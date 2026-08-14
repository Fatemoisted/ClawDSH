import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ChannelMessage } from '@clawdsh/dsh-channel-core'
import type { AdapterDeps } from '@clawdsh/dsh-channel-feishu'
import { createAdapter, createAdapterState, extractText, handleReceiveEvent, toInbound } from '@clawdsh/dsh-channel-feishu'

const CONFIG = { appId: 'app', appSecret: 'secret' }

function nextInbound(ctx: Context): Promise<ChannelMessage> {
  return new Promise((resolve) => {
    const dispose = ctx.on('channel/inbound', (message) => {
      dispose()
      resolve(message)
    })
  })
}

/** A minimal stand-in for the SDK client's `im.message.create` surface. */
function mockClient() {
  const create = vi.fn(async () => ({ code: 0 }))
  return { client: { im: { message: { create } } } as unknown as NonNullable<AdapterDeps['client']>, create }
}

const GROUP_EVENT = {
  sender: { sender_id: { open_id: 'ou_1' } },
  message: { message_id: 'om_1', chat_id: 'oc_1', chat_type: 'group', message_type: 'text', content: '{"text":"hi"}' },
}

describe('the feishu channel adapter', () => {
  it('extracts text from the content JSON envelope, falling back to raw content', () => {
    expect(extractText('{"text":"hi"}')).toBe('hi')
    expect(extractText('plain')).toBe('plain')
    expect(extractText(undefined)).toBe('')
  })

  it('normalizes a group text event to an inbound message', () => {
    expect(toInbound(GROUP_EVENT)).toEqual({ threadId: 'oc_1', sender: 'ou_1', messageId: 'om_1', text: 'hi' })
  })

  it('normalizes a p2p text event to the sender open_id thread', () => {
    const event = {
      sender: { sender_id: { open_id: 'ou_2' } },
      message: { message_id: 'om_2', chat_id: 'oc_2', chat_type: 'p2p', message_type: 'text', content: '{"text":"hey"}' },
    }
    expect(toInbound(event)).toEqual({ threadId: 'ou_2', sender: 'ou_2', messageId: 'om_2', text: 'hey' })
  })

  it('drops non-text and empty events', () => {
    expect(toInbound({ message: { message_type: 'image', content: '{}' } })).toBeUndefined()
    expect(toInbound({ message: { message_type: 'text', content: '{"text":""}' } })).toBeUndefined()
  })

  it('emits an inbound message and records the reply target', async () => {
    const ctx = new Context()
    const state = createAdapterState()
    const inbound = nextInbound(ctx)
    handleReceiveEvent(ctx, state, GROUP_EVENT)
    const message = await inbound
    expect(message).toMatchObject({ channel: 'feishu', direction: 'in', threadId: 'oc_1', sender: 'ou_1', text: 'hi' })
    expect(state.receiveByThread.get('oc_1')).toEqual({ id: 'oc_1', type: 'chat_id' })
  })

  it('de-duplicates at-least-once delivery by message id', () => {
    const ctx = new Context()
    const state = createAdapterState()
    const inbound: ChannelMessage[] = []
    ctx.on('channel/inbound', (message) => { inbound.push(message) })
    handleReceiveEvent(ctx, state, GROUP_EVENT)
    handleReceiveEvent(ctx, state, GROUP_EVENT)
    expect(inbound).toHaveLength(1)
  })

  it('posts a text message through the SDK client', async () => {
    const { client, create } = mockClient()
    const adapter = createAdapter(CONFIG, { client })
    await adapter.send({ channel: 'feishu', direction: 'out', threadId: 'oc_1', text: 'reply' })
    expect(create).toHaveBeenCalledWith({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: 'oc_1', msg_type: 'text', content: '{"text":"reply"}' },
    })
  })

  it('rejects a send without a thread id', async () => {
    const { client } = mockClient()
    const adapter = createAdapter(CONFIG, { client })
    await expect(adapter.send({ channel: 'feishu', direction: 'out', text: 'reply' }))
      .rejects.toThrow(/threadId/)
  })

  it('fails loud when the SDK reports a non-zero code', async () => {
    const create = vi.fn(async () => ({ code: 99999, msg: 'boom' }))
    const client = { im: { message: { create } } } as unknown as NonNullable<AdapterDeps['client']>
    const adapter = createAdapter(CONFIG, { client })
    await expect(adapter.send({ channel: 'feishu', direction: 'out', threadId: 'oc_1', text: 'x' }))
      .rejects.toThrow(/boom/)
  })
})
