/**
 * Provider-neutral channel protocol and same-process registration types.
 * @module @clawdsh/dsh-channel/types
 */

import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {
  ChannelAccountId,
  ChannelActionId,
  ChannelDeliveryId,
  ChannelDirectoryEntryId,
  ChannelConversationId,
  ChannelId,
  ChannelIdempotencyKey,
  ChannelMediaId,
  ChannelMediaSha256,
  ChannelMessageId,
  ChannelProviderId,
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

/** Version carried by every base channel protocol payload. */
export type ChannelProtocolVersionV1 = 1

/** Optional protocol features negotiated during the bridge handshake. */
export type ChannelProtocolExtensionV1 = 'delivery.report'

/** Outbound platform operations supported by the first channel protocol. */
export type ChannelActionKindV1 =
  | 'send'
  | 'edit'
  | 'delete'
  | 'react'
  | 'poll'
  | 'typing'
  | 'directory.self'
  | 'directory.list-peers'
  | 'directory.list-groups'
  | 'directory.list-group-members'
  | 'resolve'

/** Optional progress notification kinds emitted while a turn runs. */
export type ChannelTurnNotificationKindV1 = 'text.delta' | 'reasoning.delta' | 'tool' | 'status'

/** OpenClaw release identity verified before the Gateway is admitted. */
export interface OpenClawHostIdentityV1 {
  /** Non-floating OpenClaw release tag. */
  readonly tag: string
  /** Dereferenced source commit of the release tag. */
  readonly commitSha: OpenClawCommitSha
  /** SHA-512 of the exact installed artifact. */
  readonly artifactSha512: OpenClawArtifactSha512
  /** Node engine range recorded by the locked artifact. */
  readonly nodeEngine: string
}

/** Features supported by one connected bridge implementation. */
export interface ChannelBridgeCapabilitiesV1 {
  /** Outbound action kinds accepted by the bridge. */
  readonly actions: readonly ChannelActionKindV1[]
  /** Progress notification kinds the bridge accepts. */
  readonly notifications: readonly ChannelTurnNotificationKindV1[]
  /** Optional protocol extensions the bridge implements. */
  readonly extensions: readonly ChannelProtocolExtensionV1[]
}

/** First authenticated message exchanged with an OpenClaw Gateway. */
export interface ChannelBridgeHandshakeV1 {
  /** Base protocol version. */
  readonly protocolVersion: ChannelProtocolVersionV1
  /** Identity of this Gateway state lineage. */
  readonly gatewayInstanceId: GatewayInstanceId
  /** Locked OpenClaw release and artifact identity. */
  readonly openclaw: OpenClawHostIdentityV1
  /** OpenClaw AgentHarness API generation used by the bridge adapter. */
  readonly agentHarness: 'v1' | 'v2'
  /** Negotiated actions, notifications, and extensions. */
  readonly capabilities: ChannelBridgeCapabilitiesV1
  /** Per-startup challenge expected by the supervising provider. */
  readonly startupNonce: ChannelStartupNonce
}

/** Stable channel destination shared by inbound turns and session controls. */
export interface ChannelRouteV1 {
  /** Gateway state lineage that admitted the message. */
  readonly gatewayInstanceId: GatewayInstanceId
  /** OpenClaw session key before reset generation is applied. */
  readonly openclawSessionKey: OpenClawSessionKey
  /** Monotonic reset generation for this OpenClaw session key. */
  readonly generation: number
  /** OpenClaw channel plugin identity. */
  readonly channel: ChannelId
  /** Platform account identity inside the channel. */
  readonly account: ChannelAccountId
  /** Platform conversation identity inside the account. */
  readonly conversation: ChannelConversationId
  /** Platform thread identity when the channel exposes threads. */
  readonly thread?: ChannelThreadId
  /** Whether the destination is a direct or group conversation. */
  readonly kind: 'direct' | 'group'
}

/** Sender identity and OpenClaw's completed admission classification. */
export interface ChannelPrincipalV1 {
  /** Platform sender identity. */
  readonly senderId: ChannelSenderId
  /** Sanitized display name, when the platform supplies one. */
  readonly displayName?: string
  /** Admission class established by OpenClaw policy. */
  readonly trust: 'owner' | 'paired' | 'allowlisted' | 'admitted' | 'group-allowlisted'
}

/** Reference to an existing platform message. */
export interface ChannelMessageReferenceV1 {
  /** Referenced platform message identity. */
  readonly messageId: ChannelMessageId
  /** Referenced sender when known. */
  readonly senderId?: ChannelSenderId
}

/** One ordered media object staged by the authenticated Gateway. */
export interface ChannelStagedMediaV1 {
  /** Stable media identity within the inbound or outbound payload. */
  readonly mediaId: ChannelMediaId
  /** Zero-based position; arrays must contain a contiguous ordered sequence. */
  readonly ordinal: number
  /** Broad media class used for capability checks. */
  readonly kind: 'image' | 'audio' | 'video' | 'file'
  /** Gateway-declared media type, verified again before use. */
  readonly mediaType: string
  /** Exact staged byte count reported by the Gateway. */
  readonly bytes: number
  /** Canonical SHA-256 verified against the staged bytes before use. */
  readonly sha256: ChannelMediaSha256
  /** Slash-normalized path relative to the configured staging root. */
  readonly relativePath: string
  /** Display-only basename with no local directory information. */
  readonly name?: string
}

/** Trace fields safe to project across the authenticated local IPC connection. */
export interface ChannelTraceV1 {
  /** Trace identity for this turn. */
  readonly traceId: ChannelTraceId
  /** Parent trace identity when this turn continues another operation. */
  readonly parentTraceId?: ChannelTraceId
}

/** Complete admitted inbound turn sent by the OpenClaw bridge. */
export interface ChannelTurnEnvelopeV1 {
  /** Base protocol version. */
  readonly protocolVersion: ChannelProtocolVersionV1
  /** Gateway idempotency key; repeated equal payloads attach or replay. */
  readonly idempotencyKey: ChannelIdempotencyKey
  /** Stable identity of the logical turn. */
  readonly turnId: ChannelTurnId
  /** Identity used by explicit cancellation and progress notifications. */
  readonly runId: ChannelRunId
  /** Account, conversation, thread, and reset generation. */
  readonly route: ChannelRouteV1
  /** Sender identity after OpenClaw admission. */
  readonly sender: ChannelPrincipalV1
  /** Whether the bot was mentioned, when the platform can determine it. */
  readonly wasMentioned?: boolean
  /** Platform message identity. */
  readonly messageId: ChannelMessageId
  /** Message being replied to, when present. */
  readonly replyTo?: ChannelMessageReferenceV1
  /** Plain text; it may be empty only when media is present. */
  readonly text: string
  /** Media in platform order. */
  readonly media: readonly ChannelStagedMediaV1[]
  /** Optional distributed trace projection. */
  readonly trace?: ChannelTraceV1
}

/** Structured failure safe to persist and return across IPC. */
export interface ChannelFailureV1 {
  /** Stable machine-routable failure class. */
  readonly code: string
  /** Sanitized human-readable failure description. */
  readonly message: string
  /** Whether retrying transport delivery may succeed; never authorizes rerunning Agent tools. */
  readonly retryable: boolean
}

/** One confirmed `message.send` projection in the shape consumed by OpenClaw AgentHarness. */
export interface ChannelMessagingToolSendV1 {
  /** Model-visible tool identity. */
  readonly tool: 'message'
  /** Channel provider that accepted the send. */
  readonly provider: ChannelId
  /** Account selected by the route-bound tool. */
  readonly accountId: ChannelAccountId
  /** Conversation selected by the route-bound tool. */
  readonly to: ChannelConversationId
  /** Thread selected by the route-bound tool, when present. */
  readonly threadId?: ChannelThreadId
  /** Confirmed sent text, when present. */
  readonly text?: string
  /** Confirmed media URLs, when present. */
  readonly mediaUrls?: readonly string[]
}

/** Durable side-effect evidence derived from the exact owning Agent turn. */
export interface ChannelTurnEffectsV1 {
  /** Whether the turn invoked a mutating tool or otherwise has an uncertain effect boundary. */
  readonly hadPotentialSideEffects: boolean
  /** Whether the Agent turn may be executed again; exactly the inverse of potential side effects. */
  readonly replaySafe: boolean
  /** Whether a `message.send` may have dispatched; false only for definitive pre-dispatch outcomes. */
  readonly didSendViaMessagingTool: boolean
  /** Texts from confirmed `message.send` calls in execution order. */
  readonly messagingToolSentTexts: readonly string[]
  /** Media URLs from confirmed `message.send` calls in execution order. */
  readonly messagingToolSentMediaUrls: readonly string[]
  /** Route-bound targets from confirmed `message.send` calls in execution order. */
  readonly messagingToolSentTargets: readonly ChannelMessagingToolSendV1[]
}

/** Fields shared by every terminal turn result. */
export interface ChannelTurnResultBaseV1 {
  /** Base protocol version. */
  readonly protocolVersion: ChannelProtocolVersionV1
  /** Logical turn identity from the request. */
  readonly turnId: ChannelTurnId
  /** Run identity from the request. */
  readonly runId: ChannelRunId
  /** Persisted result identity used for safe replay without Agent execution. */
  readonly replayId: ChannelReplayId
  /** Durable Agent-tool side-effect evidence for OpenClaw replay policy. */
  readonly effects: ChannelTurnEffectsV1
}

/** A turn that produced final text or media. */
export interface ChannelTurnCompletedV1 extends ChannelTurnResultBaseV1 {
  /** Terminal result discriminant. */
  readonly status: 'completed'
  /** DSH session that produced the result. */
  readonly sessionId: SessionId
  /** Final assistant text; it may be empty only when media is present. */
  readonly text: string
  /** Final media staged for OpenClaw delivery. */
  readonly media: readonly ChannelStagedMediaV1[]
  /** Aggregated token accounting when the model adapter supplied it. */
  readonly usage?: TokenUsage
}

/** A successful turn whose contract intentionally emits no reply. */
export interface ChannelTurnSilentV1 extends ChannelTurnResultBaseV1 {
  /** Terminal result discriminant. */
  readonly status: 'silent'
  /** DSH session that consumed the turn. */
  readonly sessionId: SessionId
  /** Aggregated token accounting when the model adapter supplied it. */
  readonly usage?: TokenUsage
}

/** A turn stopped before a final reply was committed. */
export interface ChannelTurnCancelledV1 extends ChannelTurnResultBaseV1 {
  /** Terminal result discriminant. */
  readonly status: 'cancelled'
  /** DSH session when one had already been selected. */
  readonly sessionId?: SessionId
  /** Sanitized cancellation reason. */
  readonly reason: string
}

/** A turn that reached a terminal bridge or Agent failure. */
export interface ChannelTurnFailedV1 extends ChannelTurnResultBaseV1 {
  /** Terminal result discriminant. */
  readonly status: 'failed'
  /** DSH session when one had already been selected. */
  readonly sessionId?: SessionId
  /** Structured terminal failure. */
  readonly error: ChannelFailureV1
}

/** Terminal result returned by `turn.run`. */
export type ChannelTurnResultV1 =
  | ChannelTurnCompletedV1
  | ChannelTurnSilentV1
  | ChannelTurnCancelledV1
  | ChannelTurnFailedV1

/** Explicit cancellation request for one live turn. */
export interface ChannelTurnCancelV1 {
  /** Base protocol version. */
  readonly protocolVersion: ChannelProtocolVersionV1
  /** Logical turn to cancel. */
  readonly turnId: ChannelTurnId
  /** Exact live run to cancel. */
  readonly runId: ChannelRunId
  /** Caller intent used for diagnostics. */
  readonly reason: 'user' | 'timeout' | 'gateway-shutdown'
}

/** Request to retire one generation and allocate its successor. */
export interface ChannelSessionResetV1 {
  /** Base protocol version. */
  readonly protocolVersion: ChannelProtocolVersionV1
  /** Current route being retired. */
  readonly route: ChannelRouteV1
  /** Requested successor generation; it must exceed `route.generation`. */
  readonly nextGeneration: number
  /** OpenClaw command that requested the reset. */
  readonly reason: 'new' | 'reset'
}

/** Acknowledgement that a reset generation was accepted. */
export interface ChannelSessionResetResultV1 {
  /** Base protocol version. */
  readonly protocolVersion: ChannelProtocolVersionV1
  /** Successor route carrying the accepted generation. */
  readonly route: ChannelRouteV1
  /** Retired DSH session when a binding existed. */
  readonly previousSessionId?: SessionId
}

/** Request to close one route without allocating a successor generation. */
export interface ChannelSessionCloseV1 {
  /** Base protocol version. */
  readonly protocolVersion: ChannelProtocolVersionV1
  /** Route whose live resources must be drained and released. */
  readonly route: ChannelRouteV1
  /** Close cause used for diagnostics. */
  readonly reason: 'gateway' | 'account-disabled' | 'shutdown'
}

/** Stable target common to all outbound channel actions. */
export interface ChannelActionTargetV1 {
  /** Gateway state lineage that owns the account. */
  readonly gatewayInstanceId: GatewayInstanceId
  /** OpenClaw channel plugin identity. */
  readonly channel: ChannelId
  /** Platform account identity. */
  readonly account: ChannelAccountId
  /** Platform conversation identity. */
  readonly conversation: ChannelConversationId
  /** Platform thread identity when applicable. */
  readonly thread?: ChannelThreadId
}

/** Fields shared by every outbound channel action. */
export interface ChannelActionBaseV1 {
  /** Base protocol version. */
  readonly protocolVersion: ChannelProtocolVersionV1
  /** Idempotency and receipt-correlation identity for the action. */
  readonly actionId: ChannelActionId
  /** Account and conversation the operation targets. */
  readonly target: ChannelActionTargetV1
}

/** Send a new message. */
export interface ChannelSendActionV1 extends ChannelActionBaseV1 {
  /** Action discriminant. */
  readonly kind: 'send'
  /** Plain text; it may be empty only when media is present. */
  readonly text: string
  /** Ordered staged media. */
  readonly media: readonly ChannelStagedMediaV1[]
  /** Platform message to reply to. */
  readonly replyTo?: ChannelMessageId
}

/** Replace the editable content of an existing message. */
export interface ChannelEditActionV1 extends ChannelActionBaseV1 {
  /** Action discriminant. */
  readonly kind: 'edit'
  /** Platform message to edit. */
  readonly messageId: ChannelMessageId
  /** Replacement text; it may be empty only when media is present. */
  readonly text: string
  /** Replacement staged media. */
  readonly media: readonly ChannelStagedMediaV1[]
}

/** Delete an existing platform message. */
export interface ChannelDeleteActionV1 extends ChannelActionBaseV1 {
  /** Action discriminant. */
  readonly kind: 'delete'
  /** Platform message to delete. */
  readonly messageId: ChannelMessageId
}

/** Add or remove one native platform reaction. */
export interface ChannelReactActionV1 extends ChannelActionBaseV1 {
  /** Action discriminant. */
  readonly kind: 'react'
  /** Platform message receiving the reaction change. */
  readonly messageId: ChannelMessageId
  /** Platform reaction name or emoji. */
  readonly reaction: string
  /** Whether to add or remove the reaction. */
  readonly operation: 'add' | 'remove'
}

/** Create one native platform poll. */
export interface ChannelPollActionV1 extends ChannelActionBaseV1 {
  /** Action discriminant. */
  readonly kind: 'poll'
  /** Poll question. */
  readonly question: string
  /** Two or more distinct option labels. */
  readonly options: readonly string[]
  /** Whether the platform may accept more than one option. */
  readonly multiple: boolean
}

/** Start or stop the native typing indicator. */
export interface ChannelTypingActionV1 extends ChannelActionBaseV1 {
  /** Action discriminant. */
  readonly kind: 'typing'
  /** True starts or refreshes typing; false stops it. */
  readonly active: boolean
}

/** Return the current account's own directory identity. */
export interface ChannelDirectorySelfActionV1 extends ChannelActionBaseV1 {
  /** Action discriminant. */
  readonly kind: 'directory.self'
}

/** List peer directory entries from the provider cache or the live platform. */
export interface ChannelDirectoryListPeersActionV1 extends ChannelActionBaseV1 {
  /** Action discriminant. */
  readonly kind: 'directory.list-peers'
  /** Optional provider-native search text. */
  readonly query?: string
  /** Optional positive result cap. */
  readonly limit?: number
  /** Select the cached or explicitly live OpenClaw adapter method. */
  readonly source: 'cached' | 'live'
}

/** List group directory entries from the provider cache or the live platform. */
export interface ChannelDirectoryListGroupsActionV1 extends ChannelActionBaseV1 {
  /** Action discriminant. */
  readonly kind: 'directory.list-groups'
  /** Optional provider-native search text. */
  readonly query?: string
  /** Optional positive result cap. */
  readonly limit?: number
  /** Select the cached or explicitly live OpenClaw adapter method. */
  readonly source: 'cached' | 'live'
}

/** List members of one platform group directory entry. */
export interface ChannelDirectoryListGroupMembersActionV1 extends ChannelActionBaseV1 {
  /** Action discriminant. */
  readonly kind: 'directory.list-group-members'
  /** Platform group identity returned by the directory or resolver. */
  readonly groupId: ChannelDirectoryEntryId
  /** Optional positive result cap. */
  readonly limit?: number
}

/** Resolve one or more user-supplied platform destinations. */
export interface ChannelResolveActionV1 extends ChannelActionBaseV1 {
  /** Action discriminant. */
  readonly kind: 'resolve'
  /** Destination class resolved by the OpenClaw adapter. */
  readonly resolveKind: 'user' | 'group'
  /** Ordered, non-empty destination strings. */
  readonly inputs: readonly string[]
}

/** One capability-checked outbound operation carried by `channel.action`. */
export type ChannelActionV1 =
  | ChannelSendActionV1
  | ChannelEditActionV1
  | ChannelDeleteActionV1
  | ChannelReactActionV1
  | ChannelPollActionV1
  | ChannelTypingActionV1
  | ChannelDirectorySelfActionV1
  | ChannelDirectoryListPeersActionV1
  | ChannelDirectoryListGroupsActionV1
  | ChannelDirectoryListGroupMembersActionV1
  | ChannelResolveActionV1

/** Sanitized directory entry returned by an OpenClaw channel adapter. */
export interface ChannelDirectoryEntryV1 {
  /** Platform entry class. */
  readonly kind: 'user' | 'group' | 'channel'
  /** Platform directory identity. */
  readonly id: ChannelDirectoryEntryId
  /** Sanitized display name. */
  readonly name?: string
  /** Sanitized platform handle. */
  readonly handle?: string
  /** Provider-defined ordering rank when available. */
  readonly rank?: number
}

/** Result of a `directory.*` action. */
export interface ChannelDirectoryResultV1 {
  /** Base protocol version. */
  readonly protocolVersion: ChannelProtocolVersionV1
  /** Action identity from the request. */
  readonly actionId: ChannelActionId
  /** Result discriminant. */
  readonly kind: 'directory'
  /** Sanitized entries in provider order; `directory.self` returns zero or one. */
  readonly entries: readonly ChannelDirectoryEntryV1[]
}

/** One target-resolution outcome in input order. */
export type ChannelResolveMatchV1 =
  | {
    /** Original destination string. */
    readonly input: string
    /** Resolution discriminant. */
    readonly resolved: false
    /** Sanitized failure note when the provider supplied one. */
    readonly note?: string
  }
  | {
    /** Original destination string. */
    readonly input: string
    /** Resolution discriminant. */
    readonly resolved: true
    /** Resolved platform directory identity. */
    readonly id: ChannelDirectoryEntryId
    /** Sanitized display name when supplied. */
    readonly name?: string
    /** Sanitized provider note when supplied. */
    readonly note?: string
  }

/** Result of one `resolve` action. */
export interface ChannelResolveResultV1 {
  /** Base protocol version. */
  readonly protocolVersion: ChannelProtocolVersionV1
  /** Action identity from the request. */
  readonly actionId: ChannelActionId
  /** Result discriminant. */
  readonly kind: 'resolve'
  /** One ordered outcome for each requested input. */
  readonly results: readonly ChannelResolveMatchV1[]
}

/** Action or turn whose platform delivery a receipt describes. */
export type ChannelDeliverySubjectV1 =
  | { readonly kind: 'action'; readonly actionId: ChannelActionId }
  | { readonly kind: 'turn'; readonly turnId: ChannelTurnId; readonly runId: ChannelRunId }

/** Fields shared by all delivery outcomes. */
export interface ChannelDeliveryReceiptBaseV1 {
  /** Base protocol version. */
  readonly protocolVersion: ChannelProtocolVersionV1
  /** Stable identity shared by retries and reconciliation. */
  readonly deliveryId: ChannelDeliveryId
  /** Action or final turn result being delivered. */
  readonly subject: ChannelDeliverySubjectV1
  /** One-based delivery attempt count. */
  readonly attempt: number
  /** Platform message identity when one was returned. */
  readonly platformMessageId?: ChannelMessageId
}

/** Platform request was accepted but not yet confirmed. */
export interface ChannelDeliveryAcceptedV1 extends ChannelDeliveryReceiptBaseV1 {
  /** Delivery-state discriminant. */
  readonly status: 'accepted'
}

/** Platform delivery was confirmed. */
export interface ChannelDeliveryConfirmedV1 extends ChannelDeliveryReceiptBaseV1 {
  /** Delivery-state discriminant. */
  readonly status: 'confirmed'
}

/** Delivery failed transiently and has a scheduled retry. */
export interface ChannelDeliveryRetryingV1 extends ChannelDeliveryReceiptBaseV1 {
  /** Delivery-state discriminant. */
  readonly status: 'retrying'
  /** Earliest RFC 3339 retry timestamp. */
  readonly nextAttemptAt: string
  /** Sanitized failure that scheduled the retry. */
  readonly error: ChannelFailureV1
}

/** Platform may have accepted the request, but reconciliation cannot prove it. */
export interface ChannelDeliveryAmbiguousV1 extends ChannelDeliveryReceiptBaseV1 {
  /** Delivery-state discriminant. */
  readonly status: 'ambiguous'
  /** Sanitized reconciliation failure. */
  readonly error: ChannelFailureV1
}

/** Delivery reached a terminal non-retryable failure. */
export interface ChannelDeliveryDeadLetterV1 extends ChannelDeliveryReceiptBaseV1 {
  /** Delivery-state discriminant. */
  readonly status: 'dead-letter'
  /** Sanitized terminal failure. */
  readonly error: ChannelFailureV1
}

/** Durable platform delivery outcome returned by actions or reported for final turns. */
export type ChannelDeliveryReceiptV1 =
  | ChannelDeliveryAcceptedV1
  | ChannelDeliveryConfirmedV1
  | ChannelDeliveryRetryingV1
  | ChannelDeliveryAmbiguousV1
  | ChannelDeliveryDeadLetterV1

/** Delivery receipt returned specifically by `channel.action`. */
export type ChannelActionDeliveryReceiptV1 = ChannelDeliveryReceiptV1 & {
  readonly subject: { readonly kind: 'action'; readonly actionId: ChannelActionId }
}

/** Result returned by one platform mutation, directory query, or target resolution. */
export type ChannelActionResultV1 =
  | ChannelActionDeliveryReceiptV1
  | ChannelDirectoryResultV1
  | ChannelResolveResultV1

/** Optional extension notification that advances a final turn from completed to delivered. */
export interface ChannelDeliveryReportV1 {
  /** Base protocol version. */
  readonly protocolVersion: ChannelProtocolVersionV1
  /** Negotiated extension discriminant. */
  readonly extension: 'delivery.report'
  /** Receipt whose subject must be a final turn. */
  readonly receipt: ChannelDeliveryReceiptV1
}

/** Text emitted incrementally for presentation only. */
export interface ChannelTextDeltaNotificationV1 {
  /** Notification discriminant. */
  readonly kind: 'text.delta'
  /** Logical turn identity. */
  readonly turnId: ChannelTurnId
  /** Exact live run identity. */
  readonly runId: ChannelRunId
  /** Monotonic zero-based notification sequence. */
  readonly sequence: number
  /** Incremental text. */
  readonly text: string
}

/** Reasoning text emitted only when the handshake enables it. */
export interface ChannelReasoningDeltaNotificationV1 {
  /** Notification discriminant. */
  readonly kind: 'reasoning.delta'
  /** Logical turn identity. */
  readonly turnId: ChannelTurnId
  /** Exact live run identity. */
  readonly runId: ChannelRunId
  /** Monotonic zero-based notification sequence. */
  readonly sequence: number
  /** Incremental reasoning text. */
  readonly text: string
}

/** Sanitized tool lifecycle update. */
export interface ChannelToolNotificationV1 {
  /** Notification discriminant. */
  readonly kind: 'tool'
  /** Logical turn identity. */
  readonly turnId: ChannelTurnId
  /** Exact live run identity. */
  readonly runId: ChannelRunId
  /** Monotonic zero-based notification sequence. */
  readonly sequence: number
  /** Tool-call identity. */
  readonly toolCallId: ChannelToolCallId
  /** Registered tool name. */
  readonly name: string
  /** Lifecycle phase safe to expose to the Gateway. */
  readonly phase: 'started' | 'finished'
  /** Sanitized one-line outcome summary. */
  readonly summary?: string
}

/** Coarse Agent status update. */
export interface ChannelStatusNotificationV1 {
  /** Notification discriminant. */
  readonly kind: 'status'
  /** Logical turn identity. */
  readonly turnId: ChannelTurnId
  /** Exact live run identity. */
  readonly runId: ChannelRunId
  /** Monotonic zero-based notification sequence. */
  readonly sequence: number
  /** Coarse state with no model-private content. */
  readonly status: 'accepted' | 'running' | 'waiting-tool' | 'finalizing'
}

/** Optional turn progress notification negotiated in the handshake. */
export type ChannelTurnNotificationV1 =
  | ChannelTextDeltaNotificationV1
  | ChannelReasoningDeltaNotificationV1
  | ChannelToolNotificationV1
  | ChannelStatusNotificationV1

/** Empty JSON object used by request methods that only acknowledge completion. */
export type ChannelEmptyResultV1 = Record<string, never>

/** Six base bidirectional JSON-RPC request methods and their wire types. */
export interface ChannelBridgeRequestMapV1 {
  'turn.run': { readonly params: ChannelTurnEnvelopeV1; readonly result: ChannelTurnResultV1 }
  'turn.cancel': { readonly params: ChannelTurnCancelV1; readonly result: ChannelEmptyResultV1 }
  'session.reset': { readonly params: ChannelSessionResetV1; readonly result: ChannelSessionResetResultV1 }
  'session.close': { readonly params: ChannelSessionCloseV1; readonly result: ChannelEmptyResultV1 }
  'channel.action': { readonly params: ChannelActionV1; readonly result: ChannelActionResultV1 }
  'health.get': { readonly params: ChannelEmptyResultV1; readonly result: ChannelHealthV1 }
}

/** Bridge notifications sent without JSON-RPC request ids after capability negotiation. */
export interface ChannelBridgeNotificationMapV1 {
  'turn.progress': ChannelTurnNotificationV1
  'delivery.report': ChannelDeliveryReportV1
}

/** Health of one configured OpenClaw channel account. */
export interface ChannelAccountHealthV1 {
  /** Channel plugin identity. */
  readonly channel: ChannelId
  /** Platform account identity. */
  readonly account: ChannelAccountId
  /** Current account connection state. */
  readonly status: 'disabled' | 'connecting' | 'ready' | 'degraded' | 'failed'
  /** Native actions currently supported by this account. */
  readonly actions: readonly ChannelActionKindV1[]
  /** Sanitized failure when the account is degraded or failed. */
  readonly error?: ChannelFailureV1
}

/** Sanitized provider diagnostic suitable for health output. */
export interface ChannelDiagnosticV1 {
  /** Stable diagnostic class. */
  readonly code: string
  /** Human-readable diagnostic with no credentials or local paths. */
  readonly message: string
}

/** Snapshot returned by `health.get`. */
export interface ChannelHealthV1 {
  /** Base protocol version. */
  readonly protocolVersion: ChannelProtocolVersionV1
  /** Provider and supervised Gateway lifecycle state. */
  readonly status: 'starting' | 'ready' | 'degraded' | 'stopping' | 'stopped' | 'failed'
  /** RFC 3339 observation timestamp. */
  readonly checkedAt: string
  /** Verified handshake once the bridge is connected. */
  readonly handshake?: ChannelBridgeHandshakeV1
  /** Per-account connection and capability state. */
  readonly accounts: readonly ChannelAccountHealthV1[]
  /** Sanitized provider-wide diagnostics. */
  readonly diagnostics: readonly ChannelDiagnosticV1[]
}

/** Same-process context supplied while one turn executes. */
export interface ChannelTurnExecutionV1 {
  /** Explicit cancellation signal owned by the turn lifecycle, not by a transient socket. */
  readonly signal: AbortSignal
  /**
   * Publish optional progress after handshake capability checks.
   * @param notification - Sanitized progress for this exact run.
   */
  notify(notification: ChannelTurnNotificationV1): void
}

/** Agent-plane implementation registered into `ctx.channels`. */
export interface ChannelDriverV1 {
  /**
   * Execute or resume one admitted turn.
   * @param turn - Validated inbound envelope.
   * @param execution - Cancellation and optional progress publication.
   * @returns A terminal replayable result.
   */
  runTurn(turn: ChannelTurnEnvelopeV1, execution: ChannelTurnExecutionV1): Promise<ChannelTurnResultV1>
  /**
   * Cancel one exact live run.
   * @param request - Turn and run identity plus caller intent.
   * @param signal - Optional cancellation of the control request itself.
   * @returns Completion after cancellation has been accepted.
   */
  cancel(request: ChannelTurnCancelV1, signal?: AbortSignal): Promise<void>
  /**
   * Retire a route generation and accept its successor.
   * @param request - Current route and strictly newer generation.
   * @param signal - Optional cancellation of the control request itself.
   * @returns The accepted successor route and retired session identity, when present.
   */
  reset(request: ChannelSessionResetV1, signal?: AbortSignal): Promise<ChannelSessionResetResultV1>
  /**
   * Drain and release one route generation.
   * @param request - Route and close cause.
   * @param signal - Optional cancellation of the control request itself.
   * @returns Completion after the live resources have closed.
   */
  close(request: ChannelSessionCloseV1, signal?: AbortSignal): Promise<void>
  /**
   * Record a final-turn delivery outcome when the negotiated extension is active.
   * @param report - Turn-subject receipt already committed to the provider ledger.
   * @param signal - Optional cancellation of the projection request itself.
   * @returns Completion after the consumer has recorded the delivery outcome.
   */
  reportDelivery?(report: ChannelDeliveryReportV1, signal?: AbortSignal): Promise<void>
}

/** Communication-plane provider registered into `ctx.channels`. */
export interface ChannelProviderV1 {
  /** Unique identity of the active provider. */
  readonly id: ChannelProviderId
  /**
   * Execute one capability-checked native channel action.
   * @param action - Discriminated outbound operation.
   * @param signal - Optional cancellation forwarded to platform delivery.
   * @returns Durable delivery state for this action.
   */
  action(action: ChannelActionV1, signal?: AbortSignal): Promise<ChannelActionResultV1>
  /**
   * Read current provider, Gateway, and account health.
   * @param signal - Optional cancellation for an active Gateway probe.
   * @returns A sanitized health snapshot.
   */
  health(signal?: AbortSignal): Promise<ChannelHealthV1>
}
