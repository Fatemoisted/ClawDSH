import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ChannelMessage } from '@clawdsh/dsh-channel-core'

const retryPlugin = vi.hoisted(() => {
  const transformer = vi.fn()
  return { autoRetry: vi.fn(() => transformer), transformer }
})

vi.mock('@grammyjs/auto-retry', () => ({ autoRetry: retryPlugin.autoRetry }))

import type { AdapterDeps, TelegramTextContext } from '../src/index.ts'
import { createAdapter, toInbound } from '../src/index.ts'

/** A minimal stand-in for the grammY bot surface this adapter touches. */
function mockBot(
  startImpl: () => Promise<void> = async () => {},
  stopImpl: () => Promise<void> = async () => {},
) {
  const sendMessage = vi.fn(async (..._args: [string | number, string, Record<string, unknown>?]) => ({}))
  const setMessageReaction = vi.fn(async () => ({}))
  const use = vi.fn()
  const handlers: Array<(ctx: TelegramTextContext) => void | Promise<void>> = []
  const on = vi.fn((_filter: string, handler: (ctx: TelegramTextContext) => void | Promise<void>) => {
    handlers.push(handler)
  })
  const catchFn = vi.fn()
  const start = vi.fn(startImpl)
  const stop = vi.fn(stopImpl)
  const bot = {
    api: { config: { use }, sendMessage, setMessageReaction },
    on,
    catch: catchFn,
    start,
    stop,
  } as unknown as NonNullable<AdapterDeps['bot']>
  return { bot, sendMessage, setMessageReaction, use, on, catchFn, start, stop, handlers }
}

function telegramContext(overrides: Partial<TelegramTextContext> = {}): TelegramTextContext {
  return {
    message: { text: 'hi', message_id: 11 },
    chat: { id: -42, type: 'supergroup' },
    from: { id: 7 },
    me: { id: 99, username: 'ClawBot' },
    ...overrides,
  }
}

describe('the telegram channel adapter', () => {
  it('maps a direct text context to a conversation message', () => {
    expect(toInbound(telegramContext({ chat: { id: 42, type: 'private' } }))).toEqual({
      channel: 'telegram',
      direction: 'in',
      conversationId: '42',
      chatType: 'direct',
      mention: { detectable: true, botMentioned: true },
      sender: '7',
      messageId: '11',
      text: 'hi',
    })
  })

  it('detects and removes a matching username mention entity', () => {
    const inbound = toInbound(telegramContext({
      message: {
        text: '@ClawBot hello',
        entities: [{ type: 'mention', offset: 0, length: 8 }],
        message_id: 11,
      },
    }))
    expect(inbound).toMatchObject({
      chatType: 'group',
      mention: { detectable: true, botMentioned: true },
      text: 'hello',
    })
  })

  it('uses the entity target for a text_mention and removes only that span', () => {
    const inbound = toInbound(telegramContext({
      message: {
        text: 'Claw hello',
        entities: [{ type: 'text_mention', offset: 0, length: 4, user: { id: 99 } }],
        message_id: 11,
      },
    }))
    expect(inbound).toMatchObject({
      mention: { detectable: true, botMentioned: true },
      text: 'hello',
    })
  })

  it('treats a reply to the bot as a structured group mention', () => {
    const inbound = toInbound(telegramContext({
      message: {
        text: 'follow up',
        message_id: 12,
        reply_to_message: { message_id: 11, from: { id: 99, is_bot: true } },
      },
    }))
    expect(inbound?.mention).toEqual({ detectable: true, botMentioned: true })
  })

  it('does not accept an entity that names another bot', () => {
    const inbound = toInbound(telegramContext({
      message: {
        text: '@Other hi',
        entities: [{ type: 'mention', offset: 0, length: 6 }],
        message_id: 11,
      },
    }))
    expect(inbound).toMatchObject({
      mention: { detectable: true, botMentioned: false },
      text: '@Other hi',
    })
  })

  it('accepts a bot-addressed command and preserves the command for the model', () => {
    const inbound = toInbound(telegramContext({
      message: {
        text: '/help@ClawBot now',
        entities: [{ type: 'bot_command', offset: 0, length: 13 }],
        message_id: 11,
      },
    }))
    expect(inbound).toMatchObject({
      mention: { detectable: true, botMentioned: true },
      text: '/help now',
    })
  })

  it('does not accept a command addressed to another bot', () => {
    const inbound = toInbound(telegramContext({
      message: {
        text: '/help@OtherBot now',
        entities: [{ type: 'bot_command', offset: 0, length: 14 }],
        message_id: 11,
      },
    }))
    expect(inbound).toMatchObject({
      mention: { detectable: true, botMentioned: false },
      text: '/help@OtherBot now',
    })
  })

  it('fails group mention detection closed when grammY has no bot identity', () => {
    const context = telegramContext()
    delete context.me
    const inbound = toInbound(context)
    expect(inbound?.mention).toEqual({ detectable: false, botMentioned: false })
  })

  it('accepts captions and preserves the platform topic', () => {
    const inbound = toInbound(telegramContext({
      message: {
        caption: '@ClawBot photo',
        caption_entities: [{ type: 'mention', offset: 0, length: 8 }],
        message_id: 13,
        message_thread_id: 77,
      },
    }))
    expect(inbound).toMatchObject({
      conversationId: '-42',
      threadId: '77',
      mention: { detectable: true, botMentioned: true },
      text: 'photo',
    })
  })

  it('drops messages without a text or caption body', () => {
    expect(toInbound(telegramContext({ message: { message_id: 11 } }))).toBeUndefined()
  })

  it('omits the sender when the message has no author', () => {
    const context = telegramContext()
    delete context.from
    expect(toInbound(context)?.sender).toBeUndefined()
  })

  it('installs the official bounded auto-retry transformer', () => {
    retryPlugin.autoRetry.mockClear()
    const { bot, use } = mockBot()
    createAdapter({ botToken: 't' }, { bot })

    expect(retryPlugin.autoRetry).toHaveBeenCalledOnce()
    expect(retryPlugin.autoRetry).toHaveBeenCalledWith({
      maxRetryAttempts: 3,
      maxDelaySeconds: 30,
      rethrowHttpErrors: true,
    })
    expect(use).toHaveBeenCalledWith(retryPlugin.transformer)
  })

  it('registers a message handler and starts long polling, then stops on dispose', async () => {
    const { bot, on, start, stop } = mockBot()
    const ctx = new Context()
    const adapter = createAdapter({ botToken: 't' }, { bot })
    const dispose = adapter.start(ctx)
    expect(on).toHaveBeenCalledWith('message', expect.any(Function))
    expect(start).toHaveBeenCalledWith({ allowed_updates: ['message'], timeout: 30 })
    await dispose()
    expect(stop).toHaveBeenCalled()
  })

  it('awaits stop before draining the long-poll start task', async () => {
    const events: string[] = []
    let finishStart: (() => void) | undefined
    let finishStop: (() => void) | undefined
    const startTask = new Promise<void>((resolve) => {
      finishStart = () => {
        events.push('start drained')
        resolve()
      }
    })
    const stopTask = new Promise<void>((resolve) => {
      finishStop = () => {
        events.push('stop complete')
        resolve()
      }
    })
    const { bot } = mockBot(
      () => {
        events.push('start called')
        return startTask
      },
      () => {
        events.push('stop called')
        return stopTask
      },
    )
    const adapter = createAdapter({ botToken: 't' }, { bot })
    const dispose = adapter.start(new Context())

    let disposed = false
    const disposal = Promise.resolve(dispose()).then(() => { disposed = true })
    await Promise.resolve()
    expect(events).toEqual(['start called', 'stop called'])
    expect(disposed).toBe(false)

    finishStop?.()
    await Promise.resolve()
    expect(events).toEqual(['start called', 'stop called', 'stop complete'])
    expect(disposed).toBe(false)

    finishStart?.()
    await disposal
    expect(events).toEqual(['start called', 'stop called', 'stop complete', 'start drained'])
    expect(disposed).toBe(true)
  })

  it('logs a rejected polling stop instead of leaking an unhandled rejection', async () => {
    const { bot, stop } = mockBot()
    stop.mockRejectedValueOnce(new Error('stop failed'))
    const ctx = new Context()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const adapter = createAdapter({ botToken: 't' }, { bot })

    const dispose = adapter.start(ctx)
    await dispose()

    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('stop failed'))
    })
  })

  it('logs a rejected polling start instead of leaking an unhandled rejection', async () => {
    const { bot } = mockBot(() => Promise.reject(new Error('network down')))
    const ctx = new Context()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const adapter = createAdapter({ botToken: 't' }, { bot })
    const dispose = adapter.start(ctx)
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('network down'))
    })
    await dispose()
  })

  it('is send-only and never starts polling when polling is false', async () => {
    const { bot, on, start } = mockBot()
    const adapter = createAdapter({ botToken: 't', polling: false }, { bot })
    expect(adapter.capabilities.receive).toBe(false)
    const dispose = adapter.start(new Context())
    expect(on).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
    await dispose()
  })

  it('rejects a polling timeout outside Telegram\'s integer 1-60 range', () => {
    const { bot } = mockBot()
    expect(() => createAdapter({ botToken: 't', timeout: 0 }, { bot })).toThrow(/1 to 60/)
    expect(() => createAdapter({ botToken: 't', timeout: 1.5 }, { bot })).toThrow(/1 to 60/)
    expect(() => createAdapter({ botToken: 't', timeout: 61 }, { bot })).toThrow(/1 to 60/)
  })

  it('posts sendMessage with the conversation id and text', async () => {
    const { bot, sendMessage } = mockBot()
    const adapter = createAdapter({ botToken: 't' }, { bot })
    await adapter.send({ channel: 'telegram', direction: 'out', conversationId: '42', text: 'reply' })
    expect(sendMessage).toHaveBeenCalledWith('42', 'reply')
  })

  it('passes a topic and native reply_parameters to sendMessage', async () => {
    const { bot, sendMessage } = mockBot()
    const adapter = createAdapter({ botToken: 't' }, { bot })
    await adapter.send({
      channel: 'telegram',
      direction: 'out',
      conversationId: '-42',
      threadId: '77',
      replyToMessageId: '11',
      text: 'reply',
    })
    expect(sendMessage).toHaveBeenCalledWith('-42', 'reply', {
      message_thread_id: 77,
      reply_parameters: { message_id: 11, allow_sending_without_reply: true },
    })
  })

  it('splits long replies in order, preserves the topic, and quotes only the first chunk', async () => {
    const { bot, sendMessage } = mockBot()
    const adapter = createAdapter({ botToken: 't' }, { bot })
    const reply = `${'a'.repeat(4095)}😀tail`
    await adapter.send({
      channel: 'telegram',
      direction: 'out',
      conversationId: '-42',
      threadId: '77',
      replyToMessageId: '11',
      text: reply,
    })

    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(sendMessage.mock.calls[0]).toEqual(['-42', 'a'.repeat(4095), {
      message_thread_id: 77,
      reply_parameters: { message_id: 11, allow_sending_without_reply: true },
    }])
    expect(sendMessage.mock.calls[1]).toEqual(['-42', '😀tail', { message_thread_id: 77 }])
    expect(sendMessage.mock.calls.map(call => call[1]).join('')).toBe(reply)
  })

  it('rejects a send without a conversation id', async () => {
    const { bot } = mockBot()
    const adapter = createAdapter({ botToken: 't' }, { bot })
    await expect(adapter.send({ channel: 'telegram', direction: 'out', text: 'reply' }))
      .rejects.toThrow(/conversationId/)
  })

  it('rejects malformed numeric topic and reply ids', async () => {
    const { bot } = mockBot()
    const adapter = createAdapter({ botToken: 't' }, { bot })
    await expect(adapter.send({
      channel: 'telegram',
      direction: 'out',
      conversationId: '-42',
      threadId: 'topic',
      text: 'reply',
    })).rejects.toThrow(/threadId/)
  })

  it('emits an inbound message from the registered handler', async () => {
    const { bot, handlers } = mockBot()
    const ctx = new Context()
    const inbound = new Promise<ChannelMessage>((resolve) => {
      const dispose = ctx.on('channel/inbound', (message) => {
        dispose()
        resolve(message)
      })
    })
    const adapter = createAdapter({ botToken: 't' }, { bot })
    adapter.start(ctx)
    const handler = handlers[0]
    expect(handler).toBeDefined()
    if (handler === undefined) throw new Error('message handler was not registered')
    await handler(telegramContext())
    const message = await inbound
    expect(message).toMatchObject({
      channel: 'telegram',
      direction: 'in',
      conversationId: '-42',
      sender: '7',
      messageId: '11',
      text: 'hi',
    })
  })

  it('attaches an ack emoji to the conversation message', async () => {
    const { bot, setMessageReaction } = mockBot()
    const adapter = createAdapter({ botToken: 't' }, { bot })
    expect(adapter.capabilities.react).toBe(true)
    await adapter.react?.({
      channel: 'telegram',
      direction: 'in',
      conversationId: '-42',
      messageId: '11',
      text: 'hi',
    }, '👀')
    expect(setMessageReaction).toHaveBeenCalledWith('-42', 11, [{ type: 'emoji', emoji: '👀' }])
  })

  it('skips the reaction without a message id', async () => {
    const { bot, setMessageReaction } = mockBot()
    const adapter = createAdapter({ botToken: 't' }, { bot })
    await adapter.react?.({ channel: 'telegram', direction: 'in', conversationId: '-42', text: 'hi' }, '👀')
    expect(setMessageReaction).not.toHaveBeenCalled()
  })
})
