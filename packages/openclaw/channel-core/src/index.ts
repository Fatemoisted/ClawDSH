/**
 * The `ctx.channels` seam: an adapter registry that routes inbound channel
 * messages to per-thread agent sessions, drives each turn to quiescence, and
 * delivers the extracted reply back through the owning adapter.
 * @module @clawdsh/dsh-channel-core
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ChannelAdapter, ChannelMessage } from './types.ts'

export type { ChannelAdapter, ChannelCapabilities, ChannelMessage } from './types.ts'

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

/** Extract the joined text of the assistant reply produced after `firstSeq`. */
function extractReply(events: readonly SessionEvent[], firstSeq: number): string {
  let text = ''
  for (const event of events) {
    if (event.seq < firstSeq) continue
    if (event.type !== 'assistant/message') continue
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

/**
 * Registry of channel adapters plus the inbound routing that turns their
 * messages into agent turns and returns each reply through its adapter.
 */
export class ChannelRegistry extends Service {
  static inject = ['agents', 'sessions', 'agentDefaultModel']

  private readonly adapters = new Map<string, ChannelAdapter>()
  private readonly threads = new Map<string, ThreadEntry>()

  constructor(ctx: Context) {
    super(ctx, 'channels')
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
    const firstSeq = agent.session.seq
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: message.text }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()
    await this.ctx.sessions.flush(agent.session)
    const text = extractReply(agent.session.events, firstSeq)
    const adapter = this.adapters.get(message.channel)
    if (adapter === undefined) return
    const outbound: ChannelMessage = {
      channel: message.channel,
      direction: 'out',
      ...(message.threadId === undefined ? {} : { threadId: message.threadId }),
      ...(message.sender === undefined ? {} : { sender: message.sender }),
      text,
    }
    await adapter.send(outbound)
    this.ctx.emit('channel/outbound', outbound)
  }
}

export default ChannelRegistry
