/** Canonical construction and durable-boundary validation for Activity records. */

import type {
  ClawdshActivityCategory,
  ClawdshActivityKind,
  ClawdshActivityMetadata,
  ClawdshActivityProducer,
  ClawdshActivityRecord,
  ClawdshActivityStatus,
} from './types.ts'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/

const CATEGORIES: Readonly<Record<ClawdshActivityKind, ClawdshActivityCategory>> = {
  'prompt.contribution': 'prompt',
  'memory.search': 'memory',
  'memory.read': 'memory',
  'memory.write': 'memory',
  'memory.update': 'memory',
  'memory.flush': 'memory',
  'channel.received': 'channel',
  'channel.delivery': 'channel',
  'skill.catalog': 'skill',
  'skill.loaded': 'skill',
  'skill.invoked': 'skill',
  'automation.run': 'automation',
}

const SUMMARIES: Readonly<Record<ClawdshActivityKind, string>> = {
  'prompt.contribution': 'ClawDSH Prompt contribution recorded',
  'memory.search': 'Memory search activity recorded',
  'memory.read': 'Memory read activity recorded',
  'memory.write': 'Memory write activity recorded',
  'memory.update': 'Memory update activity recorded',
  'memory.flush': 'Memory flush activity recorded',
  'channel.received': 'Channel message received',
  'channel.delivery': 'Channel delivery state recorded',
  'skill.catalog': 'Skill catalog activity recorded',
  'skill.loaded': 'Skill load activity recorded',
  'skill.invoked': 'Skill invocation activity recorded',
  'automation.run': 'Automation run activity recorded',
}

interface RecordEnvelope {
  readonly id: string
  readonly timestamp: string
  readonly sessionId: string
}

/**
 * Construct one record whose summary and category are package-owned.
 * @param envelope - Generated identity, creation time, and owning Session.
 * @param kind - One fixed semantic Activity kind.
 * @param metadata - Kind-specific fields selected by a typed service method.
 * @param status - Optional sanitized lifecycle state.
 * @returns the canonical in-memory record for durable-boundary validation.
 */
export function createActivityRecord(
  envelope: RecordEnvelope,
  kind: ClawdshActivityKind,
  metadata: ClawdshActivityMetadata,
  status?: ClawdshActivityStatus,
): ClawdshActivityRecord {
  return {
    version: 1,
    ...envelope,
    category: CATEGORIES[kind],
    kind,
    ...(status === undefined ? {} : { status }),
    summary: SUMMARIES[kind],
    metadata,
  }
}

/**
 * Validate one JSON-decoded record against its requested Session and fixed producer file.
 * @param value - Untrusted JSON value read from a sidecar line.
 * @param sessionId - Session selected by the caller, never a value trusted from disk.
 * @param producer - Producer implied by the fixed sidecar basename.
 * @returns a detached canonical record, or `undefined` for an invalid line.
 */
export function decodeActivityRecord(
  value: unknown,
  sessionId: string,
  producer: ClawdshActivityProducer,
): ClawdshActivityRecord | undefined {
  if (!isPlainRecord(value)) return undefined
  const hasStatus = Object.hasOwn(value, 'status')
  if (!hasExactKeys(value, hasStatus
    ? ['version', 'id', 'timestamp', 'sessionId', 'category', 'kind', 'status', 'summary', 'metadata']
    : ['version', 'id', 'timestamp', 'sessionId', 'category', 'kind', 'summary', 'metadata'])) return undefined
  if (value.version !== 1 || typeof value.id !== 'string' || !UUID_PATTERN.test(value.id)) return undefined
  if (typeof value.timestamp !== 'string' || !isCanonicalTimestamp(value.timestamp)) return undefined
  if (value.sessionId !== sessionId || !isActivityKind(value.kind)) return undefined
  const category = CATEGORIES[value.kind]
  if (value.category !== category || value.summary !== SUMMARIES[value.kind]) return undefined
  const status = value.status
  if (status !== undefined && !isActivityStatus(status)) return undefined
  if (!isPlainRecord(value.metadata)) return undefined
  if (!validateKind(value.kind, status, value.metadata, producer)) return undefined
  return Object.freeze({
    version: 1,
    id: value.id,
    timestamp: value.timestamp,
    sessionId,
    category,
    kind: value.kind,
    ...(status === undefined ? {} : { status }),
    summary: value.summary,
    metadata: Object.freeze({ ...value.metadata }) as ClawdshActivityMetadata,
  })
}

function validateKind(
  kind: ClawdshActivityKind,
  status: unknown,
  metadata: Record<string, unknown>,
  producer: ClawdshActivityProducer,
): boolean {
  switch (kind) {
    case 'prompt.contribution':
      return (producer === 'soul' || producer === 'memory')
        && status === 'succeeded'
        && validatePromptMetadata(metadata, producer)
    case 'memory.search':
    case 'memory.read':
    case 'memory.flush':
      return producer === 'memory' && isWorkStatus(status) && validateSeqMetadata(metadata)
    case 'memory.write':
      return producer === 'memory' && validateMemoryWrite(status, metadata)
    case 'memory.update':
      return producer === 'memory' && validateMemoryUpdate(status, metadata)
    case 'channel.received':
      return producer === 'channels' && status === undefined && validateChannelMetadata(metadata)
    case 'channel.delivery':
      return producer === 'channels'
        && (status === undefined || status === 'started' || status === 'failed' || status === 'sent')
        && validateChannelMetadata(metadata)
    case 'skill.catalog':
      return producer === 'skills'
        && status === 'succeeded'
        && hasExactKeys(metadata, ['count', 'seq'])
        && isNonNegativeSafeInteger(metadata.count)
        && isNonNegativeSafeInteger(metadata.seq)
    case 'skill.loaded':
      return producer === 'skills'
        && status === 'succeeded'
        && validateNamedMetadata(metadata, 'skill')
    case 'skill.invoked':
      return producer === 'skills'
        && isWorkStatus(status)
        && validateNamedMetadata(metadata, 'skill')
    case 'automation.run':
      return producer === 'automation'
        && isWorkStatus(status)
        && hasExactKeys(metadata, ['ruleId', 'scheduledAt', 'seq'])
        && isSafeLabel(metadata.ruleId)
        && typeof metadata.scheduledAt === 'string'
        && isCanonicalTimestamp(metadata.scheduledAt)
        && isNonNegativeSafeInteger(metadata.seq)
    default:
      return false
  }
}

function validateMemoryWrite(status: unknown, metadata: Record<string, unknown>): boolean {
  const hasOutcome = Object.hasOwn(metadata, 'outcome')
  if (!isWorkStatus(status)
    || !hasExactKeys(metadata, hasOutcome ? ['scope', 'seq', 'outcome'] : ['scope', 'seq'])
    || (metadata.scope !== 'durable' && metadata.scope !== 'daily')
    || !isNonNegativeSafeInteger(metadata.seq)) return false
  if (!hasOutcome) return true
  return status === 'succeeded'
    && (metadata.outcome === 'stored'
      || (metadata.outcome === 'already-stored' && metadata.scope === 'durable'))
}

function validateMemoryUpdate(status: unknown, metadata: Record<string, unknown>): boolean {
  const hasOutcome = Object.hasOwn(metadata, 'outcome')
  if (!isWorkStatus(status)
    || !hasExactKeys(metadata, hasOutcome ? ['action', 'seq', 'outcome'] : ['action', 'seq'])
    || (metadata.action !== 'updated' && metadata.action !== 'forgotten')
    || !isNonNegativeSafeInteger(metadata.seq)) return false
  if (!hasOutcome) return true
  if (status !== 'succeeded') return false
  switch (metadata.outcome) {
    case 'updated':
    case 'already-current':
      return metadata.action === 'updated'
    case 'forgotten':
      return metadata.action === 'forgotten'
    case 'not-found':
      return true
    default:
      return false
  }
}

function validatePromptMetadata(metadata: Record<string, unknown>, producer: 'soul' | 'memory'): boolean {
  if (!hasExactKeys(metadata, ['producer', 'section', 'mode', 'characters', 'sha256', 'seq'])) return false
  if (metadata.producer !== producer
    || !isNonNegativeSafeInteger(metadata.characters)
    || typeof metadata.sha256 !== 'string'
    || !SHA256_PATTERN.test(metadata.sha256)
    || !isNonNegativeSafeInteger(metadata.seq)) return false
  if (producer === 'soul') {
    return (metadata.section === 'persona' && metadata.mode === 'replace')
      || (metadata.section === 'clawdsh:soul' && metadata.mode === 'append')
  }
  return metadata.section === 'clawdsh:memory-recall' && metadata.mode === 'append'
}

function validateChannelMetadata(metadata: Record<string, unknown>): boolean {
  return hasExactKeys(metadata, ['adapter', 'conversation', 'mention', 'seq'])
    && isSafeLabel(metadata.adapter)
    && (metadata.conversation === 'direct' || metadata.conversation === 'group')
    && (typeof metadata.mention === 'boolean' || metadata.mention === null)
    && isNonNegativeSafeInteger(metadata.seq)
}

function validateNamedMetadata(metadata: Record<string, unknown>, key: 'skill'): boolean {
  return hasExactKeys(metadata, [key, 'seq'])
    && isSafeLabel(metadata[key])
    && isNonNegativeSafeInteger(metadata.seq)
}

function validateSeqMetadata(metadata: Record<string, unknown>): boolean {
  return hasExactKeys(metadata, ['seq']) && isNonNegativeSafeInteger(metadata.seq)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

function isActivityKind(value: unknown): value is ClawdshActivityKind {
  return typeof value === 'string' && Object.hasOwn(CATEGORIES, value)
}

function isActivityStatus(value: unknown): value is ClawdshActivityStatus {
  return value === 'started' || value === 'succeeded' || value === 'failed' || value === 'sent'
}

function isWorkStatus(value: unknown): value is 'started' | 'succeeded' | 'failed' {
  return value === 'started' || value === 'succeeded' || value === 'failed'
}

function isCanonicalTimestamp(value: string): boolean {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isSafeLabel(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value === value.trim()
    && !CONTROL_PATTERN.test(value)
    && Buffer.byteLength(value, 'utf8') <= 256
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
