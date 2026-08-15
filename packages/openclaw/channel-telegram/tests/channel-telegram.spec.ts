import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ChannelMessage } from '@clawdsh/dsh-channel-core'
import type { AdapterDeps } from '@clawdsh/dsh-channel-telegram'
import { createAdapter, detectBotMention, inject, toInbound } from '@clawdsh/dsh-channel-telegram'

/** A minimal stand-in for the grammY bot surface this adapter touches. */
function mockBot() {
  const sendMessage = vi.fn(async () => ({}))
  const on = vi.fn()
  const catchFn = vi.fn()
  const start = vi.fn(async () => {})
  const stop = vi.fn(async () => {})
  const bot = {
    api: { sendMessage },
    botInfo: { username: 'mockbot' },
    on,
    catch: catchFn,
    start,
    stop,
  } as unknown as NonNullable<AdapterDeps['bot']>
  return { bot, sendMessage, on, start, stop }
}

describe('the telegram channel adapter', () => {
  it('depends only on the legacy channel registry', () => {
    expect(inject).toEqual(['legacyChannels'])
  })

  it('maps a text context to an inbound message', () => {
    expect(toInbound({ message: { text: 'hi', message_id: 11 }, chat: { id: 42 }, from: { id: 7 } }))
      .toMatchObject({ channel: 'telegram', direction: 'in', threadId: '42', sender: '7', messageId: '11', text: 'hi' })
  })

  it('omits the sender when the message has no author', () => {
    expect(toInbound({ message: { text: 'hi', message_id: 11 }, chat: { id: 42 } }).sender).toBeUndefined()
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
    type HandlerContext = { message: { text: string; message_id: number }; chat: { id: number }; from?: { id: number } }
    const handler = on.mock.calls[0]![1] as (c: HandlerContext) => void
    handler({ message: { text: 'hi', message_id: 11 }, chat: { id: 42 }, from: { id: 7 } })
    const message = await inbound
    expect(message).toMatchObject({ channel: 'telegram', direction: 'in', threadId: '42', sender: '7', messageId: '11', text: 'hi' })
  })

  it('attaches an ack emoji via setMessageReaction', async () => {
    const setMessageReaction = vi.fn(async () => ({}))
    const bot = {
      api: { sendMessage: vi.fn(async () => ({})), setMessageReaction },
    } as unknown as NonNullable<AdapterDeps['bot']>
    const adapter = createAdapter({ botToken: 't' }, { bot })
    expect(adapter.capabilities.react).toBe(true)
    await adapter.react?.({ channel: 'telegram', direction: 'in', threadId: '42', messageId: '11', text: 'hi' }, '👀')
    expect(setMessageReaction).toHaveBeenCalledWith('42', 11, [{ type: 'emoji', emoji: '👀' }])
  })

  it('skips the reaction without a message id', async () => {
    const setMessageReaction = vi.fn(async () => ({}))
    const bot = {
      api: { sendMessage: vi.fn(async () => ({})), setMessageReaction },
    } as unknown as NonNullable<AdapterDeps['bot']>
    const adapter = createAdapter({ botToken: 't' }, { bot })
    await adapter.react?.({ channel: 'telegram', direction: 'in', threadId: '42', text: 'hi' }, '👀')
    expect(setMessageReaction).not.toHaveBeenCalled()
  })

  it('detects the bot mention by @username text, case-insensitive', () => {
    expect(detectBotMention('hey @mybot do it', undefined, 'mybot', [])).toBe(true)
    expect(detectBotMention('hey @MYBOT do it', undefined, 'mybot', [])).toBe(true)
    expect(detectBotMention('hey @other do it', undefined, 'mybot', [])).toBe(false)
  })

  it('detects the bot mention from a mention entity slice', () => {
    // Text carries an @username the substring check would miss (offsets are UTF-16).
    expect(detectBotMention('@mybot', [{ type: 'mention', offset: 0, length: 6 }], 'mybot', [])).toBe(true)
    expect(detectBotMention('hi', [{ type: 'mention', offset: 0, length: 2 }], 'mybot', [])).toBe(false)
  })

  it('detects the bot mention by identity pattern when the username is unknown', () => {
    expect(detectBotMention('hey Clawd please', undefined, undefined, [/Clawd/i])).toBe(true)
    expect(detectBotMention('nothing here', undefined, undefined, [/Clawd/i])).toBe(false)
  })

  it('returns undefined when mention detection is impossible', () => {
    expect(detectBotMention('hey there', undefined, undefined, [])).toBeUndefined()
  })

  it('maps isGroup and wasMentioned onto the inbound message', () => {
    const group = toInbound(
      { message: { text: '@mybot hi', message_id: 11 }, chat: { id: 42, type: 'group' }, from: { id: 7 } },
      'mybot',
    )
    expect(group.isGroup).toBe(true)
    expect(group.wasMentioned).toBe(true)

    const dm = toInbound({ message: { text: 'hi', message_id: 12 }, chat: { id: 43, type: 'private' }, from: { id: 8 } })
    expect(dm.isGroup).toBe(false)
    expect(dm.wasMentioned).toBeUndefined()
  })
})
