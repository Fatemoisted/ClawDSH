import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { ClawdshActivityControl } from '../src/activity-control.ts'

const SESSION_ID = 'session-activity'
const HISTORY_EVENT = Object.freeze({ type: 'turn/start', seq: 0, time: 1, data: { turn: 0 } })
const MEMORY_RECORD = Object.freeze({
  version: 1,
  id: 'history:memory-start',
  timestamp: '2026-08-15T00:00:00.000Z',
  sessionId: SESSION_ID,
  category: 'memory',
  kind: 'memory.search',
  status: 'started',
  summary: 'Memory search activity recorded',
  metadata: { seq: 0 },
})

function contextWith(services: Record<string, unknown>): Context {
  return {
    get(name: string) {
      return services[name]
    },
  } as unknown as Context
}

function signal(): AbortSignal {
  return new AbortController().signal
}

describe('ClawDSH Activity control', () => {
  it('uses immutable live Session history before persistence and returns a strict page', async () => {
    const inspect = vi.fn()
    const page = vi.fn((_request: unknown, history: unknown) => {
      expect(history).toEqual({ live: [HISTORY_EVENT] })
      return {
        records: [MEMORY_RECORD],
        availability: { history: 'live', sidecar: 'missing' },
        degraded: false,
        warnings: ['activity-sidecar-missing'],
      }
    })
    const control = new ClawdshActivityControl(contextWith({
      sessions: { get: () => ({ events: [HISTORY_EVENT] }) },
      sessionPersistence: { inspect },
      clawdshActivity: { page },
    }))

    const result = await control.handle({
      version: 1,
      sessionId: SESSION_ID,
      categories: ['memory'],
      order: 'asc',
      limit: 1,
    }, signal())

    expect(result).toEqual({
      ok: true,
      value: {
        version: 1,
        records: [MEMORY_RECORD],
        availability: { history: 'live', sidecar: 'missing' },
        degraded: false,
        warnings: ['activity-sidecar-missing'],
      },
    })
    expect(page).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      categories: ['memory'],
      order: 'asc',
      limit: 1,
    }, { live: [HISTORY_EVENT] })
    expect(inspect).not.toHaveBeenCalled()
  })

  it('falls back to persistence inspection and propagates request cancellation', async () => {
    const controller = new AbortController()
    const inspect = vi.fn(async (_sessionId: string, received: AbortSignal) => {
      expect(received).toBe(controller.signal)
      return { events: [HISTORY_EVENT] }
    })
    const page = vi.fn((_request: unknown, history: unknown) => {
      expect(history).toEqual({ inspect: [HISTORY_EVENT] })
      return {
        records: [],
        availability: { history: 'inspect', sidecar: 'available' },
        degraded: false,
        warnings: [],
      }
    })
    const control = new ClawdshActivityControl(contextWith({
      sessions: { get: () => undefined },
      sessionPersistence: { inspect },
      clawdshActivity: { page },
    }))

    await expect(control.handle({ version: 1, sessionId: SESSION_ID }, controller.signal)).resolves.toEqual({
      ok: true,
      value: {
        version: 1,
        records: [],
        availability: { history: 'inspect', sidecar: 'available' },
        degraded: false,
        warnings: [],
      },
    })
    expect(inspect).toHaveBeenCalledWith(SESSION_ID, controller.signal)
  })

  it('degrades without an Activity service while preserving known history availability', async () => {
    const control = new ClawdshActivityControl(contextWith({
      sessions: { get: () => ({ events: [HISTORY_EVENT] }) },
    }))

    await expect(control.handle({ version: 1, sessionId: SESSION_ID }, signal())).resolves.toEqual({
      ok: true,
      value: {
        version: 1,
        records: [],
        availability: { history: 'live', sidecar: 'unavailable' },
        degraded: true,
        warnings: ['activity-data-incomplete'],
      },
    })
  })

  it('returns sidecar records when Session persistence is unavailable', async () => {
    const page = vi.fn((_request: unknown, history: unknown) => {
      expect(history).toEqual({})
      return {
        records: [MEMORY_RECORD],
        availability: { history: 'unavailable', sidecar: 'available' },
        degraded: false,
        warnings: ['activity-history-unavailable'],
      }
    })
    const control = new ClawdshActivityControl(contextWith({
      sessionPersistence: { inspect: async () => { throw new Error('/private/session/path') } },
      clawdshActivity: { page },
    }))

    await expect(control.handle({ version: 1, sessionId: SESSION_ID }, signal())).resolves.toEqual({
      ok: true,
      value: {
        version: 1,
        records: [MEMORY_RECORD],
        availability: { history: 'unavailable', sidecar: 'available' },
        degraded: false,
        warnings: ['activity-history-unavailable'],
      },
    })
  })

  it('contains persistence, sidecar, and malformed response diagnostics', async () => {
    const secret = '/private/session/token-canary'
    const control = new ClawdshActivityControl(contextWith({
      sessions: { get: () => undefined },
      sessionPersistence: { inspect: async () => { throw new Error(secret) } },
      clawdshActivity: {
        page: async () => ({
          records: [{ ...MEMORY_RECORD, metadata: { seq: 0, path: secret } }],
          availability: { history: 'unavailable', sidecar: 'available' },
          degraded: false,
          warnings: ['activity-history-unavailable'],
        }),
      },
    }))

    const result = await control.handle({ version: 1, sessionId: SESSION_ID }, signal())
    expect(result).toEqual({
      ok: true,
      value: {
        version: 1,
        records: [],
        availability: { history: 'unavailable', sidecar: 'unavailable' },
        degraded: true,
        warnings: ['activity-history-unavailable', 'activity-data-incomplete'],
      },
    })
    expect(JSON.stringify(result)).not.toContain(secret)
  })

  it('rejects cross-Session records and over-limit pages at the Host boundary', async () => {
    const page = vi.fn()
      .mockResolvedValueOnce({
        records: [{ ...MEMORY_RECORD, sessionId: 'another-session' }],
        availability: { history: 'live', sidecar: 'available' },
        degraded: false,
        warnings: [],
      })
      .mockResolvedValueOnce({
        records: [MEMORY_RECORD, { ...MEMORY_RECORD, id: 'history:memory-second' }],
        availability: { history: 'live', sidecar: 'available' },
        degraded: false,
        warnings: [],
      })
    const control = new ClawdshActivityControl(contextWith({
      sessions: { get: () => ({ events: [HISTORY_EVENT] }) },
      clawdshActivity: { page },
    }))
    const expected = {
      ok: true,
      value: {
        version: 1,
        records: [],
        availability: { history: 'live', sidecar: 'unavailable' },
        degraded: true,
        warnings: ['activity-data-incomplete'],
      },
    }

    await expect(control.handle({ version: 1, sessionId: SESSION_ID }, signal())).resolves.toEqual(expected)
    await expect(control.handle({ version: 1, sessionId: SESSION_ID, limit: 1 }, signal()))
      .resolves.toEqual(expected)
  })

  it('maps cursor failures without returning the cursor or underlying diagnostic', async () => {
    const secret = 'cursor contained /private/path'
    const control = new ClawdshActivityControl(contextWith({
      clawdshActivity: {
        page: async () => { throw { code: 'cursor-mismatch', message: secret } },
      },
    }))

    const result = await control.handle({ version: 1, sessionId: SESSION_ID }, signal())
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'bad-request',
        message: 'ClawDSH Activity cursor does not match this Session, filter, or order',
        details: { issues: [] },
      },
    })
    expect(JSON.stringify(result)).not.toContain(secret)
  })

  it('strictly rejects unknown request fields and reports aborts as cancellation', async () => {
    const page = vi.fn()
    const control = new ClawdshActivityControl(contextWith({ clawdshActivity: { page } }))
    await expect(control.handle({ version: 1, sessionId: SESSION_ID, extra: true }, signal())).resolves.toEqual({
      ok: false,
      error: {
        code: 'bad-request',
        message: 'invalid ClawDSH protocol v1 request',
        details: { issues: [] },
      },
    })

    const controller = new AbortController()
    controller.abort()
    await expect(control.handle({ version: 1, sessionId: SESSION_ID }, controller.signal)).resolves.toEqual({
      ok: false,
      error: {
        code: 'cancelled',
        message: 'ClawDSH Activity request was cancelled',
        details: {},
      },
    })
    expect(page).not.toHaveBeenCalled()
  })
})
