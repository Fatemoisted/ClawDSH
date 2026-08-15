import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { createActivityPage, ClawdshActivityQueryError } from '../src/pagination.ts'
import { projectSessionHistory } from '../src/projector.ts'
import { createActivityRecord } from '../src/records.ts'
import type { ClawdshActivityReadResult, ClawdshActivityRecord } from '../src/types.ts'

function event(type: string, seq: number, data: unknown, time = 1_800_000_000_000 + seq): SessionEvent {
  return { type, seq, time, data } as unknown as SessionEvent
}

function sidecars(
  records: readonly ClawdshActivityRecord[],
  availability: ClawdshActivityReadResult['availability'] = 'available',
  degraded = false,
): ClawdshActivityReadResult {
  return {
    records,
    availability,
    degraded,
    ...(degraded ? { warning: 'activity-data-incomplete' as const } : {}),
  }
}

describe('projectSessionHistory', () => {
  it('maps standard history without retaining content, identities, arguments, results, or errors', () => {
    const canary = 'PRIVATE_ACTIVITY_CANARY'
    const events = [
      event('tool/call', 1, { callId: 'memory-1', name: 'memory_search', arguments: JSON.stringify({ query: canary }) }),
      event('tool/result', 2, {
        message: { source: { kind: 'tool', callId: 'memory-1' }, content: [{ type: 'tool-result', content: [{ type: 'text', text: canary }] }] },
      }),
      event('tool/call', 3, { callId: 'memory-2', name: 'memory_get', arguments: JSON.stringify({ path: canary }) }),
      event('tool/result', 4, {
        error: { name: 'Error', code: canary },
        message: { source: { kind: 'tool', callId: 'memory-2' }, content: [{ type: 'tool-result', isError: true, content: [] }] },
      }),
      event('tool/call', 5, { callId: 'skill-1', name: 'skill', arguments: JSON.stringify({ name: 'calendar', extra: canary }) }),
      event('tool/result', 6, {
        message: { source: { kind: 'tool', callId: 'skill-1' }, content: [{ type: 'tool-result', content: [{ type: 'text', text: canary }] }] },
      }),
      event('user/message', 7, { content: [{ type: 'text', text: canary }], source: { kind: 'plugin', plugin: 'memory-flush' } }),
      event('user/message', 8, {
        content: [{ type: 'text', text: canary }],
        source: {
          kind: 'channel',
          channel: 'feishu',
          isGroup: true,
          wasMentioned: false,
          senderId: canary,
          account: canary,
          conversation: canary,
          thread: canary,
          messageId: canary,
        },
      }),
      event('user/message', 9, {
        content: [{ type: 'text', text: canary }],
        source: { kind: 'skill-catalog', entries: [{ name: 'calendar', description: canary }] },
      }),
      event('user/message', 10, {
        content: [{ type: 'text', text: canary }],
        source: { kind: 'skill-invocation', name: 'calendar', path: canary },
      }),
      event('automation/run', 11, {
        ruleId: 'morning-brief',
        scheduledAt: '2026-08-15T01:02:03.000Z',
        status: 'error',
        error: canary,
      }),
    ]

    const projected = projectSessionHistory('history-session', events)

    expect(projected.degraded).toBe(false)
    expect(projected.records.map(record => [record.kind, record.status])).toEqual([
      ['memory.search', 'started'],
      ['memory.search', 'succeeded'],
      ['memory.read', 'started'],
      ['memory.read', 'failed'],
      ['skill.invoked', 'started'],
      ['skill.invoked', 'succeeded'],
      ['memory.flush', 'started'],
      ['channel.received', undefined],
      ['skill.catalog', 'succeeded'],
      ['skill.loaded', 'succeeded'],
      ['automation.run', 'failed'],
    ])
    expect(JSON.stringify(projected)).not.toContain(canary)
    expect(projected.records.find(record => record.kind === 'channel.received')?.metadata).toEqual({
      adapter: 'feishu',
      conversation: 'group',
      mention: false,
      seq: 8,
    })
  })

  it('skips a malformed recognized event and reports degradation', () => {
    const projected = projectSessionHistory('history-session', [
      event('user/message', 1, { source: { kind: 'channel', channel: 'feishu', isGroup: 'yes' } }),
    ])

    expect(projected).toEqual({ records: [], degraded: true })
  })
})

describe('createActivityPage', () => {
  it('prefers history when deduplicating sidecars, orders stably, and continues with a bound cursor', () => {
    const sessionId = SessionId('page-session')
    const history = [event('user/message', 1, {
      source: { kind: 'channel', channel: 'feishu', isGroup: false },
    }, 1_000)]
    const duplicate = createActivityRecord(
      { id: randomUUID(), timestamp: new Date(1_500).toISOString(), sessionId },
      'channel.received',
      { adapter: 'feishu', conversation: 'direct', mention: null, seq: 1 },
    )
    const prompt = createActivityRecord(
      { id: randomUUID(), timestamp: new Date(2_000).toISOString(), sessionId },
      'prompt.contribution',
      {
        producer: 'soul',
        section: 'clawdsh:soul',
        mode: 'append',
        characters: 10,
        sha256: 'a'.repeat(64),
        seq: 2,
      },
      'succeeded',
    )

    const first = createActivityPage(
      { sessionId, order: 'asc', limit: 1 },
      { live: history },
      sidecars([duplicate, prompt]),
    )
    expect(first.records).toHaveLength(1)
    expect(first.records[0]?.id).toMatch(/^history:/)
    expect(first.nextCursor).toEqual(expect.any(String))
    expect(first.availability).toEqual({ history: 'live', sidecar: 'available' })
    const cursor = first.nextCursor
    if (cursor === undefined) throw new Error('first Activity page did not return its continuation')

    const second = createActivityPage(
      { sessionId, order: 'asc', limit: 1, cursor },
      { live: history },
      sidecars([duplicate, prompt]),
    )
    expect(second.records).toEqual([prompt])
    expect(second.nextCursor).toBeUndefined()
  })

  it('binds cursors to Session, canonical category filter, and order', () => {
    const sessionId = SessionId('bound-session')
    const records = Array.from({ length: 3 }, (_, seq) => createActivityRecord(
      { id: randomUUID(), timestamp: new Date(1_000 + seq).toISOString(), sessionId },
      'memory.search',
      { seq },
      'succeeded',
    ))
    const first = createActivityPage(
      { sessionId, categories: ['memory', 'memory'], order: 'asc', limit: 1 },
      {},
      sidecars(records),
    )
    const cursor = first.nextCursor!

    expect(() => createActivityPage(
      { sessionId: SessionId('other'), categories: ['memory'], order: 'asc', limit: 1, cursor },
      {},
      sidecars([]),
    )).toThrow(expect.objectContaining<Partial<ClawdshActivityQueryError>>({ code: 'cursor-mismatch' }))
    expect(() => createActivityPage(
      { sessionId, categories: ['skill'], order: 'asc', limit: 1, cursor },
      {},
      sidecars(records),
    )).toThrow(expect.objectContaining<Partial<ClawdshActivityQueryError>>({ code: 'cursor-mismatch' }))
    expect(() => createActivityPage(
      { sessionId, categories: ['memory'], order: 'desc', limit: 1, cursor },
      {},
      sidecars(records),
    )).toThrow(expect.objectContaining<Partial<ClawdshActivityQueryError>>({ code: 'cursor-mismatch' }))
    expect(() => createActivityPage(
      { sessionId, cursor: 'not+base64' },
      {},
      sidecars(records),
    )).toThrow(expect.objectContaining<Partial<ClawdshActivityQueryError>>({ code: 'invalid-cursor' }))
  })

  it('uses inspect when live history is unavailable and preserves either source independently', () => {
    const sessionId = SessionId('fallback-session')
    const inspect = [event('automation/run', 1, {
      ruleId: 'nightly',
      scheduledAt: '2026-08-15T01:02:03.000Z',
      status: 'ok',
    })]
    const fromHistory = createActivityPage(
      { sessionId },
      { inspect },
      sidecars([], 'unavailable', true),
    )

    expect(fromHistory.records.map(record => record.kind)).toEqual(['automation.run'])
    expect(fromHistory.availability).toEqual({ history: 'inspect', sidecar: 'unavailable' })
    expect(fromHistory.warnings).toEqual(['activity-data-incomplete'])

    const prompt = createActivityRecord(
      { id: randomUUID(), timestamp: '2026-08-15T01:02:03.000Z', sessionId },
      'prompt.contribution',
      {
        producer: 'soul',
        section: 'clawdsh:soul',
        mode: 'append',
        characters: 1,
        sha256: 'b'.repeat(64),
        seq: 1,
      },
      'succeeded',
    )
    const fromSidecar = createActivityPage({ sessionId }, {}, sidecars([prompt]))
    expect(fromSidecar.records).toEqual([prompt])
    expect(fromSidecar.availability.history).toBe('unavailable')
    expect(fromSidecar.warnings).toEqual(['activity-history-unavailable'])
  })

  it('defaults to 50 newest records and caps requests at 100', () => {
    const sessionId = SessionId('limits-session')
    const records = Array.from({ length: 101 }, (_, seq) => createActivityRecord(
      { id: randomUUID(), timestamp: new Date(10_000 + seq).toISOString(), sessionId },
      'memory.search',
      { seq },
      'succeeded',
    ))

    expect(createActivityPage({ sessionId }, {}, sidecars(records)).records).toHaveLength(50)
    expect(createActivityPage({ sessionId, limit: 100 }, {}, sidecars(records)).records).toHaveLength(100)
    expect(() => createActivityPage({ sessionId, limit: 101 }, {}, sidecars(records)))
      .toThrow(expect.objectContaining<Partial<ClawdshActivityQueryError>>({ code: 'invalid-request' }))
  })
})
