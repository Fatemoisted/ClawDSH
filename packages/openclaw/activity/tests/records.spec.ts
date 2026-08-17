import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  createActivityRecord,
  decodeActivityRecord,
  isCanonicalTimestamp,
  isNonNegativeSafeInteger,
  isSafeLabel,
} from '../src/records.ts'
import type {
  ClawdshActivityKind,
  ClawdshActivityMetadata,
  ClawdshActivityProducer,
  ClawdshActivityRecord,
  ClawdshActivityStatus,
} from '../src/types.ts'

const sessionId = 'record-session'
const timestamp = '2026-08-16T00:00:00.000Z'

function record(
  kind: ClawdshActivityKind,
  metadata: ClawdshActivityMetadata,
  status?: ClawdshActivityStatus,
): ClawdshActivityRecord {
  return createActivityRecord({ id: randomUUID(), timestamp, sessionId }, kind, metadata, status)
}

function decode(
  value: unknown,
  producer: ClawdshActivityProducer,
  requestedSession = sessionId,
): ClawdshActivityRecord | undefined {
  return decodeActivityRecord(value, requestedSession, producer)
}

describe('Activity record boundary', () => {
  it('accepts every producer-owned kind and every supported terminal outcome', () => {
    const cases: Array<[ClawdshActivityProducer, ClawdshActivityRecord]> = [
      ['soul', record('prompt.contribution', {
        producer: 'soul', section: 'persona', mode: 'replace', characters: 0, sha256: 'a'.repeat(64), seq: 0,
      }, 'succeeded')],
      ['soul', record('prompt.contribution', {
        producer: 'soul', section: 'clawdsh:soul', mode: 'append', characters: 1, sha256: 'b'.repeat(64), seq: 1,
      }, 'succeeded')],
      ['memory', record('prompt.contribution', {
        producer: 'memory', section: 'clawdsh:memory-recall', mode: 'append', characters: 2, sha256: 'c'.repeat(64), seq: 2,
      }, 'succeeded')],
      ['memory', record('memory.search', { seq: 3 }, 'started')],
      ['memory', record('memory.read', { seq: 4 }, 'succeeded')],
      ['memory', record('memory.flush', { seq: 5 }, 'failed')],
      ['memory', record('memory.write', { scope: 'daily', seq: 6 }, 'started')],
      ['memory', record('memory.write', { scope: 'daily', seq: 7, outcome: 'stored' }, 'succeeded')],
      ['memory', record('memory.write', { scope: 'durable', seq: 8, outcome: 'already-stored' }, 'succeeded')],
      ['memory', record('memory.update', { action: 'updated', seq: 9 }, 'started')],
      ['memory', record('memory.update', { action: 'updated', seq: 10, outcome: 'updated' }, 'succeeded')],
      ['memory', record('memory.update', { action: 'updated', seq: 11, outcome: 'already-current' }, 'succeeded')],
      ['memory', record('memory.update', { action: 'forgotten', seq: 12, outcome: 'forgotten' }, 'succeeded')],
      ['memory', record('memory.update', { action: 'forgotten', seq: 13, outcome: 'not-found' }, 'succeeded')],
      ['channels', record('channel.received', { adapter: 'feishu', conversation: 'direct', mention: null, seq: 14 })],
      ['channels', record('channel.delivery', { adapter: 'feishu', conversation: 'group', mention: true, seq: 15 })],
      ['channels', record('channel.delivery', { adapter: 'feishu', conversation: 'group', mention: false, seq: 16 }, 'started')],
      ['channels', record('channel.delivery', { adapter: 'feishu', conversation: 'group', mention: false, seq: 17 }, 'failed')],
      ['channels', record('channel.delivery', { adapter: 'feishu', conversation: 'group', mention: false, seq: 18 }, 'sent')],
      ['skills', record('skill.catalog', { count: 0, seq: 19 }, 'succeeded')],
      ['skills', record('skill.loaded', { skill: 'calendar', seq: 20 }, 'succeeded')],
      ['skills', record('skill.invoked', { skill: 'calendar', seq: 21 }, 'started')],
      ['automation', record('automation.run', { ruleId: 'daily', scheduledAt: timestamp, seq: 22 }, 'failed')],
    ]

    for (const [producer, candidate] of cases) {
      const decoded = decode(candidate, producer)
      expect(decoded).toEqual(candidate)
      expect(Object.isFrozen(decoded)).toBe(true)
      expect(Object.isFrozen(decoded?.metadata)).toBe(true)
    }
  })

  it('rejects malformed envelopes before trusting kind metadata', () => {
    const valid = record('channel.received', {
      adapter: 'feishu', conversation: 'direct', mention: null, seq: 1,
    })
    const invalid: unknown[] = [
      null,
      [],
      'record',
      { ...valid, extra: true },
      { ...valid, version: 2 },
      { ...valid, id: 7 },
      { ...valid, id: 'not-a-uuid' },
      { ...valid, timestamp: 1 },
      { ...valid, timestamp: '2026-08-16T00:00:00Z' },
      { ...valid, sessionId: 'another-session' },
      { ...valid, kind: 'unknown' },
      { ...valid, category: 'memory' },
      { ...valid, summary: 'caller controlled' },
      { ...valid, status: 'unknown' },
      { ...valid, metadata: [] },
    ]

    for (const candidate of invalid) expect(decode(candidate, 'channels')).toBeUndefined()

    const withoutStatus = { ...valid } as Record<string, unknown>
    delete withoutStatus.status
    expect(decode(withoutStatus, 'channels')).toEqual(valid)
    const nullPrototype = Object.assign(Object.create(null) as object, valid)
    expect(decode(nullPrototype, 'channels')).toEqual(valid)
  })

  it('rejects producer mismatches and malformed metadata for every kind', () => {
    const cases: Array<[ClawdshActivityProducer, ClawdshActivityRecord]> = [
      ['channels', record('prompt.contribution', {
        producer: 'soul', section: 'persona', mode: 'replace', characters: 1, sha256: 'a'.repeat(64), seq: 1,
      }, 'succeeded')],
      ['soul', record('prompt.contribution', {
        producer: 'memory', section: 'clawdsh:memory-recall', mode: 'append', characters: 1, sha256: 'a'.repeat(64), seq: 1,
      }, 'succeeded')],
      ['memory', record('memory.search', { seq: -1 }, 'started')],
      ['channels', record('memory.read', { seq: 1 }, 'started')],
      ['memory', record('memory.flush', { seq: 1, extra: 1 }, 'started')],
      ['memory', record('memory.write', { scope: 'other', seq: 1 }, 'started')],
      ['memory', record('memory.write', { scope: 'daily', seq: -1 }, 'started')],
      ['memory', record('memory.write', { scope: 'daily', seq: 1, outcome: 'stored' }, 'failed')],
      ['memory', record('memory.write', { scope: 'daily', seq: 1, outcome: 'already-stored' }, 'succeeded')],
      ['memory', record('memory.write', { scope: 'daily', seq: 1, outcome: 'other' }, 'succeeded')],
      ['memory', record('memory.update', { action: 'other', seq: 1 }, 'started')],
      ['memory', record('memory.update', { action: 'updated', seq: -1 }, 'started')],
      ['memory', record('memory.update', { action: 'updated', seq: 1, outcome: 'updated' }, 'failed')],
      ['memory', record('memory.update', { action: 'forgotten', seq: 1, outcome: 'updated' }, 'succeeded')],
      ['memory', record('memory.update', { action: 'updated', seq: 1, outcome: 'forgotten' }, 'succeeded')],
      ['memory', record('memory.update', { action: 'updated', seq: 1, outcome: 'other' }, 'succeeded')],
      ['memory', record('channel.received', { adapter: 'feishu', conversation: 'direct', mention: null, seq: 1 })],
      ['channels', record('channel.received', { adapter: '', conversation: 'direct', mention: null, seq: 1 })],
      ['channels', record('channel.received', { adapter: 'feishu', conversation: 'other', mention: null, seq: 1 })],
      ['channels', record('channel.received', { adapter: 'feishu', conversation: 'direct', mention: 'yes', seq: 1 })],
      ['channels', record('channel.received', { adapter: 'feishu', conversation: 'direct', mention: null, seq: -1 })],
      ['channels', record('channel.delivery', { adapter: 'feishu', conversation: 'direct', mention: null, seq: 1 }, 'succeeded')],
      ['channels', record('skill.catalog', { count: -1, seq: 1 }, 'succeeded')],
      ['skills', record('skill.catalog', { count: 1, seq: -1 }, 'succeeded')],
      ['skills', record('skill.loaded', { skill: '', seq: 1 }, 'succeeded')],
      ['skills', record('skill.invoked', { skill: 'calendar', seq: 1 }, 'sent')],
      ['skills', record('automation.run', { ruleId: '', scheduledAt: timestamp, seq: 1 }, 'started')],
      ['automation', record('automation.run', { ruleId: 'daily', scheduledAt: 'bad', seq: 1 }, 'started')],
      ['automation', record('automation.run', { ruleId: 'daily', scheduledAt: timestamp, seq: -1 }, 'started')],
    ]

    for (const [producer, candidate] of cases) expect(decode(candidate, producer)).toBeUndefined()
  })

  it('rejects every prompt metadata failure independently', () => {
    const base = {
      producer: 'soul' as const,
      section: 'persona' as const,
      mode: 'replace' as const,
      characters: 1,
      sha256: 'a'.repeat(64),
      seq: 1,
    }
    const invalid = [
      { ...base, extra: true },
      { ...base, producer: 'memory' },
      { ...base, characters: -1 },
      { ...base, sha256: 1 },
      { ...base, sha256: 'A'.repeat(64) },
      { ...base, seq: -1 },
      { ...base, section: 'persona', mode: 'append' },
      { ...base, section: 'clawdsh:soul', mode: 'replace' },
    ]
    for (const metadata of invalid) {
      expect(decode(record('prompt.contribution', metadata as never, 'succeeded'), 'soul')).toBeUndefined()
    }
    expect(decode(record('prompt.contribution', base, 'started'), 'soul')).toBeUndefined()
  })

})

describe('Activity scalar validation', () => {
  it('accepts only canonical timestamps, safe counters, and bounded labels', () => {
    expect(isCanonicalTimestamp(timestamp)).toBe(true)
    expect(isCanonicalTimestamp('not-a-time')).toBe(false)
    expect(isCanonicalTimestamp('2026-08-16T00:00:00Z')).toBe(false)

    expect(isNonNegativeSafeInteger(0)).toBe(true)
    for (const value of ['0', 0.5, -1, Number.MAX_SAFE_INTEGER + 1]) {
      expect(isNonNegativeSafeInteger(value)).toBe(false)
    }

    expect(isSafeLabel('calendar')).toBe(true)
    for (const value of [1, '', ' padded ', 'line\nbreak', 'é'.repeat(129)]) {
      expect(isSafeLabel(value)).toBe(false)
    }
  })
})
