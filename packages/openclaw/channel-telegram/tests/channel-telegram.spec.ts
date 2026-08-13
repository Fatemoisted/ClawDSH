import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ChannelMessage } from '@clawdsh/dsh-channel-core'
import { createAdapter } from '@clawdsh/dsh-channel-telegram'

afterEach(() => { vi.unstubAllGlobals() })

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function nextInbound(ctx: Context): Promise<ChannelMessage> {
  return new Promise((resolve) => {
    const dispose = ctx.on('channel/inbound', (message) => {
      dispose()
      resolve(message)
    })
  })
}

describe('the telegram channel adapter', () => {
  it('maps a getUpdates message to an inbound message and advances the offset', async () => {
    const calls: string[] = []
    const fetchMock = vi.fn(async (url: unknown): Promise<Response> => {
      calls.push(String(url))
      if (calls.length === 1) {
        return okJson({ ok: true, result: [{ update_id: 123, message: { text: 'hi', chat: { id: 42 }, from: { id: 7 } } }] })
      }
      // Hold the subsequent long-poll open; the test aborts it below.
      return new Promise<Response>(() => {})
    })
    vi.stubGlobal('fetch', fetchMock)

    const ctx = new Context()
    const adapter = createAdapter({ botToken: 't', timeout: 5 })
    const inbound = nextInbound(ctx)
    const stop = adapter.start(ctx)
    try {
      const message = await inbound
      expect(message).toMatchObject({ channel: 'telegram', direction: 'in', threadId: '42', sender: '7', text: 'hi' })
      expect(calls).toHaveLength(2)
      expect(calls[0]).toContain('bott/getUpdates')
      expect(calls[0]).not.toContain('offset=')
      expect(calls[1]).toContain('offset=124')
    } finally {
      stop()
    }
  })

  it('skips non-text updates while still advancing the offset', async () => {
    const calls: string[] = []
    const fetchMock = vi.fn(async (url: unknown): Promise<Response> => {
      calls.push(String(url))
      if (calls.length === 1) {
        return okJson({ ok: true, result: [{ update_id: 9, message: { chat: { id: 1 }, text: 'keep' } }, { update_id: 10, message: { chat: { id: 2 } } }] })
      }
      return new Promise<Response>(() => {})
    })
    vi.stubGlobal('fetch', fetchMock)

    const ctx = new Context()
    const adapter = createAdapter({ botToken: 't', timeout: 5 })
    const inbound = nextInbound(ctx)
    const stop = adapter.start(ctx)
    try {
      const message = await inbound
      expect(message.text).toBe('keep')
      expect(calls[1]).toContain('offset=11')
    } finally {
      stop()
    }
  })

  it('posts a sendMessage with chat_id and text', async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: { body?: string }): Promise<Response> => okJson({ ok: true, result: {} }))
    vi.stubGlobal('fetch', fetchMock)

    const adapter = createAdapter({ botToken: 't' })
    await adapter.send({ channel: 'telegram', direction: 'out', threadId: '42', text: 'reply' })

    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('bott/sendMessage')
    expect(JSON.parse(init?.body ?? '')).toEqual({ chat_id: '42', text: 'reply' })
  })

  it('rejects a send without a chat id', async () => {
    const adapter = createAdapter({ botToken: 't' })
    await expect(adapter.send({ channel: 'telegram', direction: 'out', text: 'reply' }))
      .rejects.toThrow(/threadId/)
  })
})
