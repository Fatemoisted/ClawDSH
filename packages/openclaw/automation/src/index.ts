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
 * `started` record lands before the turn), no automatic retries, in-flight
 * dedup, missed occurrences skipped (no catch-up), one-shot `at` rules
 * complete after an `ok` run; a failed attempt stays dormant for this mount
 * without being mistaken for durable success. `ctx.schedule` is deliberately
 * not used: its 300s `every` floor,
 * session-local delivery, live-root-only runtime attach, and tools-only
 * creation API cannot express minute-granularity cron with one dedicated
 * durable session per rule (see the cron-mapping Agent Note).
 * @module @clawdsh/dsh-automation
 */

import { Cron } from 'croner'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { installModelSelection, type AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-agent-default-model'

export type { AutomationRunEvent } from './types.ts'

/** Longest timer delay Node accepts; longer waits re-arm on wake (schedule package convention). */
export const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Grammar for rule ids: filename-safe, since the id lands in the persisted session name. */
const RULE_ID = /^[a-zA-Z0-9_-]+$/

/** Cordis plugin name. */
export const name = 'automation'

/** User-settings namespace for scheduled ClawDSH turns. */
export const AUTOMATION_SETTINGS_NAMESPACE = settingsNamespace('clawdsh-automation')

/** Agent, session, model-selection, and settings services this row requires. */
export const inject = ['agents', 'sessions', 'agentDefaultModel', 'settings']

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
  /** Interval length in whole seconds (min 1); the first occurrence fires at mount. */
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
  /** Scheduled rules; each gets its own durable agent session. */
  rules?: AutomationRule[]
}

/** Runtime schema for the automation row. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false),
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
  /** One-shot `at` rules stop after an `ok` run. */
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
 */
export function apply(ctx: Context, config: Config = {}): void {
  const settings = ctx.get('settings')
  const runtimeConfig = settings?.register(AUTOMATION_SETTINGS_NAMESPACE, Config, {
    base: config,
    applies: 'restart',
    validate: value => void resolveRules(value),
  }).get() ?? Config(config)
  const rules = resolveRules(runtimeConfig)
  if (!(runtimeConfig.enabled ?? false)) return
  const runtime = new AutomationRuntime(ctx, rules)
  // Cordis's async effect is the lifecycle barrier: unload waits for a late
  // acquire to settle before invoking (and awaiting) the runtime disposer.
  ctx.effect(async () => {
    await runtime.initialize()
    return () => runtime.dispose()
  }, 'automation.runtime()')
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
  private tickTask: Promise<void> | undefined
  private disposed = false

  constructor(
    private readonly ctx: Context,
    rules: ResolvedRule[],
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

  /** Acquire each rule's dedicated session and arm the first occurrences. Failures log and leave the rule dormant. */
  async initialize(): Promise<void> {
    for (const state of this.states) {
      await this.acquireAgent(state)
      if (state.handle === undefined) continue
      if (this.atAlreadyCompleted(state)) {
        state.completed = true
        continue
      }
      const now = Date.now()
      state.anchorMs = now
      this.scheduleNext(state, now, true)
    }
    this.arm()
  }

  async dispose(): Promise<void> {
    this.disposed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    const tickTask = this.tickTask
    const handles = this.states.flatMap((state) => {
      const handle = state.handle
      delete state.handle
      return handle === undefined ? [] : [handle]
    })
    // AgentHandle.dispose is the harness-owned stop/drain/unregister boundary.
    // Start all drains before joining the active tick so a hanging turn is
    // cancelled and allowed to converge.
    await Promise.all(handles.map(async (handle) => {
      try {
        await handle.dispose()
      } catch (error) {
        this.ctx.logger.warn(`automation: cannot dispose agent: ${errorMessage(error)}`)
      }
    }))
    if (tickTask !== undefined) await tickTask
  }

  /** Resume the rule's persisted session, or create it fresh when no artifact exists. */
  private async acquireAgent(state: RuleState): Promise<void> {
    const sessionId = SessionId(`automation:${state.rule.id}`)
    const selection = this.ctx.agentDefaultModel.currentSelection()
    const agentOptions = { provider: selection.provider, model: selection.model }
    const setup = (agentCtx: Context) => {
      installModelSelection(agentCtx, { current: selection, assembled: undefined })
    }
    const persistence: unknown = this.ctx.get('sessionPersistence')
    try {
      if (isSessionPersistenceReader(persistence)) {
        try {
          const candidate = await this.ctx.agents.resume({ resumeSessionId: sessionId, agentOptions, setup })
          state.handle = await settledAgentHandle(candidate, state.rule.id)
          return
        } catch (error) {
          const exists = (await persistence.list()).some((header: SessionHeader) => header.id === sessionId)
          if (exists) throw error
        }
      }
      const candidate = await this.ctx.agents.create({
        sessionId,
        meta: { cwd: process.cwd() },
        agentOptions,
        setup,
      })
      state.handle = await settledAgentHandle(candidate, state.rule.id)
    } catch (error) {
      this.ctx.logger.warn(`automation: cannot acquire agent for rule "${state.rule.id}": ${errorMessage(error)}`)
    }
  }

  /** Whether a one-shot `at` rule already recorded an `ok` run for its occurrence in the session log. */
  private atAlreadyCompleted(state: RuleState): boolean {
    if (state.rule.schedule.kind !== 'at' || state.handle === undefined) return false
    const scheduledAt = new Date(state.rule.atMs).toISOString()
    return state.handle.agent.session.events.some((event: SessionEvent) =>
      event.type === 'automation/run'
      && event.data.ruleId === state.rule.id
      && event.data.status === 'ok'
      && event.data.scheduledAt === scheduledAt)
  }

  /** Advance `nextRunAt` to the occurrence at or after `now`; `boot` permits an immediate first occurrence. */
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
      // First occurrence at mount time (OpenClaw: first run at/after the anchor).
      state.nextRunAt = now
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
    this.timer = setTimeout(() => {
      this.tickTask = this.tick().catch((error: unknown) => {
        this.ctx.logger.warn(`automation: scheduler tick failed: ${errorMessage(error)}`)
      })
    }, delay)
    this.timer.unref()
  }

  /** Run all due occurrences sequentially (OpenClaw's wake shape), then re-arm. */
  private async tick(): Promise<void> {
    if (this.disposed) return
    const now = Date.now()
    for (const state of this.states) {
      if (state.completed || state.running || state.nextRunAt > now) continue
      await this.runRule(state, now)
    }
    this.arm()
  }

  /** Drive one occurrence: `started` record, framed turn, flush, `ok`/`error` record. */
  private async runRule(state: RuleState, now: number): Promise<void> {
    if (state.handle === undefined) {
      state.nextRunAt = Number.POSITIVE_INFINITY
      return
    }
    state.running = true
    const { agent } = state.handle
    const scheduledAt = new Date(state.nextRunAt).toISOString()
    const firstSeq = agent.session.seq
    try {
      agent.session.append('automation/run', { ruleId: state.rule.id, scheduledAt, status: 'started' })
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: `[automation:${state.rule.id}${state.rule.name ? ` ${state.rule.name}` : ''}] ${state.rule.message}` }],
        source: { kind: 'plugin', plugin: 'automation' },
      }))
      await agent.whenIdle()
      // Adapter and driver failures are contained by the loop; the turn's own
      // `turn/end` reason is the authoritative failure record.
      const turnEnd = agent.session.events.findLast(event =>
        event.type === 'turn/end' && event.seq >= firstSeq)
      const failure = turnEnd?.type === 'turn/end'
        ? turnFailure(turnEnd.data.reason)
        : 'Agent reached idle without a terminal turn record.'
      if (failure === undefined) {
        agent.session.append('automation/run', { ruleId: state.rule.id, scheduledAt, status: 'ok' })
        if (state.rule.schedule.kind === 'at') state.completed = true
      } else {
        agent.session.append('automation/run', { ruleId: state.rule.id, scheduledAt, status: 'error', error: failure })
        this.ctx.logger.warn(`automation: rule "${state.rule.id}" run failed: ${failure}`)
      }
      // The final record must be durable before the run returns: the `at`
      // once-guard re-reads it from storage on the next mount.
      await this.ctx.sessions.flush(agent.session)
    } catch (error) {
      agent.session.append('automation/run', { ruleId: state.rule.id, scheduledAt, status: 'error', error: errorMessage(error) })
      this.ctx.logger.warn(`automation: rule "${state.rule.id}" run failed: ${errorMessage(error)}`)
    } finally {
      state.running = false
    }
    // An `at` rule has no next occurrence. Success is the durable once-guard;
    // failure remains non-completed so a later remount can recover it, but this
    // mounted runtime never turns a past timestamp into a zero-delay retry loop.
    if (state.rule.schedule.kind === 'at') {
      state.nextRunAt = Number.POSITIVE_INFINITY
    } else {
      this.scheduleNext(state, now, false)
    }
  }
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

/** Map only genuinely successful Agent terminals to success. */
function turnFailure(reason: SessionEvent<'turn/end'>['data']['reason']): string | undefined {
  if (reason.kind === 'completed' || reason.kind === 'max-tokens') return undefined
  if (reason.kind === 'error') return reason.error.message
  if (reason.kind === 'blocked') return 'Agent policy blocked the automation turn.'
  if (reason.kind === 'aborted') return `Agent automation turn was aborted (${reason.reason.kind}).`
  return 'Agent automation turn did not complete.'
}

function errorMessage(error: unknown): string {
  return String(error)
}
