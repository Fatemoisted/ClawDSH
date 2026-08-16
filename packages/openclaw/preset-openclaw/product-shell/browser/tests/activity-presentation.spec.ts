import { describe, expect, it } from 'vitest'
import type { ClawdshActivityRecord } from '../../shared/src/protocol.ts'
import { presentActivity } from '../src/pages/activity-presentation.ts'

function prompt(id: string, producer: 'soul' | 'memory', seq: number): ClawdshActivityRecord {
  return {
    version: 1,
    id,
    timestamp: '2026-08-16T00:00:00.000Z',
    sessionId: 'session-one',
    category: 'prompt',
    kind: 'prompt.contribution',
    status: 'succeeded',
    summary: 'ClawDSH Prompt contribution recorded',
    metadata: producer === 'soul' ? {
      producer,
      section: 'clawdsh:soul',
      mode: 'append',
      characters: 12,
      sha256: 'a'.repeat(64),
      seq,
    } : {
      producer,
      section: 'clawdsh:memory-recall',
      mode: 'append',
      characters: 24,
      sha256: 'b'.repeat(64),
      seq,
    },
  }
}

function failure(): ClawdshActivityRecord {
  return {
    version: 1,
    id: 'history:failure',
    timestamp: '2026-08-16T00:00:01.000Z',
    sessionId: 'session-one',
    category: 'memory',
    kind: 'memory.search',
    status: 'failed',
    summary: 'Memory search activity recorded',
    metadata: { seq: 10 },
  }
}

function automation(id: string, status: 'started' | 'succeeded' | 'failed'): ClawdshActivityRecord {
  return {
    version: 1,
    id,
    timestamp: status === 'started' ? '2026-08-16T00:00:00.000Z' : '2026-08-16T00:00:02.000Z',
    sessionId: 'session-one',
    category: 'automation',
    kind: 'automation.run',
    status,
    summary: 'Automation run activity recorded',
    metadata: { ruleId: 'digest', scheduledAt: '2026-08-16T00:00:00.000Z', seq: status === 'started' ? 4 : 8 },
  }
}

describe('Activity presentation', () => {
  it('combines Soul and Memory guidance at the same Session sequence', () => {
    const presented = presentActivity([
      prompt('soul', 'soul', 4),
      failure(),
      prompt('memory', 'memory', 4),
    ])

    expect(presented.failures).toBe(1)
    expect(presented.items).toHaveLength(2)
    expect(presented.items[0]).toMatchObject({
      type: 'context',
      id: 'context:session-one:4',
      seq: 4,
      records: [{ id: 'soul' }, { id: 'memory' }],
    })
    expect(presented.items[1]).toMatchObject({ type: 'record', id: 'history:failure' })
  })

  it('keeps Prompt contributions from different sequences distinct', () => {
    const presented = presentActivity([
      prompt('first', 'soul', 4),
      prompt('second', 'memory', 8),
    ])

    expect(presented.items.map(item => item.id)).toEqual([
      'context:session-one:4',
      'context:session-one:8',
    ])
  })

  it('preserves server-owned Automation order without browser lifecycle folding', () => {
    const presented = presentActivity([
      automation('started', 'started'),
      failure(),
      automation('done', 'succeeded'),
    ])

    expect(presented.items.map(item => item.id)).toEqual([
      'started',
      'history:failure',
      'done',
    ])
    expect(presented.failures).toBe(1)
  })
})
