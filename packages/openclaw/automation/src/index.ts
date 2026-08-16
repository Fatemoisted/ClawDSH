/**
 * OpenClaw-cron-style scheduled agent turns.
 *
 * Each rule declares a schedule (`cron` via the croner library OpenClaw
 * proves, one-shot `at`, or anchored `every`) and a message. On each
 * occurrence the rule's dedicated durable agent session (`automation:<id>`,
 * resumed across restarts) runs one ordinary turn: the framed message is
 * queued with a plugin source, the turn is driven to quiescence with the same
 * `followup → whenIdle → sessions.flush` idiom used by channel-agent and headless
 * prove, and `automation/run` records bookend the turn in the session log —
 * the log itself is the run log.
 *
 * One unref'd re-arming timer wakes for the earliest occurrence (OpenClaw's
 * scheduler shape). Semantics are OpenClaw-isomorphic: at-least-once (a
 * durable `started` record lands before the turn), no automatic retries,
 * in-flight dedup, missed occurrences skipped (no catch-up), and one-shot
 * `at` rules become terminal after their first attempt. `ctx.schedule` is
 * deliberately not used: its 300s `every` floor,
 * session-local delivery, live-root-only runtime attach, and tools-only
 * creation API cannot express minute-granularity cron with one dedicated
 * durable session per rule (see the cron-mapping Agent Note).
 * @module @clawdsh/dsh-automation
 */

import { Cron } from 'croner'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { installModelSelection, type AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-workspace'

export type { AutomationRunEvent } from './types.ts'

/** Longest timer delay Node accepts; longer waits re-arm on wake (schedule package convention). */
export const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Grammar for rule ids: filename-safe, since the id lands in the persisted session name. */
const RULE_ID = /^[a-zA-Z0-9_-]+$/

/** Cordis plugin name. */
export const name = 'automation'

/** User-settings namespace for scheduled ClawDSH turns. */
export const AUTOMATION_SETTINGS_NAMESPACE = settingsNamespace('clawdsh-automation')

/** Agent, preset, session, model-selection, and settings services this row requires. */
export const inject = ['agents', 'agentPresets', 'sessions', 'agentDefaultModel', 'settings']

/** A 5-field cron schedule with an optional IANA timezone. */
export interface CronSchedule {
  /** Discriminant: cron schedule. */
  kind: 'cron'
  /** 5-field cron expression, e.g. `0 9 * * *`. */
  expr: string
  /** IANA timezone name; omitted means the process timezone. */
  timeZone?: string
}

/** A one-shot absolute-time schedule. */
export interface AtSchedule {
  /** Discriminant: one-shot schedule. */
  kind: 'at'
  /** ISO/RFC 3339 occurrence time, e.g. `2026-08-17T09:00:00+08:00`. */
  at: string
}

/** An anchored fixed-interval schedule in seconds. */
export interface EverySchedule {
  /** Discriminant: interval schedule. */
  kind: 'every'
  /** Interval length in whole seconds (min 1); the first occurrence follows one full interval. */
  seconds: number
}

/** One scheduled rule. */
export interface AutomationRule {
  /** Stable rule identity; also the session id suffix `automation:<id>`. */
  id: string
  /** Optional human label carried in the turn framing. */
  name?: string
  /** When the rule fires: cron, one-shot at, or anchored every. */
  schedule: CronSchedule | AtSchedule | EverySchedule
  /** Message text sent to the rule's agent on each occurrence. */
  message: string
  /** Whether the rule participates; defaults to true. */
  enabled?: boolean
}

/** Plugin config: the declared rule set. cordis.yml is the durable store — no separate storage seam. */
export interface Config {
  /** Whether any automation runtime, timer, or durable session may start. */
  enabled?: boolean
  /** Agent preset mounted for every scheduled session. */
  preset?: string
  /** Absolute workspace path recorded on every newly created scheduled session. */
  cwd?: string
  /** Scheduled rules; each gets its own durable agent session. */
  rules?: AutomationRule[]
}

const absoluteCwd = z.transform(z.string().min(1), (value) => {
  if (!/^(?:\/|[a-zA-Z]:[\\/]|\\\\)/u.test(value)) {
    throw new TypeError('automation: cwd must be an absolute path')
  }
  return value
}, true)

/** Runtime schema for the automation row. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false),
  preset: z.string().min(1).default('clawdsh'),
  cwd: absoluteCwd.default(process.cwd()),
  rules: z.array(z.object({
    id: z.string().min(1),
    name: z.string().default(''),
    schedule: z.union([
      z.object({ kind: z.const('cron'), expr: z.string().min(1), timeZone: z.string().default('') }),
      z.object({ kind: z.const('at'), at: z.string().min(1) }),
      z.object({ kind: z.const('every'), seconds: z.number().step(1).min(1) }),
    ]),
    message: z.string().min(1),
    enabled: z.boolean().default(true),
  })).default([]),
})

/** Rule with defaults applied and occurrence time parsed, for raw (non-Loader) callers. */
interface ResolvedRule extends AutomationRule {
  name: string
  enabled: boolean
  /** Epoch ms of the one-shot occurrence (kind `at`). */
  atMs: number
}

/** One rule's live state. */
interface RuleState {
  rule: ResolvedRule
  handle?: AgentHandle
  cron?: Cron
  /** Epoch ms of the next occurrence; infinity when no future occurrence exists. */
  nextRunAt: number
  /** In-flight guard: a running occurrence skips overlapping fires (OpenClaw `runningAtMs`). */
  running: boolean
  /** One-shot `at` rules stop after their first terminal attempt. */
  completed: boolean
  /** Mount-time anchor of `every` rules. */
  anchorMs: number
}

/** Minimal optional persistence surface used to distinguish absent sessions from resume failures. */
interface SessionPersistenceReader {
  list(): Promise<SessionHeader[]>
}

/** Narrow an optional Cordis service without importing a persistence implementation. */
function isSessionPersistenceReader(value: unknown): value is SessionPersistenceReader {
  return typeof value === 'object' && value !== null && 'list' in value && typeof value.list === 'function'
}

/** Parse a config value into defaults and schedule facts; a malformed value throws. */
function resolveRule(rule: AutomationRule): ResolvedRule {
  if (!RULE_ID.test(rule.id)) {
    throw new Error(`automation: rule "${rule.id}" has an invalid id; use only letters, digits, "_", and "-"`)
  }
  if (rule.schedule.kind === 'at') {
    const atMs = new Date(rule.schedule.at).getTime()
    if (!Number.isFinite(atMs)) {
      throw new Error(`automation: rule "${rule.id}" has an invalid "at" time ${JSON.stringify(rule.schedule.at)}`)
    }
    return { ...rule, name: rule.name ?? '', enabled: rule.enabled ?? true, atMs }
  }
  return { ...rule, name: rule.name ?? '', enabled: rule.enabled ?? true, atMs: 0 }
}

/** Validate a cron expression and IANA timezone; both throw on invalid input. */
function validateCronSchedule(rule: AutomationRule): void {
  if (rule.schedule.kind !== 'cron') return
  try {
    new Cron(rule.schedule.expr, rule.schedule.timeZone ? { timezone: rule.schedule.timeZone } : undefined)
  } catch (error) {
    throw new Error(`automation: rule "${rule.id}" has an invalid cron expression ${JSON.stringify(rule.schedule.expr)}: ${errorMessage(error)}`)
  }
  if (rule.schedule.timeZone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: rule.schedule.timeZone }).format(new Date(0))
    } catch {
      throw new Error(`automation: rule "${rule.id}" has an invalid timezone ${JSON.stringify(rule.schedule.timeZone)}`)
    }
  }
}

/**
 * Mount the automation row: validate rules, acquire one durable agent session
 * per rule, arm the re-arming timer, and register teardown.
 * @param ctx - Cordis context carrying the agent registry and session store.
 * @param config - the declared rule set.
 * @returns fulfillment after every enabled rule has a composed, discoverable agent session.
 */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const settings = ctx.get('settings')
  const runtimeConfig = settings?.register(AUTOMATION_SETTINGS_NAMESPACE, Config, {
    base: config,
    applies: 'restart',
    validate: value => void resolveConfig(value),
  }).get() ?? Config(config)
  const rules = resolveConfig(runtimeConfig)
  if (!(runtimeConfig.enabled ?? false)) return
  const runtime = new AutomationRuntime(
    ctx,
    rules,
    runtimeConfig.preset ?? 'clawdsh',
    runtimeConfig.cwd ?? process.cwd(),
  )
  // Cordis's async effect is the lifecycle barrier: unload waits for a late
  // acquire to settle before invoking (and awaiting) the runtime disposer.
  await ctx.effect(async () => {
    await runtime.initialize()
    return () => runtime.dispose()
  }, 'automation.runtime()')
}

function resolveConfig(config: Config): ResolvedRule[] {
  const cwd = config.cwd ?? process.cwd()
  if (!isAbsolute(cwd)) throw new TypeError('automation: cwd must be an absolute path')
  return resolveRules(config)
}

function resolveRules(config: Config): ResolvedRule[] {
  const rules = (config.rules ?? []).map(rule => resolveRule(rule))
  const ids = new Set<string>()
  for (const rule of rules) {
    if (ids.has(rule.id)) throw new Error(`automation: duplicate rule id "${rule.id}"`)
    ids.add(rule.id)
    validateCronSchedule(rule)
  }
  return rules
}

/** Owns the rule states, the re-arming timer, and the per-rule agent handles. */
class AutomationRuntime {
  private readonly states: RuleState[]
  private timer: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  private readonly lifetime = new AbortController()
  private initialization: Promise<void> | undefined
  private disposal: Promise<void> | undefined
  private readonly ticks = new Set<Promise<void>>()

  constructor(
    private readonly ctx: Context,
    rules: ResolvedRule[],
    private readonly preset: string,
    private readonly cwd: string,
  ) {
    this.states = rules
      .filter(rule => rule.enabled)
      .map((rule) => {
        const state: RuleState = { rule, nextRunAt: Number.POSITIVE_INFINITY, running: false, completed: false, anchorMs: 0 }
        if (rule.schedule.kind === 'cron') {
          state.cron = new Cron(rule.schedule.expr, rule.schedule.timeZone ? { timezone: rule.schedule.timeZone } : undefined)
        }
        return state
      })
  }

  /** Acquire each rule's dedicated session and arm the first occurrences. */
  initialize(): Promise<void> {
    return (this.initialization ??= this.initializeAll())
  }

  private async initializeAll(): Promise<void> {
    try {
      for (const state of this.states) {
        const handle = await this.acquireAgent(state)
        if (this.disposed) {
          await handle.dispose()
          return
        }
        state.handle = handle
        if (this.atAlreadyTerminal(state)) {
          state.completed = true
          continue
        }
        const now = Date.now()
        state.anchorMs = now
        this.scheduleNext(state, now, true)
      }
      this.arm()
    } catch (error) {
      this.disposed = true
      this.lifetime.abort(new Error('automation initialization failed'))
      await this.disposeHandles()
      throw error
    }
  }

  dispose(): Promise<void> {
    return (this.disposal ??= this.disposeAll())
  }

  private async disposeAll(): Promise<void> {
    this.disposed = true
    this.lifetime.abort(new Error('automation runtime disposed'))
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    await this.initialization?.catch(() => undefined)
    for (const state of this.states) {
      state.handle?.agent.cancel({ kind: 'disposed' })
    }
    await Promise.allSettled([...this.ticks])
    await this.disposeHandles()
  }

  /** Resume the rule's persisted session, or create it fresh when no artifact exists. */
  private async acquireAgent(state: RuleState): Promise<AgentHandle> {
    const sessionId = SessionId(`automation:${state.rule.id}`)
    const selection = this.ctx.agentDefaultModel.currentSelection()
    const agentOptions = { provider: selection.provider, model: selection.model }
    const setup = async (agentCtx: Context): Promise<void> => {
      installModelSelection(agentCtx, { current: selection, assembled: undefined })
      await this.ctx.agentPresets.mount(agentCtx, this.preset)
    }
    const persistence: unknown = this.ctx.get('sessionPersistence')
    let handle: AgentHandle | undefined
    try {
      if (isSessionPersistenceReader(persistence)) {
        try {
          const candidate = await this.ctx.agents.resume({
            resumeSessionId: sessionId,
            agentOptions,
            setup,
            signal: this.lifetime.signal,
          })
          handle = await settledAgentHandle(candidate, state.rule.id)
        } catch (error) {
          const exists = (await persistence.list()).some((header: SessionHeader) => header.id === sessionId)
          if (exists) throw error
        }
      }
      if (handle === undefined) {
        const candidate = await this.ctx.agents.create({
          sessionId,
          meta: { cwd: this.cwd, agentPreset: this.preset },
          agentOptions,
          setup,
          signal: this.lifetime.signal,
        })
        handle = await settledAgentHandle(candidate, state.rule.id)
      }
      await this.makeDiscoverable(handle, state.rule)
      return handle
    } catch (error) {
      await handle?.dispose()
      throw new Error(`automation: cannot acquire agent for rule "${state.rule.id}": ${errorMessage(error)}`, { cause: error })
    }
  }

  /** Publish a readable title and membership in the workspace recorded by the immutable session header. */
  private async makeDiscoverable(handle: AgentHandle, rule: ResolvedRule): Promise<void> {
    const { session } = handle.agent
    const workspaceRegistry = this.ctx.get('workspaceRegistry')
    const sessionCwd = session.header.cwd
    const workspace = workspaceRegistry === undefined || sessionCwd === undefined
      ? undefined
      : await workspaceRegistry.resolveByPath(sessionCwd)
    if (workspaceRegistry !== undefined && sessionCwd !== undefined && workspace === undefined) {
      throw new Error('no registered workspace owns the Automation session cwd')
    }
    const sessionTitle = this.ctx.get('sessionTitle')
    if (sessionTitle !== undefined && sessionTitle.get(session) === undefined) {
      sessionTitle.rename(session, `自动任务 · ${rule.name || rule.id}`)
    }
    await this.ctx.sessions.flush(session)
    await workspace?.attachSession(session.id)
  }

  /** Whether a one-shot `at` rule already recorded a terminal run for its occurrence. */
  private atAlreadyTerminal(state: RuleState): boolean {
    if (state.rule.schedule.kind !== 'at' || state.handle === undefined) return false
    const scheduledAt = new Date(state.rule.atMs).toISOString()
    return state.handle.agent.session.events.some((event: SessionEvent) =>
      event.type === 'automation/run'
      && event.data.ruleId === state.rule.id
      && (event.data.status === 'ok' || event.data.status === 'error')
      && event.data.scheduledAt === scheduledAt)
  }

  /** Advance `nextRunAt`; an interval's first occurrence follows one complete period. */
  private scheduleNext(state: RuleState, now: number, boot: boolean): void {
    const { schedule } = state.rule
    if (schedule.kind === 'cron') {
      const next = state.cron?.nextRun(new Date(now))
      state.nextRunAt = next === undefined || next === null ? Number.POSITIVE_INFINITY : next.getTime()
      return
    }
    if (schedule.kind === 'at') {
      state.nextRunAt = state.completed ? Number.POSITIVE_INFINITY : state.rule.atMs
      return
    }
    if (boot) {
      state.nextRunAt = now + schedule.seconds * 1_000
      return
    }
    // Strictly future occurrence on the anchor grid; missed ticks are skipped.
    const everyMs = schedule.seconds * 1_000
    state.nextRunAt = state.anchorMs + (Math.floor((now - state.anchorMs) / everyMs) + 1) * everyMs
  }

  /** Arm one unref'd timer for the earliest upcoming occurrence; long waits re-arm on wake. */
  private arm(): void {
    if (this.disposed) return
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    const targets = this.states
      .filter(state => !state.completed && !state.running)
      .map(state => state.nextRunAt)
    if (targets.length === 0) return
    const earliest = Math.min(...targets)
    if (!Number.isFinite(earliest)) return
    const delay = Math.min(Math.max(earliest - Date.now(), 0), MAX_TIMER_DELAY_MS)
    this.timer = setTimeout(() => { this.startTick() }, delay)
    this.timer.unref()
  }

  /** Track a timer callback so disposal can cancel its agent work and await convergence. */
  private startTick(): void {
    const tick = this.tick()
    this.ticks.add(tick)
    void tick.then(undefined, (error: unknown) => {
      this.ctx.logger.warn(`automation: scheduler tick failed: ${errorMessage(error)}`)
    }).finally(() => {
      this.ticks.delete(tick)
    })
  }

  /** Run all due occurrences sequentially (OpenClaw's wake shape), then re-arm. */
  private async tick(): Promise<void> {
    if (this.disposed) return
    for (const state of this.states) {
      // A prior rule can yield while disposal cancels the runtime. Re-check at
      // each rule boundary so this tick cannot start new work after teardown.
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- disposed can change while the prior runRule() is awaited.
      if (this.disposed) return
      if (state.completed || state.running || state.nextRunAt > Date.now()) continue
      await this.runRule(state)
    }
    this.arm()
  }

  /** Drive one occurrence: `started` record, framed turn, flush, `ok`/`error` record. */
  private async runRule(state: RuleState): Promise<void> {
    if (state.handle === undefined) {
      state.nextRunAt = Number.POSITIVE_INFINITY
      return
    }
    state.running = true
    const { agent } = state.handle
    const scheduledAt = new Date(state.nextRunAt).toISOString()
    let terminal: { status: 'ok' } | { status: 'error'; error: string }
    try {
      agent.session.append('automation/run', { ruleId: state.rule.id, scheduledAt, status: 'started' })
      await this.ctx.sessions.flush(agent.session)
      const firstSeq = agent.session.seq
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: `[automation:${state.rule.id}${state.rule.name ? ` ${state.rule.name}` : ''}] ${state.rule.message}` }],
        source: { kind: 'plugin', plugin: 'automation' },
      }))
      await agent.whenIdle()
      const turnEnd = agent.session.events.findLast(event =>
        event.type === 'turn/end' && event.seq >= firstSeq)
      terminal = terminalStatus(turnEnd)
    } catch (error) {
      terminal = { status: 'error', error: errorMessage(error) }
    }
    try {
      agent.session.append('automation/run', { ruleId: state.rule.id, scheduledAt, ...terminal })
      await this.ctx.sessions.flush(agent.session)
    } catch (error) {
      this.ctx.logger.warn(`automation: rule "${state.rule.id}" terminal status was not durable: ${errorMessage(error)}`)
    }
    if (terminal.status === 'error') {
      this.ctx.logger.warn(`automation: rule "${state.rule.id}" run failed: ${terminal.error}`)
    }
    if (state.rule.schedule.kind === 'at') state.completed = true
    state.running = false
    this.scheduleNext(state, Date.now(), false)
  }

  /** Dispose every published handle and clear its state only after teardown settles. */
  private async disposeHandles(): Promise<void> {
    const handles = this.states.flatMap(state => state.handle === undefined ? [] : [state.handle])
    for (const state of this.states) delete state.handle
    const results = await Promise.allSettled(handles.map(handle => handle.dispose()))
    for (const result of results) {
      if (result.status === 'rejected') {
        this.ctx.logger.warn(`automation: cannot dispose agent: ${errorMessage(result.reason)}`)
      }
    }
  }
}

/** Interpret one exact scheduled turn end; absence or non-completion is a failed run. */
function terminalStatus(event: SessionEvent | undefined): { status: 'ok' } | { status: 'error'; error: string } {
  if (event?.type !== 'turn/end') return { status: 'error', error: 'scheduled turn ended without a turn/end record' }
  const { reason } = event.data
  if (reason.kind === 'completed') return { status: 'ok' }
  if (reason.kind === 'error') return { status: 'error', error: reason.error.message }
  return { status: 'error', error: `scheduled turn ended with ${reason.kind}` }
}

/** Publish an acquired handle only after startup quiesces; dispose every failed candidate. */
async function settledAgentHandle(candidate: AgentHandle, ruleId: string): Promise<AgentHandle> {
  try {
    await candidate.agent.whenIdle()
    return candidate
  } catch (error) {
    try {
      await candidate.dispose()
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `automation: rule "${ruleId}" agent startup failed (${errorMessage(error)})`
          + ` and candidate cleanup was incomplete (${errorMessage(cleanupError)})`,
      )
    }
    throw error
  }
}

function errorMessage(error: unknown): string {
  return String(error)
}
