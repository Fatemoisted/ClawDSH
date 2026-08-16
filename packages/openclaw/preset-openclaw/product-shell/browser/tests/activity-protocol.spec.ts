import { describe, expect, it } from 'vitest'
import {
  parseClawdshActivityListRequest,
  parseClawdshActivityListResponse,
} from '../../shared/src/protocol.ts'
import { ACTIVITY_FIXTURE } from './fixtures.ts'

describe('ClawDSH Activity protocol', () => {
  it('accepts only the closed v1 query fields and values', () => {
    const request = {
      version: 1,
      sessionId: 'session-one',
      categories: ['prompt', 'memory'],
      order: 'desc',
      limit: 50,
      cursor: 'eyJ2ZXJzaW9uIjoxfQ',
    }
    expect(parseClawdshActivityListRequest(request)).toBe(request)
    expect(() => parseClawdshActivityListRequest({ ...request, extra: true })).toThrow('unknown field')
    expect(() => parseClawdshActivityListRequest({ ...request, categories: ['memory', 'memory'] }))
      .toThrow('duplicates')
    expect(() => parseClawdshActivityListRequest({ ...request, limit: 101 })).toThrow('1 through 100')
    expect(() => parseClawdshActivityListRequest({ ...request, cursor: 'not+base64' })).toThrow('base64url')
  })

  it('accepts the canonical page and rejects inconsistent privacy projections', () => {
    expect(parseClawdshActivityListResponse(ACTIVITY_FIXTURE)).toBe(ACTIVITY_FIXTURE)
    expect(() => parseClawdshActivityListResponse({
      ...ACTIVITY_FIXTURE,
      warnings: [],
    })).toThrow('do not match')
    expect(() => parseClawdshActivityListResponse({
      ...ACTIVITY_FIXTURE,
      records: [{
        ...ACTIVITY_FIXTURE.records[0],
        category: 'memory',
      }],
    })).toThrow('category')
    expect(() => parseClawdshActivityListResponse({
      ...ACTIVITY_FIXTURE,
      records: [{
        ...ACTIVITY_FIXTURE.records[0],
        summary: 'arbitrary producer prose',
      }],
    })).toThrow('summary')
  })

  it('accepts legacy Memory write records and a privacy-safe write outcome', () => {
    const record = {
      version: 1 as const,
      id: 'history:memory-write',
      timestamp: '2026-08-16T00:00:00.000Z',
      sessionId: 'session-one',
      category: 'memory' as const,
      kind: 'memory.write' as const,
      status: 'succeeded' as const,
      summary: 'Memory write activity recorded',
      metadata: { scope: 'durable', seq: 12 },
    }
    const response = {
      ...ACTIVITY_FIXTURE,
      records: [record],
    }

    expect(parseClawdshActivityListResponse(response)).toBe(response)
    const withOutcome = {
      ...response,
      records: [{ ...record, metadata: { scope: 'durable', outcome: 'already-stored', seq: 12 } }],
    }
    expect(parseClawdshActivityListResponse(withOutcome)).toBe(withOutcome)
    expect(() => parseClawdshActivityListResponse({
      ...response,
      records: [{ ...record, metadata: { scope: 'private/path', seq: 12 } }],
    })).toThrow('memory write scope')
    expect(() => parseClawdshActivityListResponse({
      ...response,
      records: [{ ...record, metadata: { scope: 'daily', seq: 12, content: 'secret' } }],
    })).toThrow('unknown field')
    expect(() => parseClawdshActivityListResponse({
      ...response,
      records: [{ ...record, metadata: { scope: 'daily', outcome: 'already-stored', seq: 12 } }],
    })).toThrow('inconsistent')
  })

  it('accepts legacy Memory update records and all privacy-safe update outcomes', () => {
    const record = {
      version: 1 as const,
      id: 'history:memory-update',
      timestamp: '2026-08-16T00:00:00.000Z',
      sessionId: 'session-one',
      category: 'memory' as const,
      kind: 'memory.update' as const,
      status: 'succeeded' as const,
      summary: 'Memory update activity recorded',
      metadata: { action: 'forgotten', seq: 13 },
    }
    const response = { ...ACTIVITY_FIXTURE, records: [record] }

    expect(parseClawdshActivityListResponse(response)).toBe(response)
    for (const [action, outcome] of [
      ['updated', 'updated'],
      ['forgotten', 'forgotten'],
      ['updated', 'already-current'],
      ['forgotten', 'not-found'],
    ] as const) {
      expect(parseClawdshActivityListResponse({
        ...response,
        records: [{ ...record, metadata: { action, outcome, seq: 13 } }],
      })).toBeTruthy()
    }
    expect(() => parseClawdshActivityListResponse({
      ...response,
      records: [{ ...record, metadata: { action: 'rewritten', seq: 13 } }],
    })).toThrow('memory update action')
    expect(() => parseClawdshActivityListResponse({
      ...response,
      records: [{ ...record, metadata: { action: 'updated', seq: 13, oldContent: 'secret' } }],
    })).toThrow('unknown field')
    expect(() => parseClawdshActivityListResponse({
      ...response,
      records: [{ ...record, metadata: { action: 'forgotten', outcome: 'already-current', seq: 13 } }],
    })).toThrow('inconsistent')
  })
})
