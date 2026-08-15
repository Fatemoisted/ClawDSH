import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  ChannelDeliveryId,
  ChannelMediaId,
  ChannelMediaSha256,
  ChannelMessageId,
  ChannelProviderId,
  channelActionDeliveryReceiptV1Schema,
  channelSessionCloseV1Schema,
  channelSessionResetV1Schema,
  channelTurnCancelV1Schema,
  type ChannelActionResultV1,
  type ChannelActionV1,
  type ChannelProviderV1,
  type ChannelTurnEnvelopeV1,
  type ChannelTurnNotificationV1,
} from '@clawdsh/dsh-channel'
import ChannelService from '@clawdsh/dsh-channel'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { ImageAttachmentRef, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import {
  CallId,
  createUserMessage,
  type GenerateOptions,
  LlmAdapter,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import SessionPersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import * as ChannelAgent from '../src/index.ts'
import {
  channelAgentDomainSpec,
  digestJson,
  generationKey,
  ledgerKey,
  sessionIdFor,
  UNKNOWN_TURN_EFFECTS,
  type ChannelLedgerRecord,
} from '../src/storage.ts'
import { report, SAFE_TURN_EFFECTS, turn } from './fixtures.ts'

type ScriptEntry = readonly StreamChunk[] | 'hang' | 'fail'

class TestSettings extends SettingsProvider {
  get writable(): boolean { return true }
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly script: ScriptEntry[]) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const entry = this.script.shift()
    if (entry === undefined) throw new Error('ScriptedAdapter: script exhausted')
    if (entry === 'fail') throw new Error('scripted model failure')
    if (entry === 'hang') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'partial' }
      await new Promise<void>((_resolve, reject) => {
        const fail = (): void => { reject(new Error('aborted')) }
        if (options.signal?.aborted) fail()
        else options.signal?.addEventListener('abort', fail, { once: true })
      })
      return
    }
    for (const chunk of entry) {
      options.signal?.throwIfAborted()
      yield chunk
    }
  }
}

function textResponse(text: string, reason: 'stop' | 'max-tokens' = 'stop'): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...Array.from(text, char => ({ type: 'text-delta' as const, index: 0, text: char })),
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 3, outputTokens: text.length, reasoningTokens: 1 } },
    { type: 'finish', reason: { kind: reason } },
  ]
}

function reasoningResponse(reasoning: string, text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 0, text: reasoning },
    { type: 'block-end', index: 0, block: { type: 'reasoning', text: reasoning } },
    { type: 'block-start', index: 1, blockType: 'text' },
    { type: 'text-delta', index: 1, text },
    { type: 'block-end', index: 1, block: { type: 'text', text } },
    {
      type: 'usage',
      usage: {
        inputTokens: 4,
        outputTokens: text.length,
        cacheReadTokens: 2,
        cacheWriteTokens: 1,
      },
    },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function textWithoutUsage(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function toolCallResponse(name: string, args: object): StreamChunk[] {
  const callId = CallId('tool-call-1')
  const argumentsJson = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: callId, name, argumentsDelta: argumentsJson },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name, arguments: argumentsJson } },
    { type: 'usage', usage: { inputTokens: 2, outputTokens: 1 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

interface Harness {
  readonly ctx: Context
  readonly adapter: ScriptedAdapter
  readonly pool: MemoryMediaPool
  readonly root: string
  readonly mounts: string[]
  readonly actions: ChannelActionV1[]
  readonly facility: DomainFacility
  readonly cwd: string
  readonly stagingRoot: string
}

interface ChannelDeliveryActivityInput {
  readonly sessionId: string
  readonly adapter: string
  readonly conversation: 'direct' | 'group'
  readonly mention: boolean | null
  readonly seq: number
  readonly status?: 'started' | 'failed' | 'sent'
}

function installActivity(ctx: Context, write: (input: ChannelDeliveryActivityInput) => Promise<unknown>): void {
  ctx.provide('clawdshActivity', { channelDelivery: write } as never)
}

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.allSettled(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function confirmed(action: ChannelActionV1) {
  return channelActionDeliveryReceiptV1Schema.parse({
    protocolVersion: 1,
    deliveryId: ChannelDeliveryId(`delivery-${action.actionId}`),
    subject: { kind: 'action', actionId: action.actionId },
    attempt: 1,
    platformMessageId: ChannelMessageId(`platform-${action.actionId}`),
    status: 'confirmed',
  })
}

async function harness(
  script: ScriptEntry[],
  options: {
    root?: string
    pool?: MemoryMediaPool
    seed?: (domain: Domain<typeof channelAgentDomainSpec>) => Promise<void>
    mountAgent?: boolean
    dispatchAction?: (action: ChannelActionV1) => Promise<ChannelActionResultV1>
  } = {},
): Promise<Harness> {
  const base = options.root ?? await mkdtemp(join(tmpdir(), 'dsh-channel-agent-'))
  if (options.root === undefined) roots.push(base)
  const cwd = join(base, 'workspace')
  const stagingRoot = join(base, 'staging')
  await mkdir(cwd, { recursive: true })
  await mkdir(stagingRoot, { recursive: true })

  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(TestSettings)
  const adapter = new ScriptedAdapter(script)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(AgentDefaultModel, { provider: 'mock', model: 'mock' })
  await ctx.plugin(SessionPersistenceJsonl, {
    root: join(base, 'sessions'),
    compression: 'none',
    writeBatchMaxDelayMs: 1,
  })
  ctx.llm.registerAdapter(['mock'], adapter)

  await ctx.plugin(Storage)
  const pool = options.pool ?? new MemoryMediaPool()
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  if (options.seed !== undefined) {
    const domain = await facility.open(channelAgentDomainSpec)
    await options.seed(domain)
    await domain.close()
  }

  const mounts: string[] = []
  ctx.provide('agentPresets', {
    async mount(_agentCtx: Context, preset: string): Promise<void> { mounts.push(preset) },
  } as never)
  const saved: ImageAttachmentRef[] = []
  ctx.provide('attachments', {
    imageLimits: {
      maxImageBytes: 1_024,
      maxImagesPerMessage: 4,
      maxMessageImageBytes: 4_096,
      maxImagePixels: 1_000,
      mediaTypes: ['image/png'],
    },
    async validateImage(): Promise<void> {},
    async saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
      const ref = {
        attachmentId: AttachmentId(createHash('sha256').update(input.data).digest('hex')),
        mediaType: input.mediaType,
        bytes: input.data.byteLength,
        width: 1,
        height: 1,
        ...(input.name === undefined ? {} : { name: input.name }),
      }
      saved.push(ref)
      return ref
    },
  } as never)

  await ctx.plugin(ChannelService)
  const actions: ChannelActionV1[] = []
  const provider: ChannelProviderV1 = {
    id: ChannelProviderId('test-provider'),
    async action(action) {
      actions.push(action)
      return await (options.dispatchAction?.(action) ?? Promise.resolve(confirmed(action)))
    },
    async health() {
      return {
        protocolVersion: 1,
        status: 'ready',
        checkedAt: '2026-08-16T00:00:00Z',
        accounts: [],
        diagnostics: [],
      }
    },
  }
  ctx.channels.registerProvider(provider)
  ctx.tools.register(defineTool({
    name: 'danger',
    description: 'Inherited high-risk fixture.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async () => 'danger',
  }))
  if (options.mountAgent !== false) {
    await ctx.plugin(ChannelAgent, {
      ownerPreset: 'owner',
      safePreset: 'messaging-safe',
      cwd,
      stagingRoot,
      maxMediaBytes: 1_024,
      shutdownGraceMs: 1_000,
    })
  }
  return { ctx, adapter, pool, root: base, mounts, actions, facility, cwd, stagingRoot }
}

function execution(notifications: ChannelTurnNotificationV1[] = [], signal = new AbortController().signal) {
  return { signal, notify: (notification: ChannelTurnNotificationV1) => { notifications.push(notification) } }
}

function driverConfig(app: Harness, shutdownGraceMs = 1_000): ChannelAgent.Config {
  return {
    ownerPreset: 'owner',
    safePreset: 'messaging-safe',
    cwd: app.cwd,
    stagingRoot: app.stagingRoot,
    maxMediaBytes: 1_024,
    shutdownGraceMs,
  }
}

function routeTurn(
  base: ChannelTurnEnvelopeV1,
  route: Partial<ChannelTurnEnvelopeV1['route']>,
  overrides: Record<string, unknown> = {},
): ChannelTurnEnvelopeV1 {
  return turn({ ...overrides, route: { ...base.route, ...route } })
}

describe('channel Agent turn execution', () => {
  it('runs a real Agent turn, logs provenance first, emits ordered progress, and replays durably', async () => {
    const app = await harness([textResponse('reply')])
    const notifications: ChannelTurnNotificationV1[] = []
    const inbound = turn()
    const first = await app.ctx.channels.runTurn(inbound, execution(notifications))
    const replay = await app.ctx.channels.runTurn(inbound, execution())

    expect(first).toMatchObject({
      status: 'completed',
      turnId: inbound.turnId,
      runId: inbound.runId,
      text: 'reply',
      usage: { inputTokens: 3, outputTokens: 5, reasoningTokens: 1 },
    })
    expect(replay).toEqual(first)
    expect(app.adapter.requests).toHaveLength(1)
    expect(app.mounts).toEqual(['owner'])
    expect(notifications.map(item => item.sequence))
      .toEqual(notifications.map((_item, index) => index))
    expect(notifications.at(0)).toMatchObject({ kind: 'status', status: 'accepted' })
    expect(notifications.at(-1)).toMatchObject({ kind: 'status', status: 'finalizing' })

    if (first.status !== 'completed') throw new Error('expected completed result')
    const agent = app.ctx.agents.get(first.sessionId)
    expect(agent).toBeDefined()
    const messageIndex = agent?.session.events.findIndex(event => event.type === 'user/message') ?? -1
    expect(messageIndex).toBeGreaterThanOrEqual(0)
    expect(agent?.session.events.some(event => event.type.startsWith('channel/'))).toBe(false)
    const message = agent?.session.events.find(event => event.type === 'user/message')
    expect(message?.type === 'user/message' ? message.data.source : undefined).toMatchObject({
      kind: 'channel',
      channel: inbound.route.channel,
      account: inbound.route.account,
      conversation: inbound.route.conversation,
      senderId: inbound.sender.senderId,
      trust: 'owner',
      isGroup: false,
      turnId: inbound.turnId,
    })
  })

  it('replays a legacy V2 terminal ledger row with fail-closed effect metadata', async () => {
    const inbound = turn()
    const sessionId = sessionIdFor(inbound.route)
    const now = Date.now()
    const pool = new MemoryMediaPool()
    pool.versions.set('clawdsh_channel_agent', 2)
    pool.media.set('clawdsh_channel_agent', {
      global: null,
      tables: new Map([
        ['ledger', new Map([[ledgerKey(inbound), {
          envelopeDigest: digestJson(inbound),
          envelope: inbound,
          phase: 'completed',
          sessionId,
          result: {
            protocolVersion: 1,
            turnId: inbound.turnId,
            runId: inbound.runId,
            replayId: 'legacy-replay',
            status: 'completed',
            sessionId,
            text: 'legacy answer',
            media: [],
          },
          createdAt: now,
          updatedAt: now,
        }]])],
      ]),
    })
    const app = await harness([], { pool })
    const replay = await app.ctx.channels.runTurn(inbound, execution())
    expect(replay).toMatchObject({
      status: 'completed',
      text: 'legacy answer',
      effects: UNKNOWN_TURN_EFFECTS,
    })
    expect(app.adapter.requests).toEqual([])
    expect(app.actions).toEqual([])
  })

  it('projects optional provenance, reasoning progress, complete usage, and tolerates a failing progress sink', async () => {
    const app = await harness([reasoningResponse('think', 'reply'), textWithoutUsage('plain')])
    const notifications: ChannelTurnNotificationV1[] = []
    const inbound = turn({
      route: { ...turn().route, thread: 'thread-1' },
      wasMentioned: false,
      replyTo: { messageId: 'parent-message', senderId: 'parent-sender' },
      trace: { traceId: 'trace-1', parentTraceId: 'trace-parent' },
    })
    const first = await app.ctx.channels.runTurn(inbound, execution(notifications))
    expect(first).toMatchObject({
      status: 'completed',
      usage: { inputTokens: 4, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 1, reasoningTokens: 0 },
    })
    expect(notifications).toContainEqual(expect.objectContaining({ kind: 'reasoning.delta', text: 'think' }))
    if (first.status !== 'completed') throw new Error('expected completed result')
    const source = app.ctx.agents.get(first.sessionId)?.session.events.find(event => event.type === 'user/message')
    expect(source?.type === 'user/message' ? source.data.source : undefined).toMatchObject({
      kind: 'channel',
      thread: 'thread-1',
      wasMentioned: false,
      replyTo: { messageId: 'parent-message', senderId: 'parent-sender' },
      trace: { traceId: 'trace-1', parentTraceId: 'trace-parent' },
    })

    const second = turn({
      route: inbound.route,
      idempotencyKey: 'no-usage',
      turnId: 'no-usage',
      runId: 'no-usage',
      messageId: 'no-usage',
      sender: { senderId: 'sender-without-display', trust: 'owner' },
    })
    const result = await app.ctx.channels.runTurn(second, {
      signal: new AbortController().signal,
      notify: () => { throw new Error('progress consumer failed') },
    })
    expect(result).toMatchObject({ status: 'completed', text: 'plain' })
    expect(result).not.toHaveProperty('usage')
  })

  it('uses deterministic isolated Sessions across route identities and reuses one exact route', async () => {
    const app = await harness([textResponse('one'), textResponse('two'), textResponse('three')])
    const base = turn()
    const first = await app.ctx.channels.runTurn(base, execution())
    const secondTurn = turn({
      idempotencyKey: 'inbound-2', turnId: 'turn-2', runId: 'run-2', messageId: 'message-2', text: 'again',
    })
    const second = await app.ctx.channels.runTurn(secondTurn, execution())
    const other = routeTurn(base, {
      openclawSessionKey: 'openclaw-session-2', account: 'account-2', conversation: 'conversation-2',
    } as never, {
      idempotencyKey: 'inbound-3', turnId: 'turn-3', runId: 'run-3', messageId: 'message-3',
    })
    const third = await app.ctx.channels.runTurn(other, execution())
    expect(first.sessionId).toBe(second.sessionId)
    expect(third.sessionId).not.toBe(first.sessionId)
    expect(app.ctx.agents.list()).toHaveLength(2)
  })

  it('keeps inherited dangerous tools for owner DMs and strips them from safe sessions while retaining message', async () => {
    const app = await harness([textResponse('owner'), textResponse('safe'), textResponse('group')])
    const base = turn()
    await app.ctx.channels.runTurn(base, execution())
    const safe = routeTurn(base, { openclawSessionKey: 'safe', conversation: 'paired-user' } as never, {
      idempotencyKey: 'safe-1', turnId: 'safe-turn', runId: 'safe-run', messageId: 'safe-message',
      sender: { senderId: 'paired', trust: 'paired' },
    })
    await app.ctx.channels.runTurn(safe, execution())
    const group = routeTurn(base, {
      openclawSessionKey: 'group', conversation: 'group-1', kind: 'group',
    } as never, {
      idempotencyKey: 'group-1', turnId: 'group-turn', runId: 'group-run', messageId: 'group-message',
      sender: { senderId: 'member', trust: 'group-allowlisted' }, wasMentioned: true,
    })
    await app.ctx.channels.runTurn(group, execution())

    expect(app.mounts).toEqual(['owner', 'messaging-safe', 'messaging-safe'])
    expect(app.adapter.requests[0]?.tools?.map(tool => tool.name).sort()).toEqual(['danger', 'message'])
    expect(app.adapter.requests[1]?.tools?.map(tool => tool.name)).toEqual(['message'])
    expect(app.adapter.requests[2]?.tools?.map(tool => tool.name)).toEqual(['message'])
  })

  it('executes the route-bound message tool and publishes correlated tool progress', async () => {
    const app = await harness([
      toolCallResponse('message', { action: 'send', text: 'tool reply' }),
      textResponse('done'),
    ])
    const notifications: ChannelTurnNotificationV1[] = []
    const result = await app.ctx.channels.runTurn(turn(), execution(notifications))
    expect(result).toMatchObject({
      status: 'completed',
      text: 'done',
      effects: {
        hadPotentialSideEffects: true,
        replaySafe: false,
        didSendViaMessagingTool: true,
        messagingToolSentTexts: ['tool reply'],
        messagingToolSentMediaUrls: [],
        messagingToolSentTargets: [{
          tool: 'message',
          provider: 'telegram',
          accountId: 'account-1',
          to: 'conversation-1',
          text: 'tool reply',
        }],
      },
    })
    const toolResult = result.status === 'completed'
      ? app.ctx.agents.get(result.sessionId)?.session.events.find(event => event.type === 'tool/result')
      : undefined
    expect(app.actions, JSON.stringify(toolResult)).toHaveLength(1)
    expect(app.actions[0]).toMatchObject({ kind: 'send', text: 'tool reply' })
    expect(notifications.filter(item => item.kind === 'tool')).toEqual([
      expect.objectContaining({ kind: 'tool', phase: 'started', name: 'message', toolCallId: 'tool-call-1' }),
      expect.objectContaining({ kind: 'tool', phase: 'finished', name: 'message', toolCallId: 'tool-call-1' }),
    ])
    expect(await app.ctx.channels.runTurn(turn(), execution())).toEqual(result)
    expect(app.actions).toHaveLength(1)
  })

  it('distinguishes read-only message queries from uncertain mutation outcomes', async () => {
    const directory = await harness([
      toolCallResponse('message', { action: 'directory.self' }),
      textResponse('directory done'),
    ], {
      dispatchAction: action => Promise.resolve({
        protocolVersion: 1,
        actionId: action.actionId,
        kind: 'directory',
        entries: [],
      }),
    })
    const directoryResult = await directory.ctx.channels.runTurn(turn(), execution())
    expect(directoryResult.effects).toEqual(SAFE_TURN_EFFECTS)

    const ambiguous = await harness([
      toolCallResponse('message', { action: 'send', text: 'maybe sent' }),
      textResponse('ambiguous done'),
    ], {
      dispatchAction: action => Promise.resolve(channelActionDeliveryReceiptV1Schema.parse({
        protocolVersion: 1,
        deliveryId: ChannelDeliveryId(`delivery-${action.actionId}`),
        subject: { kind: 'action', actionId: action.actionId },
        attempt: 1,
        status: 'ambiguous',
        error: { code: 'ACK_LOST', message: 'platform acknowledgement was lost', retryable: false },
      })),
    })
    const ambiguousResult = await ambiguous.ctx.channels.runTurn(turn(), execution())
    expect(ambiguousResult.effects).toEqual({
      hadPotentialSideEffects: true,
      replaySafe: false,
      didSendViaMessagingTool: true,
      messagingToolSentTexts: [],
      messagingToolSentMediaUrls: [],
      messagingToolSentTargets: [],
    })

    const deadLetter = await harness([
      toolCallResponse('message', { action: 'send', text: 'rejected before dispatch' }),
      textResponse('dead letter handled'),
    ], {
      dispatchAction: action => Promise.resolve(channelActionDeliveryReceiptV1Schema.parse({
        protocolVersion: 1,
        deliveryId: ChannelDeliveryId(`delivery-${action.actionId}`),
        subject: { kind: 'action', actionId: action.actionId },
        attempt: 1,
        status: 'dead-letter',
        error: { code: 'PRE_DISPATCH', message: 'provider rejected the request', retryable: false },
      })),
    })
    const deadLetterResult = await deadLetter.ctx.channels.runTurn(turn(), execution())
    expect(deadLetterResult.effects).toEqual({
      hadPotentialSideEffects: true,
      replaySafe: false,
      didSendViaMessagingTool: false,
      messagingToolSentTexts: [],
      messagingToolSentMediaUrls: [],
      messagingToolSentTargets: [],
    })

    const rejected = await harness([
      toolCallResponse('message', { action: 'send', text: 'not confirmed' }),
      textResponse('failure handled'),
    ], {
      dispatchAction: () => Promise.reject(new Error('provider failed')),
    })
    const rejectedResult = await rejected.ctx.channels.runTurn(turn(), execution())
    expect(rejectedResult.effects).toMatchObject({
      hadPotentialSideEffects: true,
      replaySafe: false,
      didSendViaMessagingTool: true,
    })

    const invalidArguments = await harness([
      toolCallResponse('message', { action: 'send' }),
      textResponse('validation handled'),
    ])
    const invalidResult = await invalidArguments.ctx.channels.runTurn(turn(), execution())
    expect(invalidResult.effects).toMatchObject({
      hadPotentialSideEffects: true,
      replaySafe: false,
      didSendViaMessagingTool: false,
    })
    expect(invalidArguments.actions).toEqual([])
  })

  it('attaches equal concurrent retries, rejects conflicting reuse, and cancels only an exact run', async () => {
    const app = await harness(['hang'])
    const inbound = turn()
    const first = app.ctx.channels.runTurn(inbound, execution())
    const attached = app.ctx.channels.runTurn(inbound, execution())
    expect(attached).toBe(first)
    expect(() => app.ctx.channels.runTurn(turn({ text: 'different' }), execution()))
      .toThrow(/in-flight idempotency key/)
    await vi.waitFor(() => { expect(app.adapter.requests).toHaveLength(1) })
    await expect(app.ctx.channels.cancel(channelTurnCancelV1Schema.parse({
      protocolVersion: 1, turnId: inbound.turnId, runId: 'wrong-run', reason: 'user',
    }))).rejects.toThrow(/does not match/)
    await app.ctx.channels.cancel(channelTurnCancelV1Schema.parse({
      protocolVersion: 1, turnId: inbound.turnId, runId: inbound.runId, reason: 'user',
    }))
    expect(await first).toMatchObject({ status: 'cancelled' })
    expect(await attached).toEqual(await first)
  })

  it('serializes distinct turns on one route generation and isolates their progress streams', async () => {
    const app = await harness(['hang', textResponse('second')])
    const firstTurn = turn()
    const firstNotifications: ChannelTurnNotificationV1[] = []
    const first = app.ctx.channels.runTurn(firstTurn, execution(firstNotifications))
    await vi.waitFor(() => {
      expect(app.adapter.requests).toHaveLength(1)
      expect(firstNotifications).toContainEqual(expect.objectContaining({ kind: 'text.delta', text: 'partial' }))
    })

    const secondTurn = turn({
      idempotencyKey: 'serialized-2', turnId: 'serialized-2', runId: 'serialized-2', messageId: 'serialized-2',
    })
    const secondNotifications: ChannelTurnNotificationV1[] = []
    const second = app.ctx.channels.runTurn(secondTurn, execution(secondNotifications))
    await vi.waitFor(() => {
      expect(secondNotifications).toEqual([
        expect.objectContaining({ kind: 'status', status: 'accepted', sequence: 0 }),
      ])
    })
    expect(app.adapter.requests).toHaveLength(1)

    await app.ctx.channels.cancel(channelTurnCancelV1Schema.parse({
      protocolVersion: 1, turnId: firstTurn.turnId, runId: firstTurn.runId, reason: 'user',
    }))
    await expect(first).resolves.toMatchObject({ status: 'cancelled' })
    await expect(second).resolves.toMatchObject({ status: 'completed', text: 'second' })
    expect(app.adapter.requests).toHaveLength(2)
    expect(firstNotifications.filter(item => item.kind === 'text.delta').map(item => item.text)).toEqual(['partial'])
    expect(secondNotifications.filter(item => item.kind === 'text.delta').map(item => item.text).join('')).toBe('second')
  })

  it('persists a queued cancellation without cancelling the active shared Agent', async () => {
    const app = await harness(['hang', textResponse('must not run')])
    const activeTurn = turn()
    const active = app.ctx.channels.runTurn(activeTurn, execution())
    await vi.waitFor(() => { expect(app.adapter.requests).toHaveLength(1) })
    const agent = app.ctx.agents.get(sessionIdFor(activeTurn.route))
    if (agent === undefined) throw new Error('expected an active Agent')
    const cancel = vi.spyOn(agent, 'cancel')

    const queuedTurn = turn({
      idempotencyKey: 'queued-cancel', turnId: 'queued-cancel', runId: 'queued-cancel', messageId: 'queued-cancel',
    })
    const queuedNotifications: ChannelTurnNotificationV1[] = []
    const queued = app.ctx.channels.runTurn(queuedTurn, execution(queuedNotifications))
    await vi.waitFor(() => {
      expect(queuedNotifications).toEqual([
        expect.objectContaining({ kind: 'status', status: 'accepted', sequence: 0 }),
      ])
    })
    await app.ctx.channels.cancel(channelTurnCancelV1Schema.parse({
      protocolVersion: 1, turnId: queuedTurn.turnId, runId: queuedTurn.runId, reason: 'timeout',
    }))
    expect(cancel).not.toHaveBeenCalled()
    expect(app.facility.get('clawdsh_channel_agent')?.table('ledger').get(ledgerKey(queuedTurn)))
      .toMatchObject({ phase: 'accepted', cancelRequested: 'timeout' })

    await app.ctx.channels.cancel(channelTurnCancelV1Schema.parse({
      protocolVersion: 1, turnId: activeTurn.turnId, runId: activeTurn.runId, reason: 'user',
    }))
    expect(cancel).toHaveBeenCalledTimes(1)
    await expect(active).resolves.toMatchObject({ status: 'cancelled' })
    const queuedResult = await queued
    expect(queuedResult.status).toBe('cancelled')
    if (queuedResult.status !== 'cancelled') throw new Error('expected a cancelled queued turn')
    expect(queuedResult.reason).toMatch(/timeout/)
    expect(app.adapter.requests).toHaveLength(1)
  })

  it('persists cancellation before active registration and replays the cancelled result', async () => {
    const app = await harness([textResponse('must not run')])
    const inbound = turn({ idempotencyKey: 'early-cancel', turnId: 'early-cancel', runId: 'early-cancel', messageId: 'early-cancel' })
    const pending = app.ctx.channels.runTurn(inbound, execution())
    await app.ctx.channels.cancel(channelTurnCancelV1Schema.parse({
      protocolVersion: 1, turnId: inbound.turnId, runId: inbound.runId, reason: 'timeout',
    }))

    const result = await pending
    expect(result.status).toBe('cancelled')
    if (result.status !== 'cancelled') throw new Error('expected a cancelled result')
    expect(result.sessionId).toBe(sessionIdFor(inbound.route))
    expect(result.reason).toMatch(/before Agent execution \(timeout\)/)
    expect(await app.ctx.channels.runTurn(inbound, execution())).toEqual(result)
    expect(app.adapter.requests).toEqual([])
    const ledger = app.facility.get('clawdsh_channel_agent')?.table('ledger').get(ledgerKey(inbound))
    expect(ledger).toMatchObject({ phase: 'completed', result })
  })

  it('honors exact cancellation while Agent acquisition is pending', async () => {
    const app = await harness([textResponse('must not run')])
    const gate = Promise.withResolvers<undefined>()
    const originalMount = app.ctx.agentPresets.mount.bind(app.ctx.agentPresets)
    const mount = vi.spyOn(app.ctx.agentPresets, 'mount').mockImplementation(async (ctx, preset) => {
      await gate.promise
      return await originalMount(ctx, preset)
    })
    const inbound = turn({ idempotencyKey: 'acquire-cancel', turnId: 'acquire-cancel', runId: 'acquire-cancel', messageId: 'acquire-cancel' })
    const pending = app.ctx.channels.runTurn(inbound, execution())
    await vi.waitFor(() => { expect(mount).toHaveBeenCalledTimes(1) })
    await expect(app.ctx.channels.cancel(channelTurnCancelV1Schema.parse({
      protocolVersion: 1, turnId: inbound.turnId, runId: 'wrong-run', reason: 'user',
    }))).rejects.toThrow(/does not match/)
    await app.ctx.channels.cancel(channelTurnCancelV1Schema.parse({
      protocolVersion: 1, turnId: inbound.turnId, runId: inbound.runId, reason: 'gateway-shutdown',
    }))
    gate.resolve(undefined)

    const result = await pending
    expect(result.status).toBe('cancelled')
    if (result.status !== 'cancelled') throw new Error('expected a cancelled result')
    expect(result.reason).toMatch(/gateway-shutdown/)
    expect(app.adapter.requests).toEqual([])
    expect(app.ctx.agents.list()).toEqual([])
  })

  it.each([
    new Error('cancel dispatch failed'),
    'cancel dispatch failed',
  ])('persists an active cancellation when Agent cancel throws %s', async (cancellationFailure) => {
    const app = await harness(['hang'])
    const inbound = turn({ idempotencyKey: 'throwing-cancel', turnId: 'throwing-cancel', runId: 'throwing-cancel', messageId: 'throwing-cancel' })
    const pending = app.ctx.channels.runTurn(inbound, execution())
    await vi.waitFor(() => { expect(app.adapter.requests).toHaveLength(1) })
    const agent = app.ctx.agents.get(sessionIdFor(inbound.route))
    if (agent === undefined) throw new Error('expected an active Agent')
    const originalCancel = agent.cancel.bind(agent)
    vi.spyOn(agent, 'cancel').mockImplementation((reason) => {
      originalCancel(reason)
      throw cancellationFailure
    })

    await expect(app.ctx.channels.cancel(channelTurnCancelV1Schema.parse({
      protocolVersion: 1, turnId: inbound.turnId, runId: inbound.runId, reason: 'user',
    }))).rejects.toThrow(/cancel dispatch failed/)
    expect(await pending).toMatchObject({ status: 'cancelled' })
  })

  it('does not rewrite a terminal result when cancellation races its durable commit', async () => {
    const app = await harness([textResponse('already complete')])
    const inbound = turn({ idempotencyKey: 'late-cancel', turnId: 'late-cancel', runId: 'late-cancel', messageId: 'late-cancel' })
    const ledger = app.facility.get('clawdsh_channel_agent')?.table('ledger')
    if (ledger === undefined) throw new Error('expected channel-agent ledger')
    let cancellation: Promise<void> | undefined
    app.ctx.on('domain/changed', (change) => {
      if (change.domain !== 'clawdsh_channel_agent' || change.table !== 'ledger' || change.key !== ledgerKey(inbound)) return
      const record = ledger.get(ledgerKey(inbound)) as ChannelLedgerRecord | undefined
      if (cancellation !== undefined || record?.result === undefined) return
      cancellation = app.ctx.channels.cancel(channelTurnCancelV1Schema.parse({
        protocolVersion: 1, turnId: inbound.turnId, runId: inbound.runId, reason: 'user',
      }))
    })

    const result = await app.ctx.channels.runTurn(inbound, execution())
    await vi.waitFor(() => { expect(cancellation).toBeDefined() })
    await cancellation
    expect(result).toMatchObject({ status: 'completed', text: 'already complete' })
    expect((ledger.get(ledgerKey(inbound)) as ChannelLedgerRecord | undefined)?.cancelRequested).toBeUndefined()
  })

  it('recovers a durable accepted cancellation without starting an Agent', async () => {
    const inbound = turn({ idempotencyKey: 'durable-cancel', turnId: 'durable-cancel', runId: 'durable-cancel', messageId: 'durable-cancel' })
    const app = await harness([textResponse('must not run')], {
      seed: async (domain) => {
        const now = Date.now()
        await domain.table('ledger').put(ledgerKey(inbound), {
          envelopeDigest: digestJson(inbound),
          envelope: inbound,
          phase: 'accepted',
          cancelRequested: 'user',
          createdAt: now,
          updatedAt: now,
        })
      },
    })

    const result = await app.ctx.channels.runTurn(inbound, execution())
    expect(result.status).toBe('cancelled')
    if (result.status !== 'cancelled') throw new Error('expected a cancelled result')
    expect(result.reason).toMatch(/before Agent execution \(user\)/)
    expect(app.adapter.requests).toEqual([])
  })

  it('rejects a persisted idempotency conflict after the original in-flight entry retires', async () => {
    const app = await harness([textResponse('first')])
    const inbound = turn()
    await app.ctx.channels.runTurn(inbound, execution())
    await expect(app.ctx.channels.runTurn(turn({ text: 'changed' }), execution()))
      .rejects.toThrow(/idempotency key was reused/)
    expect(app.adapter.requests).toHaveLength(1)
  })

  it('reuses one Agent acquisition across distinct serialized turns on one route', async () => {
    const app = await harness([textResponse('first'), textResponse('second')])
    const gate = Promise.withResolvers<undefined>()
    const originalMount = app.ctx.agentPresets.mount.bind(app.ctx.agentPresets)
    const mount = vi.spyOn(app.ctx.agentPresets, 'mount').mockImplementation(async (ctx, preset) => {
      await gate.promise
      return await originalMount(ctx, preset)
    })
    const first = app.ctx.channels.runTurn(turn(), execution())
    const second = app.ctx.channels.runTurn(turn({
      idempotencyKey: 'concurrent-2', turnId: 'concurrent-2', runId: 'concurrent-2', messageId: 'concurrent-2',
    }), execution())
    await vi.waitFor(() => { expect(mount).toHaveBeenCalledTimes(1) })
    gate.resolve(undefined)
    const results = await Promise.all([first, second])
    expect(results.map(result => result.status)).toEqual(['completed', 'completed'])
    expect(results[0]?.sessionId).toBe(results[1]?.sessionId)
    expect(app.ctx.agents.list()).toHaveLength(1)
  })

  it('fails before execution when the deterministic Session is owned by another runtime', async () => {
    const app = await harness([textResponse('unused')])
    const inbound = turn()
    const external = await app.ctx.agents.create({
      sessionId: sessionIdFor(inbound.route),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const result = await app.ctx.channels.runTurn(inbound, execution())
    expect(result.status).toBe('failed')
    if (result.status !== 'failed') throw new Error('expected a failed result')
    expect(result.sessionId).toBe(sessionIdFor(inbound.route))
    expect(result.error.message).toBe('The DeepSeek Harness Agent turn failed before a safe result was committed.')
    expect(result.error.retryable).toBe(true)
    expect(app.adapter.requests).toEqual([])
    await external.dispose()
  })

  it('returns a retryable pre-run failure when preset composition rejects Agent acquisition', async () => {
    const app = await harness([textResponse('recovered')])
    vi.spyOn(app.ctx.agentPresets, 'mount')
      .mockRejectedValueOnce(new Error('channel-agent: preset failed at /Users/operator with token sk-secret'))
    const failed = await app.ctx.channels.runTurn(turn(), execution())
    expect(failed).toMatchObject({
      status: 'failed',
      sessionId: sessionIdFor(turn().route),
      error: {
        message: 'The DeepSeek Harness Agent turn failed before a safe result was committed.',
        retryable: true,
      },
    })
    expect(app.ctx.agents.list()).toEqual([])
    expect(app.adapter.requests).toEqual([])
    const record = app.facility.get('clawdsh_channel_agent')?.table('ledger').get(ledgerKey(turn())) as ChannelLedgerRecord
    expect(record).toMatchObject({ phase: 'accepted', sessionId: sessionIdFor(turn().route) })
    expect(record.result).toBeUndefined()
    expect(JSON.stringify({ failed, record })).not.toMatch(/\/Users\/operator|sk-secret/)

    const recovered = await app.ctx.channels.runTurn(turn(), execution())
    expect(recovered).toMatchObject({
      status: 'completed', sessionId: failed.sessionId, text: 'recovered',
    })
    expect(app.ctx.agents.list()).toHaveLength(1)
  })

  it('honors execution abort, silent output, max-token output, and model failure', async () => {
    const aborting = await harness(['hang'])
    const controller = new AbortController()
    const pending = aborting.ctx.channels.runTurn(turn(), execution([], controller.signal))
    await vi.waitFor(() => { expect(aborting.adapter.requests).toHaveLength(1) })
    controller.abort(new Error('bridge cancelled'))
    expect(await pending).toMatchObject({ status: 'cancelled' })

    const terminal = await harness([
      textResponse(''), textWithoutUsage(''), textResponse('partial', 'max-tokens'), 'fail',
    ])
    expect(await terminal.ctx.channels.runTurn(turn(), execution())).toMatchObject({ status: 'silent' })
    const noUsage = await terminal.ctx.channels.runTurn(turn({
      idempotencyKey: 'no-usage-silent', turnId: 'no-usage-silent', runId: 'no-usage-silent', messageId: 'no-usage-silent',
    }), execution())
    expect(noUsage).toMatchObject({ status: 'silent' })
    expect(noUsage).not.toHaveProperty('usage')
    expect(await terminal.ctx.channels.runTurn(turn({
      idempotencyKey: 'two', turnId: 'two', runId: 'two', messageId: 'two',
    }), execution())).toMatchObject({ status: 'completed', text: 'partial' })
    const modelFailure = await terminal.ctx.channels.runTurn(turn({
      idempotencyKey: 'three', turnId: 'three', runId: 'three', messageId: 'three',
    }), execution())
    expect(modelFailure).toMatchObject({
      status: 'failed',
      error: {
        code: 'CHANNEL_AGENT_FAILED',
        message: 'The DeepSeek Harness Agent turn failed before a safe result was committed.',
        retryable: false,
      },
    })
  })

  it('maps a policy-blocked continuation to a stable terminal failure', async () => {
    const app = await harness([textResponse('first')])
    let proposals = 0
    app.ctx.on('agent/pre-step', async (_payload, next) => {
      proposals += 1
      return proposals === 2 ? { kind: 'reject' } : next()
    })
    app.ctx.on('agent/turn-stopping', ({ agent }) => {
      agent.inject(createUserMessage({
        content: [{ type: 'text', text: 'policy continuation' }],
        source: { kind: 'plugin', plugin: 'channel-agent-test' },
      }))
    })
    expect(await app.ctx.channels.runTurn(turn(), execution())).toMatchObject({
      status: 'failed',
      error: { code: 'CHANNEL_TURN_BLOCKED', retryable: false },
    })
    expect(proposals).toBe(2)
  })
})

describe('channel session and ledger lifecycle', () => {
  it('resets to a newer generation, retires the old Session, and closes the successor', async () => {
    const app = await harness([textResponse('first'), textResponse('second')])
    const base = turn()
    const first = await app.ctx.channels.runTurn(base, execution())
    const reset = await app.ctx.channels.reset(channelSessionResetV1Schema.parse({
      protocolVersion: 1, route: base.route, nextGeneration: 1, reason: 'reset',
    }))
    expect(reset.previousSessionId).toBe(first.sessionId)
    expect(reset.route.generation).toBe(1)
    expect(await app.ctx.channels.reset(channelSessionResetV1Schema.parse({
      protocolVersion: 1, route: base.route, nextGeneration: 1, reason: 'reset',
    }))).toEqual(reset)
    expect((await app.ctx.channels.runTurn(turn({
      idempotencyKey: 'stale', turnId: 'stale', runId: 'stale', messageId: 'stale',
    }), execution())).status).toBe('failed')
    const successor = routeTurn(base, { generation: 1 }, {
      idempotencyKey: 'next', turnId: 'next', runId: 'next', messageId: 'next',
    })
    const second = await app.ctx.channels.runTurn(successor, execution())
    expect(second.sessionId).not.toBe(first.sessionId)
    await app.ctx.channels.close(channelSessionCloseV1Schema.parse({
      protocolVersion: 1, route: successor.route, reason: 'gateway',
    }))
    await expect(app.ctx.channels.close(channelSessionCloseV1Schema.parse({
      protocolVersion: 1, route: successor.route, reason: 'gateway',
    }))).resolves.toBeUndefined()
    expect((await app.ctx.channels.runTurn(turn({
      ...successor,
      idempotencyKey: 'closed', turnId: 'closed', runId: 'closed', messageId: 'closed',
    }), execution())).status).toBe('failed')
  })

  it('cancels an active route before advancing its generation', async () => {
    const app = await harness(['hang'])
    const inbound = turn()
    const pending = app.ctx.channels.runTurn(inbound, execution())
    await vi.waitFor(() => { expect(app.adapter.requests).toHaveLength(1) })
    const reset = await app.ctx.channels.reset(channelSessionResetV1Schema.parse({
      protocolVersion: 1, route: inbound.route, nextGeneration: 1, reason: 'reset',
    }))
    expect(reset.previousSessionId).toBe(sessionIdFor(inbound.route))
    expect(await pending).toMatchObject({ status: 'cancelled' })
  })

  it('does not cancel an active Agent when a different route generation resets', async () => {
    const app = await harness(['hang'])
    const active = turn()
    const pending = app.ctx.channels.runTurn(active, execution())
    await vi.waitFor(() => { expect(app.adapter.requests).toHaveLength(1) })
    const other = routeTurn(active, {
      openclawSessionKey: 'other-session', account: 'other-account', conversation: 'other-conversation',
    } as never)
    await app.ctx.channels.reset(channelSessionResetV1Schema.parse({
      protocolVersion: 1, route: other.route, nextGeneration: 1, reason: 'reset',
    }))
    expect(app.ctx.agents.get(sessionIdFor(active.route))?.status).toBe('running')
    await app.ctx.channels.cancel(channelTurnCancelV1Schema.parse({
      protocolVersion: 1, turnId: active.turnId, runId: active.runId, reason: 'user',
    }))
    expect(await pending).toMatchObject({ status: 'cancelled' })
  })

  it('rejects stale reset and close controls and requires a strictly newer safe generation', async () => {
    const app = await harness([])
    const base = turn()
    await expect(app.ctx.channels.reset({
      protocolVersion: 1, route: base.route, nextGeneration: 0, reason: 'reset',
    })).rejects.toThrow(/strictly newer/)
    await app.ctx.channels.reset(channelSessionResetV1Schema.parse({
      protocolVersion: 1, route: base.route, nextGeneration: 1, reason: 'new',
    }))
    await expect(app.ctx.channels.reset(channelSessionResetV1Schema.parse({
      protocolVersion: 1, route: { ...base.route, generation: 0 }, nextGeneration: 2, reason: 'reset',
    }))).rejects.toThrow(/current route generation/)
    await expect(app.ctx.channels.close(channelSessionCloseV1Schema.parse({
      protocolVersion: 1, route: { ...base.route, generation: 0 }, reason: 'shutdown',
    }))).rejects.toThrow(/current route generation/)
  })

  it('invalidates a turn before its queued generation acceptance can start', async () => {
    const app = await harness([])
    const inbound = turn({ idempotencyKey: 'queued', turnId: 'queued', runId: 'queued', messageId: 'queued' })
    const pending = app.ctx.channels.runTurn(inbound, execution())
    await app.ctx.channels.reset(channelSessionResetV1Schema.parse({
      protocolVersion: 1, route: inbound.route, nextGeneration: 1, reason: 'reset',
    }))

    const result = await pending
    expect(result.status).toBe('failed')
    if (result.status !== 'failed') throw new Error('expected a failed result')
    expect(result.error.retryable).toBe(true)
    expect(result.error.message).toBe('The DeepSeek Harness Agent turn failed before a safe result was committed.')
    expect(app.adapter.requests).toEqual([])
  })

  it('rejects reset and close coordinates that conflict with the durable route binding', async () => {
    const app = await harness([textResponse('bound')])
    const inbound = turn()
    await app.ctx.channels.runTurn(inbound, execution())
    const conflicting = { ...inbound.route, account: 'different-account' }

    await expect(app.ctx.channels.reset(channelSessionResetV1Schema.parse({
      protocolVersion: 1, route: conflicting, nextGeneration: 1, reason: 'reset',
    }))).rejects.toThrow(/conflicts with the durable account binding/)
    await expect(app.ctx.channels.close(channelSessionCloseV1Schema.parse({
      protocolVersion: 1, route: conflicting, reason: 'shutdown',
    }))).rejects.toThrow(/conflicts with the durable account binding/)
  })

  it('continues a serialized lineage after an earlier queued control rejects', async () => {
    const app = await harness([], { mountAgent: false })
    const driver = await ChannelAgent.ChannelAgentDriver.create(app.ctx, driverConfig(app))
    const controller = new AbortController()
    const first = driver.reset(channelSessionResetV1Schema.parse({
      protocolVersion: 1, route: turn().route, nextGeneration: 1, reason: 'reset',
    }), controller.signal)
    controller.abort(new Error('first reset aborted'))
    const second = driver.reset(channelSessionResetV1Schema.parse({
      protocolVersion: 1, route: turn().route, nextGeneration: 1, reason: 'reset',
    }))

    await expect(first).rejects.toThrow(/first reset aborted/)
    await expect(second).resolves.toMatchObject({ route: { generation: 1 } })
    await driver.dispose()
  })

  it('continues a route-generation turn lane after an earlier operation rejects', async () => {
    const app = await harness([], { mountAgent: false })
    const driver = await ChannelAgent.ChannelAgentDriver.create(app.ctx, driverConfig(app))
    const internals = driver as unknown as {
      serializeTurn<T>(
        route: ChannelTurnEnvelopeV1['route'],
        operation: () => Promise<T>,
      ): Promise<T>
    }
    const first = internals.serializeTurn(turn().route, () => Promise.reject(new Error('first turn failed')))
    const second = internals.serializeTurn(turn().route, () => Promise.resolve('second turn ran'))

    await expect(first).rejects.toThrow(/first turn failed/)
    await expect(second).resolves.toBe('second turn ran')
    await driver.dispose()
  })

  it('replays identical reset and close controls queued before the first commit', async () => {
    const app = await harness([], { mountAgent: false })
    const driver = await ChannelAgent.ChannelAgentDriver.create(app.ctx, driverConfig(app))
    const resetRequest = channelSessionResetV1Schema.parse({
      protocolVersion: 1, route: turn().route, nextGeneration: 1, reason: 'reset',
    })
    const firstReset = driver.reset(resetRequest)
    const secondReset = driver.reset(resetRequest)
    expect(await secondReset).toEqual(await firstReset)

    const closeRequest = channelSessionCloseV1Schema.parse({
      protocolVersion: 1, route: { ...turn().route, generation: 1 }, reason: 'shutdown',
    })
    const firstClose = driver.close(closeRequest)
    const secondClose = driver.close(closeRequest)
    await expect(Promise.all([firstClose, secondClose])).resolves.toEqual([undefined, undefined])
    await driver.dispose()
  })

  it('rejects an exhausted in-process route lineage counter', async () => {
    const app = await harness([], { mountAgent: false })
    const driver = await ChannelAgent.ChannelAgentDriver.create(app.ctx, driverConfig(app))
    const internals = driver as unknown as { lineageEpochs: Map<string, number> }
    internals.lineageEpochs.set(generationKey(turn().route), Number.MAX_SAFE_INTEGER)

    await expect(driver.close(channelSessionCloseV1Schema.parse({
      protocolVersion: 1, route: turn().route, reason: 'shutdown',
    }))).rejects.toThrow(/lineage epoch is exhausted/)
    await driver.dispose()
  })

  it('prevents deferred Agent acquisition from crossing reset or close', async () => {
    for (const operation of ['reset', 'close'] as const) {
      const app = await harness([textResponse('must not run')])
      const gate = Promise.withResolvers<undefined>()
      const originalMount = app.ctx.agentPresets.mount.bind(app.ctx.agentPresets)
      const mount = vi.spyOn(app.ctx.agentPresets, 'mount').mockImplementation(async (ctx, preset) => {
        await gate.promise
        return await originalMount(ctx, preset)
      })
      const inbound = turn({
        idempotencyKey: `pending-${operation}`,
        turnId: `pending-${operation}`,
        runId: `pending-${operation}`,
        messageId: `pending-${operation}`,
      })
      const pending = app.ctx.channels.runTurn(inbound, execution())
      await vi.waitFor(() => { expect(mount).toHaveBeenCalledTimes(1) })
      if (operation === 'reset') {
        const request = channelSessionResetV1Schema.parse({
          protocolVersion: 1, route: inbound.route, nextGeneration: 1, reason: 'reset',
        })
        const result = await app.ctx.channels.reset(request)
        expect(await app.ctx.channels.reset(request)).toEqual(result)
      } else {
        const request = channelSessionCloseV1Schema.parse({
          protocolVersion: 1, route: inbound.route, reason: 'shutdown',
        })
        await app.ctx.channels.close(request)
        await expect(app.ctx.channels.close(request)).resolves.toBeUndefined()
      }
      gate.resolve(undefined)
      const result = await pending
      expect(result.status).toBe('failed')
      if (result.status !== 'failed') throw new Error('expected a failed result')
      expect(result.error.message).toBe('The DeepSeek Harness Agent turn failed before a safe result was committed.')
      expect(result.error.retryable).toBe(true)
      expect(app.adapter.requests).toEqual([])
      expect(app.ctx.agents.list()).toEqual([])
    }
  })

  it('does not invalidate a successor acquisition when the old reset acknowledgement is retried', async () => {
    const app = await harness([textResponse('successor')])
    const base = turn()
    const request = channelSessionResetV1Schema.parse({
      protocolVersion: 1, route: base.route, nextGeneration: 1, reason: 'new',
    })
    const acknowledged = await app.ctx.channels.reset(request)
    const gate = Promise.withResolvers<undefined>()
    const originalMount = app.ctx.agentPresets.mount.bind(app.ctx.agentPresets)
    const mount = vi.spyOn(app.ctx.agentPresets, 'mount').mockImplementation(async (ctx, preset) => {
      await gate.promise
      return await originalMount(ctx, preset)
    })
    const successor = routeTurn(base, { generation: 1 }, {
      idempotencyKey: 'successor-acquire', turnId: 'successor-acquire', runId: 'successor-acquire', messageId: 'successor-acquire',
    })
    const pending = app.ctx.channels.runTurn(successor, execution())
    await vi.waitFor(() => { expect(mount).toHaveBeenCalledTimes(1) })

    expect(await app.ctx.channels.reset(request)).toEqual(acknowledged)
    gate.resolve(undefined)
    expect(await pending).toMatchObject({ status: 'completed', text: 'successor' })
  })

  it('disposes one late Agent handle once and rejects its queued successor when acquisition crosses reset', async () => {
    const app = await harness([], { mountAgent: false })
    const gate = Promise.withResolvers<undefined>()
    const originalMount = app.ctx.agentPresets.mount.bind(app.ctx.agentPresets)
    vi.spyOn(app.ctx.agentPresets, 'mount').mockImplementation(async (ctx, preset) => {
      await gate.promise
      return await originalMount(ctx, preset)
    })
    let handleDisposeCalls = 0
    const originalCreate = app.ctx.agents.create.bind(app.ctx.agents)
    vi.spyOn(app.ctx.agents, 'create').mockImplementation(async (options) => {
      const handle = await originalCreate(options)
      const originalDispose = handle.dispose.bind(handle)
      vi.spyOn(handle, 'dispose').mockImplementation(async () => {
        handleDisposeCalls += 1
        await originalDispose()
      })
      return handle
    })
    const driver = await ChannelAgent.ChannelAgentDriver.create(app.ctx, driverConfig(app))
    const acquire = vi.spyOn(driver as unknown as {
      acquire: (...args: never[]) => Promise<AgentHandle>
    }, 'acquire')
    const firstTurn = turn({ idempotencyKey: 'shared-1', turnId: 'shared-1', runId: 'shared-1', messageId: 'shared-1' })
    const secondTurn = turn({ idempotencyKey: 'shared-2', turnId: 'shared-2', runId: 'shared-2', messageId: 'shared-2' })
    const first = driver.runTurn(firstTurn, execution())
    const second = driver.runTurn(secondTurn, execution())
    await vi.waitFor(() => { expect(acquire).toHaveBeenCalledTimes(1) })
    await driver.reset(channelSessionResetV1Schema.parse({
      protocolVersion: 1, route: firstTurn.route, nextGeneration: 1, reason: 'reset',
    }))
    gate.resolve(undefined)

    expect(await Promise.all([first, second])).toEqual([
      expect.objectContaining({ status: 'failed' }),
      expect.objectContaining({ status: 'failed' }),
    ])
    expect(handleDisposeCalls).toBe(1)
    expect(app.ctx.agents.list()).toEqual([])
    await driver.dispose()
  })

  it('records monotonic delivery receipts and treats an exact terminal replay as a no-op', async () => {
    const app = await harness([textResponse('reply')])
    const activity = vi.fn(async (_input: ChannelDeliveryActivityInput) => {})
    installActivity(app.ctx, activity)
    const result = await app.ctx.channels.runTurn(turn(), execution())
    await app.ctx.channels.reportDelivery(report())
    await app.ctx.channels.reportDelivery(report())
    await vi.waitFor(() => { expect(activity).toHaveBeenCalledOnce() })
    const activityInput = activity.mock.calls[0]?.[0]
    expect(activityInput).toMatchObject({
      adapter: 'telegram',
      conversation: 'direct',
      mention: null,
      status: 'sent',
    })
    expect(typeof activityInput?.sessionId).toBe('string')
    expect(Number.isSafeInteger(activityInput?.seq)).toBe(true)
    if (result.status !== 'completed') throw new Error('expected completed result')
    const session = app.ctx.agents.get(result.sessionId)?.session
    expect(session?.events.some(event => event.type.startsWith('channel/'))).toBe(false)
    const ledger = app.facility.get('clawdsh_channel_agent')?.table('ledger').get(ledgerKey(turn())) as ChannelLedgerRecord
    expect(ledger.phase).toBe('delivered')
    expect(ledger.delivery?.status).toBe('confirmed')
    await expect(app.ctx.channels.reportDelivery(report({ deliveryId: 'different-delivery' })))
      .rejects.toThrow(/identity changed/)
    await expect(app.ctx.channels.reportDelivery(report({ status: 'accepted' })))
      .rejects.toThrow(/regressed/)
  })

  it('tracks accepted, retrying, ambiguous, and dead-letter delivery states without blind resend', async () => {
    const app = await harness([textResponse('one'), textResponse('two'), textResponse('three')])
    const activity: ChannelDeliveryActivityInput[] = []
    installActivity(app.ctx, async (input) => { activity.push(input) })
    const turns = [
      turn(),
      turn({ idempotencyKey: 'ambiguous', turnId: 'ambiguous', runId: 'ambiguous', messageId: 'ambiguous' }),
      turn({ idempotencyKey: 'dead', turnId: 'dead', runId: 'dead', messageId: 'dead' }),
    ]
    for (const inbound of turns) await app.ctx.channels.runTurn(inbound, execution())

    await app.ctx.channels.reportDelivery(report({ status: 'accepted', attempt: 1 }))
    await app.ctx.channels.reportDelivery(report({
      status: 'retrying',
      attempt: 2,
      nextAttemptAt: '2026-08-16T00:01:00Z',
      error: { code: 'RATE_LIMIT', message: 'retry later', retryable: true },
    }))
    await expect(app.ctx.channels.reportDelivery(report({ status: 'accepted', attempt: 1 })))
      .rejects.toThrow(/regressed/)
    await expect(app.ctx.channels.reportDelivery(report({ status: 'accepted', attempt: 2 })))
      .rejects.toThrow(/regressed/)
    await expect(app.ctx.channels.reportDelivery(report({
      status: 'retrying',
      attempt: 2,
      nextAttemptAt: '2026-08-16T00:02:00Z',
      error: { code: 'RATE_LIMIT', message: 'still retrying', retryable: true },
    }))).rejects.toThrow(/regressed/)
    await expect(app.ctx.channels.reportDelivery(report({
      status: 'retrying',
      attempt: 3,
      platformMessageId: undefined,
      nextAttemptAt: '2026-08-16T00:03:00Z',
      error: { code: 'RATE_LIMIT', message: 'retry later', retryable: true },
    }))).rejects.toThrow(/regressed/)
    await expect(app.ctx.channels.reportDelivery(report({
      status: 'retrying',
      attempt: 3,
      platformMessageId: 'changed-platform-message',
      nextAttemptAt: '2026-08-16T00:03:00Z',
      error: { code: 'RATE_LIMIT', message: 'retry later', retryable: true },
    }))).rejects.toThrow(/regressed/)
    await app.ctx.channels.reportDelivery(report({
      status: 'retrying',
      attempt: 3,
      nextAttemptAt: '2026-08-16T00:03:00Z',
      error: { code: 'RATE_LIMIT', message: 'retry later', retryable: true },
    }))
    await app.ctx.channels.reportDelivery(report({
      subject: { kind: 'turn', turnId: 'ambiguous', runId: 'ambiguous' },
      deliveryId: 'delivery-ambiguous',
      status: 'ambiguous',
      error: { code: 'UNKNOWN', message: 'receipt lost', retryable: false },
    }))
    await expect(app.ctx.channels.reportDelivery(report({
      subject: { kind: 'turn', turnId: 'ambiguous', runId: 'ambiguous' },
      deliveryId: 'delivery-ambiguous', status: 'confirmed',
    }))).rejects.toThrow(/regressed/)
    await app.ctx.channels.reportDelivery(report({
      subject: { kind: 'turn', turnId: 'dead', runId: 'dead' },
      deliveryId: 'delivery-dead',
      status: 'dead-letter',
      error: { code: 'DENIED', message: 'platform rejected', retryable: false },
    }))
    await expect(app.ctx.channels.reportDelivery(report({
      subject: { kind: 'turn', turnId: 'dead', runId: 'dead' },
      deliveryId: 'delivery-dead', status: 'confirmed',
    }))).rejects.toThrow(/regressed/)

    const table = app.facility.get('clawdsh_channel_agent')?.table('ledger')
    expect((table?.get(ledgerKey(turns[0]!)) as ChannelLedgerRecord).delivery?.status).toBe('retrying')
    expect((table?.get(ledgerKey(turns[1]!)) as ChannelLedgerRecord).phase).toBe('ambiguous')
    expect((table?.get(ledgerKey(turns[2]!)) as ChannelLedgerRecord).phase).toBe('dead-letter')
    await vi.waitFor(() => { expect(activity).toHaveLength(5) })
    expect(activity.map(input => input.status)).toEqual(['started', 'started', 'started', undefined, 'failed'])
    expect(activity.every(input => input.adapter === 'telegram'
      && input.conversation === 'direct'
      && input.mention === null
      && Number.isSafeInteger(input.seq))).toBe(true)
    const serialized = JSON.stringify(activity)
    expect(serialized).not.toContain('account-1')
    expect(serialized).not.toContain('conversation-1')
    expect(serialized).not.toContain('sender-1')
    expect(serialized).not.toContain('delivery-')
    expect(serialized).not.toContain('retry later')
    expect(serialized).not.toContain('receipt lost')
  })

  it('keeps a durable receipt successful when the optional Activity sink rejects', async () => {
    const app = await harness([textResponse('reply')])
    const activity = vi.fn(async (_input: ChannelDeliveryActivityInput) => {
      throw new Error('activity-failure-secret-canary')
    })
    installActivity(app.ctx, activity)
    await app.ctx.channels.runTurn(turn(), execution())

    await expect(app.ctx.channels.reportDelivery(report())).resolves.toBeUndefined()
    await vi.waitFor(() => { expect(activity).toHaveBeenCalledOnce() })
    const ledger = app.facility.get('clawdsh_channel_agent')?.table('ledger').get(ledgerKey(turn())) as ChannelLedgerRecord
    expect(ledger.phase).toBe('delivered')
    expect(ledger.delivery?.status).toBe('confirmed')
  })

  it('keeps a durable receipt successful when Activity is not mounted', async () => {
    const app = await harness([textResponse('reply')])
    await app.ctx.channels.runTurn(turn(), execution())

    await expect(app.ctx.channels.reportDelivery(report())).resolves.toBeUndefined()
    const ledger = app.facility.get('clawdsh_channel_agent')?.table('ledger').get(ledgerKey(turn())) as ChannelLedgerRecord
    expect(ledger.phase).toBe('delivered')
    expect(ledger.delivery?.status).toBe('confirmed')
  })

  it('omits Activity when persisted Session inspection has no events', async () => {
    const app = await harness([textResponse('reply')])
    const activity = vi.fn(async (_input: ChannelDeliveryActivityInput) => {})
    installActivity(app.ctx, activity)
    await app.ctx.channels.runTurn(turn(), execution())
    vi.spyOn(app.ctx.sessions, 'get').mockReturnValue(undefined)
    const inspect = vi.spyOn(app.ctx.sessionPersistence, 'inspect').mockResolvedValue({ events: [] } as never)

    await expect(app.ctx.channels.reportDelivery(report())).resolves.toBeUndefined()
    await vi.waitFor(() => { expect(inspect).toHaveBeenCalledOnce() })
    await Promise.resolve()
    expect(activity).not.toHaveBeenCalled()
  })

  it('keeps a durable receipt successful when persisted Activity inspection rejects', async () => {
    const app = await harness([textResponse('reply')])
    const activity = vi.fn(async (_input: ChannelDeliveryActivityInput) => {})
    installActivity(app.ctx, activity)
    await app.ctx.channels.runTurn(turn(), execution())
    vi.spyOn(app.ctx.sessions, 'get').mockReturnValue(undefined)
    const inspect = vi.spyOn(app.ctx.sessionPersistence, 'inspect')
      .mockRejectedValue(new Error('inspection-failure-secret-canary'))

    await expect(app.ctx.channels.reportDelivery(report())).resolves.toBeUndefined()
    await vi.waitFor(() => { expect(inspect).toHaveBeenCalledOnce() })
    await Promise.resolve()
    expect(activity).not.toHaveBeenCalled()
  })

  it('keeps a durable receipt successful when the optional Activity sink throws synchronously', async () => {
    const app = await harness([textResponse('reply')])
    const activity = vi.fn((_input: ChannelDeliveryActivityInput): Promise<unknown> => {
      throw new Error('synchronous-activity-failure-secret-canary')
    })
    installActivity(app.ctx, activity)
    await app.ctx.channels.runTurn(turn(), execution())

    await expect(app.ctx.channels.reportDelivery(report())).resolves.toBeUndefined()
    await vi.waitFor(() => { expect(activity).toHaveBeenCalledOnce() })
    const ledger = app.facility.get('clawdsh_channel_agent')?.table('ledger').get(ledgerKey(turn())) as ChannelLedgerRecord
    expect(ledger.phase).toBe('delivered')
  })

  it('rejects reports before results, unknown turns, and ambiguous turn/run identities', async () => {
    const app = await harness([textResponse('one'), textResponse('two')])
    await expect(app.ctx.channels.reportDelivery(report())).rejects.toThrow(/unknown turn/)
    const base = turn()
    await app.ctx.channels.runTurn(base, execution())
    const other = routeTurn(base, { gatewayInstanceId: 'gateway-2', openclawSessionKey: 'other' } as never, {
      idempotencyKey: 'other', messageId: 'other',
    })
    await app.ctx.channels.runTurn(other, execution())
    await expect(app.ctx.channels.reportDelivery(report())).rejects.toThrow(/ambiguous/)
    await expect(app.ctx.channels.reportDelivery({
      protocolVersion: 1,
      extension: 'delivery.report',
      receipt: {
        protocolVersion: 1,
        deliveryId: ChannelDeliveryId('action-delivery'),
        subject: { kind: 'action', actionId: other.route.account as never },
        attempt: 1,
        status: 'confirmed',
      },
    })).rejects.toThrow(/only final-turn/)
  })

  it('rejects a delivery report for an accepted turn, then safely resumes that accepted ledger row', async () => {
    const inbound = turn()
    const app = await harness([textResponse('resumed')], {
      seed: async (domain) => {
        const now = Date.now()
        await domain.table('ledger').put(ledgerKey(inbound), {
          envelopeDigest: digestJson(inbound),
          envelope: inbound,
          phase: 'accepted',
          createdAt: now,
          updatedAt: now,
        })
      },
    })
    await expect(app.ctx.channels.reportDelivery(report())).rejects.toThrow(/before a durable turn result/)
    expect(await app.ctx.channels.runTurn(inbound, execution())).toMatchObject({
      status: 'completed', text: 'resumed',
    })
  })

  it('quarantines a persisted running turn and never reruns its possible side effects', async () => {
    const inbound = turn()
    const app = await harness([], {
      seed: async (domain) => {
        const now = Date.now()
        await domain.table('ledger').put(ledgerKey(inbound), {
          envelopeDigest: digestJson(inbound),
          envelope: inbound,
          phase: 'running',
          sessionId: sessionIdFor(inbound.route),
          createdAt: now,
          updatedAt: now,
        })
      },
    })
    const result = await app.ctx.channels.runTurn(inbound, execution())
    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'CHANNEL_TURN_NEEDS_RECOVERY', retryable: false },
    })
    expect(app.adapter.requests).toEqual([])
  })

  it('quarantines a running row observed after startup and persists runtime failures as recovery-required', async () => {
    const live = turn()
    const late = await harness([])
    const now = Date.now()
    await late.facility.get('clawdsh_channel_agent')?.table('ledger').put(ledgerKey(live), {
      envelopeDigest: digestJson(live),
      envelope: live,
      phase: 'running',
      sessionId: sessionIdFor(live.route),
      createdAt: now,
      updatedAt: now,
    })
    expect(await late.ctx.channels.runTurn(live, execution())).toMatchObject({
      status: 'failed', error: { code: 'CHANNEL_TURN_NEEDS_RECOVERY' },
    })
    expect((late.facility.get('clawdsh_channel_agent')?.table('ledger').get(ledgerKey(live)) as ChannelLedgerRecord).phase)
      .toBe('needs-recovery')

    const failing = await harness([textResponse('reply')])
    vi.spyOn(failing.ctx.sessions, 'flush').mockRejectedValueOnce(new Error('durable flush failed'))
    const result = await failing.ctx.channels.runTurn(turn(), execution())
    expect(result).toMatchObject({
      status: 'failed',
      sessionId: sessionIdFor(turn().route),
      error: {
        message: 'The DeepSeek Harness Agent turn failed before a safe result was committed.',
        retryable: false,
      },
    })
    const ledger = failing.facility.get('clawdsh_channel_agent')?.table('ledger').get(ledgerKey(turn())) as ChannelLedgerRecord
    expect(ledger.phase).toBe('needs-recovery')
    expect(ledger.result).toBeUndefined()
    expect(await failing.ctx.channels.runTurn(turn(), execution())).toMatchObject({
      status: 'failed', error: { code: 'CHANNEL_TURN_NEEDS_RECOVERY' },
    })
  })

  it('resumes the same durable Session and route ledger after a runtime restart', async () => {
    const first = await harness([textResponse('first')])
    const initial = await first.ctx.channels.runTurn(turn(), execution())
    await first.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(first.ctx), 1)

    const second = await harness([textResponse('second')], { root: first.root, pool: first.pool })
    const continued = turn({
      idempotencyKey: 'continued', turnId: 'continued', runId: 'continued',
      messageId: 'continued', text: 'continue',
    })
    const result = await second.ctx.channels.runTurn(continued, execution())
    expect(result.sessionId).toBe(initial.sessionId)
    expect(second.adapter.requests[0]?.messages.some(message =>
      message.role === 'assistant' && message.content.some(block => block.type === 'text' && block.text === 'first')),
    JSON.stringify(result)).toBe(true)
  })

  it('retires a persisted binding even when this runtime has not resumed its Agent handle', async () => {
    const first = await harness([textResponse('first')])
    const initial = await first.ctx.channels.runTurn(turn(), execution())
    await first.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(first.ctx), 1)

    const second = await harness([], { root: first.root, pool: first.pool })
    const reset = await second.ctx.channels.reset(channelSessionResetV1Schema.parse({
      protocolVersion: 1, route: turn().route, nextGeneration: 1, reason: 'reset',
    }))
    expect(reset.previousSessionId).toBe(initial.sessionId)
    expect(second.ctx.agents.list()).toEqual([])
  })

  it('fails closed if one direct route changes between owner and safe admission classes', async () => {
    const app = await harness([textResponse('owner')])
    await app.ctx.channels.runTurn(turn(), execution())
    const changed = turn({
      idempotencyKey: 'changed', turnId: 'changed', runId: 'changed', messageId: 'changed',
      sender: { senderId: 'paired', trust: 'paired' },
    })
    const result = await app.ctx.channels.runTurn(changed, execution())
    expect(result.status).toBe('failed')
    if (result.status !== 'failed') throw new Error('expected a failed result')
    expect(result.error.code).toBe('CHANNEL_TURN_FAILED')
    expect(result.error.message).toBe('The DeepSeek Harness Agent turn failed before a safe result was committed.')
    expect(app.adapter.requests).toHaveLength(1)
  })

  it('fails closed when one OpenClaw lineage is reused for different account coordinates', async () => {
    const app = await harness([textResponse('first')])
    const base = turn()
    await app.ctx.channels.runTurn(base, execution())
    const conflicting = routeTurn(base, { account: 'other-account', conversation: 'other-conversation' } as never, {
      idempotencyKey: 'route-conflict', turnId: 'route-conflict', runId: 'route-conflict', messageId: 'route-conflict',
    })
    const result = await app.ctx.channels.runTurn(conflicting, execution())
    expect(result.status).toBe('failed')
    if (result.status !== 'failed') throw new Error('expected a failed result')
    expect(result.error.message).toBe('The DeepSeek Harness Agent turn failed before a safe result was committed.')
    expect(result.error.retryable).toBe(true)
    expect(app.adapter.requests).toHaveLength(1)
  })
})

describe('channel admission and media failures', () => {
  it('imports authenticated image bytes and projects only the durable attachment reference to the model', async () => {
    const app = await harness([textResponse('seen')])
    const bytes = Buffer.from('image-data')
    await writeFile(join(app.root, 'staging/image.png'), bytes)
    const inbound = turn({
      text: '',
      media: [{
        mediaId: ChannelMediaId('media-1'),
        ordinal: 0,
        kind: 'image',
        mediaType: 'image/png',
        bytes: bytes.byteLength,
        sha256: ChannelMediaSha256(createHash('sha256').update(bytes).digest('hex')),
        relativePath: 'image.png',
      }],
    })
    const result = await app.ctx.channels.runTurn(inbound, execution())
    expect(result.status).toBe('completed')
    const request = app.adapter.requests[0]
    const user = request?.messages.findLast(message => message.role === 'user')
    expect(user?.content).toHaveLength(1)
    const content = user?.content[0]
    expect(content?.type).toBe('image')
    if (content?.type !== 'image') throw new Error('expected imported image content')
    expect(content.attachment).toBeTypeOf('object')
    expect(JSON.stringify(user)).not.toContain(join(app.root, 'staging'))
  })

  it('keeps a media validation failure retryable until the same admitted turn can start safely', async () => {
    const app = await harness([textResponse('recovered')])
    const bytes = Buffer.from('bad-image')
    await writeFile(join(app.stagingRoot, 'bad.png'), bytes)
    vi.spyOn(app.ctx.attachments, 'validateImage').mockRejectedValueOnce('decoder rejected bytes')
    const inbound = turn({
      text: '',
      media: [{
        mediaId: ChannelMediaId('bad-media'),
        ordinal: 0,
        kind: 'image',
        mediaType: 'image/png',
        bytes: bytes.byteLength,
        sha256: ChannelMediaSha256(createHash('sha256').update(bytes).digest('hex')),
        relativePath: 'bad.png',
      }],
    })
    expect(await app.ctx.channels.runTurn(inbound, execution())).toMatchObject({
      status: 'failed',
      error: {
        message: 'The DeepSeek Harness Agent turn failed before a safe result was committed.',
        retryable: true,
      },
    })
    expect(app.adapter.requests).toEqual([])
    const failed = app.facility.get('clawdsh_channel_agent')?.table('ledger').get(ledgerKey(inbound)) as ChannelLedgerRecord
    expect(failed.phase).toBe('accepted')
    expect(failed.result).toBeUndefined()
    expect(await app.ctx.channels.runTurn(inbound, execution())).toMatchObject({
      status: 'completed', text: 'recovered', sessionId: sessionIdFor(inbound.route),
    })
    expect(app.adapter.requests).toHaveLength(1)
  })

  it('rejects invalid trust, empty input, generation, disposed state, and unsupported media before the model', async () => {
    const app = await harness([])
    const directGroupTrust = {
      ...turn(), sender: { senderId: 'x', trust: 'group-allowlisted' },
    } as ChannelTurnEnvelopeV1
    expect(() => app.ctx.channels.runTurn(directGroupTrust, execution())).toThrow(/group-only admission/)
    const groupOwner = {
      ...turn(),
      route: { ...turn().route, kind: 'group' },
      sender: { senderId: 'x', trust: 'owner' },
      wasMentioned: true,
    } as ChannelTurnEnvelopeV1
    expect(() => app.ctx.channels.runTurn(groupOwner, execution())).toThrow(/group allowlist/)
    expect(() => app.ctx.channels.runTurn({ ...turn(), text: '', media: [] }, execution()))
      .toThrow(/requires text or media/)
    expect(() => app.ctx.channels.runTurn({
      ...turn(), route: { ...turn().route, generation: -1 },
    }, execution())).toThrow(/non-negative safe integer/)

    const unsupported = turn({
      text: '',
      media: [{
        mediaId: ChannelMediaId('file-1'), ordinal: 0, kind: 'file', mediaType: 'application/pdf',
        bytes: 1, sha256: ChannelMediaSha256('a'.repeat(64)), relativePath: 'file.pdf',
      }],
    })
    expect(await app.ctx.channels.runTurn(unsupported, execution())).toMatchObject({
      status: 'failed', error: { retryable: true },
    })
    await app.ctx.channels.reset(channelSessionResetV1Schema.parse({
      protocolVersion: 1, route: unsupported.route, nextGeneration: 1, reason: 'reset',
    }))
    const stale = await app.ctx.channels.runTurn(unsupported, execution())
    expect(stale.status).toBe('failed')
    if (stale.status !== 'failed') throw new Error('expected a failed result')
    expect(stale.error.message).toBe('The DeepSeek Harness Agent turn failed before a safe result was committed.')
    expect(stale.error.retryable).toBe(true)
    await app.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(app.ctx), 1)
    expect(() => app.ctx.channels.runTurn(turn(), execution())).toThrow()
    expect(app.adapter.requests).toEqual([])
  })

  it('validates absolute deployment paths before opening storage', async () => {
    await expect(ChannelAgent.apply(new Context(), {
      ownerPreset: 'owner', safePreset: 'safe', cwd: 'relative', stagingRoot: '/tmp/staging', maxMediaBytes: 1,
      shutdownGraceMs: 100,
    })).rejects.toThrow(/cwd must be absolute/)
    await expect(ChannelAgent.apply(new Context(), {
      ownerPreset: 'owner', safePreset: 'safe', cwd: '/tmp/work', stagingRoot: 'relative', maxMediaBytes: 1,
      shutdownGraceMs: 100,
    })).rejects.toThrow(/stagingRoot must be absolute/)
    await expect(ChannelAgent.apply(new Context(), {
      ownerPreset: 'owner', safePreset: 'safe', cwd: '/tmp/work', stagingRoot: '/tmp/staging', maxMediaBytes: 0,
      shutdownGraceMs: 100,
    })).rejects.toThrow(/maxMediaBytes must be a positive safe integer/)
    await expect(ChannelAgent.apply(new Context(), {
      ownerPreset: 'owner', safePreset: 'safe', cwd: '/tmp/work', stagingRoot: '/tmp/staging', maxMediaBytes: 1,
      shutdownGraceMs: 0,
    })).rejects.toThrow(/shutdownGraceMs must be a positive safe integer/)
  })

  it('rejects an invalid direct-driver teardown limit before opening storage', async () => {
    const app = await harness([], { mountAgent: false })

    await expect(ChannelAgent.ChannelAgentDriver.create(app.ctx, driverConfig(app, 0)))
      .rejects.toThrow(/shutdownGraceMs must be a positive safe integer/)
  })

  it('closes the opened storage domain when startup recovery persistence fails', async () => {
    const recoveryFailure = new Error('recovery write failed')
    const close = vi.fn(async () => {})
    const ledger = {
      entries: () => [[
        'running',
        { phase: 'running', updatedAt: 1 },
      ]] as const,
      put: vi.fn(async () => { throw recoveryFailure }),
    }
    const domain = {
      table: vi.fn(() => ledger),
      close,
    }
    const ctx = {
      storageDomain: { open: vi.fn(async () => domain) },
    }

    await expect(ChannelAgent.ChannelAgentDriver.create(ctx as never, {
      ownerPreset: 'owner',
      safePreset: 'safe',
      cwd: '/tmp/workspace',
      stagingRoot: '/tmp/staging',
      maxMediaBytes: 1,
      shutdownGraceMs: 100,
    })).rejects.toBe(recoveryFailure)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('shares one successful teardown promise, cancels active work, and closes storage after quiescence', async () => {
    const app = await harness(['hang'], { mountAgent: false })
    const driver = await ChannelAgent.ChannelAgentDriver.create(app.ctx, driverConfig(app))
    const domain = app.facility.get('clawdsh_channel_agent')
    if (domain === undefined) throw new Error('expected channel-agent domain')
    const close = vi.spyOn(domain, 'close')
    const pending = driver.runTurn(turn(), execution())
    await vi.waitFor(() => { expect(app.adapter.requests).toHaveLength(1) })

    const first = driver.dispose()
    const second = driver.dispose()
    expect(second).toBe(first)
    expect(() => driver.runTurn(turn({ idempotencyKey: 'late' }), execution())).toThrow(/disposed/)
    expect(await pending).toMatchObject({ status: 'cancelled' })
    await first
    expect(close).toHaveBeenCalledTimes(1)
    expect(app.ctx.agents.list()).toEqual([])
  })

  it('aggregates a synchronous cancellation failure after the active turn still settles', async () => {
    const app = await harness(['hang'], { mountAgent: false })
    const driver = await ChannelAgent.ChannelAgentDriver.create(app.ctx, driverConfig(app))
    const pending = driver.runTurn(turn(), execution())
    await vi.waitFor(() => { expect(app.adapter.requests).toHaveLength(1) })
    const agent = app.ctx.agents.get(sessionIdFor(turn().route))
    if (agent === undefined) throw new Error('expected an active Agent')
    const originalCancel = agent.cancel.bind(agent)
    vi.spyOn(agent, 'cancel').mockImplementation((reason) => {
      originalCancel(reason)
      throw new Error('cancel observer failed')
    })

    const disposing = driver.dispose()
    expect(await pending).toMatchObject({ status: 'cancelled' })
    await expect(disposing).rejects.toBeInstanceOf(AggregateError)
    await expect(disposing).rejects.toThrow(/resources failed/)
  })

  it('aggregates a rejected acquisition observed during teardown', async () => {
    const app = await harness([], { mountAgent: false })
    const gate = Promise.withResolvers<undefined>()
    const mount = vi.spyOn(app.ctx.agentPresets, 'mount').mockImplementation(async () => {
      await gate.promise
      throw new Error('preset composition failed during shutdown')
    })
    const driver = await ChannelAgent.ChannelAgentDriver.create(app.ctx, driverConfig(app))
    const pending = driver.runTurn(turn(), execution())
    await vi.waitFor(() => { expect(mount).toHaveBeenCalledTimes(1) })

    const disposing = driver.dispose()
    gate.resolve(undefined)
    expect(await pending).toMatchObject({ status: 'failed', error: { retryable: true } })
    await expect(disposing).rejects.toBeInstanceOf(AggregateError)
    await expect(disposing).rejects.toThrow(/resources failed/)
  })

  it('times out deferred acquisition without closing writable storage and releases the late handle', async () => {
    const app = await harness([textResponse('must not run')], { mountAgent: false })
    const gate = Promise.withResolvers<undefined>()
    const originalMount = app.ctx.agentPresets.mount.bind(app.ctx.agentPresets)
    const mount = vi.spyOn(app.ctx.agentPresets, 'mount').mockImplementation(async (ctx, preset) => {
      await gate.promise
      return await originalMount(ctx, preset)
    })
    const driver = await ChannelAgent.ChannelAgentDriver.create(app.ctx, driverConfig(app, 10))
    const domain = app.facility.get('clawdsh_channel_agent')
    if (domain === undefined) throw new Error('expected channel-agent domain')
    const close = vi.spyOn(domain, 'close')
    const pending = driver.runTurn(turn(), execution())
    await vi.waitFor(() => { expect(mount).toHaveBeenCalledTimes(1) })

    const disposing = driver.dispose()
    expect(driver.dispose()).toBe(disposing)
    await expect(disposing).rejects.toThrow(/quiescence within shutdownGraceMs/)
    expect(close).not.toHaveBeenCalled()
    gate.resolve(undefined)
    const result = await pending
    expect(result.status).toBe('failed')
    if (result.status !== 'failed') throw new Error('expected a failed result')
    expect(result.error.retryable).toBe(true)
    expect(app.adapter.requests).toEqual([])
    expect(app.ctx.agents.list()).toEqual([])
  })

  it('surfaces Agent and storage teardown failures together', async () => {
    const app = await harness([textResponse('done')], { mountAgent: false })
    let created: AgentHandle | undefined
    const originalCreate = app.ctx.agents.create.bind(app.ctx.agents)
    vi.spyOn(app.ctx.agents, 'create').mockImplementation(async (options) => {
      const handle = await originalCreate(options)
      created = handle
      return handle
    })
    const driver = await ChannelAgent.ChannelAgentDriver.create(app.ctx, driverConfig(app))
    await driver.runTurn(turn(), execution())
    if (created === undefined) throw new Error('expected an owned Agent handle')
    const handleDispose = vi.spyOn(created, 'dispose').mockRejectedValueOnce(new Error('Agent dispose failed'))
    const domain = app.facility.get('clawdsh_channel_agent')
    if (domain === undefined) throw new Error('expected channel-agent domain')
    const close = vi.spyOn(domain, 'close').mockRejectedValueOnce(new Error('domain close failed'))

    const disposing = driver.dispose()
    await expect(disposing).rejects.toBeInstanceOf(AggregateError)
    await expect(disposing).rejects.toThrow(/resources failed/)
    expect(handleDispose).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('enforces direct driver lifecycle, empty controls, and aborted control signals', async () => {
    const app = await harness([], { mountAgent: false })
    const driver = await ChannelAgent.ChannelAgentDriver.create(app.ctx, driverConfig(app))
    await driver.cancel(channelTurnCancelV1Schema.parse({
      protocolVersion: 1, turnId: 'absent', runId: 'absent', reason: 'user',
    }))
    await driver.close(channelSessionCloseV1Schema.parse({
      protocolVersion: 1, route: turn().route, reason: 'shutdown',
    }))
    const controller = new AbortController()
    controller.abort(new Error('control aborted'))
    const signal = controller.signal
    await expect(driver.cancel(channelTurnCancelV1Schema.parse({
      protocolVersion: 1, turnId: 'absent', runId: 'absent', reason: 'user',
    }), signal)).rejects.toThrow(/control aborted/)
    await expect(driver.reset(channelSessionResetV1Schema.parse({
      protocolVersion: 1, route: turn().route, nextGeneration: 1, reason: 'reset',
    }), signal)).rejects.toThrow(/control aborted/)
    await expect(driver.close(channelSessionCloseV1Schema.parse({
      protocolVersion: 1, route: turn().route, reason: 'shutdown',
    }), signal)).rejects.toThrow(/control aborted/)
    await expect(driver.reportDelivery(report(), signal)).rejects.toThrow(/control aborted/)

    await driver.dispose()
    await driver.dispose()
    expect(() => driver.runTurn(turn(), execution())).toThrow(/driver is disposed/)
  })
})
