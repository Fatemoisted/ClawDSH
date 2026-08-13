import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ChannelMessage } from '@clawdsh/dsh-channel-core'
import type { AdapterDeps } from '@clawdsh/dsh-channel-telegram'
import { createAdapter, toInbound } from '@clawdsh/dsh-channel-telegram'

/** A minimal stand-in for the grammY bot surface this adapter touches. */
function mockBot() {
  const sendMessage = vi.fn(async () => ({}))
  const on = vi.fn()
  const catchFn = vi.fn()
  const start = vi.fn(async () => {})
  const stop = vi.fn(async () => {})
  const bot = {
    api: { sendMessage },
    on,
    catch: catchFn,
    start,
    stop,
  } as unknown as NonNullable<AdapterDeps['bot']>
  return { bot, sendMessage, on, start, stop }
}

describe('the telegram channel adapter', () => {
  it('maps a text context to an inbound message', () => {
    expect(toInbound({ message: { text: 'hi' }, chat: { id: 42 }, from: { id: 7 } }))
      .toMatchObject({ channel: 'telegram', direction: 'in', threadId: '42', sender: '7', text: 'hi' })
  })

  it('omits the sender when the message has no author', () => {
    expect(toInbound({ message: { text: 'hi' }, chat: { id: 42 } }).sender).toBeUndefined()
  })

  it('registers a text handler and starts long polling, then stops on dispose', () => {
    const { bot, on, start, stop } = mockBot()
    const ctx = new Context()
    const adapter = createAdapter({ botToken: 't' }, { bot })
    const dispose = adapter.start(ctx)
    expect(on).toHaveBeenCalledWith('message:text', expect.any(Function))
    expect(start).toHaveBeenCalledWith({ allowed_updates: ['message'], timeout: 30 })
    dispose()
    expect(stop).toHaveBeenCalled()
  })

  it('is send-only and never starts polling when polling is false', () => {
    const { bot, on, start } = mockBot()
    const adapter = createAdapter({ botToken: 't', polling: false }, { bot })
    expect(adapter.capabilities.receive).toBe(false)
    const dispose = adapter.start(new Context())
    expect(on).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
    dispose()
  })

  it('posts a sendMessage with the chat id and text', async () => {
    const { bot, sendMessage } = mockBot()
    const adapter = createAdapter({ botToken: 't' }, { bot })
    await adapter.send({ channel: 'telegram', direction: 'out', threadId: '42', text: 'reply' })
    expect(sendMessage).toHaveBeenCalledWith('42', 'reply')
  })

  it('rejects a send without a chat id', async () => {
    const { bot } = mockBot()
    const adapter = createAdapter({ botToken: 't' }, { bot })
    await expect(adapter.send({ channel: 'telegram', direction: 'out', text: 'reply' }))
      .rejects.toThrow(/threadId/)
  })

  it('emits an inbound message from the registered text handler', async () => {
    const { bot, on } = mockBot()
    const ctx = new Context()
    const inbound = new Promise<ChannelMessage>((resolve) => {
      const dispose = ctx.on('channel/inbound', (message) => {
        dispose()
        resolve(message)
      })
    })
    const adapter = createAdapter({ botToken: 't' }, { bot })
    adapter.start(ctx)
    const handler = on.mock.calls[0]![1] as (c: { message: { text: string }; chat: { id: number }; from?: { id: number } }) => void
    handler({ message: { text: 'hi' }, chat: { id: 42 }, from: { id: 7 } })
    const message = await inbound
    expect(message).toMatchObject({ channel: 'telegram', direction: 'in', threadId: '42', sender: '7', text: 'hi' })
  })
})
