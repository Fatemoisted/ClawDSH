/** Pure projection from privacy-safe Activity records to user-facing timeline items. */

import type { ClawdshActivityRecord } from '../../../shared/src/protocol.ts'

/** One context-preparation item assembled from Prompt contributions at the same Session sequence. */
export interface ActivityContextItem {
  readonly type: 'context'
  readonly id: string
  readonly timestamp: string
  readonly seq: number
  readonly records: readonly ClawdshActivityRecord[]
}

/** One user-facing item backed by an individual semantic record. */
export interface ActivityRecordItem {
  readonly type: 'record'
  readonly id: string
  readonly record: ClawdshActivityRecord
}

/** Closed item vocabulary rendered by the Activity timeline. */
export type ActivityPresentationItem = ActivityContextItem | ActivityRecordItem

/** Presentation result with a failure count for the prominent page summary. */
export interface ActivityPresentation {
  readonly items: readonly ActivityPresentationItem[]
  readonly failures: number
}

interface MutableContextItem {
  readonly type: 'context'
  readonly id: string
  readonly timestamp: string
  readonly seq: number
  readonly records: ClawdshActivityRecord[]
}

/**
 * Combine Prompt contributions that prepared the same request while preserving record order.
 * @param records - Strict, privacy-safe Activity records in display order.
 * @returns User-facing items and the number of failed operations.
 */
export function presentActivity(records: readonly ClawdshActivityRecord[]): ActivityPresentation {
  const items: Array<MutableContextItem | ActivityRecordItem> = []
  const contexts = new Map<string, MutableContextItem>()
  for (const record of records) {
    if (record.kind !== 'prompt.contribution') {
      items.push({ type: 'record', id: record.id, record })
      continue
    }
    const seq = record.metadata.seq
    if (typeof seq !== 'number') {
      items.push({ type: 'record', id: record.id, record })
      continue
    }
    const key = `${record.sessionId}\u0000${String(seq)}`
    const existing = contexts.get(key)
    if (existing !== undefined) {
      existing.records.push(record)
      continue
    }
    const context: MutableContextItem = {
      type: 'context',
      id: `context:${record.sessionId}:${String(seq)}`,
      timestamp: record.timestamp,
      seq,
      records: [record],
    }
    contexts.set(key, context)
    items.push(context)
  }
  return Object.freeze({
    items: Object.freeze(items.map(item => item.type === 'record'
      ? Object.freeze(item)
      : Object.freeze({ ...item, records: Object.freeze(item.records) }))),
    failures: items.filter(item => item.type === 'record' && item.record.status === 'failed').length,
  })
}
