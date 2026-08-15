/** Public records and typed producer inputs for ClawDSH semantic Activity. */

import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'

/** Activity categories exposed by the product UI and local control API. */
export type ClawdshActivityCategory = 'prompt' | 'memory' | 'channel' | 'skill' | 'automation'

/** Stable Activity record kinds. */
export type ClawdshActivityKind =
  | 'prompt.contribution'
  | 'memory.search'
  | 'memory.read'
  | 'memory.flush'
  | 'channel.received'
  | 'channel.delivery'
  | 'skill.catalog'
  | 'skill.loaded'
  | 'skill.invoked'
  | 'automation.run'

/** Optional lifecycle state carried by an Activity record. */
export type ClawdshActivityStatus = 'started' | 'succeeded' | 'failed' | 'sent'

/** Sidecar producer, and therefore the fixed JSONL basename, for one record. */
export type ClawdshActivityProducer = 'soul' | 'memory' | 'channels' | 'skills' | 'automation'

/** Primitive-only metadata accepted by the public Activity record. */
export type ClawdshActivityMetadata = Record<string, string | number | boolean | null>

/** One sanitized semantic Activity record. */
export interface ClawdshActivityRecord {
  /** Durable record format version. */
  readonly version: 1
  /** Process-generated opaque record identity. */
  readonly id: string
  /** UTC ISO-8601 creation time. */
  readonly timestamp: string
  /** Session whose activity produced the record. */
  readonly sessionId: string
  /** Product-facing semantic category. */
  readonly category: ClawdshActivityCategory
  /** Stable semantic event kind. */
  readonly kind: ClawdshActivityKind
  /** Optional lifecycle state when the source can establish one. */
  readonly status?: ClawdshActivityStatus
  /** Package-generated summary containing no producer-supplied prose. */
  readonly summary: string
  /** Kind-specific primitive fields selected by this package. */
  readonly metadata: ClawdshActivityMetadata
}

/** Sanitized outcome of a best-effort Activity append. */
export interface ClawdshActivityWriteResult {
  /** Whether the record reached its active sidecar file. */
  readonly written: boolean
  /** Whether Activity completeness is degraded for this process and session. */
  readonly degraded: boolean
}

/** Sidecar availability without physical locations or filesystem diagnostics. */
export type ClawdshActivityAvailability = 'available' | 'missing' | 'unavailable'

/** Safe read result returned to history projectors and control-plane callers. */
export interface ClawdshActivityReadResult {
  /** Parsed, canonical records in timestamp/id order. */
  readonly records: readonly ClawdshActivityRecord[]
  /** Whether any sidecar file was readable, absent, or wholly unavailable. */
  readonly availability: ClawdshActivityAvailability
  /** True when a write failed or a file contained unreadable or invalid data. */
  readonly degraded: boolean
  /** Stable warning suitable for UI projection; never a filesystem error. */
  readonly warning?: 'activity-data-incomplete'
}

/** Query for package-owned sidecars of one Session. */
export interface ClawdshActivityReadRequest {
  /** Session whose sidecars are read. */
  readonly sessionId: SessionId
  /** Optional producer subset; omitted reads all five fixed files. */
  readonly producers?: readonly ClawdshActivityProducer[]
}

/** Result of projecting privacy-safe facts from one standard Session history. */
export interface ClawdshActivityHistoryProjection {
  /** Canonical records derived without retaining message, argument, result, or error content. */
  readonly records: readonly ClawdshActivityRecord[]
  /** Whether a recognized event was malformed and therefore omitted. */
  readonly degraded: boolean
}

/** Live and persisted history candidates; a defined live log takes precedence over inspection. */
export interface ClawdshActivityHistorySources {
  /** Current in-memory Session events, when the Session is live. */
  readonly live?: readonly SessionEvent[]
  /** Validated `sessionPersistence.inspect()` events when no live Session is available. */
  readonly inspect?: readonly SessionEvent[]
}

/** History source selected for one Activity page. */
export type ClawdshActivityHistoryAvailability = 'live' | 'inspect' | 'unavailable'

/** Stable Activity ordering modes. */
export type ClawdshActivityOrder = 'asc' | 'desc'

/** Public page request; Session history is supplied separately by the trusted Host caller. */
export interface ClawdshActivityPageRequest {
  /** Session whose history and sidecars are merged. */
  readonly sessionId: SessionId
  /** Optional semantic category filter; omitted includes all categories. */
  readonly categories?: readonly ClawdshActivityCategory[]
  /** Timestamp/id ordering; defaults to newest first. */
  readonly order?: ClawdshActivityOrder
  /** Page size from 1 through 100; defaults to 50. */
  readonly limit?: number
  /** Opaque versioned continuation from an earlier equal query. */
  readonly cursor?: string
}

/** Sanitized availability of the two inputs merged into one page. */
export interface ClawdshActivityPageAvailability {
  readonly history: ClawdshActivityHistoryAvailability
  readonly sidecar: ClawdshActivityAvailability
}

/** Stable warnings a product UI may render without exposing source errors. */
export type ClawdshActivityWarning =
  | 'activity-data-incomplete'
  | 'activity-history-unavailable'
  | 'activity-sidecar-missing'

/** One merged, filtered, cursor-paginated Activity response. */
export interface ClawdshActivityPage {
  /** Records in the requested stable order. */
  readonly records: readonly ClawdshActivityRecord[]
  /** Continuation when more matching records follow this page. */
  readonly nextCursor?: string
  /** Selected history and sidecar availability. */
  readonly availability: ClawdshActivityPageAvailability
  /** True only for malformed or failed data, not expected source absence. */
  readonly degraded: boolean
  /** Deduplicated stable warnings suitable for direct UI mapping. */
  readonly warnings: readonly ClawdshActivityWarning[]
}

/** Prompt sections whose contributions can be recorded without arbitrary labels. */
export type ClawdshPromptSection = 'persona' | 'clawdsh:soul' | 'clawdsh:memory-recall'

/** Typed input for an actual ClawDSH prompt contribution. */
export interface PromptContributionActivity {
  readonly sessionId: SessionId
  readonly producer: 'soul' | 'memory'
  readonly section: ClawdshPromptSection
  readonly mode: 'append' | 'replace'
  readonly characters: number
  readonly sha256: string
  readonly seq: number
}

/** Typed input shared by Memory search, read, and flush records. */
export interface MemoryActivity {
  readonly sessionId: SessionId
  readonly status: 'started' | 'succeeded' | 'failed'
  readonly seq: number
}

/** Typed input for a sanitized inbound channel record. */
export interface ChannelReceivedActivity {
  readonly sessionId: SessionId
  readonly adapter: string
  readonly conversation: 'direct' | 'group'
  readonly mention: boolean | null
  readonly seq: number
}

/** Typed input for one newly committed channel delivery state. */
export interface ChannelDeliveryActivity extends ChannelReceivedActivity {
  readonly status?: 'started' | 'failed' | 'sent'
}

/** Typed input for a skill catalog projection. */
export interface SkillCatalogActivity {
  readonly sessionId: SessionId
  readonly count: number
  readonly seq: number
}

/** Typed input for one selected skill. */
export interface SkillLoadedActivity {
  readonly sessionId: SessionId
  readonly skill: string
  readonly seq: number
}

/** Typed input for one skill invocation lifecycle state. */
export interface SkillInvokedActivity extends SkillLoadedActivity {
  readonly status: 'started' | 'succeeded' | 'failed'
}

/** Typed input for one automation run lifecycle state. */
export interface AutomationRunActivity {
  readonly sessionId: SessionId
  readonly ruleId: string
  readonly scheduledAt: string
  readonly status: 'started' | 'succeeded' | 'failed'
  readonly seq: number
}
