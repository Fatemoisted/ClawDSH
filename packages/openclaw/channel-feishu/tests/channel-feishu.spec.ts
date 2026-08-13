import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ChannelMessage } from '@clawdsh/dsh-channel-core'
import { createAdapter, createWebhookState, processWebhook } from '@clawdsh/dsh-channel-feishu'

afterEach(() => { vi.unstubAllGlobals() })

const CONFIG = { appId: 'app', appSecret: 'secret' }

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

const V1_EVENT = {
  type: 'event_callback',
  uuid: 'uuid-1',
  token: '',
  event: {
    type: 'im.message.receive_v1',
    sender: { sender_id: { open_id: 'ou_1' } },
    message: { message_type: 'text', chat_type: 'group', chat_id: 'oc_1', content: '{"text":"hi"}' },
  },
}

describe('the feishu channel adapter', () => {
  it('maps a v1 event_callback into an inbound message', async () => {
    const ctx = new Context()
    const inbound = nextInbound(ctx)
    processWebhook(ctx, CONFIG, createWebhookState(), V1_EVENT)
    const message = await inbound
    expect(message).toMatchObject({ channel: 'feishu', direction: 'in', threadId: 'oc_1', sender: 'ou_1', text: 'hi' })
  })

  it('maps a v2 event into an inbound message', async () => {
    const ctx = new Context()
    const inbound = nextInbound(ctx)
    processWebhook(ctx, CONFIG, createWebhookState(), {
      schema: '2.0',
      header: { event_id: 'evt-1', event_type: 'im.message.receive_v1', token: '' },
      event: {
        sender: { sender_id: { open_id: 'ou_2' } },
        message: { message_type: 'text', chat_type: 'group', chat_id: 'oc_2', content: '{"text":"hey"}' },
      },
    })
    const message = await inbound
    expect(message).toMatchObject({ threadId: 'oc_2', sender: 'ou_2', text: 'hey' })
  })

  it('echoes the challenge for URL verification', () => {
    const result = processWebhook(new Context(), CONFIG, createWebhookState(), { type: 'url_verification', challenge: 'abc', token: '' })
    expect(result).toEqual({ status: 200, body: { challenge: 'abc' } })
  })

  it('de-duplicates at-least-once delivery by uuid', async () => {
    const ctx = new Context()
    const state = createWebhookState()
    const inbound: ChannelMessage[] = []
    ctx.on('channel/inbound', (message) => { inbound.push(message) })
    processWebhook(ctx, CONFIG, state, V1_EVENT)
    processWebhook(ctx, CONFIG, state, V1_EVENT)
    expect(inbound).toHaveLength(1)
  })

  it('caches the tenant token across sends and posts the message payload', async () => {
    const fetchMock = vi.fn(async (url: unknown, _init?: { body?: string }): Promise<Response> => {
      const u = String(url)
      if (u.includes('tenant_access_token')) {
        return okJson({ code: 0, tenant_access_token: 't-1', expire: 7200 })
      }
      return okJson({ code: 0 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const adapter = createAdapter(CONFIG)
    await adapter.send({ channel: 'feishu', direction: 'out', threadId: 'oc_1', text: 'reply' })
    await adapter.send({ channel: 'feishu', direction: 'out', threadId: 'oc_2', text: 'again' })

    const tokenCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('tenant_access_token'))
    expect(tokenCalls).toHaveLength(1)

    const sendCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('im/v1/messages'))
    expect(sendCalls).toHaveLength(2)
    const [url, init] = sendCalls[0]!
    expect(String(url)).toContain('receive_id_type=chat_id')
    expect(JSON.parse(init?.body ?? '')).toEqual({ receive_id: 'oc_1', msg_type: 'text', content: '{"text":"reply"}' })
  })

  it('rejects a send without a thread id', async () => {
    const adapter = createAdapter(CONFIG)
    await expect(adapter.send({ channel: 'feishu', direction: 'out', text: 'reply' }))
      .rejects.toThrow(/threadId/)
  })

  it('fails to load when an encryptKey is configured', () => {
    expect(() => createAdapter({ appId: 'app', appSecret: 'secret', encryptKey: 'k' })).toThrow(/encrypted/)
  })
})
