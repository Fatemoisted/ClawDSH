/**
 * Channel adapter contract types for the legacy `ctx.legacyChannels` seam.
 * @module @clawdsh/dsh-channel-core/types
 */

import type { Context } from '@deepseek-ai/cordis'

/** Receiving and sending capability flags an adapter advertises. */
export interface ChannelCapabilities {
  /** The adapter can accept inbound messages from the platform. */
  receive: boolean
  /** The adapter can deliver outbound messages back to the platform. */
  send: boolean
  /** The adapter can attach an ack emoji reaction to an inbound message. */
  react: boolean
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
  /** Platform-side message id, when the platform exposes one (ack reactions target it). */
  messageId?: string
  /**
   * Whether the message arrived in a group chat. Absent means the adapter
   * could not determine it; the ack gate then treats it as a non-group.
   */
  isGroup?: boolean
  /**
   * Whether the message mentioned the bot. Field presence is the
   * detection-capability signal: omitted means the adapter cannot evaluate
   * mentions, and the ack gate fails open (no ack, never a blocked message).
   */
  wasMentioned?: boolean
  /** Plain text body. */
  text: string
}

/** A channel adapter a provider plugin registers with the legacy `ctx.legacyChannels` seam. */
export interface ChannelAdapter {
  /** Unique id, matching the `channel` field of its messages. */
  id: string
  /** What this adapter can receive and send. */
  capabilities: ChannelCapabilities
  /** Subscribe to platform events and emit `channel/inbound`; returns a disposer. */
  start(ctx: Context): () => void
  /** Deliver an outbound message back to the platform. */
  send(message: ChannelMessage): Promise<void>
  /** Attach an ack emoji reaction to an inbound message; required when `capabilities.react` is true. */
  react?(message: ChannelMessage, emoji: string): Promise<void>
}
