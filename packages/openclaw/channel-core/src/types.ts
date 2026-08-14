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
  /** The adapter can attach an ack emoji reaction to an inbound message. */
  react: boolean
}

/** A normalized message flowing into or out of the channel seam. */
export interface ChannelMessage {
  /** Adapter id this message belongs to, e.g. `telegram` or `feishu`. */
  channel: string
  /** Whether the message enters from or leaves to the platform. */
  direction: 'in' | 'out'
  /** Platform-side conversation/send target: chat id or p2p recipient id. */
  conversationId?: string
  /** Optional platform topic/thread id inside `conversationId`. */
  threadId?: string
  /** Sender identity: open_id or `from.id`. */
  sender?: string
  /** Platform-side message id, when the platform exposes one (ack reactions target it). */
  messageId?: string
  /** Inbound message id an outbound response should quote/reply to. */
  replyToMessageId?: string
  /** Conversation shape used by group response and ack policies. */
  chatType?: 'direct' | 'group'
  /** Platform-structured bot-mention result; unknown detection fails closed. */
  mention?: {
    /** Whether the adapter had enough bot identity/entity data to decide. */
    detectable: boolean
    /** Whether the structured platform event mentions this bot. */
    botMentioned: boolean
  }
  /** Plain text body. */
  text: string
}

/** A channel adapter a provider plugin registers with the `ctx.channels` seam. */
export interface ChannelAdapter {
  /** Unique id, matching the `channel` field of its messages. */
  id: string
  /** What this adapter can receive and send. */
  capabilities: ChannelCapabilities
  /** Subscribe to platform events and emit `channel/inbound`; returns a lifecycle-aware disposer. */
  start(ctx: Context): () => void | Promise<void>
  /** Deliver an outbound message back to the platform. */
  send(message: ChannelMessage): Promise<void>
  /** Attach an ack emoji reaction to an inbound message; required when `capabilities.react` is true. */
  react?(message: ChannelMessage, emoji: string): Promise<void>
}
