import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { ChannelMessage } from '@clawdsh/dsh-channel-core'

const retryPlugin = vi.hoisted(() => {
  const transformer = vi.fn()
  return { autoRetry: vi.fn(() => transformer), transformer }
})
const filesPlugin = vi.hoisted(() => {
  const transformer = vi.fn()
  return { hydrateFiles: vi.fn(() => transformer), transformer }
})

vi.mock('@grammyjs/auto-retry', () => ({ autoRetry: retryPlugin.autoRetry }))
vi.mock('@grammyjs/files', () => ({ hydrateFiles: filesPlugin.hydrateFiles }))

import type { AdapterDeps, TelegramTextContext } from '../src/index.ts'
import { createAdapter, TELEGRAM_DEFAULT_BOT_TOKEN_ENV, toInbound } from '../src/index.ts'

const TEST_BOT_TOKEN = '123456789:unit-test-token-value'

interface MockPollingOptions {
  allowed_updates?: readonly string[]
  timeout?: number
  onStart?: () => void | Promise<void>
}

/** A minimal stand-in for the grammY bot surface this adapter touches. */
function mockBot(
  startImpl?: (options?: MockPollingOptions) => Promise<void>,
  stopImpl?: () => Promise<void>,
) {
  let finishDefaultStart: (() => void) | undefined
  const resolvedStart = (options?: MockPollingOptions): Promise<void> => {
    void options?.onStart?.()
    return new Promise((resolve) => { finishDefaultStart = resolve })
  }
  const resolvedStop = async (): Promise<void> => { finishDefaultStart?.() }
  const sendMessage = vi.fn(async (..._args: [string | number, string, Record<string, unknown>?]) => ({}))
  const setMessageReaction = vi.fn(async () => ({}))
  const getFile = vi.fn(async () => ({ getUrl: (): string => 'https://example.invalid/file' }))
  const use = vi.fn()
  const handlers: Array<(ctx: TelegramTextContext) => void | Promise<void>> = []
  const on = vi.fn((_filter: string, handler: (ctx: TelegramTextContext) => void | Promise<void>) => {
    handlers.push(handler)
  })
  const catchFn = vi.fn()
  const start = vi.fn((options?: MockPollingOptions) => (startImpl ?? resolvedStart)(options))
  const stop = vi.fn(async () => {
    try {
      await (stopImpl ?? resolvedStop)()
    } finally {
      // Real grammY resolves start() when stop() settles, including its error
      // path. Keep the default mock lifecycle faithful to that contract.
      finishDefaultStart?.()
    }
  })
  const bot = {
    api: { config: { use }, getFile, sendMessage, setMessageReaction },
    on,
    catch: catchFn,
    start,
    stop,
  } as unknown as NonNullable<AdapterDeps['bot']>
  return { bot, getFile, sendMessage, setMessageReaction, use, on, catchFn, start, stop, handlers }
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

  it('maps the largest Telegram photo without requiring a caption', () => {
    const inbound = toInbound(telegramContext({
      message: {
        message_id: 14,
        photo: [
          { file_id: 'small', width: 100, height: 100, file_size: 1000 },
          { file_id: 'large', width: 800, height: 600, file_size: 4000 },
        ],
      },
      chat: { id: 42, type: 'private' },
    }))
    expect(inbound).toMatchObject({
      text: '',
      images: [{ sourceId: 'large', mediaType: 'image/jpeg', bytes: 4000 }],
    })
  })

  it('maps only supported raster image documents', () => {
    expect(toInbound(telegramContext({
      message: {
        message_id: 15,
        document: {
          file_id: 'png-file',
          file_name: 'diagram.png',
          mime_type: 'image/png',
          file_size: 2000,
        },
      },
      chat: { id: 42, type: 'private' },
    }))).toMatchObject({
      images: [{
        sourceId: 'png-file',
        mediaType: 'image/png',
        bytes: 2000,
        name: 'diagram.png',
      }],
    })
    expect(toInbound(telegramContext({
      message: {
        message_id: 16,
        document: { file_id: 'pdf-file', mime_type: 'application/pdf' },
      },
      chat: { id: 42, type: 'private' },
    }))).toBeUndefined()
  })

  it('keeps the current delivery chat id separate from a stable session chat id', () => {
    expect(toInbound(telegramContext(), '-7')).toMatchObject({
      conversationId: '-42',
      sessionConversationId: '-7',
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

  it('installs the official bounded auto-retry and file transformers', async () => {
    retryPlugin.autoRetry.mockClear()
    filesPlugin.hydrateFiles.mockClear()
    const { bot, use } = mockBot()
    const adapter = createAdapter({ botToken: TEST_BOT_TOKEN }, { bot })
    const dispose = adapter.start(new Context())

    expect(retryPlugin.autoRetry).toHaveBeenCalledOnce()
    expect(retryPlugin.autoRetry).toHaveBeenCalledWith({
      maxRetryAttempts: 3,
      maxDelaySeconds: 30,
      rethrowHttpErrors: true,
    })
    expect(use).toHaveBeenCalledWith(retryPlugin.transformer)
    expect(filesPlugin.hydrateFiles).toHaveBeenCalledWith(TEST_BOT_TOKEN)
    expect(use).toHaveBeenCalledWith(filesPlugin.transformer)
    await dispose()
  })

  it('streams admitted images through grammY files and Harness attachments', async () => {
    const sdk = mockBot()
    sdk.getFile.mockResolvedValue({ getUrl: () => 'https://example.invalid/provider-file' })
    const fetchFile = vi.fn(async (
      _input: string | URL | Request,
      _init?: RequestInit,
    ) => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.of(1, 2))
        controller.enqueue(Uint8Array.of(3, 4))
        controller.close()
      },
    })))
    const validateImage = vi.fn(async () => {})
    const saved = {
      attachmentId: 'saved-image' as never,
      mediaType: 'image/png' as const,
      bytes: 4,
      width: 1,
      height: 1,
    }
    const saveImage = vi.fn(async () => saved)
    const ctx = new Context()
    await ctx.plugin(Timer)
    ctx.provide('attachments', {
      imageLimits: {
        maxImageBytes: 5,
        maxImagesPerMessage: 2,
        maxMessageImageBytes: 8,
        maxImagePixels: 100,
        mediaTypes: ['image/png'],
      },
      validateImage,
      saveImage,
    } as never)
    const adapter = createAdapter({ botToken: TEST_BOT_TOKEN, polling: false }, {
      bot: sdk.bot,
      fetch: fetchFile,
    })
    const dispose = adapter.start(ctx)

    await expect(adapter.materializeImages?.({
      channel: 'telegram',
      direction: 'in',
      conversationId: '42',
      text: '',
      images: [{ sourceId: 'provider-file', mediaType: 'image/png', bytes: 4 }],
    })).resolves.toEqual([saved])

    expect(sdk.getFile).toHaveBeenCalledWith('provider-file', expect.any(AbortSignal))
    expect(fetchFile).toHaveBeenCalledOnce()
    expect(fetchFile.mock.calls[0]?.[0]).toBe('https://example.invalid/provider-file')
    expect(fetchFile.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
    expect(validateImage).toHaveBeenCalledWith({ data: Uint8Array.of(1, 2, 3, 4), mediaType: 'image/png' })
    expect(saveImage).toHaveBeenCalledAfter(validateImage)
    await dispose()
  })

  it('rejects provider-declared oversized images before downloading them', async () => {
    const sdk = mockBot()
    const ctx = new Context()
    ctx.provide('attachments', {
      imageLimits: {
        maxImageBytes: 3,
        maxImagesPerMessage: 1,
        maxMessageImageBytes: 3,
        maxImagePixels: 100,
        mediaTypes: ['image/jpeg'],
      },
      validateImage: vi.fn(),
      saveImage: vi.fn(),
    } as never)
    const adapter = createAdapter({ botToken: 't', polling: false }, { bot: sdk.bot })
    const dispose = adapter.start(ctx)

    await expect(adapter.materializeImages?.({
      channel: 'telegram',
      direction: 'in',
      conversationId: '42',
      text: '',
      images: [{ sourceId: 'oversized', mediaType: 'image/jpeg', bytes: 4 }],
    })).rejects.toThrow(/byte limit/)
    expect(sdk.getFile).not.toHaveBeenCalled()
    await dispose()
  })

  it('rejects an actual streamed overflow before attachment validation', async () => {
    const sdk = mockBot()
    const fetchFile = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.of(1, 2))
        controller.enqueue(Uint8Array.of(3, 4))
        controller.close()
      },
    })))
    const validateImage = vi.fn()
    const saveImage = vi.fn()
    const ctx = new Context()
    await ctx.plugin(Timer)
    ctx.provide('attachments', {
      imageLimits: {
        maxImageBytes: 3,
        maxImagesPerMessage: 1,
        maxMessageImageBytes: 3,
        maxImagePixels: 100,
        mediaTypes: ['image/png'],
      },
      validateImage,
      saveImage,
    } as never)
    const adapter = createAdapter({ botToken: TEST_BOT_TOKEN, polling: false }, {
      bot: sdk.bot,
      fetch: fetchFile,
    })
    const dispose = adapter.start(ctx)

    await expect(adapter.materializeImages?.({
      channel: 'telegram',
      direction: 'in',
      conversationId: '42',
      text: '',
      images: [{ sourceId: 'actual-overflow', mediaType: 'image/png' }],
    })).rejects.toThrow(/download exceeds the configured byte limit/)
    expect(validateImage).not.toHaveBeenCalled()
    expect(saveImage).not.toHaveBeenCalled()
    await dispose()
  })

  it('times out and aborts a stalled image fetch without blocking disposal', async () => {
    vi.useFakeTimers()
    try {
      const sdk = mockBot()
      const fetchFile = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal
          const abortError = (): Error => {
            const reason: unknown = signal?.reason
            return reason instanceof Error ? reason : new Error('image download aborted')
          }
          if (signal?.aborted === true) {
            reject(abortError())
            return
          }
          signal?.addEventListener('abort', () => { reject(abortError()) }, { once: true })
        })
      })
      const ctx = new Context()
      await ctx.plugin(Timer)
      ctx.provide('attachments', {
        imageLimits: {
          maxImageBytes: 5,
          maxImagesPerMessage: 1,
          maxMessageImageBytes: 5,
          maxImagePixels: 100,
          mediaTypes: ['image/png'],
        },
        validateImage: vi.fn(),
        saveImage: vi.fn(),
      } as never)
      const adapter = createAdapter({
        botToken: TEST_BOT_TOKEN,
        polling: false,
        imageDownloadTimeoutMs: 1000,
      }, { bot: sdk.bot, fetch: fetchFile })
      const dispose = adapter.start(ctx)
      const pending = adapter.materializeImages?.({
        channel: 'telegram',
        direction: 'in',
        conversationId: '42',
        text: '',
        images: [{ sourceId: 'stalled', mediaType: 'image/png' }],
      })
      const rejection = expect(pending).rejects.toThrow(/timed out after 1000ms/)

      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(1000)
      await rejection
      await expect(dispose()).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('validates every image before saving the first attachment', async () => {
    const sdk = mockBot()
    const fetchFile = vi.fn(async () => new Response(Uint8Array.of(1)))
    const validateImage = vi.fn(async () => {})
    const saveImage = vi.fn(async (input: { mediaType: 'image/png' }) => ({
      attachmentId: `saved-${saveImage.mock.calls.length}` as never,
      mediaType: input.mediaType,
      bytes: 1,
      width: 1,
      height: 1,
    }))
    const ctx = new Context()
    await ctx.plugin(Timer)
    ctx.provide('attachments', {
      imageLimits: {
        maxImageBytes: 2,
        maxImagesPerMessage: 2,
        maxMessageImageBytes: 4,
        maxImagePixels: 100,
        mediaTypes: ['image/png'],
      },
      validateImage,
      saveImage,
    } as never)
    const adapter = createAdapter({ botToken: 't', polling: false }, { bot: sdk.bot, fetch: fetchFile })
    const dispose = adapter.start(ctx)

    await adapter.materializeImages?.({
      channel: 'telegram',
      direction: 'in',
      conversationId: '42',
      text: '',
      images: [
        { sourceId: 'one', mediaType: 'image/png', bytes: 1 },
        { sourceId: 'two', mediaType: 'image/png', bytes: 1 },
      ],
    })

    expect(validateImage).toHaveBeenCalledTimes(2)
    expect(saveImage).toHaveBeenCalledTimes(2)
    expect(saveImage.mock.invocationCallOrder[0])
      .toBeGreaterThan(Math.max(...validateImage.mock.invocationCallOrder))
    await dispose()
  })

  it('resolves the default bot token through the Harness credential reference', async () => {
    const sdk = mockBot()
    const botFactory = vi.fn(() => sdk.bot)
    const resolveToken = vi.fn(async () => 'credential-token')
    const adapter = createAdapter({}, { botFactory, resolveToken })

    const dispose = adapter.start(new Context())
    await vi.waitFor(() => { expect(sdk.start).toHaveBeenCalledOnce() })
    expect(resolveToken).toHaveBeenCalledWith(expect.any(Context), credentialRef(TELEGRAM_DEFAULT_BOT_TOKEN_ENV))
    expect(botFactory).toHaveBeenCalledWith('credential-token')
    expect(adapter.capabilities).toMatchObject({ receive: true, send: true, react: true })
    await dispose()
  })

  it('uses a literal token without asking the credential resolver', async () => {
    const sdk = mockBot()
    const botFactory = vi.fn(() => sdk.bot)
    const resolveToken = vi.fn(async () => 'unused')
    const adapter = createAdapter({ botToken: ' literal-token ' }, { botFactory, resolveToken })

    const dispose = adapter.start(new Context())
    await vi.waitFor(() => { expect(sdk.start).toHaveBeenCalledOnce() })
    expect(botFactory).toHaveBeenCalledWith('literal-token')
    expect(resolveToken).not.toHaveBeenCalled()
    await dispose()
  })

  it('stays unavailable when no bot token resolves', async () => {
    const botFactory = vi.fn()
    const ctx = new Context()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const adapter = createAdapter({}, {
      botFactory,
      resolveToken: async () => undefined,
    })

    const dispose = adapter.start(ctx)
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(TELEGRAM_DEFAULT_BOT_TOKEN_ENV))
    })
    expect(botFactory).not.toHaveBeenCalled()
    expect(adapter.capabilities).toEqual({ receive: false, send: false, react: false })
    await dispose()
  })

  it('re-resolves a matching rotated credential and drains the previous bot', async () => {
    const first = mockBot()
    const second = mockBot()
    const bots = [first.bot, second.bot]
    let token = 'token-one'
    const resolveToken = vi.fn(async () => token)
    const botFactory = vi.fn(() => {
      const next = bots.shift()
      if (next === undefined) throw new Error('unexpected Telegram bot')
      return next
    })
    const ctx = new Context()
    const adapter = createAdapter({}, { botFactory, resolveToken })
    const dispose = adapter.start(ctx)
    await vi.waitFor(() => { expect(first.start).toHaveBeenCalledOnce() })

    ctx.emit('credentials/updated', credentialRef('UNRELATED_TOKEN'))
    await Promise.resolve()
    expect(botFactory).toHaveBeenCalledOnce()

    token = 'token-two'
    ctx.emit('credentials/updated', credentialRef(TELEGRAM_DEFAULT_BOT_TOKEN_ENV))
    await vi.waitFor(() => { expect(second.start).toHaveBeenCalledOnce() })
    expect(first.stop).toHaveBeenCalledOnce()
    expect(botFactory).toHaveBeenCalledTimes(2)
    expect(resolveToken).toHaveBeenCalledTimes(2)
    await dispose()
  })

  it('registers a message handler and starts long polling, then stops on dispose', async () => {
    const { bot, on, start, stop } = mockBot()
    const ctx = new Context()
    const adapter = createAdapter({ botToken: TEST_BOT_TOKEN }, { bot })
    const dispose = adapter.start(ctx)
    expect(on).toHaveBeenCalledWith('message', expect.any(Function))
    expect(start).toHaveBeenCalledOnce()
    expect(start.mock.calls[0]?.[0]).toMatchObject({
      allowed_updates: ['message'],
      timeout: 30,
    })
    expect(start.mock.calls[0]?.[0]?.onStart).toBeTypeOf('function')
    await dispose()
    expect(stop).toHaveBeenCalled()
  })

  it('advertises receive capability only after grammY finishes polling setup', async () => {
    let onStart: (() => void | Promise<void>) | undefined
    let finish!: () => void
    const running = new Promise<void>((resolve) => { finish = resolve })
    const { bot } = mockBot(
      (options) => {
        onStart = options?.onStart
        return running
      },
      async () => { finish() },
    )
    const adapter = createAdapter({ botToken: 't' }, { bot })
    const dispose = adapter.start(new Context())

    expect(adapter.capabilities.receive).toBe(false)
    await onStart?.()
    expect(adapter.capabilities.receive).toBe(true)
    await dispose()
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
    await vi.waitFor(() => { expect(events).toContain('stop called') })
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
    const { bot } = mockBot(undefined, async () => { throw new Error('stop failed') })
    const ctx = new Context()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const adapter = createAdapter({ botToken: TEST_BOT_TOKEN }, { bot })

    const dispose = adapter.start(ctx)
    await dispose()

    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('stop failed'))
    })
  })

  it('restarts rejected polling through the Harness timer and cancels it on dispose', async () => {
    vi.useFakeTimers()
    try {
      let attempts = 0
      let finishRetry!: () => void
      const retryTask = new Promise<void>((resolve) => { finishRetry = resolve })
      const { bot, start } = mockBot(
        (options) => {
          attempts += 1
          if (attempts === 1) return Promise.reject(new Error('network down'))
          void options?.onStart?.()
          return retryTask
        },
        async () => { finishRetry() },
      )
      const ctx = new Context()
      await ctx.plugin(Timer)
      const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
      const adapter = createAdapter({ botToken: TEST_BOT_TOKEN }, { bot })
      const dispose = adapter.start(ctx)

      await Promise.resolve()
      await Promise.resolve()
      expect(start).toHaveBeenCalledOnce()
      expect(adapter.capabilities.receive).toBe(false)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('retrying in 1000ms'))

      await vi.advanceTimersByTimeAsync(1000)
      expect(start).toHaveBeenCalledTimes(2)
      expect(adapter.capabilities.receive).toBe(true)
      await dispose()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(start).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([401, 409])('stops permanently on Telegram polling error %s', async (errorCode) => {
    const permanent = Object.assign(new Error('permanent polling failure'), { error_code: errorCode })
    const { bot, start } = mockBot(() => Promise.reject(permanent))
    const ctx = new Context()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const adapter = createAdapter({ botToken: TEST_BOT_TOKEN }, { bot })
    const dispose = adapter.start(ctx)

    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('permanently'))
    })
    expect(adapter.capabilities.receive).toBe(false)
    expect(adapter.capabilities.send).toBe(errorCode !== 401)
    expect(adapter.capabilities.react).toBe(errorCode !== 401)
    expect(start).toHaveBeenCalledOnce()
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

  it('rejects an image download timeout outside the bounded integer range', () => {
    const { bot } = mockBot()
    expect(() => createAdapter({ botToken: 't', imageDownloadTimeoutMs: 999 }, { bot }))
      .toThrow(/imageDownloadTimeoutMs/)
    expect(() => createAdapter({ botToken: 't', imageDownloadTimeoutMs: 1000.5 }, { bot }))
      .toThrow(/imageDownloadTimeoutMs/)
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

  it('pauses a newly migrated chat after observing the migration service update', async () => {
    const { bot, handlers } = mockBot()
    const ctx = new Context()
    const inbound = vi.fn()
    ctx.on('channel/inbound', inbound)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const adapter = createAdapter({ botToken: 't' }, { bot })
    const dispose = adapter.start(ctx)
    const handler = handlers[0]
    if (handler === undefined) throw new Error('message handler was not registered')

    await handler(telegramContext({
      message: { message_id: 20, migrate_to_chat_id: -10042 },
      chat: { id: -42, type: 'group' },
    }))
    await handler(telegramContext({
      message: { text: 'after migration', message_id: 21 },
      chat: { id: -10042, type: 'supergroup' },
    }))

    expect(inbound).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('after this update are paused'))
    await dispose()
  })

  it('routes a migrated delivery id through its explicitly configured stable session id', async () => {
    const { bot, handlers } = mockBot()
    const ctx = new Context()
    const inbound = new Promise<ChannelMessage>((resolve) => {
      ctx.on('channel/inbound', (message) => { resolve(message) })
    })
    const adapter = createAdapter({
      botToken: 't',
      chatIdAliases: [{ chatId: '-10042', sessionChatId: '-42' }],
    }, { bot })
    const dispose = adapter.start(ctx)
    const handler = handlers[0]
    if (handler === undefined) throw new Error('message handler was not registered')

    await handler(telegramContext({
      message: { message_id: 20, migrate_from_chat_id: -42 },
      chat: { id: -10042, type: 'supergroup' },
    }))
    await handler(telegramContext({
      message: { text: 'after migration', message_id: 21 },
      chat: { id: -10042, type: 'supergroup' },
    }))

    await expect(inbound).resolves.toMatchObject({
      conversationId: '-10042',
      sessionConversationId: '-42',
      text: 'after migration',
    })
    await dispose()
  })

  it('keeps an observed unaliased migration paused across credential hot rotation', async () => {
    const first = mockBot()
    const second = mockBot()
    const bots = [first.bot, second.bot]
    let token = 'token-one'
    const ctx = new Context()
    const inbound = vi.fn()
    ctx.on('channel/inbound', inbound)
    vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const adapter = createAdapter({}, {
      botFactory: () => {
        const next = bots.shift()
        if (next === undefined) throw new Error('unexpected Telegram bot')
        return next
      },
      resolveToken: async () => token,
    })
    const dispose = adapter.start(ctx)
    await vi.waitFor(() => { expect(first.start).toHaveBeenCalledOnce() })
    const firstHandler = first.handlers[0]
    if (firstHandler === undefined) throw new Error('first message handler was not registered')
    await firstHandler(telegramContext({
      message: { message_id: 20, migrate_to_chat_id: -10042 },
      chat: { id: -42, type: 'group' },
    }))

    token = 'token-two'
    ctx.emit('credentials/updated', credentialRef(TELEGRAM_DEFAULT_BOT_TOKEN_ENV))
    await vi.waitFor(() => { expect(second.start).toHaveBeenCalledOnce() })
    const secondHandler = second.handlers[0]
    if (secondHandler === undefined) throw new Error('second message handler was not registered')
    await secondHandler(telegramContext({
      message: { text: 'after rotation', message_id: 21 },
      chat: { id: -10042, type: 'supergroup' },
    }))

    expect(inbound).not.toHaveBeenCalled()
    await dispose()
  })

  it('rejects conflicting or cyclic configured chat aliases', () => {
    const { bot } = mockBot()
    expect(() => createAdapter({
      botToken: 't',
      chatIdAliases: [
        { chatId: '-10042', sessionChatId: '-42' },
        { chatId: '-10042', sessionChatId: '-43' },
      ],
    }, { bot })).toThrow(/conflicting/)
    expect(() => createAdapter({
      botToken: 't',
      chatIdAliases: [
        { chatId: '-42', sessionChatId: '-10042' },
        { chatId: '-10042', sessionChatId: '-42' },
      ],
    }, { bot })).toThrow(/cycle/)
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
