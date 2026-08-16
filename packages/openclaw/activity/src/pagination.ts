/** Merge, deduplication, filtering, ordering, and opaque cursor pagination for Activity. */

import { createHash } from 'node:crypto'
import { TextDecoder } from 'node:util'
import { projectSessionHistory } from './projector.ts'
import { sessionDigest } from './storage.ts'
import type {
  ClawdshActivityCategory,
  ClawdshActivityHistoryAvailability,
  ClawdshActivityHistorySources,
  ClawdshActivityOrder,
  ClawdshActivityPage,
  ClawdshActivityPageRequest,
  ClawdshActivityReadResult,
  ClawdshActivityRecord,
  ClawdshActivityWarning,
} from './types.ts'

/** Default number of records returned by one Activity page. */
export const DEFAULT_ACTIVITY_PAGE_LIMIT = 50
/** Maximum number of records accepted by one Activity page request. */
export const MAX_ACTIVITY_PAGE_LIMIT = 100
/** Closed product-facing category order used for filter canonicalization. */
export const ACTIVITY_CATEGORIES = Object.freeze([
  'prompt',
  'memory',
  'channel',
  'skill',
  'automation',
] as const satisfies readonly ClawdshActivityCategory[])

/** Stable local-query failure codes suitable for RPC mapping. */
export type ClawdshActivityQueryErrorCode = 'invalid-request' | 'invalid-cursor' | 'cursor-mismatch'

/** Request or cursor failure that contains no cursor payload or source diagnostic. */
export class ClawdshActivityQueryError extends Error {
  /** Stable failure class for control-plane mapping. */
  readonly code: ClawdshActivityQueryErrorCode

  /**
   * @param code - Stable failure class.
   * @param message - Sanitized correction-oriented description.
   */
  constructor(code: ClawdshActivityQueryErrorCode, message: string) {
    super(message)
    this.name = 'ClawdshActivityQueryError'
    this.code = code
  }
}

interface CursorV1 {
  readonly version: 1
  readonly session: string
  readonly categories: readonly ClawdshActivityCategory[]
  readonly order: ClawdshActivityOrder
  readonly snapshot: string
  readonly timestamp: string
  readonly id: string
}

interface MergeResult {
  readonly records: readonly ClawdshActivityRecord[]
  readonly degraded: boolean
}

const cursorDecoder = new TextDecoder('utf-8', { fatal: true })
const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/
const MAX_CURSOR_CHARS = 2048
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/

/**
 * Merge one live-or-inspected Session history with Activity sidecars and return a stable page.
 * @param request - Session, filters, order, page size, and optional continuation.
 * @param history - Live events first, then persisted inspection as fallback.
 * @param sidecars - Safe sidecar read result for the same Session.
 * @returns deduplicated records, continuation, availability, and sanitized warnings.
 * @throws {ClawdshActivityQueryError} for invalid request fields or a malformed/mismatched cursor.
 */
export function createActivityPage(
  request: ClawdshActivityPageRequest,
  history: ClawdshActivityHistorySources,
  sidecars: ClawdshActivityReadResult,
): ClawdshActivityPage {
  const sessionId = String(request.sessionId)
  const categories = canonicalCategories(request.categories)
  const order = resolveOrder(request.order)
  const limit = resolveLimit(request.limit)
  const selected = selectHistory(history)
  const projected = selected.events === undefined
    ? { records: [] as readonly ClawdshActivityRecord[], degraded: false }
    : projectSessionHistory(sessionId, selected.events)
  const merged = mergeRecords(sessionId, projected.records, sidecars.records)
  const collapsed = collapseAutomationRuns(merged.records)
  const filtered = collapsed.records
    .filter(record => categories.includes(record.category))
    .sort((left, right) => compareRecord(left, right, order))
  const snapshot = snapshotDigest(filtered)
  const cursor = request.cursor === undefined
    ? undefined
    : decodeCursor(request.cursor, sessionId, categories, order, snapshot)
  const remaining = cursor === undefined
    ? filtered
    : filtered.filter(record => compareAnchor(record, cursor, order) > 0)
  const records = remaining.slice(0, limit)
  const last = records.at(-1)
  const nextCursor = remaining.length > limit && last !== undefined
    ? encodeCursor(sessionId, categories, order, snapshot, last)
    : undefined
  const degraded = projected.degraded || sidecars.degraded || merged.degraded || collapsed.degraded
  const warnings = warningsFor(selected.availability, sidecars, degraded)
  return Object.freeze({
    records: Object.freeze(records),
    ...(nextCursor === undefined ? {} : { nextCursor }),
    availability: Object.freeze({
      history: selected.availability,
      sidecar: sidecars.availability,
    }),
    degraded,
    warnings: Object.freeze(warnings),
  })
}

function collapseAutomationRuns(records: readonly ClawdshActivityRecord[]): MergeResult {
  const collapsed: ClawdshActivityRecord[] = []
  const runs = new Map<string, number>()
  let degraded = false
  for (const record of records) {
    if (record.kind !== 'automation.run') {
      collapsed.push(record)
      continue
    }
    const key = `${record.sessionId}\u0000${String(record.metadata.ruleId)}\u0000${String(record.metadata.scheduledAt)}`
    const existingIndex = runs.get(key)
    if (existingIndex === undefined) {
      runs.set(key, collapsed.length)
      collapsed.push(record)
      continue
    }
    const existing = collapsed[existingIndex]
    if (existing === undefined) throw new Error('automation run index must reference a collapsed record')
    const existingTerminal = existing.status !== 'started'
    const candidateTerminal = record.status !== 'started'
    if (existingTerminal !== candidateTerminal) {
      if (candidateTerminal) collapsed[existingIndex] = record
      continue
    }
    degraded = true
    if (compareRecord(existing, record, 'asc') < 0) collapsed[existingIndex] = record
  }
  return { records: collapsed, degraded }
}

function selectHistory(history: ClawdshActivityHistorySources): {
  readonly availability: ClawdshActivityHistoryAvailability
  readonly events?: ClawdshActivityHistorySources['live']
} {
  if (history.live !== undefined) return { availability: 'live', events: history.live }
  if (history.inspect !== undefined) return { availability: 'inspect', events: history.inspect }
  return { availability: 'unavailable' }
}

function mergeRecords(
  sessionId: string,
  history: readonly ClawdshActivityRecord[],
  sidecars: readonly ClawdshActivityRecord[],
): MergeResult {
  const semantics = new Set<string>()
  const ids = new Map<string, string>()
  const records: ClawdshActivityRecord[] = []
  let degraded = false
  for (const record of [...history, ...sidecars]) {
    if (record.sessionId !== sessionId) {
      degraded = true
      continue
    }
    const semantic = semanticKey(record)
    if (semantics.has(semantic)) continue
    const existing = ids.get(record.id)
    if (existing !== undefined) {
      if (existing !== semantic) degraded = true
      continue
    }
    semantics.add(semantic)
    ids.set(record.id, semantic)
    records.push(record)
  }
  return { records, degraded }
}

function semanticKey(record: ClawdshActivityRecord): string {
  const metadata = Object.keys(record.metadata).sort().map(key => [key, record.metadata[key]])
  return JSON.stringify([
    record.sessionId,
    record.category,
    record.kind,
    record.status ?? null,
    metadata,
  ])
}

function canonicalCategories(
  requested: readonly ClawdshActivityCategory[] | undefined,
): readonly ClawdshActivityCategory[] {
  if (requested === undefined) return ACTIVITY_CATEGORIES
  const selected = new Set<ClawdshActivityCategory>()
  for (const category of requested) {
    if (!(ACTIVITY_CATEGORIES as readonly unknown[]).includes(category)) {
      throw new ClawdshActivityQueryError('invalid-request', 'activity categories contain an unsupported value')
    }
    selected.add(category)
  }
  return Object.freeze(ACTIVITY_CATEGORIES.filter(category => selected.has(category)))
}

function resolveOrder(value: ClawdshActivityOrder | undefined): ClawdshActivityOrder {
  return value ?? 'desc'
}

function resolveLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_ACTIVITY_PAGE_LIMIT
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_ACTIVITY_PAGE_LIMIT) {
    throw new ClawdshActivityQueryError(
      'invalid-request',
      `activity limit must be a safe integer from 1 through ${MAX_ACTIVITY_PAGE_LIMIT}`,
    )
  }
  return value
}

function compareRecord(
  left: Pick<ClawdshActivityRecord, 'timestamp' | 'id'>,
  right: Pick<ClawdshActivityRecord, 'timestamp' | 'id'>,
  order: ClawdshActivityOrder,
): number {
  const ascending = left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id)
  return order === 'asc' ? ascending : -ascending
}

function compareAnchor(
  record: Pick<ClawdshActivityRecord, 'timestamp' | 'id'>,
  cursor: Pick<CursorV1, 'timestamp' | 'id'>,
  order: ClawdshActivityOrder,
): number {
  return compareRecord(record, cursor, order)
}

function encodeCursor(
  sessionId: string,
  categories: readonly ClawdshActivityCategory[],
  order: ClawdshActivityOrder,
  snapshot: string,
  record: Pick<ClawdshActivityRecord, 'timestamp' | 'id'>,
): string {
  const payload: CursorV1 = {
    version: 1,
    session: sessionDigest(sessionId),
    categories,
    order,
    snapshot,
    timestamp: record.timestamp,
    id: record.id,
  }
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

function decodeCursor(
  token: string,
  sessionId: string,
  categories: readonly ClawdshActivityCategory[],
  order: ClawdshActivityOrder,
  snapshot: string,
): CursorV1 {
  if (token.length === 0 || token.length > MAX_CURSOR_CHARS || !CURSOR_PATTERN.test(token)) {
    throw new ClawdshActivityQueryError('invalid-cursor', 'activity cursor is malformed')
  }
  let bytes: Buffer
  let value: unknown
  try {
    bytes = Buffer.from(token, 'base64url')
    if (bytes.toString('base64url') !== token) throw new Error('non-canonical base64url')
    value = JSON.parse(cursorDecoder.decode(bytes))
  } catch {
    throw new ClawdshActivityQueryError('invalid-cursor', 'activity cursor is malformed')
  }
  const record = asRecord(value)
  if (record === undefined
    || !hasExactKeys(record, ['version', 'session', 'categories', 'order', 'snapshot', 'timestamp', 'id'])
    || record.version !== 1
    || typeof record.session !== 'string'
    || !Array.isArray(record.categories)
    || !record.categories.every(isActivityCategory)
    || (record.order !== 'asc' && record.order !== 'desc')
    || typeof record.snapshot !== 'string'
    || !/^[a-f0-9]{64}$/.test(record.snapshot)
    || typeof record.timestamp !== 'string'
    || !isCanonicalTimestamp(record.timestamp)
    || !isCursorId(record.id)) {
    throw new ClawdshActivityQueryError('invalid-cursor', 'activity cursor is malformed')
  }
  const cursorCategories = canonicalCategories(record.categories)
  if (record.session !== sessionDigest(sessionId)
    || record.order !== order
    || !equalCategories(cursorCategories, categories)
    || record.snapshot !== snapshot) {
    throw new ClawdshActivityQueryError(
      'cursor-mismatch',
      'activity cursor does not match this Session, filter, order, or result snapshot',
    )
  }
  return {
    version: 1,
    session: record.session,
    categories: cursorCategories,
    order: record.order,
    snapshot: record.snapshot,
    timestamp: record.timestamp,
    id: record.id,
  }
}

function snapshotDigest(records: readonly ClawdshActivityRecord[]): string {
  const hash = createHash('sha256')
  for (const record of records) {
    const metadata = Object.keys(record.metadata).sort().map(key => [key, record.metadata[key]])
    hash.update(JSON.stringify([
      record.version,
      record.id,
      record.timestamp,
      record.sessionId,
      record.category,
      record.kind,
      record.status ?? null,
      record.summary,
      metadata,
    ]))
    hash.update('\n')
  }
  return hash.digest('hex')
}

function warningsFor(
  history: ClawdshActivityHistoryAvailability,
  sidecars: ClawdshActivityReadResult,
  degraded: boolean,
): ClawdshActivityWarning[] {
  const warnings: ClawdshActivityWarning[] = []
  if (history === 'unavailable') warnings.push('activity-history-unavailable')
  if (sidecars.availability === 'missing') warnings.push('activity-sidecar-missing')
  if (degraded) warnings.push('activity-data-incomplete')
  return warnings
}

function equalCategories(
  left: readonly ClawdshActivityCategory[],
  right: readonly ClawdshActivityCategory[],
): boolean {
  return left.length === right.length && left.every((category, index) => category === right[index])
}

function isActivityCategory(value: unknown): value is ClawdshActivityCategory {
  return typeof value === 'string' && (ACTIVITY_CATEGORIES as readonly string[]).includes(value)
}

function isCanonicalTimestamp(value: string): boolean {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function isCursorId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 128
    && !CONTROL_PATTERN.test(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}
