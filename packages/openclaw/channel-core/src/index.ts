/**
 * The `ctx.channels` seam: an adapter registry that routes inbound channel
 * messages to per-thread agent sessions, drives each turn to quiescence, and
 * delivers the extracted reply back through the owning adapter.
 * @module @clawdsh/dsh-channel-core
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { resolveAckReaction, resolveResponsePrefix, type IdentityConfig, type PresentationConfig } from './presentation.ts'
import type { ChannelAdapter, ChannelMessage } from './types.ts'

export type { ChannelAdapter, ChannelCapabilities, ChannelMessage } from './types.ts'
export {
  AUTO_RESPONSE_PREFIX,
  DEFAULT_ACK_REACTION,
  deriveMentionPatterns,
  resolveAckReaction,
  resolveMessagePrefix,
  resolveResponsePrefix,
  stripMentions,
} from './presentation.ts'
export type { IdentityConfig, PresentationConfig } from './presentation.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    channels: ChannelRegistry
  }

  interface Events {
    /**
     * A normalized inbound message from a channel adapter, ready to route.
     * @mode emit
     * @param message - the inbound message routed to its per-thread agent.
     */
    'channel/inbound'(message: ChannelMessage): void
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
  /** Tail of the per-thread turn chain; each turn awaits its predecessor. */
  tail: Promise<void>
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
  /** Identity the presentation resolves against. */
  identity?: IdentityConfig
  /** Outbound prefix; `'auto'` renders `[name]`. */
  responsePrefix?: string
  /** Ack emoji; falls back to `identity.emoji`, then `👀`. */
  ackReaction?: string
}

export const Config: z<Config> = z.object({
  // Every inner key defaulted makes the whole object optional in the input,
  // mirroring the memory row's `flush` sub-config shape.
  identity: z.object({
    name: z.string().default(''),
    theme: z.string().default(''),
    emoji: z.string().default(''),
  }),
  responsePrefix: z.string().default(''),
  ackReaction: z.string().default(''),
})

/**
 * Registry of channel adapters plus the inbound routing that turns their
 * messages into agent turns and returns each reply through its adapter.
 */
export class ChannelRegistry extends Service {
  static inject = ['agents', 'sessions', 'agentDefaultModel']
  static Config: z<Config> = Config

  private readonly adapters = new Map<string, ChannelAdapter>()
  private readonly threads = new Map<string, ThreadEntry>()
  private readonly presentation: PresentationConfig

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'channels')
    this.presentation = {
      ...(config.identity === undefined ? {} : { identity: config.identity }),
      ...(config.responsePrefix === undefined || config.responsePrefix === '' ? {} : { responsePrefix: config.responsePrefix }),
      ...(config.ackReaction === undefined || config.ackReaction === '' ? {} : { ackReaction: config.ackReaction }),
    }
    ctx.on('channel/inbound', (message) => {
      this.route(message).catch((error: unknown) => {
        this.ctx.logger.warn(`channels: inbound routing failed: ${describe(error)}`)
      })
    })
  }

  /**
   * Register an adapter and start it, failing loud on a duplicate id.
   * @param adapter - the adapter to register; its `id` must be unique among
   *   live adapters.
   * @returns the disposer that stops the adapter and removes it from the registry.
   */
  registerAdapter(adapter: ChannelAdapter): () => void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`channels: adapter "${adapter.id}" is already registered`)
    }
    return this.ctx.effect(() => {
      this.adapters.set(adapter.id, adapter)
      const stop = adapter.start(this.ctx)
      return () => {
        this.adapters.delete(adapter.id)
        stop()
      }
    }, `channels.register(${adapter.id})`)
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
    if (message.direction !== 'in') return
    const key = `${message.channel}\0${message.threadId ?? ''}`
    const entry = await this.getOrCreateThread(key)
    entry.tail = entry.tail
      .then(() => this.driveTurn(entry, message))
      .catch((error: unknown) => {
        this.ctx.logger.warn(`channels: turn for "${message.channel}" failed: ${describe(error)}`)
      })
    await entry.tail
  }

  private async getOrCreateThread(key: string): Promise<ThreadEntry> {
    const existing = this.threads.get(key)
    if (existing !== undefined) return existing
    const selection = this.ctx.agentDefaultModel.currentSelection()
    const handle = await this.ctx.agents.create({
      sessionId: SessionId(`channel-${randomUUID()}`),
      meta: { cwd: process.cwd() },
      agentOptions: { provider: selection.provider, model: selection.model },
      setup: (agentCtx) => {
        installModelSelection(agentCtx, { current: selection, assembled: undefined })
      },
    })
    await handle.agent.whenIdle()
    const entry: ThreadEntry = { handle, tail: Promise.resolve() }
    this.threads.set(key, entry)
    return entry
  }

  private async driveTurn(entry: ThreadEntry, message: ChannelMessage): Promise<void> {
    const { agent } = entry.handle
    const adapter = this.adapters.get(message.channel)
    if (adapter !== undefined && adapter.capabilities.react && adapter.react !== undefined
      && message.messageId !== undefined) {
      // Fire-and-forget: the ack marks receipt; a failed reaction must not block the reply.
      const emoji = resolveAckReaction(this.presentation)
      void adapter.react(message, emoji).catch((error: unknown) => {
        this.ctx.logger.warn(`channels: ack reaction for "${message.channel}" failed: ${describe(error)}`)
      })
    }
    const firstSeq = agent.session.seq
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: message.text }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()
    await this.ctx.sessions.flush(agent.session)
    const text = extractReply(agent.session.events, firstSeq)
    if (adapter === undefined) return
    const prefix = resolveResponsePrefix(this.presentation)
    const outbound: ChannelMessage = {
      channel: message.channel,
      direction: 'out',
      ...(message.threadId === undefined ? {} : { threadId: message.threadId }),
      ...(message.sender === undefined ? {} : { sender: message.sender }),
      text: text !== '' && prefix !== '' ? `${prefix} ${text}` : text,
    }
    await adapter.send(outbound)
    this.ctx.emit('channel/outbound', outbound)
  }
}

export default ChannelRegistry
