/**
 * OpenClaw-cron-style scheduled agent turns.
 *
 * Each rule declares a schedule (`cron` through croner, one-shot `at`, or
 * anchored `every`) and a message. On each
 * occurrence the rule's dedicated durable agent session (`automation:<id>`,
 * resumed across restarts) runs one ordinary turn: the framed message is
 * queued with a plugin source, the turn is driven to quiescence with the same
 * `followup → whenIdle → sessions.flush` sequence used by channel-agent and
 * headless execution, and `automation/run` records bookend the turn in the session log —
 * the log itself is the run log.
 *
 * The always-mounted `automation` tool is the sole model authority for rule
 * CRUD. Rule changes are persisted through Settings and replace the immutable
 * scheduler runtime immediately. An owner-authenticated Channel turn captures
 * its durable route privately, so a successful scheduled answer returns to
 * the originating conversation without making destination ids model inputs.
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
import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ChannelActionId, ChannelActionTargetV1, ChannelActionV1 } from '@clawdsh/dsh-channel'
import type {} from '@clawdsh/dsh-channel'
import { deepEqualJson, settingsNamespace, type SettingsScope } from '@deepseek-ai/dsh-settings'
import { installModelSelection, type Agent, type AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
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

/** Agent, preset, session, model-selection, settings, and tool services this row requires. */
export const inject = ['agents', 'agentPresets', 'sessions', 'agentDefaultModel', 'settings', 'tools']

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

/** Private channel destination captured from an owner-authenticated inbound message. */
export interface AutomationChannelDelivery {
  /** Delivery discriminant. */
  readonly kind: 'channel'
  /** Gateway state lineage that admitted the creating message. */
  readonly gatewayInstanceId: string
  /** OpenClaw channel plugin identity. */
  readonly channel: string
  /** Platform account identity. */
  readonly account: string
  /** Platform conversation identity. */
  readonly conversation: string
  /** Platform thread identity when present. */
  readonly thread?: string
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
  /** Optional owner-bound origin channel; never accepted as a model tool argument. */
  delivery?: AutomationChannelDelivery
}

/** Plugin config and resolved Settings value; the Settings user layer is the durable mutable store. */
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
    delivery: z.union([
      z.never(),
      z.object({
        kind: z.const('channel'),
        gatewayInstanceId: z.string().min(1).required(),
        channel: z.string().min(1).required(),
        account: z.string().min(1).required(),
        conversation: z.string().min(1).required(),
        thread: z.string().min(1),
      }),
    ]),
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
    /* v8 ignore next -- Config materializes the rule-level name and enabled defaults before resolveRules dispatches here. */
    return { ...rule, name: rule.name ?? '', enabled: rule.enabled ?? true, atMs }
  }
  /* v8 ignore next -- Config materializes the rule-level name and enabled defaults before resolveRules dispatches here. */
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
  const scope = ctx.settings.register(AUTOMATION_SETTINGS_NAMESPACE, Config, {
    base: config,
    applies: 'live',
    validate: value => void resolveConfig(value),
  })
  const coordinator = new AutomationCoordinator(ctx, scope)
  ctx.effect(() => registerAutomationTool(ctx, coordinator))
  // Cordis's async effect is the lifecycle barrier: unload waits for a late
  // settings reconciliation before invoking (and awaiting) the runtime disposer.
  await ctx.effect(async () => {
    const unwatch = scope.watch(next => coordinator.reconcile(next))
    try {
      await coordinator.reconcile(scope.get())
    } catch (error) {
      unwatch()
      await coordinator.dispose()
      throw error
    }
    return async () => {
      unwatch()
      await coordinator.dispose()
    }
  }, 'automation.runtime()')
}

/** Serialized live replacement of the immutable scheduler runtime. */
class AutomationCoordinator {
  private runtime: AutomationRuntime | undefined
  private desired: Config | undefined
  private disposed = false
  private reconcileTail: Promise<void> = Promise.resolve()
  private mutationTail: Promise<void> = Promise.resolve()

  constructor(
    private readonly ctx: Context,
    private readonly scope: SettingsScope<Config>,
  ) {}

  /** Replace the applied runtime after one committed Settings revision. */
  reconcile(config: Config): Promise<void> {
    const next = Config(config)
    if (deepEqualJson(this.desired, next)) return this.reconcileTail
    this.desired = structuredClone(next)
    const operation = this.reconcileTail.catch(() => undefined).then(async () => {
      if (this.disposed) return
      await this.runtime?.dispose()
      this.runtime = undefined
      const rules = resolveConfig(next)
      /* v8 ignore next -- Config materializes the top-level enabled default before this operation is queued. */
      const enabled = next.enabled ?? false
      if (!enabled) return
      const candidate = new AutomationRuntime(
        this.ctx,
        rules,
        /* v8 ignore next -- Config materializes the preset default before this operation is queued. */
        next.preset ?? 'clawdsh',
        /* v8 ignore next -- Config materializes the cwd default before this operation is queued. */
        next.cwd ?? process.cwd(),
      )
      await candidate.initialize()
      if (this.isDisposed()) {
        await candidate.dispose()
        return
      }
      this.runtime = candidate
    })
    this.reconcileTail = operation
    return operation
  }

  /** Serialize one tool-authored rule mutation and await its live application. */
  mutate(change: (current: Config) => { enabled: boolean; rules: AutomationRule[] }): Promise<void> {
    const operation = this.mutationTail.catch(() => undefined).then(async () => {
      if (this.disposed) throw new Error('automation: runtime is disposed')
      const patch = change(this.scope.get())
      await this.scope.update(patch)
      await this.reconcile(this.scope.get())
    })
    this.mutationTail = operation
    return operation
  }

  /** Current resolved Settings plus per-rule scheduler state. */
  snapshot(): { config: Config; states: ReadonlyMap<string, AutomationRuleStatus> } {
    return { config: this.scope.get(), states: this.runtime?.snapshot() ?? new Map() }
  }

  /** Re-read disposal after an awaited operation that may let lifecycle teardown run. */
  private isDisposed(): boolean {
    return this.disposed
  }

  /** Stop accepting mutations, drain reconciliation, and release the active runtime. */
  async dispose(): Promise<void> {
    this.disposed = true
    await this.mutationTail.catch(() => undefined)
    await this.reconcileTail.catch(() => undefined)
    await this.runtime?.dispose()
    this.runtime = undefined
  }
}

interface AutomationRuleStatus {
  readonly nextRunAt: string | null
  readonly running: boolean
  readonly completed: boolean
}

function registerAutomationTool(ctx: Context, coordinator: AutomationCoordinator): () => void {
  return ctx.tools.register(defineTool({
    name: 'automation',
    description: 'Create, list, update, or remove durable scheduled ClawDSH tasks. '
      + 'For reminders, future work, and recurring tasks, always use this tool; never substitute Bash, Batch, jobs, sleep, or a background process. '
      + 'A task created from an owner-authenticated channel returns its final answer to that same channel conversation.',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'add', 'update', 'remove'] },
      id: { type: 'string', description: 'Exact task id returned by list; required for update and remove.' },
      name: { type: 'string', description: 'Optional human-readable task name.' },
      message: { type: 'string', description: 'The complete instruction to run; required for add.' },
      enabled: { type: 'boolean', description: 'Whether this task is active; update only.' },
      after_seconds: { type: 'integer', description: 'One-shot delay from now in positive whole seconds.' },
      at: { type: 'string', description: 'One-shot absolute RFC 3339 time.' },
      every_seconds: { type: 'integer', description: 'Recurring interval in positive whole seconds.' },
      cron: { type: 'string', description: 'Recurring 5-field cron expression.' },
      time_zone: { type: 'string', description: 'Optional IANA timezone used only with cron.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (args.action === 'list') return automationToolValue(coordinator)
      const origin = requireHumanOrigin(exec.agent)
      if (args.action === 'add') {
        const schedule = scheduleFromTool(args, true)
        const message = requiredText(args.message, 'message')
        const id = `rule-${randomUUID()}`
        await coordinator.mutate((current) => {
          /* v8 ignore next -- SettingsScope.get returns the Config-resolved rules array, including its empty default. */
          const rules = current.rules ?? []
          return {
            enabled: true,
            rules: [
              ...rules,
              {
                id,
                name: args.name?.trim() ?? '',
                message,
                schedule: schedule as CronSchedule | AtSchedule | EverySchedule,
                enabled: true,
                ...(origin.delivery === undefined ? {} : { delivery: origin.delivery }),
              },
            ],
          }
        })
        return automationToolValue(coordinator, id)
      }
      const id = requiredText(args.id, 'id')
      if (args.action === 'remove') {
        assertNoScheduleArgs(args)
        await coordinator.mutate((current) => {
          /* v8 ignore next -- SettingsScope.get returns the Config-resolved rules array, including its empty default. */
          const rules = current.rules ?? []
          if (!rules.some(rule => rule.id === id)) throw new Error(`automation: unknown task id "${id}"`)
          const next = rules.filter(rule => rule.id !== id)
          return { enabled: next.some(rule => rule.enabled !== false), rules: next }
        })
        return automationToolValue(coordinator)
      }
      const schedule = scheduleFromTool(args, false)
      await coordinator.mutate((current) => {
        /* v8 ignore next -- SettingsScope.get returns the Config-resolved rules array, including its empty default. */
        const rules = current.rules ?? []
        if (!rules.some(rule => rule.id === id)) throw new Error(`automation: unknown task id "${id}"`)
        const next = rules.map(rule => rule.id !== id ? rule : {
          ...rule,
          ...(args.name === undefined ? {} : { name: args.name.trim() }),
          ...(args.message === undefined ? {} : { message: requiredText(args.message, 'message') }),
          ...(args.enabled === undefined ? {} : { enabled: args.enabled }),
          ...(schedule === undefined ? {} : { schedule }),
        })
        return { enabled: next.some(rule => rule.enabled !== false), rules: next }
      })
      return automationToolValue(coordinator, id)
    },
  }))
}

interface HumanOrigin {
  readonly delivery?: AutomationChannelDelivery
}

/** Whether one durable event carries direct human input rather than derived model context. */
function isDirectHumanInput(event: SessionEvent): boolean {
  if (event.type !== 'user/message') return false
  const source: unknown = event.data.source
  return isRecord(source) && (source.kind === 'user' || source.kind === 'channel')
}

/** Resolve direct human authority from the active turn, ignoring injected context messages. */
function requireHumanOrigin(agent: Agent | undefined): HumanOrigin {
  if (agent === undefined) throw new Error('automation: task mutation requires an owning Agent session')
  const turnStart = agent.session.events.findLastIndex(event => event.type === 'turn/start')
  if (turnStart === -1) throw new Error('automation: task mutation requires direct human input in the active turn')
  const input = agent.session.events.slice(turnStart + 1).findLast(isDirectHumanInput)
  if (input?.type !== 'user/message') {
    throw new Error('automation: task mutation requires direct human input in the active turn')
  }
  const source: unknown = input.data.source
  /* v8 ignore next -- isDirectHumanInput accepted this same immutable Session event only after proving its source is a record. */
  if (!isRecord(source)) throw new Error('automation: task mutation requires direct human input in the active turn')
  if (source.kind === 'user') return {}
  if (source.kind !== 'channel' || source.trust !== 'owner') {
    throw new Error('automation: channel task mutation requires an owner-authenticated message')
  }
  for (const field of ['gatewayInstanceId', 'channel', 'account', 'conversation'] as const) {
    if (typeof source[field] !== 'string' || source[field].length === 0) {
      throw new Error('automation: channel message is missing its durable delivery route')
    }
  }
  return {
    delivery: {
      kind: 'channel',
      gatewayInstanceId: source.gatewayInstanceId as string,
      channel: source.channel as string,
      account: source.account as string,
      conversation: source.conversation as string,
      ...(typeof source.thread === 'string' && source.thread.length > 0 ? { thread: source.thread } : {}),
    },
  }
}

interface AutomationToolScheduleArgs {
  readonly after_seconds?: number
  readonly at?: string
  readonly every_seconds?: number
  readonly cron?: string
  readonly time_zone?: string
}

function scheduleFromTool(args: AutomationToolScheduleArgs, required: boolean): AutomationRule['schedule'] | undefined {
  const selectors = [args.after_seconds, args.at, args.every_seconds, args.cron].filter(value => value !== undefined)
  if (selectors.length === 0) {
    if (args.time_zone !== undefined) throw new Error('automation: time_zone requires cron')
    if (required) throw new Error('automation: add requires exactly one of after_seconds, at, every_seconds, or cron')
    return undefined
  }
  if (selectors.length !== 1) throw new Error('automation: supply exactly one schedule selector')
  if (args.after_seconds !== undefined) {
    positiveSafeInteger(args.after_seconds, 'after_seconds')
    if (args.time_zone !== undefined) throw new Error('automation: time_zone requires cron')
    return { kind: 'at', at: new Date(Date.now() + args.after_seconds * 1_000).toISOString() }
  }
  if (args.at !== undefined) {
    if (args.time_zone !== undefined) throw new Error('automation: time_zone requires cron')
    return { kind: 'at', at: requiredText(args.at, 'at') }
  }
  if (args.every_seconds !== undefined) {
    positiveSafeInteger(args.every_seconds, 'every_seconds')
    if (args.time_zone !== undefined) throw new Error('automation: time_zone requires cron')
    return { kind: 'every', seconds: args.every_seconds }
  }
  return {
    kind: 'cron',
    expr: requiredText(args.cron, 'cron'),
    ...(args.time_zone === undefined || args.time_zone.trim() === '' ? {} : { timeZone: args.time_zone.trim() }),
  }
}

function assertNoScheduleArgs(args: AutomationToolScheduleArgs): void {
  if ([args.after_seconds, args.at, args.every_seconds, args.cron, args.time_zone].some(value => value !== undefined)) {
    throw new Error('automation: remove does not accept schedule fields')
  }
}

function positiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`automation: ${field} must be a positive safe integer`)
}

function requiredText(value: string | undefined, field: string): string {
  const text = value?.trim()
  if (text === undefined || text.length === 0) throw new Error(`automation: ${field} must be non-empty`)
  return text
}

function automationToolValue(coordinator: AutomationCoordinator, selectedId?: string): Record<string, JsonValue> {
  const { config, states } = coordinator.snapshot()
  return {
    /* v8 ignore next -- SettingsScope.get returns Config-resolved enabled with its false default materialized. */
    enabled: config.enabled ?? false,
    /* v8 ignore next -- SettingsScope.get returns Config-resolved rules with its empty-array default materialized. */
    tasks: (config.rules ?? []).map((rule) => {
      const status = states.get(rule.id)
      return {
        id: rule.id,
        /* v8 ignore next -- Config materializes every rule name before SettingsScope.get returns it. */
        name: rule.name ?? '',
        message: rule.message,
        /* v8 ignore next -- Config materializes every rule enabled flag before SettingsScope.get returns it. */
        enabled: rule.enabled ?? true,
        schedule: scheduleJson(rule.schedule),
        delivery: rule.delivery?.kind === 'channel' ? 'origin-channel' : 'session',
        next_run_at: status?.nextRunAt ?? null,
        running: status?.running ?? false,
        completed: status?.completed ?? false,
        selected: rule.id === selectedId,
      }
    }),
  }
}

function scheduleJson(schedule: AutomationRule['schedule']): Record<string, JsonValue> {
  if (schedule.kind === 'cron') {
    return {
      kind: 'cron',
      expr: schedule.expr,
      /* v8 ignore next -- Config materializes an omitted cron timezone as the empty string before this formatter receives it. */
      ...(schedule.timeZone === undefined ? {} : { timeZone: schedule.timeZone }),
    }
  }
  if (schedule.kind === 'at') return { kind: 'at', at: schedule.at }
  return { kind: 'every', seconds: schedule.seconds }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function resolveConfig(config: Config): ResolvedRule[] {
  /* v8 ignore next -- Config materializes cwd before Settings validation and reconciliation call this defensive host check. */
  const cwd = config.cwd ?? process.cwd()
  /* v8 ignore next -- Windows accepts every Config-permitted path spelling; the POSIX runIf test owns this peer-platform rejection. */
  if (!isAbsolute(cwd)) throw new TypeError('automation: cwd must be an absolute path')
  return resolveRules(config)
}

function resolveRules(config: Config): ResolvedRule[] {
  /* v8 ignore next -- Config materializes rules as an empty array before Settings validation and reconciliation call this parser. */
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

  /** @returns secret-free timer state keyed by rule id. */
  snapshot(): ReadonlyMap<string, AutomationRuleStatus> {
    return new Map(this.states.map(state => [state.rule.id, {
      nextRunAt: Number.isFinite(state.nextRunAt) ? new Date(state.nextRunAt).toISOString() : null,
      running: state.running,
      completed: state.completed,
    }]))
  }

  private async initializeAll(): Promise<void> {
    try {
      for (const state of this.states) {
        const handle = await this.acquireAgent(state)
        /* v8 ignore next 4 -- the Coordinator does not publish or dispose this runtime until initialize() has fulfilled. */
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
    /* v8 ignore next -- a runtime becomes disposable only after the Coordinator has awaited its successful initialization. */
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
    /* v8 ignore next 3 -- tick contains rule failures and arm uses validated state; rejection is a future-change backstop. */
    void tick.then(undefined, (error: unknown) => {
      this.ctx.logger.warn(`automation: scheduler tick failed: ${errorMessage(error)}`)
    }).finally(() => {
      this.ticks.delete(tick)
    })
  }

  /** Run all due occurrences sequentially (OpenClaw's wake shape), then re-arm. */
  private async tick(): Promise<void> {
    /* v8 ignore next -- dispose clears the timer; a started tick runs this synchronous check before disposal can interleave. */
    if (this.disposed) return
    for (const state of this.states) {
      // A prior rule can yield while disposal cancels the runtime. Re-check at
      // each rule boundary so this tick cannot start new work after teardown.
      if (this.lifetime.signal.aborted) return
      if (state.completed || state.running || state.nextRunAt > Date.now()) continue
      await this.runRule(state)
    }
    this.arm()
  }

  /** Drive one occurrence: `started` record, framed turn, flush, `ok`/`error` record. */
  private async runRule(state: RuleState): Promise<void> {
    /* v8 ignore next 4 -- arm() is called only after initializeAll has assigned a handle to every scheduled state. */
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
      if (terminal.status === 'ok' && state.rule.delivery !== undefined) {
        await this.deliverToOrigin(state.rule, scheduledAt, assistantText(agent.session.events, firstSeq))
      }
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

  /** Deliver one successful scheduled answer to its owner-authenticated origin channel. */
  private async deliverToOrigin(rule: ResolvedRule, scheduledAt: string, text: string): Promise<void> {
    if (text.length === 0) throw new Error('scheduled turn completed without a text answer for channel delivery')
    const channels = this.ctx.get('channels')
    if (channels === undefined) throw new Error('channel delivery is unavailable')
    const delivery = rule.delivery
    /* v8 ignore next -- runRule calls this method only inside its rule.delivery !== undefined branch. */
    if (delivery === undefined) return
    const target = {
      gatewayInstanceId: delivery.gatewayInstanceId,
      channel: delivery.channel,
      account: delivery.account,
      conversation: delivery.conversation,
      ...(delivery.thread === undefined || delivery.thread === '' ? {} : { thread: delivery.thread }),
    } as unknown as ChannelActionTargetV1
    const digest = createHash('sha256')
      .update(JSON.stringify(['automation-delivery-v1', rule.id, scheduledAt, target]))
      .digest('hex') as ChannelActionId
    const action: ChannelActionV1 = {
      protocolVersion: 1,
      actionId: digest,
      target,
      kind: 'send',
      text,
      media: [],
    }
    const result = await channels.action(action, this.lifetime.signal)
    if ('status' in result && result.status === 'dead-letter') {
      throw new Error(`channel delivery failed: ${result.error.message}`)
    }
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
  /* v8 ignore next -- Agent.whenIdle resolves only after followup's turn() finally appends its matching turn/end. */
  if (event?.type !== 'turn/end') return { status: 'error', error: 'scheduled turn ended without a turn/end record' }
  const { reason } = event.data
  if (reason.kind === 'completed') return { status: 'ok' }
  if (reason.kind === 'error') return { status: 'error', error: reason.error.message }
  return { status: 'error', error: `scheduled turn ended with ${reason.kind}` }
}

/** Extract the final non-empty assistant text produced by one scheduled turn. */
function assistantText(events: readonly SessionEvent[], firstSeq: number): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'assistant/message' || event.seq < firstSeq) continue
    const text = event.data.message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
      .trim()
    if (text.length > 0) return text
  }
  return ''
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
