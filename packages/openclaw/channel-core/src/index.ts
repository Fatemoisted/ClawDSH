/**
 * The `ctx.legacyChannels` seam: an adapter registry that routes inbound channel
 * messages to per-thread agent sessions, drives each turn to quiescence, and
 * delivers the extracted reply back through the owning adapter.
 * @module @clawdsh/dsh-channel-core
 */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { AgentHandle, ModelSelection } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type {} from '@deepseek-ai/cordis-plugin-timer'
import {
  DEFAULT_ACK_REACTION_SCOPE,
  deriveMentionPatterns,
  resolveAckReaction,
  resolveResponsePrefix,
  shouldAckReaction,
  stripMentions,
  stripZeroWidth,
  type AckReactionScope,
  type IdentityConfig,
  type PresentationConfig,
} from './presentation.ts'
import type { ChannelAdapter, ChannelMessage } from './types.ts'

export type {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelImageSource,
  ChannelMessage,
} from './types.ts'
export {
  AUTO_RESPONSE_PREFIX,
  DEFAULT_ACK_REACTION,
  DEFAULT_ACK_REACTION_SCOPE,
  deriveMentionPatterns,
  resolveAckReaction,
  resolveMessagePrefix,
  resolveResponsePrefix,
  shouldAckReaction,
  stripMentions,
  stripZeroWidth,
} from './presentation.ts'
export type { AckReactionScope, IdentityConfig, PresentationConfig } from './presentation.ts'
export {
  normalizeChannelCredential,
  resolveChannelCredential,
} from './credentials.ts'
export type {
  ChannelCredentialNormalizer,
  ChannelCredentialResolver,
} from './credentials.ts'
export { createChannelMaintenanceQueue } from './maintenance.ts'
export type {
  ChannelMaintenanceOperation,
  ChannelMaintenanceQueue,
} from './maintenance.ts'
export { splitTextByUtf16Limit } from './text.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    legacyChannels: LegacyChannelRegistry
  }

  interface Events {
    /**
     * A normalized inbound message from a channel adapter, ready to route.
     * Adapters should dispatch this with `ctx.parallel` so provider delivery
     * does not finish before the routed turn and durability checkpoint.
     * Legacy `ctx.emit` producers remain accepted by the contained listener.
     * @mode parallel
     * @param message - the inbound message routed to its per-thread agent.
     */
    'channel/inbound'(message: ChannelMessage): Promise<void> | void
    /**
     * A reply delivered back through its owning adapter.
     * @mode emit
     * @param message - the outbound reply that was delivered.
     */
    'channel/outbound'(message: ChannelMessage): void
  }
}

/** Per-thread routing state: the live agent plus its serialized turn chain. */
interface ThreadEntry {
  handle: AgentHandle
  /** Exact route installed into this live Agent. */
  selection: ModelSelection
  /** Tail of the per-thread turn chain; each turn awaits its predecessor. */
  tail: Promise<void>
  /** Last admission/completion time, used by the lifecycle-aware idle sweep. */
  lastActive: number
  /** In-flight handle teardown; new traffic waits and resumes the same durable id. */
  closing?: Promise<void>
}

/** Whether group traffic requires a bot mention before it becomes an agent turn. */
export type GroupMode = 'mention' | 'always'

/** Default idle lifetime for an in-memory channel Agent (30 minutes). */
export const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000

/** Stable transport notice for an image sent to a text-only model route. */
export const IMAGE_MODEL_UNSUPPORTED_NOTICE = 'This conversation is using a text-only model, so I cannot inspect images. Send the relevant text or configure an image-capable model.'

/** Model-facing context appended when a text-only route continues with an image caption. */
export const IMAGE_OMITTED_MODEL_CONTEXT = '[Attached image omitted because the current model does not declare image input. Do not claim to have inspected it.]'

/** Stable transport notice when provider media cannot pass Harness attachment validation. */
export const IMAGE_IMPORT_FAILED_NOTICE = 'I could not safely import that image. Please resend a supported PNG, JPEG, WebP, or GIF within the configured size limit.'

/**
 * Derive the opaque durable session id for one platform conversation/topic.
 * Raw platform identifiers never appear in derived session ids or filenames;
 * provider adapters may still render an id in an actionable operations warning.
 * @param channel - adapter id.
 * @param conversationId - platform chat or direct-conversation id.
 * @param threadId - optional topic/thread inside the conversation.
 * @returns a stable v1 channel session id.
 */
export function deriveChannelSessionId(
  channel: string,
  conversationId: string,
  threadId?: string,
): SessionId {
  const digest = createHash('sha256')
    .update(JSON.stringify([channel, conversationId, threadId ?? null]))
    .digest('base64url')
  return SessionId(`channel:v1:${digest}`)
}

/**
 * Extract the joined text of the assistant reply produced after `firstSeq`.
 * Turns claimed by a plugin-sourced message (memory flush, schedule notices)
 * are skipped: their output is not the channel reply.
 */
function extractReply(events: readonly SessionEvent[], firstSeq: number): string {
  let text = ''
  let pluginTurn = false
  let turnHasUser = false
  for (const event of events) {
    if (event.seq < firstSeq) continue
    if (event.type === 'turn/start') {
      pluginTurn = false
      turnHasUser = false
      continue
    }
    if (event.type === 'user/message') {
      // The turn's claimed input decides; injected context mid-turn does not.
      if (!turnHasUser) pluginTurn = event.data.source.kind === 'plugin'
      turnHasUser = true
      continue
    }
    if (event.type !== 'assistant/message' || pluginTurn) continue
    const joined = event.data.message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    if (joined !== '') text = joined
  }
  return text
}

/** Render an error for a warning log line. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Channel registry config: identity presentation (never prompt content). */
export interface Config {
  /** Agent preset composed for newly created channel sessions. */
  agentPreset?: string
  /** Group messages become turns only after a bot mention by default. */
  groupMode?: GroupMode
  /** Scope of the non-blocking inbound acknowledgement reaction. */
  ackReactionScope?: AckReactionScope
  /** Dispose idle live Agents after this many milliseconds; 0 disables eviction. */
  idleTimeoutMs?: number
  /** Identity the presentation resolves against. */
  identity?: IdentityConfig
  /** Outbound prefix; `'auto'` renders `[name]`, while an explicit empty string disables it. */
  responsePrefix?: string
  /** Ack emoji; falls back to `identity.emoji`, then `👀`; an explicit empty string disables acks. */
  ackReaction?: string
}

export const Config: z<Config> = z.object({
  agentPreset: z.string().default('openclaw'),
  groupMode: z.union(['mention', 'always'] as const).default('mention'),
  ackReactionScope: z.union(['all', 'direct', 'group-all', 'group-mentions', 'off', 'none'] as const)
    .default(DEFAULT_ACK_REACTION_SCOPE),
  idleTimeoutMs: z.union([
    z.const(0),
    z.number().step(1).min(1000).max(MAX_TIMER_DELAY_MS),
  ]).default(DEFAULT_IDLE_TIMEOUT_MS),
  // Every inner key defaulted makes the whole object optional in the input,
  // mirroring the memory row's `flush` sub-config shape.
  identity: z.object({
    name: z.string().default(''),
    theme: z.string().default(''),
    emoji: z.string().default(''),
  }),
  // No schema default: undefined follows the automatic identity prefix, while
  // an explicit empty string remains observable and disables the prefix.
  responsePrefix: z.string(),
  // No schema default: undefined follows the identity/default fallback, while
  // an explicit empty string remains observable and disables reactions.
  ackReaction: z.string(),
})

/**
 * Registry of channel adapters plus the inbound routing that turns their
 * messages into agent turns and returns each reply through its adapter.
 */
export class LegacyChannelRegistry extends Service {
  static inject = ['agents', 'sessions', 'llm', 'agentDefaultModel', 'agentPresets', 'sessionPersistence', 'timer']
  static Config: z<Config> = Config

  private readonly adapters = new Map<string, ChannelAdapter>()
  private readonly threads = new Map<string, Promise<ThreadEntry>>()
  private readonly presentation: PresentationConfig
  private readonly mentionPatterns: readonly RegExp[]
  private readonly agentPreset: string
  private readonly groupMode: GroupMode
  private readonly ackReactionScope: AckReactionScope
  private readonly idleTimeoutMs: number
  private readonly activeRoutes = new Set<Promise<void>>()
  private stopping = false

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'legacyChannels')
    this.agentPreset = config.agentPreset ?? 'openclaw'
    this.groupMode = config.groupMode ?? 'mention'
    this.ackReactionScope = config.ackReactionScope ?? DEFAULT_ACK_REACTION_SCOPE
    this.idleTimeoutMs = config.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    this.presentation = {
      ...(config.identity === undefined ? {} : { identity: config.identity }),
      ...(config.responsePrefix === undefined ? {} : { responsePrefix: config.responsePrefix }),
      ...(config.ackReaction === undefined ? {} : { ackReaction: config.ackReaction }),
    }
    this.mentionPatterns = deriveMentionPatterns(config.identity?.name, config.identity?.emoji)
    ctx.on('channel/inbound', (message) => {
      const operation = this.route(message)
      this.activeRoutes.add(operation)
      // Keep an explicit rejection observer for legacy `ctx.emit` producers,
      // while returning the original promise lets `ctx.parallel` propagate the
      // failure to adapters that can apply their delivery policy.
      void operation.catch((error: unknown) => {
        this.ctx.logger.warn(`legacyChannels: inbound routing failed: ${describe(error)}`)
      })
      void operation.then(
        () => { this.activeRoutes.delete(operation) },
        () => { this.activeRoutes.delete(operation) },
      )
      return operation
    })
    if (this.idleTimeoutMs > 0) {
      const sweepEvery = Math.min(Math.max(Math.floor(this.idleTimeoutMs / 2), 1000), 60_000)
      ctx.interval(() => { this.sweepIdleThreads() }, sweepEvery)
    }
    ctx.effect(() => () => this.disposeThreads(), 'legacyChannels.thread-handles()')
  }

  /**
   * The registry's presentation config — the single entry point adapters use
   * to derive mention patterns from the deployment identity.
   * @returns the resolved presentation config, readonly.
   */
  getPresentation(): Readonly<PresentationConfig> {
    return this.presentation
  }

  /**
   * Register an adapter and start it, failing loud on a duplicate id.
   * @param adapter - the adapter to register; its `id` must be unique among
   *   live adapters.
   * @returns the disposer that stops the adapter and removes it from the registry.
   */
  registerAdapter(adapter: ChannelAdapter): () => Promise<void> {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`legacyChannels: adapter "${adapter.id}" is already registered`)
    }
    return this.ctx.effect(() => {
      this.adapters.set(adapter.id, adapter)
      try {
        const stop = adapter.start(this.ctx)
        return async () => {
          try {
            // Provider stops are drain-aware: keep the adapter addressable until
            // every admitted middleware invocation has delivered its reply.
            await stop()
          } finally {
            this.adapters.delete(adapter.id)
          }
        }
      } catch (error) {
        this.adapters.delete(adapter.id)
        throw error
      }
    }, `legacyChannels.register(${adapter.id})`)
  }

  /**
   * Look up a registered adapter by id.
   * @param id - the adapter id.
   * @returns the adapter, or `undefined` when no such adapter is registered.
   */
  getAdapter(id: string): ChannelAdapter | undefined {
    return this.adapters.get(id)
  }

  /**
   * List every live adapter.
   * @returns the adapters in registration order.
   */
  listAdapters(): ChannelAdapter[] {
    return [...this.adapters.values()]
  }

  private async route(message: ChannelMessage): Promise<void> {
    if (this.stopping) throw new Error('legacyChannels: registry is stopping')
    if (message.direction !== 'in') return
    const address = this.resolveAddress(message)
    const chatType = message.chatType ?? 'direct'
    const mention = this.resolveMention(message, chatType)
    if (chatType === 'group' && this.groupMode === 'mention' && !mention.botMentioned) return
    // Provider adapters normalize structured mentions themselves. The generic
    // identity regex is only a fallback for group adapters without mention
    // metadata; applying it to every accepted message corrupts ordinary direct
    // text such as "tell me about ClawDSH".
    const fallbackMention = chatType === 'group' && message.mention === undefined && mention.botMentioned
    const fallbackText = fallbackMention ? stripZeroWidth(message.text) : message.text
    const text = (fallbackMention ? stripMentions(fallbackText, this.mentionPatterns) : fallbackText).trim()
    if (text === '' && (message.images === undefined || message.images.length === 0)) return
    const normalized: ChannelMessage = {
      ...message,
      conversationId: address.conversationId,
      ...(address.threadId === undefined ? {} : { threadId: address.threadId }),
      chatType,
      text,
    }
    if (address.threadId === undefined) delete normalized.threadId
    // Acknowledgement is a receipt signal, so begin it as soon as the message
    // has passed routing/text gates. It must not sit behind a slow prior model
    // turn in the same FIFO. The route still awaits the contained task below,
    // which keeps provider and registry teardown drain-aware.
    const ackTask = this.startAck(normalized, mention)
    const sessionConversationId = message.sessionConversationId === undefined
      || message.sessionConversationId.length === 0
      ? address.conversationId
      : message.sessionConversationId
    const key = JSON.stringify([message.channel, sessionConversationId, address.threadId ?? null])
    const sessionId = deriveChannelSessionId(message.channel, sessionConversationId, address.threadId)
    try {
      const entry = await this.getOrCreateThread(key, sessionId)
      const turn = entry.tail
        .then(async () => {
          try {
            await this.driveTurn(entry, normalized, address.legacyThreadOnly)
          } finally {
            entry.lastActive = Date.now()
          }
        })
      // A failed turn is visible to this caller, but the queue tail itself is
      // contained so later messages in the same conversation can still run.
      entry.tail = turn.catch(() => undefined)
      await turn
    } finally {
      await ackTask
    }
  }

  /** Normalize the new address contract while accepting the former threadId-only shape. */
  private resolveAddress(message: ChannelMessage): {
    conversationId: string
    threadId?: string
    legacyThreadOnly: boolean
  } {
    if (message.conversationId !== undefined && message.conversationId.length > 0) {
      return {
        conversationId: message.conversationId,
        ...(message.threadId === undefined || message.threadId.length === 0 ? {} : { threadId: message.threadId }),
        legacyThreadOnly: false,
      }
    }
    if (message.threadId !== undefined && message.threadId.length > 0) {
      return { conversationId: message.threadId, legacyThreadOnly: true }
    }
    throw new Error(`legacyChannels: inbound "${message.channel}" message has no conversationId`)
  }

  /** Prefer platform-structured mention data; configured identity is a generic-adapter fallback. */
  private resolveMention(
    message: ChannelMessage,
    chatType: 'direct' | 'group',
  ): { detectable: boolean; botMentioned: boolean } {
    if (chatType !== 'group') return { detectable: false, botMentioned: false }
    if (message.mention !== undefined) {
      return {
        detectable: message.mention.detectable,
        botMentioned: message.mention.detectable && message.mention.botMentioned,
      }
    }
    return {
      detectable: this.mentionPatterns.length > 0,
      botMentioned: this.mentionPatterns.some(pattern => pattern.test(stripZeroWidth(message.text))),
    }
  }

  /** Start one contained receipt reaction without joining the conversation FIFO. */
  private startAck(
    message: ChannelMessage,
    mention: { detectable: boolean; botMentioned: boolean },
  ): Promise<void> {
    const adapter = this.adapters.get(message.channel)
    const emoji = resolveAckReaction(this.presentation)
    if (adapter === undefined || !adapter.capabilities.react || adapter.react === undefined
      || message.messageId === undefined || emoji === ''
      || !shouldAckReaction(
        this.ackReactionScope,
        message.chatType === 'group',
        this.groupMode === 'mention',
        mention.detectable,
        mention.botMentioned,
      )) return Promise.resolve()

    return Promise.resolve().then(() => adapter.react?.(message, emoji)).catch((error: unknown) => {
      this.ctx.logger.warn(`legacyChannels: ack reaction for "${message.channel}" failed: ${describe(error)}`)
    })
  }

  /** Single-flight acquisition of one deterministic, durable channel Agent. */
  private async getOrCreateThread(key: string, sessionId: SessionId): Promise<ThreadEntry> {
    const existing = this.threads.get(key)
    if (existing !== undefined) {
      const entry = await existing
      if (entry.closing === undefined) {
        // Admit the route before returning the handle. This closes the small
        // window where an idle sweep could decide to dispose the Agent after
        // acquisition but before the caller appends its turn to `entry.tail`.
        entry.lastActive = Date.now()
        return entry
      }
      await entry.closing
      return this.getOrCreateThread(key, sessionId)
    }
    const pending = this.openThread(sessionId)
    this.threads.set(key, pending)
    void pending.catch(() => {
      if (this.threads.get(key) === pending) this.threads.delete(key)
    })
    const entry = await pending
    entry.lastActive = Date.now()
    return entry
  }

  /** Resume a materialized exact id, or create it with the configured preset. */
  private async openThread(sessionId: SessionId): Promise<ThreadEntry> {
    const selection = this.ctx.agentDefaultModel.currentSelection()
    const persisted = (await this.ctx.sessionPersistence.list()).some(header => header.id === sessionId)
    let handle: AgentHandle
    if (persisted) {
      const inspected = await this.ctx.sessionPersistence.inspect(sessionId)
      const persistedPreset = resolveSessionPreset({ header: inspected.meta, events: inspected.events })
      const preset = await this.ctx.agentPresets.resolve(persistedPreset ?? this.agentPreset)
      handle = await this.ctx.agents.resume({
        resumeSessionId: sessionId,
        agentOptions: { provider: selection.provider, model: selection.model },
        setup: async (agentCtx) => {
          installModelSelection(agentCtx, { current: selection, assembled: undefined })
          await this.ctx.agentPresets.mount(agentCtx, preset.id)
        },
      })
    } else {
      const preset = await this.ctx.agentPresets.resolve(this.agentPreset)
      handle = await this.ctx.agents.create({
        sessionId,
        meta: { cwd: process.cwd(), agentPreset: preset.id },
        agentOptions: { provider: selection.provider, model: selection.model },
        setup: async (agentCtx) => {
          installModelSelection(agentCtx, { current: selection, assembled: undefined })
          await this.ctx.agentPresets.mount(agentCtx, preset.id)
        },
      })
    }
    try {
      await handle.agent.whenIdle()
      return { handle, selection, tail: Promise.resolve(), lastActive: Date.now() }
    } catch (error) {
      await handle.dispose()
      throw error
    }
  }

  private async driveTurn(
    entry: ThreadEntry,
    message: ChannelMessage,
    legacyThreadOnly: boolean,
  ): Promise<void> {
    const { agent } = entry.handle
    const adapter = this.adapters.get(message.channel)
    let userText = message.text
    const imageContent: ContentBlock[] = []
    if (message.images !== undefined && message.images.length > 0) {
      const model = await this.ctx.llm.resolveModelInfo(entry.selection.provider, entry.selection.model)
      if (model.inputModalities === undefined || !model.inputModalities.includes('image')) {
        if (userText === '') {
          await this.deliverText(adapter, message, legacyThreadOnly, IMAGE_MODEL_UNSUPPORTED_NOTICE)
          return
        }
        userText = `${userText}\n\n${IMAGE_OMITTED_MODEL_CONTEXT}`
      } else {
        if (adapter?.materializeImages === undefined) {
          this.ctx.logger.warn(`legacyChannels: adapter "${message.channel}" cannot materialize image sources`)
          await this.deliverText(adapter, message, legacyThreadOnly, IMAGE_IMPORT_FAILED_NOTICE)
          return
        }
        try {
          const attachments = await adapter.materializeImages(message)
          if (attachments.length !== message.images.length) {
            throw new Error(
              `adapter "${message.channel}" materialized ${attachments.length} of ${message.images.length} images`,
            )
          }
          imageContent.push(...attachments.map(attachment => ({ type: 'image' as const, attachment })))
        } catch (error: unknown) {
          this.ctx.logger.warn(`legacyChannels: image import for "${message.channel}" failed: ${describe(error)}`)
          await this.deliverText(adapter, message, legacyThreadOnly, IMAGE_IMPORT_FAILED_NOTICE)
          return
        }
      }
    }
    const content: ContentBlock[] = []
    if (userText !== '') content.push({ type: 'text', text: userText })
    content.push(...imageContent)
    if (content.length === 0) return
    const firstSeq = agent.session.seq
    agent.followup(createUserMessage({
      content,
      source: { kind: 'user' },
    }))
    await agent.whenIdle()
    await this.ctx.sessions.flush(agent.session)
    const text = extractReply(agent.session.events, firstSeq)
    // Tool-only / NO_REPLY-style turns can legitimately produce no assistant
    // text. Provider APIs reject an empty body, so the absence of a reply is a
    // completed no-op rather than an adapter send failure.
    if (text === '') return
    const prefix = resolveResponsePrefix(this.presentation)
    const outboundText = prefix === '' ? text : `${prefix} ${text}`
    await this.deliverText(adapter, message, legacyThreadOnly, outboundText)
  }

  /** Deliver one transport-owned text reply without appending it to the Agent session. */
  private async deliverText(
    adapter: ChannelAdapter | undefined,
    message: ChannelMessage,
    legacyThreadOnly: boolean,
    text: string,
  ): Promise<void> {
    if (adapter === undefined || text === '') return
    const outboundThreadId = message.threadId
      ?? (legacyThreadOnly ? message.conversationId : undefined)
    const outbound: ChannelMessage = {
      channel: message.channel,
      direction: 'out',
      ...(message.conversationId === undefined ? {} : { conversationId: message.conversationId }),
      ...(outboundThreadId === undefined ? {} : { threadId: outboundThreadId }),
      ...(message.sender === undefined ? {} : { sender: message.sender }),
      ...(message.messageId === undefined ? {} : { replyToMessageId: message.messageId }),
      ...(message.chatType === undefined ? {} : { chatType: message.chatType }),
      text,
    }
    await adapter.send(outbound)
    this.ctx.emit('channel/outbound', outbound)
  }

  /** Mark idle handles as closing, then dispose them behind admitted turns. */
  private sweepIdleThreads(): void {
    if (this.idleTimeoutMs === 0) return
    for (const [key, pending] of this.threads) {
      void pending.then((entry) => {
        if (entry.closing !== undefined || Date.now() - entry.lastActive < this.idleTimeoutMs) return
        // Publish `closing` before waiting on the FIFO. A concurrent admission
        // will now wait for disposal and acquire a fresh handle instead of
        // queueing work onto the handle being evicted.
        const closing = entry.tail
          .then(() => entry.handle.dispose())
          .finally(() => {
            if (this.threads.get(key) === pending) this.threads.delete(key)
          })
        entry.closing = closing
        void closing.catch((error: unknown) => {
          this.ctx.logger.warn(`legacyChannels: idle eviction failed: ${describe(error)}`)
        })
      }, () => undefined)
    }
  }

  /** Drain every acquired handle when the registry's owning fiber unloads. */
  private async disposeThreads(): Promise<void> {
    this.stopping = true
    while (this.activeRoutes.size > 0) {
      await Promise.allSettled([...this.activeRoutes])
    }
    const pending = [...this.threads.values()]
    this.threads.clear()
    const settled = await Promise.allSettled(pending)
    const entries = settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
    await Promise.allSettled(entries.map(async (entry) => {
      await entry.tail
      if (entry.closing !== undefined) {
        await entry.closing
        return
      }
      const closing = entry.handle.dispose()
      entry.closing = closing
      await closing
    }))
  }
}

/**
 * Build and register a channel adapter, deriving its mention patterns from the
 * registry's identity presentation. Every bundled channel adapter's `apply()`
 * uses this lifecycle entry; adapters without structured mention metadata can
 * consume the supplied patterns as their fallback.
 * @param ctx - Cordis context carrying the `legacyChannels` service.
 * @param build - builds the adapter from the derived mention patterns.
 * @returns the disposer that stops the adapter and removes it from the registry.
 */
export function registerLegacyChannelAdapter(
  ctx: Context,
  build: (mentionPatterns: readonly RegExp[]) => ChannelAdapter,
): () => Promise<void> {
  const presentation = ctx.legacyChannels.getPresentation()
  const mentionPatterns = deriveMentionPatterns(presentation.identity?.name, presentation.identity?.emoji)
  const adapter = build(mentionPatterns)
  return ctx.effect(() => ctx.legacyChannels.registerAdapter(adapter), `legacy-channel-${adapter.id}.register()`)
}

export default LegacyChannelRegistry
