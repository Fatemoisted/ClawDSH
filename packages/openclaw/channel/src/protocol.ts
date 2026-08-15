/**
 * Strict zod validation for channel JSON-RPC payloads.
 * @module @clawdsh/dsh-channel/protocol
 */

import { z } from 'zod'
import {
  ChannelAccountId,
  ChannelActionId,
  ChannelConversationId,
  ChannelDeliveryId,
  ChannelDirectoryEntryId,
  ChannelId,
  ChannelIdempotencyKey,
  ChannelMediaId,
  ChannelMediaSha256,
  ChannelMessageId,
  ChannelReplayId,
  ChannelRunId,
  ChannelSenderId,
  ChannelStartupNonce,
  ChannelThreadId,
  ChannelToolCallId,
  ChannelTraceId,
  ChannelTurnId,
  GatewayInstanceId,
  OpenClawArtifactSha512,
  OpenClawCommitSha,
  OpenClawSessionKey,
} from './brand.ts'
import type {
  ChannelActionV1,
  ChannelActionDeliveryReceiptV1,
  ChannelActionResultV1,
  ChannelBridgeHandshakeV1,
  ChannelDeliveryReceiptV1,
  ChannelDeliveryReportV1,
  ChannelHealthV1,
  ChannelSessionCloseV1,
  ChannelSessionResetResultV1,
  ChannelSessionResetV1,
  ChannelTurnCancelV1,
  ChannelTurnEnvelopeV1,
  ChannelTurnNotificationV1,
  ChannelTurnResultV1,
} from './types.ts'

/** Numeric version carried by every base channel protocol payload. */
export const CHANNEL_PROTOCOL_VERSION = 1 as const

/** JSON-RPC request names in the base protocol plus its delivery-report extension. */
export const CHANNEL_BRIDGE_METHODS_V1 = {
  turnRun: 'turn.run',
  turnCancel: 'turn.cancel',
  sessionReset: 'session.reset',
  sessionClose: 'session.close',
  channelAction: 'channel.action',
  healthGet: 'health.get',
} as const

/** One method name accepted by a V1 bridge request router. */
export type ChannelBridgeMethodV1 = typeof CHANNEL_BRIDGE_METHODS_V1[keyof typeof CHANNEL_BRIDGE_METHODS_V1]

/** JSON-RPC notifications sent without request ids after capability negotiation. */
export const CHANNEL_BRIDGE_NOTIFICATIONS_V1 = {
  turnProgress: 'turn.progress',
  deliveryReport: 'delivery.report',
} as const

/** One notification name accepted by a V1 bridge router. */
export type ChannelBridgeNotificationV1 =
  typeof CHANNEL_BRIDGE_NOTIFICATIONS_V1[keyof typeof CHANNEL_BRIDGE_NOTIFICATIONS_V1]

/** Reject blank or whitespace-padded opaque wire identities before branding. */
function opaqueId<T extends string>(factory: (value: string) => T): z.ZodType<T> {
  return z.string().min(1).refine(value => value.trim() === value, 'must not have surrounding whitespace').transform(factory)
}

const gatewayInstanceIdSchema = opaqueId(GatewayInstanceId)
const channelIdSchema = opaqueId(ChannelId)
const channelAccountIdSchema = opaqueId(ChannelAccountId)
const channelConversationIdSchema = opaqueId(ChannelConversationId)
const channelThreadIdSchema = opaqueId(ChannelThreadId)
const channelMessageIdSchema = opaqueId(ChannelMessageId)
const channelSenderIdSchema = opaqueId(ChannelSenderId)
const channelTurnIdSchema = opaqueId(ChannelTurnId)
const channelRunIdSchema = opaqueId(ChannelRunId)
const channelIdempotencyKeySchema = opaqueId(ChannelIdempotencyKey)
const openClawSessionKeySchema = opaqueId(OpenClawSessionKey)
const channelStartupNonceSchema = opaqueId(ChannelStartupNonce)
const channelReplayIdSchema = opaqueId(ChannelReplayId)
const channelMediaIdSchema = opaqueId(ChannelMediaId)
const channelMediaSha256Schema = z.string().regex(/^[a-f0-9]{64}$/).transform(ChannelMediaSha256)
const channelActionIdSchema = opaqueId(ChannelActionId)
const channelDeliveryIdSchema = opaqueId(ChannelDeliveryId)
const channelDirectoryEntryIdSchema = opaqueId(ChannelDirectoryEntryId)
const channelTraceIdSchema = opaqueId(ChannelTraceId)
const channelToolCallIdSchema = opaqueId(ChannelToolCallId)

const protocolVersionSchema = z.literal(CHANNEL_PROTOCOL_VERSION)
const nonNegativeIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const positiveIntegerSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const nonBlankSchema = z.string().min(1).refine(value => value.trim().length > 0, 'must contain a non-whitespace character')
const rfc3339Schema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
  'must be an RFC 3339 timestamp',
)
const mediaTypeSchema = z.string().regex(
  /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/,
  'must be a media type',
)
const displayBasenameSchema = z.string().min(1).refine(
  value => value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\') && !value.includes('\0'),
  'must be a display basename',
)
const relativeStagingPathSchema = z.string().min(1).refine((value) => {
  if (value.startsWith('/') || value.includes('\\') || value.includes('\0') || /^[A-Za-z]:/.test(value)) return false
  return value.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..')
}, 'must be a slash-normalized relative staging path without dot segments')

const openClawCommitShaSchema = z.string().regex(/^[a-f0-9]{40}$/).transform(OpenClawCommitSha)
const openClawArtifactSha512Schema = z.string().regex(/^[a-f0-9]{128}$/).transform(OpenClawArtifactSha512)
const sessionIdSchema = opaqueId(value => value as import('@deepseek-ai/dsh-session').SessionId)

const actionKindSchema = z.enum([
  'send',
  'edit',
  'delete',
  'react',
  'poll',
  'typing',
  'directory.self',
  'directory.list-peers',
  'directory.list-groups',
  'directory.list-group-members',
  'resolve',
])
const notificationKindSchema = z.enum(['text.delta', 'reasoning.delta', 'tool', 'status'])
const protocolExtensionSchema = z.literal('delivery.report')

/** Report duplicate values in one negotiated capability list. */
function uniqueValues(values: readonly string[]): boolean {
  return new Set(values).size === values.length
}

const openClawHostIdentitySchema = z.object({
  tag: nonBlankSchema,
  commitSha: openClawCommitShaSchema,
  artifactSha512: openClawArtifactSha512Schema,
  nodeEngine: nonBlankSchema,
}).strict()

const bridgeCapabilitiesSchema = z.object({
  actions: z.array(actionKindSchema).refine(uniqueValues, 'actions must not contain duplicates'),
  notifications: z.array(notificationKindSchema).refine(uniqueValues, 'notifications must not contain duplicates'),
  extensions: z.array(protocolExtensionSchema).refine(uniqueValues, 'extensions must not contain duplicates'),
}).strict()

/** Strict validator for the authenticated V1 bridge handshake. */
export const channelBridgeHandshakeV1Schema = z.object({
  protocolVersion: protocolVersionSchema,
  gatewayInstanceId: gatewayInstanceIdSchema,
  openclaw: openClawHostIdentitySchema,
  agentHarness: z.enum(['v1', 'v2']),
  capabilities: bridgeCapabilitiesSchema,
  startupNonce: channelStartupNonceSchema,
}).strict() as unknown as z.ZodType<ChannelBridgeHandshakeV1>

const channelRouteV1Schema = z.object({
  gatewayInstanceId: gatewayInstanceIdSchema,
  openclawSessionKey: openClawSessionKeySchema,
  generation: nonNegativeIntegerSchema,
  channel: channelIdSchema,
  account: channelAccountIdSchema,
  conversation: channelConversationIdSchema,
  thread: channelThreadIdSchema.optional(),
  kind: z.enum(['direct', 'group']),
}).strict()

const channelPrincipalV1Schema = z.object({
  senderId: channelSenderIdSchema,
  displayName: z.string().optional(),
  trust: z.enum(['owner', 'paired', 'allowlisted', 'admitted', 'group-allowlisted']),
}).strict()

const channelMessageReferenceV1Schema = z.object({
  messageId: channelMessageIdSchema,
  senderId: channelSenderIdSchema.optional(),
}).strict()

const channelStagedMediaV1Schema = z.object({
  mediaId: channelMediaIdSchema,
  ordinal: nonNegativeIntegerSchema,
  kind: z.enum(['image', 'audio', 'video', 'file']),
  mediaType: mediaTypeSchema,
  bytes: positiveIntegerSchema,
  sha256: channelMediaSha256Schema,
  relativePath: relativeStagingPathSchema,
  name: displayBasenameSchema.optional(),
}).strict()

/** Enforce the media array's stated order and per-payload identities. */
function validateMediaOrder(
  media: readonly z.infer<typeof channelStagedMediaV1Schema>[],
  ctx: z.RefinementCtx,
): void {
  const ids = new Set<string>()
  for (const [index, item] of media.entries()) {
    if (item.ordinal !== index) {
      ctx.addIssue({ code: 'custom', path: [index, 'ordinal'], message: `must equal array position ${index}` })
    }
    if (ids.has(item.mediaId)) {
      ctx.addIssue({ code: 'custom', path: [index, 'mediaId'], message: 'must be unique within the payload' })
    }
    ids.add(item.mediaId)
  }
}

const orderedMediaSchema = z.array(channelStagedMediaV1Schema).superRefine(validateMediaOrder)

const channelTraceV1Schema = z.object({
  traceId: channelTraceIdSchema,
  parentTraceId: channelTraceIdSchema.optional(),
}).strict()

/** Require text or media without imposing deployment-specific size limits. */
function validateMessageContent(
  value: { readonly text: string; readonly media: readonly unknown[] },
  ctx: z.RefinementCtx,
): void {
  if (value.text === '' && value.media.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['text'], message: 'text or media is required' })
  }
}

/** Strict validator for one admitted inbound V1 turn. */
export const channelTurnEnvelopeV1Schema = z.object({
  protocolVersion: protocolVersionSchema,
  idempotencyKey: channelIdempotencyKeySchema,
  turnId: channelTurnIdSchema,
  runId: channelRunIdSchema,
  route: channelRouteV1Schema,
  sender: channelPrincipalV1Schema,
  wasMentioned: z.boolean().optional(),
  messageId: channelMessageIdSchema,
  replyTo: channelMessageReferenceV1Schema.optional(),
  text: z.string(),
  media: orderedMediaSchema,
  trace: channelTraceV1Schema.optional(),
}).strict().superRefine(validateMessageContent) as unknown as z.ZodType<ChannelTurnEnvelopeV1>

const tokenUsageSchema = z.object({
  inputTokens: nonNegativeIntegerSchema,
  outputTokens: nonNegativeIntegerSchema,
  cacheReadTokens: nonNegativeIntegerSchema.optional(),
  cacheWriteTokens: nonNegativeIntegerSchema.optional(),
  reasoningTokens: nonNegativeIntegerSchema.optional(),
}).strict()

const channelFailureV1Schema = z.object({
  code: nonBlankSchema,
  message: nonBlankSchema,
  retryable: z.boolean(),
}).strict()

const turnResultBase = {
  protocolVersion: protocolVersionSchema,
  turnId: channelTurnIdSchema,
  runId: channelRunIdSchema,
  replayId: channelReplayIdSchema,
}

const completedResultSchema = z.object({
  ...turnResultBase,
  status: z.literal('completed'),
  sessionId: sessionIdSchema,
  text: z.string(),
  media: orderedMediaSchema,
  usage: tokenUsageSchema.optional(),
}).strict().superRefine(validateMessageContent)

const silentResultSchema = z.object({
  ...turnResultBase,
  status: z.literal('silent'),
  sessionId: sessionIdSchema,
  usage: tokenUsageSchema.optional(),
}).strict()

const cancelledResultSchema = z.object({
  ...turnResultBase,
  status: z.literal('cancelled'),
  sessionId: sessionIdSchema.optional(),
  reason: nonBlankSchema,
}).strict()

const failedResultSchema = z.object({
  ...turnResultBase,
  status: z.literal('failed'),
  sessionId: sessionIdSchema.optional(),
  error: channelFailureV1Schema,
}).strict()

/** Strict validator for every terminal `turn.run` result. */
export const channelTurnResultV1Schema = z.union([
  completedResultSchema,
  silentResultSchema,
  cancelledResultSchema,
  failedResultSchema,
]) as unknown as z.ZodType<ChannelTurnResultV1>

/** Strict validator for `turn.cancel` parameters. */
export const channelTurnCancelV1Schema = z.object({
  protocolVersion: protocolVersionSchema,
  turnId: channelTurnIdSchema,
  runId: channelRunIdSchema,
  reason: z.enum(['user', 'timeout', 'gateway-shutdown']),
}).strict() as unknown as z.ZodType<ChannelTurnCancelV1>

/** Strict validator for `session.reset` parameters. */
export const channelSessionResetV1Schema = z.object({
  protocolVersion: protocolVersionSchema,
  route: channelRouteV1Schema,
  nextGeneration: nonNegativeIntegerSchema,
  reason: z.enum(['new', 'reset']),
}).strict().superRefine((value, ctx) => {
  if (value.nextGeneration <= value.route.generation) {
    ctx.addIssue({ code: 'custom', path: ['nextGeneration'], message: 'must exceed route.generation' })
  }
}) as unknown as z.ZodType<ChannelSessionResetV1>

/** Strict validator for a successful `session.reset` result. */
export const channelSessionResetResultV1Schema = z.object({
  protocolVersion: protocolVersionSchema,
  route: channelRouteV1Schema,
  previousSessionId: sessionIdSchema.optional(),
}).strict() as unknown as z.ZodType<ChannelSessionResetResultV1>

/** Strict validator for `session.close` parameters. */
export const channelSessionCloseV1Schema = z.object({
  protocolVersion: protocolVersionSchema,
  route: channelRouteV1Schema,
  reason: z.enum(['gateway', 'account-disabled', 'shutdown']),
}).strict() as unknown as z.ZodType<ChannelSessionCloseV1>

const channelActionTargetV1Schema = z.object({
  gatewayInstanceId: gatewayInstanceIdSchema,
  channel: channelIdSchema,
  account: channelAccountIdSchema,
  conversation: channelConversationIdSchema,
  thread: channelThreadIdSchema.optional(),
}).strict()

const actionBase = {
  protocolVersion: protocolVersionSchema,
  actionId: channelActionIdSchema,
  target: channelActionTargetV1Schema,
}

const sendActionSchema = z.object({
  ...actionBase,
  kind: z.literal('send'),
  text: z.string(),
  media: orderedMediaSchema,
  replyTo: channelMessageIdSchema.optional(),
}).strict().superRefine(validateMessageContent)

const editActionSchema = z.object({
  ...actionBase,
  kind: z.literal('edit'),
  messageId: channelMessageIdSchema,
  text: z.string(),
  media: orderedMediaSchema,
}).strict().superRefine(validateMessageContent)

const deleteActionSchema = z.object({
  ...actionBase,
  kind: z.literal('delete'),
  messageId: channelMessageIdSchema,
}).strict()

const reactActionSchema = z.object({
  ...actionBase,
  kind: z.literal('react'),
  messageId: channelMessageIdSchema,
  reaction: nonBlankSchema,
  operation: z.enum(['add', 'remove']),
}).strict()

const pollActionSchema = z.object({
  ...actionBase,
  kind: z.literal('poll'),
  question: nonBlankSchema,
  options: z.array(nonBlankSchema).min(2).refine(uniqueValues, 'poll options must be distinct'),
  multiple: z.boolean(),
}).strict()

const typingActionSchema = z.object({
  ...actionBase,
  kind: z.literal('typing'),
  active: z.boolean(),
}).strict()

const directorySelfActionSchema = z.object({
  ...actionBase,
  kind: z.literal('directory.self'),
}).strict()

const directoryListBase = {
  ...actionBase,
  query: z.string().optional(),
  limit: positiveIntegerSchema.optional(),
  source: z.enum(['cached', 'live']),
}

const directoryListPeersActionSchema = z.object({
  ...directoryListBase,
  kind: z.literal('directory.list-peers'),
}).strict()

const directoryListGroupsActionSchema = z.object({
  ...directoryListBase,
  kind: z.literal('directory.list-groups'),
}).strict()

const directoryListGroupMembersActionSchema = z.object({
  ...actionBase,
  kind: z.literal('directory.list-group-members'),
  groupId: channelDirectoryEntryIdSchema,
  limit: positiveIntegerSchema.optional(),
}).strict()

const resolveActionSchema = z.object({
  ...actionBase,
  kind: z.literal('resolve'),
  resolveKind: z.enum(['user', 'group']),
  inputs: z.array(nonBlankSchema).min(1),
}).strict()

/** Strict validator for V1 outbound, directory, and resolution actions. */
export const channelActionV1Schema = z.union([
  sendActionSchema,
  editActionSchema,
  deleteActionSchema,
  reactActionSchema,
  pollActionSchema,
  typingActionSchema,
  directorySelfActionSchema,
  directoryListPeersActionSchema,
  directoryListGroupsActionSchema,
  directoryListGroupMembersActionSchema,
  resolveActionSchema,
]) as unknown as z.ZodType<ChannelActionV1>

const actionDeliverySubjectSchema = z.object({
  kind: z.literal('action'),
  actionId: channelActionIdSchema,
}).strict()

const turnDeliverySubjectSchema = z.object({
  kind: z.literal('turn'),
  turnId: channelTurnIdSchema,
  runId: channelRunIdSchema,
}).strict()

const deliverySubjectSchema = z.union([actionDeliverySubjectSchema, turnDeliverySubjectSchema])

const deliveryReceiptBase = {
  protocolVersion: protocolVersionSchema,
  deliveryId: channelDeliveryIdSchema,
  subject: deliverySubjectSchema,
  attempt: positiveIntegerSchema,
  platformMessageId: channelMessageIdSchema.optional(),
}

const acceptedReceiptSchema = z.object({
  ...deliveryReceiptBase,
  status: z.literal('accepted'),
}).strict()

const confirmedReceiptSchema = z.object({
  ...deliveryReceiptBase,
  status: z.literal('confirmed'),
}).strict()

const retryingReceiptSchema = z.object({
  ...deliveryReceiptBase,
  status: z.literal('retrying'),
  nextAttemptAt: rfc3339Schema,
  error: channelFailureV1Schema,
}).strict()

const ambiguousReceiptSchema = z.object({
  ...deliveryReceiptBase,
  status: z.literal('ambiguous'),
  error: channelFailureV1Schema,
}).strict()

const deadLetterReceiptSchema = z.object({
  ...deliveryReceiptBase,
  status: z.literal('dead-letter'),
  error: channelFailureV1Schema,
}).strict()

/** Strict validator for durable delivery states. */
export const channelDeliveryReceiptV1Schema = z.union([
  acceptedReceiptSchema,
  confirmedReceiptSchema,
  retryingReceiptSchema,
  ambiguousReceiptSchema,
  deadLetterReceiptSchema,
]) as unknown as z.ZodType<ChannelDeliveryReceiptV1>

/** Strict validator for a delivery receipt returned specifically by `channel.action`. */
export const channelActionDeliveryReceiptV1Schema = channelDeliveryReceiptV1Schema.superRefine((value, ctx) => {
  if (value.subject.kind !== 'action') {
    ctx.addIssue({ code: 'custom', path: ['subject'], message: 'channel.action delivery requires an action subject' })
  }
}) as unknown as z.ZodType<ChannelActionDeliveryReceiptV1>

const channelDirectoryEntryV1Schema = z.object({
  kind: z.enum(['user', 'group', 'channel']),
  id: channelDirectoryEntryIdSchema,
  name: z.string().optional(),
  handle: z.string().optional(),
  rank: z.number().optional(),
}).strict()

const channelDirectoryResultV1Schema = z.object({
  protocolVersion: protocolVersionSchema,
  actionId: channelActionIdSchema,
  kind: z.literal('directory'),
  entries: z.array(channelDirectoryEntryV1Schema),
}).strict()

const channelResolveMatchV1Schema = z.discriminatedUnion('resolved', [
  z.object({
    input: nonBlankSchema,
    resolved: z.literal(false),
    note: z.string().optional(),
  }).strict(),
  z.object({
    input: nonBlankSchema,
    resolved: z.literal(true),
    id: channelDirectoryEntryIdSchema,
    name: z.string().optional(),
    note: z.string().optional(),
  }).strict(),
])

const channelResolveResultV1Schema = z.object({
  protocolVersion: protocolVersionSchema,
  actionId: channelActionIdSchema,
  kind: z.literal('resolve'),
  results: z.array(channelResolveMatchV1Schema),
}).strict()

/** Strict validator for every `channel.action` result variant. */
export const channelActionResultV1Schema = z.union([
  channelActionDeliveryReceiptV1Schema,
  channelDirectoryResultV1Schema,
  channelResolveResultV1Schema,
]) as unknown as z.ZodType<ChannelActionResultV1>

/** Strict validator for the negotiated `delivery.report` extension. */
export const channelDeliveryReportV1Schema = z.object({
  protocolVersion: protocolVersionSchema,
  extension: protocolExtensionSchema,
  receipt: channelDeliveryReceiptV1Schema,
}).strict().superRefine((value, ctx) => {
  if (value.receipt.subject.kind !== 'turn') {
    ctx.addIssue({ code: 'custom', path: ['receipt', 'subject'], message: 'delivery.report requires a turn subject' })
  }
}) as unknown as z.ZodType<ChannelDeliveryReportV1>

const notificationBase = {
  turnId: channelTurnIdSchema,
  runId: channelRunIdSchema,
  sequence: nonNegativeIntegerSchema,
}

const textDeltaNotificationSchema = z.object({
  ...notificationBase,
  kind: z.literal('text.delta'),
  text: nonBlankSchema,
}).strict()

const reasoningDeltaNotificationSchema = z.object({
  ...notificationBase,
  kind: z.literal('reasoning.delta'),
  text: nonBlankSchema,
}).strict()

const toolNotificationSchema = z.object({
  ...notificationBase,
  kind: z.literal('tool'),
  toolCallId: channelToolCallIdSchema,
  name: nonBlankSchema,
  phase: z.enum(['started', 'finished']),
  summary: z.string().optional(),
}).strict()

const statusNotificationSchema = z.object({
  ...notificationBase,
  kind: z.literal('status'),
  status: z.enum(['accepted', 'running', 'waiting-tool', 'finalizing']),
}).strict()

/** Strict validator for optional turn-progress notifications. */
export const channelTurnNotificationV1Schema = z.union([
  textDeltaNotificationSchema,
  reasoningDeltaNotificationSchema,
  toolNotificationSchema,
  statusNotificationSchema,
]) as unknown as z.ZodType<ChannelTurnNotificationV1>

const channelAccountHealthV1Schema = z.object({
  channel: channelIdSchema,
  account: channelAccountIdSchema,
  status: z.enum(['disabled', 'connecting', 'ready', 'degraded', 'failed']),
  actions: z.array(actionKindSchema).refine(uniqueValues, 'actions must not contain duplicates'),
  error: channelFailureV1Schema.optional(),
}).strict()

const channelDiagnosticV1Schema = z.object({
  code: nonBlankSchema,
  message: nonBlankSchema,
}).strict()

/** Strict validator for `health.get` results. */
export const channelHealthV1Schema = z.object({
  protocolVersion: protocolVersionSchema,
  status: z.enum(['starting', 'ready', 'degraded', 'stopping', 'stopped', 'failed']),
  checkedAt: rfc3339Schema,
  handshake: channelBridgeHandshakeV1Schema.optional(),
  accounts: z.array(channelAccountHealthV1Schema),
  diagnostics: z.array(channelDiagnosticV1Schema),
}).strict() as unknown as z.ZodType<ChannelHealthV1>

/** Strict empty-object validator for acknowledgement and parameterless request payloads. */
export const channelEmptyResultV1Schema = z.object({}).strict()
