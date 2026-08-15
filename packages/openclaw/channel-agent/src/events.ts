/** Durable channel provenance carried by core user-message events. @module @clawdsh/dsh-channel-agent/events */

import type {
  ChannelAccountId,
  ChannelConversationId,
  ChannelId,
  ChannelIdempotencyKey,
  ChannelMessageId,
  ChannelMessageReferenceV1,
  ChannelPrincipalV1,
  ChannelRunId,
  ChannelSenderId,
  ChannelThreadId,
  ChannelTurnId,
  ChannelTraceV1,
  GatewayInstanceId,
  OpenClawSessionKey,
} from '@clawdsh/dsh-channel'

/** Sanitized platform provenance stored on a model-visible channel message. */
export interface ChannelMessageSource {
  /** Source discriminant. */
  readonly kind: 'channel'
  /** Gateway state lineage that admitted the message. */
  readonly gatewayInstanceId: GatewayInstanceId
  /** OpenClaw session lineage before DSH generation mapping. */
  readonly openclawSessionKey: OpenClawSessionKey
  /** Monotonic reset generation used for this Session binding. */
  readonly generation: number
  /** OpenClaw channel plugin identity. */
  readonly channel: ChannelId
  /** Account that admitted the message. */
  readonly account: ChannelAccountId
  /** Platform conversation identity. */
  readonly conversation: ChannelConversationId
  /** Platform thread identity when present. */
  readonly thread?: ChannelThreadId
  /** Platform message identity. */
  readonly messageId: ChannelMessageId
  /** Gateway-scoped duplicate suppression identity. */
  readonly idempotencyKey: ChannelIdempotencyKey
  /** Exact bridge run identity. */
  readonly runId: ChannelRunId
  /** Sanitized sender identity. */
  readonly senderId: ChannelSenderId
  /** Sanitized sender display name when supplied. */
  readonly senderDisplayName?: string
  /** OpenClaw admission class. */
  readonly trust: ChannelPrincipalV1['trust']
  /** Whether the source conversation is a group. */
  readonly isGroup: boolean
  /** Whether OpenClaw observed a bot mention. */
  readonly wasMentioned?: boolean
  /** Logical bridge turn. */
  readonly turnId: ChannelTurnId
  /** Platform message being replied to, when known. */
  readonly replyTo?: ChannelMessageReferenceV1
  /** Sanitized distributed trace projection, when supplied. */
  readonly trace?: ChannelTraceV1
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Human input admitted and authenticated by the local OpenClaw Gateway. */
    channel: ChannelMessageSource
  }
}
