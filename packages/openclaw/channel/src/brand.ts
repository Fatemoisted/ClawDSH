/**
 * Opaque identifiers exchanged by the ClawDSH channel capability.
 * @module @clawdsh/dsh-channel/brand
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Cast one validated wire string to its package-owned brand. */
function branded<B extends string>(value: string): Branded<B> {
  return value as Branded<B>
}

/** Identity of one OpenClaw Gateway process lineage. */
export type GatewayInstanceId = Branded<'GatewayInstanceId'>

/**
 * Brand a validated Gateway instance id.
 * @param value - Stable Gateway instance identifier.
 * @returns The same string with the Gateway instance brand.
 */
export function GatewayInstanceId(value: string): GatewayInstanceId {
  return branded<'GatewayInstanceId'>(value)
}

/** Identity reserved by the active channel provider. */
export type ChannelProviderId = Branded<'ChannelProviderId'>

/**
 * Brand a validated channel provider id.
 * @param value - Provider identifier.
 * @returns The same string with the provider brand.
 */
export function ChannelProviderId(value: string): ChannelProviderId {
  return branded<'ChannelProviderId'>(value)
}

/** OpenClaw channel plugin identity, such as Telegram or Feishu. */
export type ChannelId = Branded<'ChannelId'>

/**
 * Brand a validated channel id.
 * @param value - Channel plugin identifier.
 * @returns The same string with the channel brand.
 */
export function ChannelId(value: string): ChannelId {
  return branded<'ChannelId'>(value)
}

/** Platform account identity inside one channel. */
export type ChannelAccountId = Branded<'ChannelAccountId'>

/**
 * Brand a validated channel account id.
 * @param value - Platform account identifier.
 * @returns The same string with the account brand.
 */
export function ChannelAccountId(value: string): ChannelAccountId {
  return branded<'ChannelAccountId'>(value)
}

/** Platform conversation identity inside one account. */
export type ChannelConversationId = Branded<'ChannelConversationId'>

/**
 * Brand a validated conversation id.
 * @param value - Platform conversation identifier.
 * @returns The same string with the conversation brand.
 */
export function ChannelConversationId(value: string): ChannelConversationId {
  return branded<'ChannelConversationId'>(value)
}

/** Optional platform thread identity inside one conversation. */
export type ChannelThreadId = Branded<'ChannelThreadId'>

/**
 * Brand a validated thread id.
 * @param value - Platform thread identifier.
 * @returns The same string with the thread brand.
 */
export function ChannelThreadId(value: string): ChannelThreadId {
  return branded<'ChannelThreadId'>(value)
}

/** Platform message identity. */
export type ChannelMessageId = Branded<'ChannelMessageId'>

/**
 * Brand a validated message id.
 * @param value - Platform message identifier.
 * @returns The same string with the message brand.
 */
export function ChannelMessageId(value: string): ChannelMessageId {
  return branded<'ChannelMessageId'>(value)
}

/** Platform sender identity after OpenClaw admission. */
export type ChannelSenderId = Branded<'ChannelSenderId'>

/**
 * Brand a validated sender id.
 * @param value - Platform sender identifier.
 * @returns The same string with the sender brand.
 */
export function ChannelSenderId(value: string): ChannelSenderId {
  return branded<'ChannelSenderId'>(value)
}

/** Identity of one accepted inbound turn. */
export type ChannelTurnId = Branded<'ChannelTurnId'>

/**
 * Brand a validated channel turn id.
 * @param value - Turn identifier.
 * @returns The same string with the turn brand.
 */
export function ChannelTurnId(value: string): ChannelTurnId {
  return branded<'ChannelTurnId'>(value)
}

/** Identity of one live or completed Agent run for a channel turn. */
export type ChannelRunId = Branded<'ChannelRunId'>

/**
 * Brand a validated channel run id.
 * @param value - Run identifier.
 * @returns The same string with the run brand.
 */
export function ChannelRunId(value: string): ChannelRunId {
  return branded<'ChannelRunId'>(value)
}

/** Gateway-supplied key used to deduplicate one inbound event. */
export type ChannelIdempotencyKey = Branded<'ChannelIdempotencyKey'>

/**
 * Brand a validated idempotency key.
 * @param value - Inbound event idempotency key.
 * @returns The same string with the idempotency-key brand.
 */
export function ChannelIdempotencyKey(value: string): ChannelIdempotencyKey {
  return branded<'ChannelIdempotencyKey'>(value)
}

/** OpenClaw's stable session key before generation is applied. */
export type OpenClawSessionKey = Branded<'OpenClawSessionKey'>

/**
 * Brand a validated OpenClaw session key.
 * @param value - OpenClaw session key.
 * @returns The same string with the OpenClaw-session brand.
 */
export function OpenClawSessionKey(value: string): OpenClawSessionKey {
  return branded<'OpenClawSessionKey'>(value)
}

/** One-startup nonce that prevents a stale peer from completing a handshake. */
export type ChannelStartupNonce = Branded<'ChannelStartupNonce'>

/**
 * Brand a validated startup nonce.
 * @param value - Per-startup nonce.
 * @returns The same string with the startup-nonce brand.
 */
export function ChannelStartupNonce(value: string): ChannelStartupNonce {
  return branded<'ChannelStartupNonce'>(value)
}

/** Stable identity of one persisted result that may be replayed without rerunning the Agent. */
export type ChannelReplayId = Branded<'ChannelReplayId'>

/**
 * Brand a validated replay id.
 * @param value - Persisted result identifier.
 * @returns The same string with the replay brand.
 */
export function ChannelReplayId(value: string): ChannelReplayId {
  return branded<'ChannelReplayId'>(value)
}

/** Identity of one ordered media item. */
export type ChannelMediaId = Branded<'ChannelMediaId'>

/**
 * Brand a validated media id.
 * @param value - Media identifier.
 * @returns The same string with the media brand.
 */
export function ChannelMediaId(value: string): ChannelMediaId {
  return branded<'ChannelMediaId'>(value)
}

/** Canonical lowercase SHA-256 digest of one staged media object. */
export type ChannelMediaSha256 = Branded<'ChannelMediaSha256'>

/**
 * Brand a validated staged-media digest.
 * @param value - Canonical lowercase SHA-256 digest.
 * @returns The same string with the staged-media-digest brand.
 */
export function ChannelMediaSha256(value: string): ChannelMediaSha256 {
  return branded<'ChannelMediaSha256'>(value)
}

/** Identity of one outbound channel action. */
export type ChannelActionId = Branded<'ChannelActionId'>

/**
 * Brand a validated action id.
 * @param value - Action identifier.
 * @returns The same string with the action brand.
 */
export function ChannelActionId(value: string): ChannelActionId {
  return branded<'ChannelActionId'>(value)
}

/** Identity of one delivery attempt and its eventual receipt. */
export type ChannelDeliveryId = Branded<'ChannelDeliveryId'>

/**
 * Brand a validated delivery id.
 * @param value - Delivery identifier.
 * @returns The same string with the delivery brand.
 */
export function ChannelDeliveryId(value: string): ChannelDeliveryId {
  return branded<'ChannelDeliveryId'>(value)
}

/** Identity returned by an OpenClaw channel directory or resolver. */
export type ChannelDirectoryEntryId = Branded<'ChannelDirectoryEntryId'>

/**
 * Brand a validated channel-directory entry id.
 * @param value - Platform directory entry identifier.
 * @returns The same string with the directory-entry brand.
 */
export function ChannelDirectoryEntryId(value: string): ChannelDirectoryEntryId {
  return branded<'ChannelDirectoryEntryId'>(value)
}

/** Distributed trace identity projected by the Gateway. */
export type ChannelTraceId = Branded<'ChannelTraceId'>

/**
 * Brand a validated trace id.
 * @param value - Trace identifier.
 * @returns The same string with the trace brand.
 */
export function ChannelTraceId(value: string): ChannelTraceId {
  return branded<'ChannelTraceId'>(value)
}

/** Identity of one tool call in an optional turn-progress notification. */
export type ChannelToolCallId = Branded<'ChannelToolCallId'>

/**
 * Brand a validated tool-call id.
 * @param value - Tool-call identifier.
 * @returns The same string with the tool-call brand.
 */
export function ChannelToolCallId(value: string): ChannelToolCallId {
  return branded<'ChannelToolCallId'>(value)
}

/** Canonical 40-character Git commit for the running OpenClaw host. */
export type OpenClawCommitSha = Branded<'OpenClawCommitSha'>

/**
 * Brand a validated OpenClaw commit SHA.
 * @param value - Canonical lowercase commit SHA.
 * @returns The same string with the commit-SHA brand.
 */
export function OpenClawCommitSha(value: string): OpenClawCommitSha {
  return branded<'OpenClawCommitSha'>(value)
}

/** Canonical lowercase hexadecimal SHA-512 of the running OpenClaw artifact. */
export type OpenClawArtifactSha512 = Branded<'OpenClawArtifactSha512'>

/**
 * Brand a validated OpenClaw artifact digest.
 * @param value - Canonical lowercase SHA-512 digest.
 * @returns The same string with the artifact-digest brand.
 */
export function OpenClawArtifactSha512(value: string): OpenClawArtifactSha512 {
  return branded<'OpenClawArtifactSha512'>(value)
}
