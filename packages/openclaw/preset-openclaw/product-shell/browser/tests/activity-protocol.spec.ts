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
})
