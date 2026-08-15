/**
 * Durable Agent-plane Consumer for the OpenClaw channel Service.
 * @module @clawdsh/dsh-channel-agent
 */

import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  ChannelReplayId,
  ChannelToolCallId,
  type ChannelDeliveryReportV1,
  type ChannelDeliveryReceiptV1,
  type ChannelDriverV1,
  type ChannelRouteV1,
  type ChannelSessionCloseV1,
  type ChannelSessionResetResultV1,
  type ChannelSessionResetV1,
  type ChannelTurnCancelV1,
  type ChannelTurnEnvelopeV1,
  type ChannelTurnExecutionV1,
  type ChannelTurnNotificationV1,
  type ChannelTurnResultV1,
} from '@clawdsh/dsh-channel'
import { installModelSelection, type Agent, type AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-attachment'
import { createUserMessage, type ContentBlock, type TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-tools'
import type { ChannelMessageSource } from './events.ts'
import { importStagedImages } from './media.ts'
import { registerMessageTool } from './message-tool.ts'
import {
  bindingKey,
  channelAgentDomainSpec,
  closeRequestDigest,
  digestJson,
  generationKey,
  ledgerKey,
  resetRequestDigest,
  sessionIdFor,
  type ChannelGenerationRecord,
  type ChannelLedgerRecord,
  type ChannelSessionBindingRecord,
} from './storage.ts'

const PUBLIC_DEPENDENCY_FAILURE_MESSAGE = 'The DeepSeek Harness Agent turn failed before a safe result was committed.'

/** Installer-managed preset for OpenClaw-classified owner direct messages. */
export const MANAGED_OWNER_PRESET = 'clawdsh'

/** Installer-managed restricted preset for every other admitted route. */
export const MANAGED_SAFE_PRESET = 'clawdsh-messaging-safe'

export type { ChannelMessageSource } from './events.ts'
export { channelAgentDomainSpec } from './storage.ts'

/** Cordis plugin name. */
export const name = 'channel-agent'

/** User-settings namespace for the always-mounted Agent bridge. */
export const CHANNEL_AGENT_SETTINGS_NAMESPACE = settingsNamespace('clawdsh-channel-agent')

/** Complete seam dependencies required before channel turns can be admitted. */
export const inject = [
  'channels',
  'agents',
  'sessions',
  'sessionPersistence',
  'agentDefaultModel',
  'agentPresets',
  'attachments',
  'storageDomain',
  'tools',
  'settings',
]

/** Deployment decisions for channel-created Agents and media intake. */
export interface Config {
  /** Preset used only for an OpenClaw-classified owner DM. */
  ownerPreset: string
  /** Restricted preset used for every other sender or group. */
  safePreset: string
  /** Absolute workspace assigned to channel-created Sessions. */
  cwd: string
  /** Absolute root shared only with the authenticated local bridge. */
  stagingRoot: string
  /** Per-staged-object byte cap, no larger than the attachment-store policy. */
  maxMediaBytes: number
  /** Maximum teardown wait for accepted work to reach quiescence. */
  shutdownGraceMs: number
}

/** Runtime config schema. Deployment-varying choices are mandatory. */
export const Config: z<Config> = z.object({
  ownerPreset: z.string().min(1).default(MANAGED_OWNER_PRESET),
  safePreset: z.string().min(1).default(MANAGED_SAFE_PRESET),
  cwd: z.string().min(1).required(),
  stagingRoot: z.string().min(1).required(),
  maxMediaBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  shutdownGraceMs: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
})

interface ActiveRun {
  readonly turn: ChannelTurnEnvelopeV1
  readonly agent: Agent
}

interface InFlightTurn {
  readonly envelopeDigest: string
  readonly turn: ChannelTurnEnvelopeV1
  readonly promise: Promise<ChannelTurnResultV1>
}

interface ChannelActivitySink {
  channelDelivery(input: {
    readonly sessionId: SessionId
    readonly adapter: string
    readonly conversation: 'direct' | 'group'
    readonly mention: boolean | null
    readonly seq: number
    readonly status?: 'started' | 'failed' | 'sent'
  }): Promise<unknown>
}

/** Exact pre-Agent cancellation requested through `turn.cancel`. */
class ChannelTurnCancelledError extends Error {
  constructor(readonly reason: ChannelTurnCancelV1['reason']) {
    super(`channel-agent: channel turn was cancelled (${reason})`)
  }
}

/** Mount the durable driver after its storage domain is ready. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const settings = ctx.get('settings')
  const runtimeConfig = settings?.register(CHANNEL_AGENT_SETTINGS_NAMESPACE, Config, {
    base: config,
    applies: 'restart',
    validate: (value) => {
      validateConfig(value)
      assertManagedConfig(value, config)
    },
  }).get() ?? config
  validateConfig(runtimeConfig)
  assertManagedConfig(runtimeConfig, config)
  const driver = await ChannelAgentDriver.create(ctx, runtimeConfig)
  ctx.effect(function* () {
    yield () => driver.dispose()
    yield ctx.channels.registerDriver(driver)
  }, 'channel-agent.driver()')
}

function validateConfig(config: Config): void {
  if (!isAbsolute(config.cwd)) throw new Error('channel-agent: cwd must be absolute')
  if (!isAbsolute(config.stagingRoot)) throw new Error('channel-agent: stagingRoot must be absolute')
  if (!Number.isSafeInteger(config.maxMediaBytes) || config.maxMediaBytes <= 0) {
    throw new Error('channel-agent: maxMediaBytes must be a positive safe integer')
  }
  if (!Number.isSafeInteger(config.shutdownGraceMs) || config.shutdownGraceMs <= 0) {
    throw new Error('channel-agent: shutdownGraceMs must be a positive safe integer')
  }
}

/** Refuse user-layer replacement of installer-owned route and media identities. */
function assertManagedConfig(config: Config, base: Config): void {
  const changed = [
    config.ownerPreset === base.ownerPreset ? undefined : 'ownerPreset',
    config.safePreset === base.safePreset ? undefined : 'safePreset',
    config.stagingRoot === base.stagingRoot ? undefined : 'stagingRoot',
    config.maxMediaBytes === base.maxMediaBytes ? undefined : 'maxMediaBytes',
  ].filter((field): field is string => field !== undefined)
  if (changed.length !== 0) {
    throw new Error(`channel-agent: ${changed.join(', ')} ${changed.length === 1 ? 'is' : 'are'} installer-managed and cannot be overridden by user settings`)
  }
}

/** Durable turn driver; one instance owns every Agent handle it creates or resumes. */
export class ChannelAgentDriver implements ChannelDriverV1 {
  private readonly bindings: KvTable<string, ChannelSessionBindingRecord>
  private readonly generations: KvTable<string, ChannelGenerationRecord>
  private readonly ledger: KvTable<string, ChannelLedgerRecord>
  private readonly handles = new Map<SessionId, AgentHandle>()
  private readonly acquiring = new Map<SessionId, Promise<AgentHandle>>()
  private readonly inFlight = new Map<string, InFlightTurn>()
  private readonly active = new Map<string, ActiveRun>()
  private readonly cancellationRequests = new Map<string, ChannelTurnCancelV1['reason']>()
  private readonly turnOperations = new Map<string, Promise<void>>()
  private readonly lineageEpochs = new Map<string, number>()
  private readonly lineageOperations = new Map<string, Promise<void>>()
  private disposed = false
  private disposePromise: Promise<void> | undefined

  private constructor(
    private readonly ctx: Context,
    private readonly config: Config,
    private readonly domain: Domain<typeof channelAgentDomainSpec>,
  ) {
    this.bindings = domain.table('bindings')
    this.generations = domain.table('generations')
    this.ledger = domain.table('ledger')
  }

  /**
   * Open storage and quarantine crash-orphaned running turns.
   * @param ctx - Plugin context that owns the storage domain and Agent dependencies.
   * @param config - Validated channel Agent deployment configuration.
   * @returns A driver ready for registration after startup recovery completes.
   */
  static async create(ctx: Context, config: Config): Promise<ChannelAgentDriver> {
    if (!Number.isSafeInteger(config.shutdownGraceMs) || config.shutdownGraceMs <= 0) {
      throw new Error('channel-agent: shutdownGraceMs must be a positive safe integer')
    }
    const domain = await ctx.storageDomain.open(channelAgentDomainSpec)
    const driver = new ChannelAgentDriver(ctx, config, domain)
    const now = Date.now()
    for (const [key, record] of driver.ledger.entries()) {
      if (record.phase === 'running') {
        await driver.ledger.put(key, { ...record, phase: 'needs-recovery', updatedAt: now })
      }
    }
    return driver
  }

  /** Stop owned Agents and close the durable domain. */
  dispose(): Promise<void> {
    if (this.disposePromise !== undefined) return this.disposePromise
    this.disposed = true
    this.disposePromise = this.disposeOwnedResources()
    return this.disposePromise
  }

  /** Drain accepted work, dispose every owned Agent, and close storage exactly once. */
  private async disposeOwnedResources(): Promise<void> {
    const failures: unknown[] = []
    for (const active of this.active.values()) {
      try {
        active.agent.cancel({ kind: 'user' })
      } catch (error) {
        failures.push(error)
      }
    }
    const pending = [
      ...[...this.inFlight.values()].map(entry => entry.promise),
      ...this.acquiring.values(),
      ...this.turnOperations.values(),
      ...this.lineageOperations.values(),
    ]
    const turns = await withinShutdownGrace(Promise.allSettled(pending), this.config.shutdownGraceMs)
    for (const turn of turns) {
      if (turn.status === 'rejected') failures.push(turn.reason)
    }
    const handles = [...this.handles.entries()]
    const disposals = await Promise.all(handles.map(async ([sessionId, handle]) => {
      try {
        await handle.dispose()
        return { status: 'fulfilled' as const, sessionId }
      } catch (reason) {
        return { status: 'rejected' as const, reason }
      }
    }))
    for (const disposal of disposals) {
      if (disposal.status === 'rejected') {
        failures.push(disposal.reason)
      } else {
        this.handles.delete(disposal.sessionId)
      }
    }
    try {
      await this.domain.close()
    } catch (error) {
      failures.push(error)
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'channel-agent: one or more resources failed to dispose')
    }
  }

  /** Execute, attach to, or replay one Gateway-scoped idempotent turn. */
  runTurn(turn: ChannelTurnEnvelopeV1, execution: ChannelTurnExecutionV1): Promise<ChannelTurnResultV1> {
    this.assertTurn(turn)
    const key = ledgerKey(turn)
    const envelopeDigest = digestJson(turn)
    const attached = this.inFlight.get(key)
    if (attached !== undefined) {
      if (attached.envelopeDigest !== envelopeDigest) {
        throw new Error('channel-agent: one in-flight idempotency key was reused with a different envelope')
      }
      return attached.promise
    }
    const epoch = this.lineageEpoch(turn.route)
    const running = this.executeTurn(key, envelopeDigest, turn, execution, epoch)
    this.inFlight.set(key, { envelopeDigest, turn, promise: running })
    void running.finally(() => {
      this.inFlight.delete(key)
      this.cancellationRequests.delete(activeKey(turn.turnId, turn.runId))
    }).catch((_turnFailureAlreadyReturned: unknown) => {
      // The caller owns the original promise; this observes only finally()'s derived rejection.
    })
    return running
  }

  /** Cancel only the exact live run named by both turn and run id. */
  async cancel(request: ChannelTurnCancelV1, signal?: AbortSignal): Promise<void> {
    this.assertAvailable()
    signal?.throwIfAborted()
    const key = activeKey(request.turnId, request.runId)
    const exactActive = this.active.get(key)
    const exactPending = [...this.inFlight.values()].find(entry =>
      entry.turn.turnId === request.turnId && entry.turn.runId === request.runId)
    const exactTurn = exactActive?.turn ?? exactPending?.turn
    if (exactTurn !== undefined) {
      this.cancellationRequests.set(key, request.reason)
      let cancellationFailure: unknown
      try {
        exactActive?.agent.cancel({ kind: 'user' })
      } catch (error) {
        cancellationFailure = error
      }
      await this.ledger.update(ledgerKey(exactTurn), current => current.result === undefined
        ? { ...current, cancelRequested: request.reason, updatedAt: Date.now() }
        : current)
      if (cancellationFailure !== undefined) {
        throw new Error(errorMessage(cancellationFailure), { cause: cancellationFailure })
      }
      return
    }
    const conflicting = [...this.inFlight.values()].some(entry => entry.turn.turnId === request.turnId)
    if (conflicting) throw new Error('channel-agent: cancellation run id does not match the active turn')
  }

  /** Retire one exact generation; its successor remains lazy until first input. */
  async reset(request: ChannelSessionResetV1, signal?: AbortSignal): Promise<ChannelSessionResetResultV1> {
    this.assertAvailable()
    signal?.throwIfAborted()
    if (!Number.isSafeInteger(request.nextGeneration) || request.nextGeneration <= request.route.generation) {
      throw new Error('channel-agent: reset nextGeneration must be a strictly newer safe integer')
    }
    const replay = this.resetReplay(request)
    if (replay !== undefined) return replay
    this.assertControlRoute(request.route, 'reset')
    this.invalidateLineage(request.route)
    return await this.serializeLineage(request.route, async () => {
      signal?.throwIfAborted()
      const queuedReplay = this.resetReplay(request)
      if (queuedReplay !== undefined) return queuedReplay
      this.assertControlRoute(request.route, 'reset')
      const key = generationKey(request.route)
      this.cancelRoute(request.route)
      const previous = this.bindings.get(bindingKey(request.route))
      await this.releaseBinding(previous)
      if (previous !== undefined) {
        await this.bindings.put(bindingKey(request.route), { ...previous, state: 'closed', updatedAt: Date.now() })
      }
      const result: ChannelSessionResetResultV1 = {
        protocolVersion: 1,
        route: { ...request.route, generation: request.nextGeneration },
        ...(previous === undefined ? {} : { previousSessionId: previous.sessionId }),
      }
      const completedAt = Date.now()
      await this.generations.put(key, {
        gatewayInstanceId: request.route.gatewayInstanceId,
        openclawSessionKey: request.route.openclawSessionKey,
        generation: request.nextGeneration,
        closed: false,
        lastControl: {
          kind: 'reset',
          requestDigest: resetRequestDigest(request),
          request,
          result,
          completedAt,
        },
        updatedAt: completedAt,
      })
      return result
    })
  }

  /** Close and retire one exact route generation. */
  async close(request: ChannelSessionCloseV1, signal?: AbortSignal): Promise<void> {
    this.assertAvailable()
    signal?.throwIfAborted()
    if (this.isCloseReplay(request)) return
    this.assertControlRoute(request.route, 'close')
    this.invalidateLineage(request.route)
    await this.serializeLineage(request.route, async () => {
      signal?.throwIfAborted()
      if (this.isCloseReplay(request)) return
      this.assertControlRoute(request.route, 'close')
      const key = generationKey(request.route)
      this.cancelRoute(request.route)
      const binding = this.bindings.get(bindingKey(request.route))
      await this.releaseBinding(binding)
      if (binding !== undefined) {
        await this.bindings.put(bindingKey(request.route), { ...binding, state: 'closed', updatedAt: Date.now() })
      }
      const completedAt = Date.now()
      await this.generations.put(key, {
        gatewayInstanceId: request.route.gatewayInstanceId,
        openclawSessionKey: request.route.openclawSessionKey,
        generation: request.route.generation,
        closed: true,
        lastControl: {
          kind: 'close',
          requestDigest: closeRequestDigest(request),
          request,
          completedAt,
        },
        updatedAt: completedAt,
      })
    })
  }

  /** Record a provider-durable final-turn delivery update in the consumer ledger. */
  async reportDelivery(report: ChannelDeliveryReportV1, signal?: AbortSignal): Promise<void> {
    this.assertAvailable()
    signal?.throwIfAborted()
    if (report.receipt.subject.kind !== 'turn') {
      throw new Error('channel-agent: delivery.report accepts only final-turn receipts')
    }
    const subject = report.receipt.subject
    const matches = [...this.ledger.entries()].filter(([, record]) =>
      record.envelope.turnId === subject.turnId
      && record.envelope.runId === subject.runId)
    const match = matches[0]
    if (match === undefined) throw new Error('channel-agent: delivery report names an unknown turn')
    if (matches.length !== 1) throw new Error('channel-agent: delivery report turn/run identity is ambiguous')
    const [key, record] = match
    if (record.result === undefined || record.sessionId === undefined) {
      throw new Error('channel-agent: delivery report arrived before a durable turn result')
    }
    if (record.delivery !== undefined) {
      if (JSON.stringify(record.delivery) === JSON.stringify(report.receipt)) return
      if (record.delivery.deliveryId !== report.receipt.deliveryId) {
        throw new Error('channel-agent: delivery identity changed for one final turn')
      }
      if (!deliveryAdvances(record.delivery, report.receipt)) {
        throw new Error('channel-agent: delivery report regressed durable delivery state')
      }
    }
    const phase = deliveryPhase(report.receipt)
    const committed = { ...record, phase, delivery: report.receipt, updatedAt: Date.now() }
    await this.ledger.put(key, committed)
    this.recordDeliveryActivity(committed)
  }

  /** Project a committed receipt without retaining provider identities or errors in Activity. */
  private recordDeliveryActivity(record: ChannelLedgerRecord): void {
    const activity = this.ctx.get('clawdshActivity') as ChannelActivitySink | undefined
    if (activity === undefined || record.sessionId === undefined || record.delivery === undefined) return
    const status = deliveryActivityStatus(record.delivery)
    const safe = {
      sessionId: record.sessionId,
      adapter: String(record.envelope.route.channel),
      conversation: record.envelope.route.kind,
      mention: record.envelope.wasMentioned ?? null,
      ...status === undefined ? {} : { status },
    }
    void this.latestSessionSeq(record.sessionId).then((seq) => {
      if (seq === undefined) return
      try {
        void activity.channelDelivery({ ...safe, seq }).catch((_activityWriteFailed: unknown) => {
          // Activity is a best-effort projection and cannot own the durable receipt.
        })
      } catch (_activityWriteFailed) {
        // Activity is a best-effort projection and cannot own the durable receipt.
      }
    }).catch((_activityProjectionFailed: unknown) => {
      // Missing or unreadable Session history degrades only Activity completeness.
    })
  }

  /** Resolve a source Session sequence from the live log, then its immutable persisted inspection. */
  private async latestSessionSeq(sessionId: SessionId): Promise<number | undefined> {
    const live = this.ctx.sessions.get(sessionId)
    if (live !== undefined) return live.events.at(-1)?.seq
    return (await this.ctx.sessionPersistence.inspect(sessionId)).events.at(-1)?.seq
  }

  private async executeTurn(
    key: string,
    digest: string,
    turn: ChannelTurnEnvelopeV1,
    execution: ChannelTurnExecutionV1,
    epoch: number,
  ): Promise<ChannelTurnResultV1> {
    const existing = this.ledger.get(key)
    if (existing !== undefined && existing.envelopeDigest !== digest) {
      throw new Error('channel-agent: one idempotency key was reused with a different envelope')
    }
    if (existing?.result !== undefined) return existing.result
    if (existing?.phase === 'running' || existing?.phase === 'needs-recovery') {
      let recoveryRecord = existing
      if (existing.phase === 'running') {
        recoveryRecord = { ...existing, phase: 'needs-recovery', updatedAt: Date.now() }
        await this.ledger.put(key, recoveryRecord)
      }
      return this.failed(turn, 'CHANNEL_TURN_NEEDS_RECOVERY', 'A prior Agent run may have produced side effects; operator reconciliation is required.', false, recoveryRecord.sessionId)
    }
    const now = Date.now()
    const acceptedRecord: ChannelLedgerRecord = existing
      ?? { envelopeDigest: digest, envelope: turn, phase: 'accepted', createdAt: now, updatedAt: now }
    if (existing === undefined) {
      await this.ledger.put(key, acceptedRecord)
    }
    safeNotify(execution, {
      kind: 'status', turnId: turn.turnId, runId: turn.runId,
      sequence: 0, status: 'accepted',
    })
    return await this.serializeTurn(turn.route, () =>
      this.executeAcceptedTurn(key, acceptedRecord, turn, execution, epoch))
  }

  /** Execute one durably accepted turn while it owns its route-generation lane. */
  private async executeAcceptedTurn(
    key: string,
    acceptedRecord: ChannelLedgerRecord,
    turn: ChannelTurnEnvelopeV1,
    execution: ChannelTurnExecutionV1,
    epoch: number,
  ): Promise<ChannelTurnResultV1> {
    let record = acceptedRecord
    let notificationSequence = 1
    const nextSequence = (): number => notificationSequence++
    let agentMayHaveStarted = false
    let sessionId: SessionId | undefined
    let acquiredHandle: AgentHandle | undefined
    try {
      execution.signal.throwIfAborted()
      this.assertNotCancelled(turn)
      await this.acceptGeneration(turn.route, epoch)
      this.assertAvailable()
      this.assertCurrentGeneration(turn.route, epoch)
      execution.signal.throwIfAborted()
      this.assertNotCancelled(turn)
      const refs = await importStagedImages(this.ctx.attachments, this.config.stagingRoot, turn.media, this.config.maxMediaBytes)
      this.assertAvailable()
      this.assertCurrentGeneration(turn.route, epoch)
      execution.signal.throwIfAborted()
      this.assertNotCancelled(turn)
      const binding = await this.ensureBinding(turn, epoch)
      this.assertAvailable()
      this.assertCurrentGeneration(turn.route, epoch)
      execution.signal.throwIfAborted()
      this.assertNotCancelled(turn)
      sessionId = binding.sessionId
      const handle = await this.acquire(turn.route, binding.sessionId, binding.preset)
      acquiredHandle = handle
      this.assertAvailable()
      this.assertCurrentGeneration(turn.route, epoch)
      execution.signal.throwIfAborted()
      this.assertNotCancelled(turn)
      record = { ...record, phase: 'running', sessionId, updatedAt: Date.now() }
      await this.ledger.put(key, record)
      this.assertAvailable()
      this.assertCurrentGeneration(turn.route, epoch)
      execution.signal.throwIfAborted()
      this.assertNotCancelled(turn)
      const abort = (): void => { handle.agent.cancel({ kind: 'user' }) }
      const stopProgress = this.observeProgress(handle.agent, turn, execution, nextSequence)
      const active = { turn, agent: handle.agent }
      this.active.set(activeKey(turn.turnId, turn.runId), active)
      execution.signal.addEventListener('abort', abort, { once: true })
      try {
        execution.signal.throwIfAborted()
        safeNotify(execution, {
          kind: 'status', turnId: turn.turnId, runId: turn.runId,
          sequence: nextSequence(), status: 'running',
        })
        const source: ChannelMessageSource = {
          kind: 'channel',
          gatewayInstanceId: turn.route.gatewayInstanceId,
          openclawSessionKey: turn.route.openclawSessionKey,
          generation: turn.route.generation,
          channel: turn.route.channel,
          account: turn.route.account,
          conversation: turn.route.conversation,
          ...(turn.route.thread === undefined ? {} : { thread: turn.route.thread }),
          messageId: turn.messageId,
          idempotencyKey: turn.idempotencyKey,
          runId: turn.runId,
          senderId: turn.sender.senderId,
          ...(turn.sender.displayName === undefined ? {} : { senderDisplayName: turn.sender.displayName }),
          trust: turn.sender.trust,
          isGroup: turn.route.kind === 'group',
          ...(turn.wasMentioned === undefined ? {} : { wasMentioned: turn.wasMentioned }),
          turnId: turn.turnId,
          ...(turn.replyTo === undefined ? {} : { replyTo: turn.replyTo }),
          ...(turn.trace === undefined ? {} : { trace: turn.trace }),
        }
        const content: ContentBlock[] = [
          ...(turn.text === '' ? [] : [{ type: 'text' as const, text: turn.text }]),
          ...refs.map(attachment => ({ type: 'image' as const, attachment })),
        ]
        const message = createUserMessage({ content, source })
        this.assertAvailable()
        this.assertCurrentGeneration(turn.route, epoch)
        execution.signal.throwIfAborted()
        this.assertNotCancelled(turn)
        agentMayHaveStarted = true
        handle.agent.followup(message)
        await handle.agent.whenIdle()
        await this.ctx.sessions.flush(handle.agent.session)
        safeNotify(execution, {
          kind: 'status', turnId: turn.turnId, runId: turn.runId,
          sequence: nextSequence(), status: 'finalizing',
        })
        const result = resultFor(turn, handle.agent, message.id)
        await this.ledger.put(key, { ...record, phase: 'completed', sessionId, result, updatedAt: Date.now() })
        return result
      } finally {
        stopProgress()
        execution.signal.removeEventListener('abort', abort)
        this.active.delete(activeKey(turn.turnId, turn.runId))
      }
    } catch (error) {
      if (error instanceof ChannelTurnCancelledError && !agentMayHaveStarted) {
        const cancelledSessionId = sessionId ?? sessionIdFor(turn.route)
        const result = this.cancelled(turn, error.reason, cancelledSessionId)
        await this.ledger.put(key, {
          ...record,
          phase: 'completed',
          sessionId: cancelledSessionId,
          result,
          updatedAt: Date.now(),
        })
        if (acquiredHandle !== undefined && sessionId !== undefined) {
          await this.releaseHandle(sessionId, acquiredHandle)
        }
        return result
      }
      const failure = this.failed(turn, 'CHANNEL_TURN_FAILED', publicTurnFailureMessage(error), !agentMayHaveStarted, sessionId)
      if (agentMayHaveStarted) {
        /* v8 ignore next -- Agent work can start only after sessionId is bound and the running row is durable. */
        if (sessionId === undefined) throw new Error('channel-agent: running turn lost its durable Session identity')
        await this.ledger.put(key, {
          ...record,
          phase: 'needs-recovery',
          sessionId,
          updatedAt: Date.now(),
        })
      } else {
        await this.ledger.put(key, {
          ...record,
          phase: 'accepted',
          ...(sessionId === undefined ? {} : { sessionId }),
          updatedAt: Date.now(),
        })
        if (acquiredHandle !== undefined && sessionId !== undefined
          && (this.disposed || !this.isCurrentGeneration(turn.route, epoch))) {
          await this.releaseHandle(sessionId, acquiredHandle)
        }
      }
      return failure
    }
  }

  private observeProgress(
    agent: Agent,
    turn: ChannelTurnEnvelopeV1,
    execution: ChannelTurnExecutionV1,
    nextSequence: () => number,
  ): () => void {
    const toolNames = new Map<string, string>()
    return agent.ctx.on('session/event', (session, event) => {
      /* v8 ignore next -- an Agent-scoped listener receives only that Agent's Session events. */
      if (session !== agent.session) return
      let notification: ChannelTurnNotificationV1 | undefined
      if (event.type === 'assistant/chunk') {
        const chunk = event.data.chunk
        if (chunk.type === 'text-delta' && chunk.text !== '') {
          notification = {
            kind: 'text.delta', turnId: turn.turnId, runId: turn.runId,
            sequence: nextSequence(), text: chunk.text,
          }
        } else if (chunk.type === 'reasoning-delta' && chunk.text !== '') {
          notification = {
            kind: 'reasoning.delta', turnId: turn.turnId, runId: turn.runId,
            sequence: nextSequence(), text: chunk.text,
          }
        }
      } else if (event.type === 'tool/call') {
        toolNames.set(event.data.callId, event.data.name)
        notification = {
          kind: 'tool', turnId: turn.turnId, runId: turn.runId, sequence: nextSequence(), phase: 'started',
          toolCallId: ChannelToolCallId(event.data.callId), name: event.data.name,
        }
      } else if (event.type === 'tool/result') {
        const callId = event.data.message.source.callId
        notification = {
          kind: 'tool', turnId: turn.turnId, runId: turn.runId, sequence: nextSequence(), phase: 'finished',
          toolCallId: ChannelToolCallId(callId), name: observedToolName(toolNames, callId),
        }
      }
      if (notification !== undefined) safeNotify(execution, notification)
    })
  }

  private assertTurn(turn: ChannelTurnEnvelopeV1): void {
    this.assertAvailable()
    if (!Number.isSafeInteger(turn.route.generation) || turn.route.generation < 0) {
      throw new Error('channel-agent: route generation must be a non-negative safe integer')
    }
    if (turn.text === '' && turn.media.length === 0) throw new Error('channel-agent: an inbound turn requires text or media')
    if (turn.route.kind === 'group' && turn.sender.trust !== 'group-allowlisted') {
      throw new Error('channel-agent: group turns require OpenClaw group allowlist admission')
    }
    if (turn.route.kind === 'direct' && turn.sender.trust === 'group-allowlisted') {
      throw new Error('channel-agent: direct turns cannot carry group-only admission')
    }
  }

  /** Reject new or not-yet-started Agent work once teardown begins. */
  private assertAvailable(): void {
    if (this.disposed) throw new Error('channel-agent: driver is disposed')
  }

  /** Reject an exact in-flight turn after its bridge cancellation became durable. */
  private assertNotCancelled(turn: ChannelTurnEnvelopeV1): void {
    const reason = this.cancellationRequests.get(activeKey(turn.turnId, turn.runId))
      ?? this.ledger.get(ledgerKey(turn))?.cancelRequested
    if (reason !== undefined) throw new ChannelTurnCancelledError(reason)
  }

  /** Read the in-process invalidation epoch for one durable route lineage. */
  private lineageEpoch(route: ChannelRouteV1): number {
    return this.lineageEpochs.get(generationKey(route)) ?? 0
  }

  /** Invalidate pending starts synchronously before a queued reset or close can yield. */
  private invalidateLineage(route: ChannelRouteV1): void {
    const key = generationKey(route)
    const current = this.lineageEpoch(route)
    if (current >= Number.MAX_SAFE_INTEGER) throw new Error('channel-agent: route lineage epoch is exhausted')
    this.lineageEpochs.set(key, current + 1)
  }

  /** Reject work captured before the latest reset or close request. */
  private assertLineageEpoch(route: ChannelRouteV1, epoch: number): void {
    if (this.lineageEpoch(route) !== epoch) {
      throw new Error('channel-agent: turn names a closed or stale route generation')
    }
  }

  /** Whether both the in-process epoch and durable generation still admit this turn. */
  private isCurrentGeneration(route: ChannelRouteV1, epoch: number): boolean {
    if (this.lineageEpoch(route) !== epoch) return false
    const current = this.generations.get(generationKey(route))
    return current !== undefined && !current.closed && current.generation === route.generation
  }

  /** Require one turn's generation to remain current after an asynchronous step. */
  private assertCurrentGeneration(route: ChannelRouteV1, epoch: number): void {
    if (!this.isCurrentGeneration(route, epoch)) {
      throw new Error('channel-agent: turn names a closed or stale route generation')
    }
  }

  /** Validate an exact reset/close route before mutating its lineage. */
  private assertControlRoute(route: ChannelRouteV1, operation: 'reset' | 'close'): void {
    const current = this.generations.get(generationKey(route))
    if (current !== undefined && current.generation !== route.generation) {
      throw new Error(`channel-agent: ${operation} does not name the current route generation`)
    }
    const binding = this.bindings.get(bindingKey(route))
    if (binding !== undefined && !sameRoute(binding.route, route)) {
      throw new Error(`channel-agent: ${operation} route conflicts with the durable account binding`)
    }
  }

  /** Return the durable acknowledgement for one exact completed reset retry. */
  private resetReplay(request: ChannelSessionResetV1): ChannelSessionResetResultV1 | undefined {
    const control = this.generations.get(generationKey(request.route))?.lastControl
    return control?.kind === 'reset' && control.requestDigest === resetRequestDigest(request)
      ? control.result
      : undefined
  }

  /** Whether one exact close request already reached its durable commit point. */
  private isCloseReplay(request: ChannelSessionCloseV1): boolean {
    const control = this.generations.get(generationKey(request.route))?.lastControl
    return control?.kind === 'close' && control.requestDigest === closeRequestDigest(request)
  }

  /** Serialize complete turn execution for one deterministic route-generation Session. */
  private serializeTurn<T>(route: ChannelRouteV1, operation: () => Promise<T>): Promise<T> {
    const key = bindingKey(route)
    const previous = this.turnOperations.get(key) ?? Promise.resolve()
    const running = previous.then(operation)
    const tail = running.then(() => undefined, () => undefined)
    this.turnOperations.set(key, tail)
    void tail.then(() => {
      if (this.turnOperations.get(key) === tail) this.turnOperations.delete(key)
    })
    return running
  }

  /** Serialize generation and binding mutations without holding the lane across Agent acquisition. */
  private serializeLineage<T>(route: ChannelRouteV1, operation: () => Promise<T>): Promise<T> {
    const key = generationKey(route)
    const previous = this.lineageOperations.get(key) ?? Promise.resolve()
    const ready = previous.then(() => undefined)
    const running = ready.then(operation)
    const tail = running.then(() => undefined, () => undefined)
    this.lineageOperations.set(key, tail)
    void tail.then(() => {
      if (this.lineageOperations.get(key) === tail) this.lineageOperations.delete(key)
    })
    return running
  }

  private async acceptGeneration(route: ChannelRouteV1, epoch: number): Promise<void> {
    await this.serializeLineage(route, async () => {
      this.assertAvailable()
      this.assertLineageEpoch(route, epoch)
      const key = generationKey(route)
      const current = this.generations.get(key)
      if (current === undefined) {
        await this.generations.put(key, {
          gatewayInstanceId: route.gatewayInstanceId,
          openclawSessionKey: route.openclawSessionKey,
          generation: route.generation,
          closed: false,
          updatedAt: Date.now(),
        })
        this.assertAvailable()
        this.assertLineageEpoch(route, epoch)
        return
      }
      if (current.closed || current.generation !== route.generation) {
        throw new Error('channel-agent: turn names a closed or stale route generation')
      }
    })
  }

  private async ensureBinding(turn: ChannelTurnEnvelopeV1, epoch: number): Promise<ChannelSessionBindingRecord> {
    return await this.serializeLineage(turn.route, async () => {
      this.assertAvailable()
      this.assertCurrentGeneration(turn.route, epoch)
      const key = bindingKey(turn.route)
      const preset = this.presetFor(turn)
      const found = this.bindings.get(key)
      if (found !== undefined) {
        if (found.state !== 'active' || !sameRoute(found.route, turn.route)) {
          throw new Error('channel-agent: route binding is closed or conflicts with persisted account identity')
        }
        if (found.preset !== preset) {
          throw new Error('channel-agent: route admission class changed its preset; reset the channel session before continuing')
        }
        return found
      }
      const now = Date.now()
      const binding: ChannelSessionBindingRecord = {
        route: turn.route,
        sessionId: sessionIdFor(turn.route),
        preset,
        state: 'active',
        createdAt: now,
        updatedAt: now,
      }
      await this.bindings.put(key, binding)
      this.assertAvailable()
      this.assertCurrentGeneration(turn.route, epoch)
      return binding
    })
  }

  private presetFor(turn: ChannelTurnEnvelopeV1): string {
    return turn.route.kind === 'direct' && turn.sender.trust === 'owner'
      ? this.config.ownerPreset
      : this.config.safePreset
  }

  private acquire(route: ChannelRouteV1, sessionId: SessionId, preset: string): Promise<AgentHandle> {
    const owned = this.handles.get(sessionId)
    if (owned !== undefined) return Promise.resolve(owned)
    if (this.ctx.agents.get(sessionId) !== undefined) {
      return Promise.reject(new Error(`channel-agent: live Session ${JSON.stringify(sessionId)} is owned by another runtime`))
    }
    const pending = this.acquiring.get(sessionId)
    /* v8 ignore next -- one route-generation lane owns acquisition; retain coalescing for direct lifecycle reuse. */
    if (pending !== undefined) return pending
    const acquiring = this.acquireNew(route, sessionId, preset)
    this.acquiring.set(sessionId, acquiring)
    void acquiring.finally(() => { this.acquiring.delete(sessionId) }).catch((_acquisitionFailureReturned: unknown) => {
      // The requesting turn owns the original promise; this observes only finally()'s derived rejection.
    })
    return acquiring
  }

  private async acquireNew(route: ChannelRouteV1, sessionId: SessionId, preset: string): Promise<AgentHandle> {
    const selection = this.ctx.agentDefaultModel.currentSelection()
    const channels = this.ctx.channels
    const agentOptions = { provider: selection.provider, model: selection.model }
    const setup = async (agentCtx: Context): Promise<void> => {
      installModelSelection(agentCtx, { current: selection, assembled: undefined })
      if (preset === this.config.safePreset) agentCtx.tools.restrict({ allow: [] })
      await this.ctx.agentPresets.mount(agentCtx, preset)
      registerMessageTool(agentCtx, route, (action, signal) => channels.action(action, signal))
    }
    const headers = await this.ctx.sessionPersistence.list()
    const exists = headers.some((header: SessionHeader) => header.id === sessionId)
    const handle = exists
      ? await this.ctx.agents.resume({ resumeSessionId: sessionId, agentOptions, setup })
      : await this.ctx.agents.create({ sessionId, meta: { cwd: this.config.cwd, agentPreset: preset }, agentOptions, setup })
    await handle.agent.whenIdle()
    this.handles.set(sessionId, handle)
    return handle
  }

  private async releaseBinding(binding: ChannelSessionBindingRecord | undefined): Promise<void> {
    if (binding === undefined) return
    const handle = this.handles.get(binding.sessionId)
    if (handle === undefined) return
    await this.releaseHandle(binding.sessionId, handle)
  }

  /** Dispose one still-owned handle exactly once across reset, close, and stale acquisition cleanup. */
  private async releaseHandle(sessionId: SessionId, handle: AgentHandle): Promise<void> {
    /* v8 ignore next -- route-turn serialization leaves only one stale cleanup owner; retain identity defense for lifecycle changes. */
    if (this.handles.get(sessionId) !== handle) return
    this.handles.delete(sessionId)
    await handle.dispose()
  }

  /** Cancel every active Agent run bound to one exact route generation. */
  private cancelRoute(route: ChannelRouteV1): void {
    for (const active of this.active.values()) {
      if (sameRoute(active.turn.route, route)) active.agent.cancel({ kind: 'user' })
    }
  }

  private failed(
    turn: ChannelTurnEnvelopeV1,
    code: string,
    message: string,
    retryable: boolean,
    sessionId?: SessionId,
  ): ChannelTurnResultV1 {
    return {
      protocolVersion: 1,
      turnId: turn.turnId,
      runId: turn.runId,
      replayId: replayIdFor(turn),
      status: 'failed',
      ...(sessionId === undefined ? {} : { sessionId }),
      error: { code, message, retryable },
    }
  }

  /** Build the durable terminal result for cancellation before Agent execution. */
  private cancelled(
    turn: ChannelTurnEnvelopeV1,
    reason: ChannelTurnCancelV1['reason'],
    sessionId: SessionId,
  ): ChannelTurnResultV1 {
    return {
      protocolVersion: 1,
      turnId: turn.turnId,
      runId: turn.runId,
      replayId: replayIdFor(turn),
      status: 'cancelled',
      sessionId,
      reason: `The channel turn was cancelled before Agent execution (${reason}).`,
    }
  }
}

/** Active-run map key. */
function activeKey(turnId: string, runId: string): string {
  return `${turnId}\0${runId}`
}

/** Stable replay identity derived from the authenticated turn identity. */
function replayIdFor(turn: ChannelTurnEnvelopeV1): ReturnType<typeof ChannelReplayId> {
  return ChannelReplayId(createHash('sha256')
    .update(turn.route.gatewayInstanceId)
    .update('\0')
    .update(turn.idempotencyKey)
    .update('\0')
    .update(turn.turnId)
    .digest('hex'))
}

/** Compare the complete route identity; no account/conversation may alias one binding. */
function sameRoute(left: ChannelRouteV1, right: ChannelRouteV1): boolean {
  return left.gatewayInstanceId === right.gatewayInstanceId
    && left.openclawSessionKey === right.openclawSessionKey
    && left.generation === right.generation
    && left.channel === right.channel
    && left.account === right.account
    && left.conversation === right.conversation
    && left.thread === right.thread
    && left.kind === right.kind
}

/** Derive one final result from the exact user message's owning turn. */
function resultFor(turn: ChannelTurnEnvelopeV1, agent: Agent, userMessageId: string): ChannelTurnResultV1 {
  let owningTurn: number | undefined
  let openTurn: number | undefined
  for (const event of agent.session.events) {
    if (event.type === 'turn/start') openTurn = event.data.turn
    if (event.type === 'user/message' && event.data.id === userMessageId) {
      owningTurn = openTurn
      break
    }
  }
  /* v8 ignore next -- whenIdle follows the followup wake; an accepted exact message either enters a turn or the Agent rejects earlier. */
  if (owningTurn === undefined) throw new Error('channel-agent: exact channel message never entered an Agent turn')
  const events = agent.session.events.filter(event => eventBelongsToTurn(event, owningTurn))
  const end = events.findLast(event => event.type === 'turn/end')
  /* v8 ignore next -- Agent quiescence closes every entered turn before whenIdle resolves. */
  if (end?.type !== 'turn/end') throw new Error('channel-agent: Agent reached idle without a terminal turn record')
  const base = {
    protocolVersion: 1 as const,
    turnId: turn.turnId,
    runId: turn.runId,
    replayId: replayIdFor(turn),
    sessionId: agent.session.id,
  }
  if (end.data.reason.kind === 'aborted') {
    return { ...base, status: 'cancelled', reason: 'The channel turn was cancelled.' }
  }
  if (end.data.reason.kind === 'error') {
    return {
      ...base,
      status: 'failed',
      error: { code: 'CHANNEL_AGENT_FAILED', message: PUBLIC_DEPENDENCY_FAILURE_MESSAGE, retryable: false },
    }
  }
  if (end.data.reason.kind === 'blocked') {
    return {
      ...base,
      status: 'failed',
      error: { code: 'CHANNEL_TURN_BLOCKED', message: 'Agent policy blocked the channel turn.', retryable: false },
    }
  }
  /* v8 ignore next -- a fresh live turn cannot end interrupted; this preserves failure for that repair marker and merge extensions. */
  if (end.data.reason.kind !== 'completed' && end.data.reason.kind !== 'max-tokens') {
    return {
      ...base,
      status: 'failed',
      error: { code: `CHANNEL_TURN_${end.data.reason.kind.toUpperCase()}`, message: `Agent turn ended with ${end.data.reason.kind}.`, retryable: false },
    }
  }
  const assistants = events.filter((event): event is AssistantMessageEvent => event.type === 'assistant/message')
  const final = assistants.at(-1)
  /* v8 ignore next -- completed and max-token Agent turns always publish their assembled assistant message. */
  const text = final?.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('') ?? ''
  const usage = aggregateUsage(assistants)
  if (text === '') return { ...base, status: 'silent', ...(usage === undefined ? {} : { usage }) }
  return { ...base, status: 'completed', text, media: [], ...(usage === undefined ? {} : { usage }) }
}

/** Whether a core event carries the named turn directly. */
function eventBelongsToTurn(event: SessionEvent, turn: number): boolean {
  if (event.type === 'turn/start' || event.type === 'turn/end'
    || event.type === 'step/start' || event.type === 'step/end'
    || event.type === 'assistant/chunk' || event.type === 'assistant/message'
    || event.type === 'tool/call' || event.type === 'tool/result') {
    return event.data.turn === turn
  }
  return false
}

/** Read the name recorded by the preceding call event in one ordered live stream. */
function observedToolName(toolNames: ReadonlyMap<string, string>, callId: string): string {
  const name = toolNames.get(callId)
  /* v8 ignore next -- a core tool/result always follows its tool/call in the same ordered stream. */
  if (name === undefined) return 'unknown'
  return name
}

type AssistantMessageEvent = Extract<SessionEvent, { type: 'assistant/message' }>

/** Sum disjoint token counters from all assistant messages in one turn. */
function aggregateUsage(events: readonly AssistantMessageEvent[]): TokenUsage | undefined {
  let found = false
  const total: Required<TokenUsage> = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  }
  for (const event of events) {
    if (event.data.usage === undefined) continue
    found = true
    total.inputTokens += event.data.usage.inputTokens
    total.outputTokens += event.data.usage.outputTokens
    total.cacheReadTokens += event.data.usage.cacheReadTokens ?? 0
    total.cacheWriteTokens += event.data.usage.cacheWriteTokens ?? 0
    total.reasoningTokens += event.data.usage.reasoningTokens ?? 0
  }
  return found ? total : undefined
}

/** Map receipt state to the consumer ledger's coarse terminal state. */
function deliveryPhase(receipt: ChannelDeliveryReceiptV1): ChannelLedgerRecord['phase'] {
  switch (receipt.status) {
    case 'confirmed': return 'delivered'
    case 'ambiguous': return 'ambiguous'
    case 'dead-letter': return 'dead-letter'
    case 'accepted':
    case 'retrying': return 'completed'
    /* v8 ignore next 3 -- ChannelDeliveryReceiptV1 is closed and every status is handled above. */
    default: {
      const exhaustive: never = receipt
      throw new Error(`channel-agent: unknown delivery status ${String(exhaustive)}`)
    }
  }
}

/** Map provider receipt states to the intentionally smaller Activity lifecycle vocabulary. */
function deliveryActivityStatus(
  receipt: ChannelDeliveryReceiptV1,
): 'started' | 'failed' | 'sent' | undefined {
  switch (receipt.status) {
    case 'accepted':
    case 'retrying': return 'started'
    case 'confirmed': return 'sent'
    case 'dead-letter': return 'failed'
    case 'ambiguous': return undefined
    /* v8 ignore next 3 -- ChannelDeliveryReceiptV1 is closed and every status is handled above. */
    default: {
      const exhaustive: never = receipt
      throw new Error(`channel-agent: unknown delivery status ${String(exhaustive)}`)
    }
  }
}

/** Whether a platform delivery state permits no later transition. */
function isTerminalDelivery(receipt: ChannelDeliveryReceiptV1): boolean {
  return receipt.status === 'confirmed' || receipt.status === 'ambiguous' || receipt.status === 'dead-letter'
}

/** Require monotonic receipt attempts, status, and learned platform identity. */
function deliveryAdvances(previous: ChannelDeliveryReceiptV1, next: ChannelDeliveryReceiptV1): boolean {
  if (isTerminalDelivery(previous) || next.attempt < previous.attempt) return false
  if (previous.platformMessageId !== undefined && next.platformMessageId !== previous.platformMessageId) return false
  if (previous.status === 'retrying') {
    if (next.status === 'accepted') return false
    if (next.status === 'retrying' && next.attempt <= previous.attempt) return false
  }
  return true
}

/** Progress is optional presentation; listener failure cannot change the Agent result. */
function safeNotify(execution: ChannelTurnExecutionV1, notification: ChannelTurnNotificationV1): void {
  try {
    execution.notify(notification)
  } catch (_progressConsumerFailed) {
    // Optional progress never owns turn execution or its durable result.
  }
}

/** Render an unknown failure without exposing arbitrary structured values. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Replace every caught execution failure before it enters durable or model-visible state. */
function publicTurnFailureMessage(_error: unknown): string {
  return PUBLIC_DEPENDENCY_FAILURE_MESSAGE
}

/** Bound teardown waiting without closing storage while accepted work can still write. */
async function withinShutdownGrace<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error('channel-agent: accepted work did not reach quiescence within shutdownGraceMs'))
    }, timeoutMs)
    timer.unref()
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    /* v8 ignore next -- the Promise executor assigns the timer synchronously before this block can run. */
    if (timer !== undefined) clearTimeout(timer)
  }
}
