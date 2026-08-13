/**
 * Channel adapter contract types for the `ctx.channels` seam.
 * @module @clawdsh/dsh-channel-core/types
 */

import type { Context } from '@deepseek-ai/cordis'

/** Receiving and sending capability flags an adapter advertises. */
export interface ChannelCapabilities {
  /** The adapter can accept inbound messages from the platform. */
  receive: boolean
  /** The adapter can deliver outbound messages back to the platform. */
  send: boolean
}

/** A normalized message flowing into or out of the channel seam. */
export interface ChannelMessage {
  /** Adapter id this message belongs to, e.g. `telegram` or `feishu`. */
  channel: string
  /** Whether the message enters from or leaves to the platform. */
  direction: 'in' | 'out'
  /** Platform-side conversation key: group chat id, p2p chat id, or TG chat id. */
  threadId?: string
  /** Sender identity: open_id or `from.id`. */
  sender?: string
  /** Plain text body. */
  text: string
}

/** A channel adapter a provider plugin registers with the `ctx.channels` seam. */
export interface ChannelAdapter {
  /** Unique id, matching the `channel` field of its messages. */
  id: string
  /** What this adapter can receive and send. */
  capabilities: ChannelCapabilities
  /** Subscribe to platform events and emit `channel/inbound`; returns a disposer. */
  start(ctx: Context): () => void
  /** Deliver an outbound message back to the platform. */
  send(message: ChannelMessage): Promise<void>
}
