import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { createActivityPage, ClawdshActivityQueryError } from '../src/pagination.ts'
import { projectSessionHistory } from '../src/projector.ts'
import { createActivityRecord } from '../src/records.ts'
import type { ClawdshActivityReadResult, ClawdshActivityRecord } from '../src/types.ts'

const timestamp = '2026-08-16T00:00:00.000Z'

function event(type: string, seq: number, data: unknown, time = 1_800_000_000_000 + seq): SessionEvent {
  const located = (type === 'tool/call' || type === 'tool/result')
    && typeof data === 'object'
    && data !== null
    && !Array.isArray(data)
    ? { turn: 1, step: 1, ...data }
    : data
  return { type, seq, time, data: located } as unknown as SessionEvent
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
      event('tool/call', 7, { callId: 'memory-write-1', name: 'memory_write', arguments: JSON.stringify({ scope: 'daily', content: canary }) }),
      event('tool/result', 8, {
        message: { source: { kind: 'tool', callId: 'memory-write-1' }, content: [{ type: 'tool-result', content: [{ type: 'text', text: 'Stored daily memory.' }] }] },
      }),
      event('user/message', 9, { content: [{ type: 'text', text: canary }], source: { kind: 'plugin', plugin: 'memory-flush' } }),
      event('user/message', 10, {
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
      event('user/message', 11, {
        content: [{ type: 'text', text: canary }],
        source: { kind: 'skill-catalog', entries: [{ name: 'calendar', description: canary }] },
      }),
      event('user/message', 12, {
        content: [{ type: 'text', text: canary }],
        source: { kind: 'skill-invocation', name: 'calendar', path: canary },
      }),
      event('automation/run', 13, {
        ruleId: 'morning-brief',
        scheduledAt: '2026-08-15T01:02:03.000Z',
        status: 'error',
        error: canary,
      }),
      event('tool/call', 14, {
        callId: 'memory-update-1',
        name: 'memory_update',
        arguments: JSON.stringify({ oldContent: canary, newContent: `${canary}-new` }),
      }),
      event('tool/result', 15, {
        message: { source: { kind: 'tool', callId: 'memory-update-1' }, content: [{ type: 'tool-result', content: [{ type: 'text', text: 'Updated durable memory.' }] }] },
      }),
    ]

    const projected = projectSessionHistory('history-session', events)

    expect(projected.degraded).toBe(false)
    expect(projected.records.map(record => [record.kind, record.status])).toEqual([
      ['memory.search', 'succeeded'],
      ['memory.read', 'failed'],
      ['skill.invoked', 'succeeded'],
      ['memory.write', 'succeeded'],
      ['memory.flush', 'started'],
      ['channel.received', undefined],
      ['skill.catalog', 'succeeded'],
      ['skill.loaded', 'succeeded'],
      ['automation.run', 'failed'],
      ['memory.update', 'succeeded'],
    ])
    expect(JSON.stringify(projected)).not.toContain(canary)
    expect(projected.records.find(record => record.kind === 'channel.received')?.metadata).toEqual({
      adapter: 'feishu',
      conversation: 'group',
      mention: false,
      seq: 10,
    })
    expect(projected.records.find(record => record.kind === 'memory.write')?.metadata).toEqual({
      outcome: 'stored',
      scope: 'daily',
      seq: 8,
    })
    expect(projected.records.find(record => record.kind === 'memory.update')?.metadata).toEqual({
      action: 'updated',
      outcome: 'updated',
      seq: 15,
    })
  })

  it('keeps only unresolved tracked calls as started records', () => {
    const projected = projectSessionHistory('history-session', [
      event('tool/call', 1, { callId: 'pending', name: 'memory_search', arguments: '{}' }),
      event('tool/call', 2, { callId: 'done', name: 'memory_get', arguments: '{}' }),
      event('tool/result', 3, {
        message: { source: { kind: 'tool', callId: 'done' }, content: [{ type: 'tool-result', content: [] }] },
      }),
    ])

    expect(projected.records.map(record => [record.kind, record.status, record.metadata.seq])).toEqual([
      ['memory.read', 'succeeded', 3],
      ['memory.search', 'started', 1],
    ])
  })

  it('pairs reused call ids within their own turn and step', () => {
    const projected = projectSessionHistory('history-session', [
      event('tool/call', 1, {
        turn: 1,
        step: 1,
        callId: 'reused',
        name: 'memory_search',
        arguments: '{}',
      }),
      event('tool/call', 2, {
        turn: 1,
        step: 2,
        callId: 'reused',
        name: 'memory_get',
        arguments: '{}',
      }),
      event('tool/result', 3, {
        turn: 1,
        step: 2,
        message: { source: { kind: 'tool', callId: 'reused' }, content: [{ type: 'tool-result', content: [] }] },
      }),
    ])

    expect(projected).toMatchObject({
      degraded: false,
      records: [
        { kind: 'memory.read', status: 'succeeded', metadata: { seq: 3 } },
        { kind: 'memory.search', status: 'started', metadata: { seq: 1 } },
      ],
    })
  })

  it('rejects malformed memory_write arguments without retaining their content', () => {
    const canary = 'PRIVATE_WRITE_CANARY'
    const projected = projectSessionHistory('history-session', [
      event('tool/call', 1, { callId: 'bad-json', name: 'memory_write', arguments: canary }),
      event('tool/call', 2, { callId: 'bad-scope', name: 'memory_write', arguments: JSON.stringify({ scope: canary }) }),
    ])

    expect(projected).toEqual({ records: [], degraded: true })
    expect(JSON.stringify(projected)).not.toContain(canary)
  })

  it('classifies a Memory forget without retaining either fact', () => {
    const canary = 'PRIVATE_FORGET_CANARY'
    const projected = projectSessionHistory('history-session', [
      event('tool/call', 1, {
        callId: 'forget',
        name: 'memory_update',
        arguments: JSON.stringify({ oldContent: canary, newContent: '' }),
      }),
      event('tool/result', 2, {
        message: { source: { kind: 'tool', callId: 'forget' }, content: [{ type: 'tool-result', content: [{ type: 'text', text: 'Forgot durable memory.' }] }] },
      }),
    ])

    expect(projected).toMatchObject({
      degraded: false,
      records: [{
        kind: 'memory.update',
        status: 'succeeded',
        metadata: { action: 'forgotten', outcome: 'forgotten', seq: 2 },
      }],
    })
    expect(JSON.stringify(projected)).not.toContain(canary)
  })

  it.each([
    [
      'new durable write',
      'memory_write',
      { scope: 'durable', content: 'private durable fact' },
      'Stored durable memory.',
      { scope: 'durable', outcome: 'stored', seq: 2 },
    ],
    [
      'duplicate durable write',
      'memory_write',
      { scope: 'durable', content: 'private durable fact' },
      'Durable memory already stored.',
      { scope: 'durable', outcome: 'already-stored', seq: 2 },
    ],
    [
      'changed update',
      'memory_update',
      { oldContent: 'private old fact', newContent: 'private new fact' },
      'Updated durable memory.',
      { action: 'updated', outcome: 'updated', seq: 2 },
    ],
    [
      'whitespace forget',
      'memory_update',
      { oldContent: 'private old fact', newContent: '   ' },
      'Forgot durable memory.',
      { action: 'forgotten', outcome: 'forgotten', seq: 2 },
    ],
    [
      'already-current update',
      'memory_update',
      { oldContent: 'private fact', newContent: 'private fact' },
      'Durable memory is already current.',
      { action: 'updated', outcome: 'already-current', seq: 2 },
    ],
    [
      'unmatched update',
      'memory_update',
      { oldContent: 'private missing fact', newContent: 'private replacement' },
      'No exact durable memory entry matched. Read MEMORY.md and retry with the exact line.',
      { action: 'updated', outcome: 'not-found', seq: 2 },
    ],
  ])('projects a privacy-safe outcome for %s', (_label, name, args, result, metadata) => {
    const projected = projectSessionHistory('history-session', [
      event('tool/call', 1, { callId: 'memory-call', name, arguments: JSON.stringify(args) }),
      event('tool/result', 2, {
        message: {
          source: { kind: 'tool', callId: 'memory-call' },
          content: [{ type: 'tool-result', content: [{ type: 'text', text: result }] }],
        },
      }),
    ])

    expect(projected).toMatchObject({ degraded: false, records: [{ status: 'succeeded', metadata }] })
    expect(JSON.stringify(projected)).not.toContain('private')
  })

  it('projects Automation lifecycle events independently for page-level reconciliation', () => {
    const scheduledAt = '2026-08-15T01:02:03.000Z'
    const projected = projectSessionHistory('history-session', [
      event('automation/run', 1, { ruleId: 'digest', scheduledAt, status: 'started' }),
      event('automation/run', 8, { ruleId: 'digest', scheduledAt, status: 'ok' }),
    ])

    expect(projected).toMatchObject({
      degraded: false,
      records: [
        { kind: 'automation.run', status: 'started', metadata: { ruleId: 'digest', scheduledAt, seq: 1 } },
        { kind: 'automation.run', status: 'succeeded', metadata: { ruleId: 'digest', scheduledAt, seq: 8 } },
      ],
    })
  })

  it('skips a malformed recognized event and reports degradation', () => {
    const projected = projectSessionHistory('history-session', [
      event('user/message', 1, { source: { kind: 'channel', channel: 'feishu', isGroup: 'yes' } }),
    ])

    expect(projected).toEqual({ records: [], degraded: true })
  })

  it('accepts the Date boundary and degrades a safe integer beyond it without throwing', () => {
    const maximumDateTime = 8_640_000_000_000_000
    const valid = projectSessionHistory('history-session', [
      event('user/message', 1, {
        source: { kind: 'channel', channel: 'telegram', isGroup: false },
      }, maximumDateTime),
    ])
    expect(valid).toMatchObject({
      degraded: false,
      records: [{ timestamp: new Date(maximumDateTime).toISOString() }],
    })

    const beyondDateRange = maximumDateTime + 1
    expect(Number.isSafeInteger(beyondDateRange)).toBe(true)
    expect(() => projectSessionHistory('history-session', [
      event('user/message', 1, {
        source: { kind: 'channel', channel: 'telegram', isGroup: false },
      }, beyondDateRange),
    ])).not.toThrow()
    expect(projectSessionHistory('history-session', [
      event('user/message', 1, {
        source: { kind: 'channel', channel: 'telegram', isGroup: false },
      }, beyondDateRange),
    ])).toEqual({ records: [], degraded: true })
  })

  it('degrades malformed tool lifecycle events without retaining untrusted values', () => {
    const calls = [
      event('tool/call', 1, null),
      event('tool/call', 2, { callId: 2, name: 'memory_search' }),
      event('tool/call', 3, { callId: 'missing-name' }),
      event('tool/call', 4, { callId: 'write-non-string', name: 'memory_write', arguments: {} }),
      event('tool/call', 5, { callId: 'update-bad-json', name: 'memory_update', arguments: '{' }),
      event('tool/call', 5, { callId: 'update-non-string', name: 'memory_update', arguments: {} }),
      event('tool/call', 6, { callId: 'update-non-record', name: 'memory_update', arguments: '[]' }),
      event('tool/call', 7, { callId: 'update-old', name: 'memory_update', arguments: JSON.stringify({ oldContent: 1, newContent: 'x' }) }),
      event('tool/call', 8, { callId: 'update-new', name: 'memory_update', arguments: JSON.stringify({ oldContent: 'x', newContent: 1 }) }),
      event('tool/call', 9, { callId: 'skill-bad-json', name: 'skill', arguments: '{' }),
      event('tool/call', 9, { callId: 'skill-non-string', name: 'skill', arguments: {} }),
      event('tool/call', 10, { callId: 'skill-non-record', name: 'skill', arguments: '[]' }),
      event('tool/call', 11, { callId: 'skill-empty', name: 'skill', arguments: JSON.stringify({ name: '' }) }),
      event('tool/call', 12, { callId: 'unknown', name: 'not-tracked', arguments: '{}' }),
      event('tool/call', 13, { turn: -1, callId: 'bad-turn', name: 'memory_search' }),
      event('tool/call', 14, { step: -1, callId: 'bad-step', name: 'memory_search' }),
    ]

    const projected = projectSessionHistory('malformed-tools', calls)

    expect(projected.records).toEqual([])
    expect(projected.degraded).toBe(true)
  })

  it('handles duplicate, unmatched, malformed, and failing tool results', () => {
    const projected = projectSessionHistory('result-edges', [
      event('tool/call', 1, { callId: 'duplicate', name: 'memory_search' }),
      event('tool/call', 2, { callId: 'duplicate', name: 'memory_get' }),
      event('tool/result', 3, null),
      event('tool/result', 4, { message: null }),
      event('tool/result', 5, { message: { source: { callId: 5 } } }),
      event('tool/result', 6, { turn: -1, message: { source: { callId: 'duplicate' } } }),
      event('tool/result', 6, { turn: -1, message: { source: { callId: 'never-tracked' } } }),
      event('tool/result', 7, { turn: 9, step: 9, message: { source: { callId: 'unknown' } } }),
      event('tool/result', -1, {
        message: { source: { callId: 'duplicate' }, content: 'not-blocks' },
      }),
      event('tool/call', 9, { callId: 'tool-error', name: 'memory_get' }),
      event('tool/result', 10, {
        message: { source: { callId: 'tool-error' }, content: [{ type: 'tool-result', isError: true }] },
      }),
    ])

    expect(projected.degraded).toBe(true)
    expect(projected.records).toEqual([
      expect.objectContaining({ kind: 'memory.read', status: 'failed', metadata: { seq: 10 } }),
    ])
  })

  it('projects safe fallbacks for result content and unsupported Memory outcome text', () => {
    const cases = [
      ['write-unknown', 'memory_write', { scope: 'daily' }, { content: [] }],
      ['write-durable-mismatch', 'memory_write', { scope: 'daily' }, {
        content: [{ type: 'tool-result', content: [{ type: 'text', text: 'Durable memory already stored.' }] }],
      }],
      ['update-mismatch', 'memory_update', { oldContent: 'a', newContent: 'b' }, {
        content: [{ type: 'tool-result', content: [{ type: 'text', text: 'Forgot durable memory.' }] }],
      }],
      ['update-no-content', 'memory_update', { oldContent: 'a', newContent: 'b' }, { content: 'bad' }],
      ['update-many-results', 'memory_update', { oldContent: 'a', newContent: 'b' }, {
        content: [{ type: 'tool-result', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }],
      }],
      ['update-non-text', 'memory_update', { oldContent: 'a', newContent: 'b' }, {
        content: [{ type: 'tool-result', content: [{ type: 'image', data: 'x' }] }],
      }],
    ] as const
    const events: SessionEvent[] = []
    let seq = 0
    for (const [callId, name, args, message] of cases) {
      events.push(event('tool/call', ++seq, { callId, name, arguments: JSON.stringify(args) }))
      events.push(event('tool/result', ++seq, { message: { source: { callId }, ...message } }))
    }

    const projected = projectSessionHistory('outcome-fallbacks', events)

    expect(projected.degraded).toBe(false)
    expect(projected.records).toHaveLength(cases.length)
    expect(projected.records.every(record => !Object.hasOwn(record.metadata, 'outcome'))).toBe(true)
  })

  it('degrades malformed user and Automation events while ignoring unknown history', () => {
    const malformed = [
      event('user/message', 1, null),
      event('user/message', 2, { source: null }),
      event('user/message', 3, { source: { kind: 3 } }),
      event('user/message', 3, { source: { kind: 'other' } }),
      event('user/message', -1, { source: { kind: 'plugin', plugin: 'memory-flush' } }),
      event('user/message', 5, { source: { kind: 'channel', channel: '', isGroup: false } }),
      event('user/message', 6, { source: { kind: 'channel', channel: 'feishu', isGroup: false, wasMentioned: 'yes' } }),
      event('user/message', 7, { source: { kind: 'skill-catalog', entries: null } }),
      event('user/message', -1, { source: { kind: 'skill-catalog', entries: [] } }),
      event('user/message', 9, { source: { kind: 'skill-invocation', name: '' } }),
      event('user/message', -1, { source: { kind: 'skill-invocation', name: 'calendar' } }),
      event('automation/run', 11, null),
      event('automation/run', 12, { ruleId: '', scheduledAt: timestamp, status: 'ok' }),
      event('automation/run', 13, { ruleId: 'daily', scheduledAt: 1, status: 'ok' }),
      event('automation/run', 14, { ruleId: 'daily', scheduledAt: 'bad', status: 'ok' }),
      event('automation/run', 15, { ruleId: 'daily', scheduledAt: timestamp, status: 'other' }),
      event('automation/run', 1.5, { ruleId: 'daily', scheduledAt: timestamp, status: 'started' }),
      event('unknown/event', 17, { private: 'ignored' }),
    ]

    const projected = projectSessionHistory('malformed-history', malformed)

    expect(projected).toEqual({ records: [], degraded: true })
  })

  it('defaults absent channel mentions and degrades an invalid pending event timestamp', () => {
    const projected = projectSessionHistory('channel-default', [
      event('user/message', 1, { source: { kind: 'channel', channel: 'telegram', isGroup: false } }),
      event('automation/run', 2, { ruleId: 'daily', scheduledAt: timestamp, status: 'started' }),
      event('automation/run', 3, { ruleId: 'daily', scheduledAt: timestamp, status: 'error' }),
      event('tool/call', -1, { callId: 'pending', name: 'memory_search' }),
    ])

    expect(projected.degraded).toBe(true)
    expect(projected.records.map(record => [record.kind, record.status, record.metadata])).toEqual([
      ['channel.received', undefined, { adapter: 'telegram', conversation: 'direct', mention: null, seq: 1 }],
      ['automation.run', 'started', { ruleId: 'daily', scheduledAt: timestamp, seq: 2 }],
      ['automation.run', 'failed', { ruleId: 'daily', scheduledAt: timestamp, seq: 3 }],
    ])
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

  it.each(['asc', 'desc'] as const)('rejects an %s cursor after a pending lifecycle becomes terminal', (order) => {
    const sessionId = SessionId(`lifecycle-${order}`)
    const stable = [1_000, 3_000].map((time, index) => createActivityRecord(
      { id: randomUUID(), timestamp: new Date(time).toISOString(), sessionId },
      'memory.search',
      { seq: index + 10 },
      'succeeded',
    ))
    const pending = [event('tool/call', 1, {
      callId: 'lifecycle',
      name: 'memory_search',
      arguments: '{}',
    }, 2_000)]
    const first = createActivityPage(
      { sessionId, order, limit: 1 },
      { live: pending },
      sidecars(stable),
    )
    const cursor = first.nextCursor
    if (cursor === undefined) throw new Error('lifecycle page did not return its continuation')

    const completed = [...pending, event('tool/result', 2, {
      message: { source: { kind: 'tool', callId: 'lifecycle' }, content: [{ type: 'tool-result', content: [] }] },
    }, 4_000)]
    expect(() => createActivityPage(
      { sessionId, order, limit: 1, cursor },
      { live: completed },
      sidecars(stable),
    )).toThrow(expect.objectContaining<Partial<ClawdshActivityQueryError>>({ code: 'cursor-mismatch' }))
  })

  it('collapses Automation lifecycle after merge and orders by the terminal event time', () => {
    const sessionId = SessionId('automation-order')
    const scheduledAt = '2026-08-15T01:02:03.000Z'
    const history = [
      event('user/message', 2, {
        source: { kind: 'channel', channel: 'feishu', isGroup: false },
      }, 2_000),
      event('automation/run', 3, { ruleId: 'digest', scheduledAt, status: 'ok' }, 3_000),
    ]
    const started = createActivityRecord(
      { id: randomUUID(), timestamp: new Date(1_000).toISOString(), sessionId },
      'automation.run',
      { ruleId: 'digest', scheduledAt, seq: 1 },
      'started',
    )

    const ascending = createActivityPage(
      { sessionId, order: 'asc' },
      { live: history },
      sidecars([started]),
    )
    expect(ascending.records.map(record => [record.kind, record.status, record.timestamp])).toEqual([
      ['channel.received', undefined, new Date(2_000).toISOString()],
      ['automation.run', 'succeeded', new Date(3_000).toISOString()],
    ])

    const descending = createActivityPage(
      { sessionId, order: 'desc' },
      { live: history },
      sidecars([started]),
    )
    expect(descending.records.map(record => [record.kind, record.status, record.timestamp])).toEqual([
      ['automation.run', 'succeeded', new Date(3_000).toISOString()],
      ['channel.received', undefined, new Date(2_000).toISOString()],
    ])
  })

  it('collapses an accepted Channel delivery into its confirmed terminal state', () => {
    const sessionId = SessionId('channel-confirmed')
    const metadata = { adapter: 'telegram', conversation: 'direct' as const, mention: null, seq: 7 }
    const started = createActivityRecord(
      { id: randomUUID(), timestamp: new Date(1_000).toISOString(), sessionId },
      'channel.delivery',
      metadata,
      'started',
    )
    const confirmed = createActivityRecord(
      { id: randomUUID(), timestamp: new Date(2_000).toISOString(), sessionId },
      'channel.delivery',
      metadata,
      'sent',
    )

    const page = createActivityPage({ sessionId, order: 'asc' }, {}, sidecars([started, confirmed]))

    expect(page.degraded).toBe(false)
    expect(page.records).toEqual([confirmed])
    expect(page.records[0]?.metadata).toEqual(metadata)
  })

  it('collapses an accepted Channel delivery into its dead-letter failure state', () => {
    const sessionId = SessionId('channel-dead-letter')
    const metadata = { adapter: 'telegram', conversation: 'group' as const, mention: false, seq: 11 }
    const started = createActivityRecord(
      { id: randomUUID(), timestamp: new Date(1_000).toISOString(), sessionId },
      'channel.delivery',
      metadata,
      'started',
    )
    const failed = createActivityRecord(
      { id: randomUUID(), timestamp: new Date(2_000).toISOString(), sessionId },
      'channel.delivery',
      metadata,
      'failed',
    )

    const page = createActivityPage({ sessionId, order: 'asc' }, {}, sidecars([started, failed]))

    expect(page.degraded).toBe(false)
    expect(page.records).toEqual([failed])
    expect(Object.keys(page.records[0]?.metadata ?? {}).sort()).toEqual([
      'adapter', 'conversation', 'mention', 'seq',
    ])
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

  it('rejects unsupported filters and every invalid limit class', () => {
    const sessionId = SessionId('invalid-page-request')
    expect(() => createActivityPage({ sessionId, categories: ['other' as 'memory'] }, {}, sidecars([])))
      .toThrow(expect.objectContaining<Partial<ClawdshActivityQueryError>>({ code: 'invalid-request' }))
    for (const limit of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => createActivityPage({ sessionId, limit }, {}, sidecars([])))
        .toThrow(expect.objectContaining<Partial<ClawdshActivityQueryError>>({ code: 'invalid-request' }))
    }
    expect(createActivityPage({ sessionId, categories: [] }, {}, sidecars([])).records).toEqual([])
  })

  it('reports wrong-session rows, id collisions, and duplicate lifecycle terminals as degraded', () => {
    const sessionId = SessionId('merge-degradation')
    const sharedId = randomUUID()
    const wrongSession = createActivityRecord(
      { id: randomUUID(), timestamp, sessionId: 'other-session' },
      'memory.search',
      { seq: 1 },
      'succeeded',
    )
    const first = createActivityRecord(
      { id: sharedId, timestamp: new Date(1_000).toISOString(), sessionId },
      'memory.search',
      { seq: 2 },
      'succeeded',
    )
    const collision = createActivityRecord(
      { id: sharedId, timestamp: new Date(2_000).toISOString(), sessionId },
      'memory.read',
      { seq: 3 },
      'failed',
    )
    const metadata = { adapter: 'feishu', conversation: 'direct' as const, mention: null, seq: 4 }
    const earlierTerminal = createActivityRecord(
      { id: randomUUID(), timestamp: new Date(3_000).toISOString(), sessionId },
      'channel.delivery',
      metadata,
      'failed',
    )
    const laterTerminal = createActivityRecord(
      { id: randomUUID(), timestamp: new Date(4_000).toISOString(), sessionId },
      'channel.delivery',
      metadata,
      'sent',
    )

    const page = createActivityPage(
      { sessionId, order: 'asc' },
      {},
      sidecars([wrongSession, first, collision, earlierTerminal, laterTerminal]),
    )

    expect(page.degraded).toBe(true)
    expect(page.warnings).toContain('activity-data-incomplete')
    expect(page.records).toEqual([first, laterTerminal])
  })

  it('keeps the later duplicate start and earlier duplicate terminal by canonical ordering', () => {
    const sessionId = SessionId('lifecycle-duplicates')
    const startedMetadata = { ruleId: 'daily', scheduledAt: timestamp, seq: 1 }
    const startedEarly = createActivityRecord(
      { id: randomUUID(), timestamp: new Date(1_000).toISOString(), sessionId },
      'automation.run',
      { ...startedMetadata, seq: 2 },
      'started',
    )
    const startedLate = createActivityRecord(
      { id: randomUUID(), timestamp: new Date(2_000).toISOString(), sessionId },
      'automation.run',
      startedMetadata,
      'started',
    )
    const terminalMetadata = { ruleId: 'nightly', scheduledAt: timestamp, seq: 3 }
    const terminalLate = createActivityRecord(
      { id: randomUUID(), timestamp: new Date(4_000).toISOString(), sessionId },
      'automation.run',
      { ...terminalMetadata, seq: 4 },
      'failed',
    )
    const terminalEarly = createActivityRecord(
      { id: randomUUID(), timestamp: new Date(3_000).toISOString(), sessionId },
      'automation.run',
      terminalMetadata,
      'succeeded',
    )

    const page = createActivityPage(
      { sessionId, order: 'asc' },
      {},
      sidecars([startedEarly, startedLate, terminalLate, terminalEarly]),
    )

    expect(page.degraded).toBe(true)
    expect(page.records).toEqual([startedLate, terminalLate])
  })

  it('rejects malformed cursor encodings and payload fields', () => {
    const sessionId = SessionId('cursor-validation')
    const records = [0, 1].map(seq => createActivityRecord(
      { id: randomUUID(), timestamp: new Date(1_000 + seq).toISOString(), sessionId },
      'memory.search',
      { seq },
      'succeeded',
    ))
    const first = createActivityPage({ sessionId, order: 'asc', limit: 1 }, {}, sidecars(records))
    const valid = first.nextCursor
    if (valid === undefined) throw new Error('expected a cursor')
    const payload = JSON.parse(Buffer.from(valid, 'base64url').toString('utf8')) as Record<string, unknown>
    const token = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
    const malformed: string[] = [
      '',
      'a'.repeat(2049),
      'A',
      Buffer.from('{', 'utf8').toString('base64url'),
      Buffer.from(Uint8Array.of(0xff)).toString('base64url'),
      token(null),
      token([]),
      token({ ...payload, extra: true }),
      token({ ...payload, version: 2 }),
      token({ ...payload, session: 1 }),
      token({ ...payload, categories: 'memory' }),
      token({ ...payload, categories: ['other'] }),
      token({ ...payload, order: 'sideways' }),
      token({ ...payload, snapshot: 1 }),
      token({ ...payload, snapshot: 'A'.repeat(64) }),
      token({ ...payload, timestamp: 1 }),
      token({ ...payload, timestamp: '2026-08-16T00:00:00Z' }),
      token({ ...payload, id: 1 }),
      token({ ...payload, id: '' }),
      token({ ...payload, id: 'x'.repeat(129) }),
      token({ ...payload, id: 'bad\nid' }),
    ]
    for (const cursor of malformed) {
      expect(() => createActivityPage({ sessionId, order: 'asc', limit: 1, cursor }, {}, sidecars(records)))
        .toThrow(expect.objectContaining<Partial<ClawdshActivityQueryError>>({ code: 'invalid-cursor' }))
    }
  })

  it('warns when both history and sidecars are absent', () => {
    const page = createActivityPage(
      { sessionId: SessionId('absent-sources') },
      {},
      sidecars([], 'missing'),
    )
    expect(page.warnings).toEqual(['activity-history-unavailable', 'activity-sidecar-missing'])
  })
})
