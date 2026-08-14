import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import { LarkChannelError } from '@larksuiteoapi/node-sdk'
import type { LarkChannel, NormalizedMessage } from '@larksuiteoapi/node-sdk'
import type { ChannelMessage } from '@clawdsh/dsh-channel-core'
import { createAdapter, toInbound } from '../src/index.ts'

const CONFIG = { appId: 'app', appSecret: 'secret' }

function normalized(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    messageId: 'om_1',
    chatId: 'oc_1',
    chatType: 'group',
    senderId: 'ou_1',
    content: 'hello',
    rawContentType: 'text',
    resources: [],
    mentions: [],
    mentionAll: false,
    mentionedBot: true,
    createTime: Date.now(),
    ...overrides,
  }
}

type MessageHandler = (message: NormalizedMessage) => void | Promise<void>
type ErrorHandler = (error: LarkChannelError) => void

/** Minimal high-level LarkChannel surface touched by the adapter. */
function mockChannel(
  connectImpl: () => Promise<void> = async () => {},
  connectionStatus?: ReturnType<LarkChannel['getConnectionStatus']>,
) {
  const handlers = new Map<string, MessageHandler | ErrorHandler>()
  const unsubscriptions: ReturnType<typeof vi.fn>[] = []
  const on = vi.fn((event: string, handler: MessageHandler | ErrorHandler) => {
    handlers.set(event, handler)
    const unsubscribe = vi.fn(() => { handlers.delete(event) })
    unsubscriptions.push(unsubscribe)
    return unsubscribe
  })
  const connect = vi.fn(connectImpl)
  const disconnect = vi.fn(async () => {})
  const send = vi.fn(async (..._args: Parameters<LarkChannel['send']>) => ({ messageId: 'om_reply' }))
  const addReaction = vi.fn(async () => 'reaction_1')
  const getConnectionStatus = vi.fn((): ReturnType<LarkChannel['getConnectionStatus']> => connectionStatus)
  const channel = { on, connect, disconnect, send, addReaction, getConnectionStatus } as unknown as LarkChannel
  return { channel, handlers, unsubscriptions, connect, disconnect, send, addReaction, getConnectionStatus }
}

function nextInbound(ctx: Context): Promise<ChannelMessage> {
  return new Promise((resolve) => {
    const dispose = ctx.on('channel/inbound', (message) => {
      dispose()
      resolve(message)
    })
  })
}

describe('the Feishu channel adapter', () => {
  it('maps the SDK normalized group message and preserves its topic', () => {
    expect(toInbound(normalized({
      content: 'Status\nhello @Alice',
      rawContentType: 'post',
      threadId: 'omt_1',
    }))).toEqual({
      channel: 'feishu',
      direction: 'in',
      conversationId: 'oc_1',
      threadId: 'omt_1',
      chatType: 'group',
      mention: { detectable: true, botMentioned: true },
      sender: 'ou_1',
      messageId: 'om_1',
      text: 'Status\nhello @Alice',
    })
  })

  it('uses the sender open_id as the direct-message target', () => {
    expect(toInbound(normalized({ chatType: 'p2p', mentionedBot: false }))).toMatchObject({
      conversationId: 'ou_1',
      chatType: 'direct',
      mention: { detectable: true, botMentioned: true },
    })
  })

  it('falls back to the p2p chat id when the sender id is absent', () => {
    expect(toInbound(normalized({ chatType: 'p2p', senderId: '' }))).toMatchObject({
      conversationId: 'oc_1',
      chatType: 'direct',
    })
  })

  it('passes through SDK-rendered attachment/rich-message text', () => {
    expect(toInbound(normalized({
      content: '<image key="img_1"/>',
      rawContentType: 'image',
      resources: [{ type: 'image', fileKey: 'img_1' }],
    }))?.text).toBe('<image key="img_1"/>')
  })

  it('drops an empty normalized body', () => {
    expect(toInbound(normalized({ content: '  ' }))).toBeUndefined()
  })

  it('connects the SDK channel and emits normalized inbound messages', async () => {
    const sdk = mockChannel()
    const ctx = new Context()
    const inbound = nextInbound(ctx)
    const adapter = createAdapter(CONFIG, { channel: sdk.channel })

    const dispose = adapter.start(ctx)
    const handler = sdk.handlers.get('message') as MessageHandler
    await handler(normalized())

    await expect(inbound).resolves.toMatchObject({ conversationId: 'oc_1', text: 'hello' })
    expect(sdk.connect).toHaveBeenCalledOnce()
    await dispose()
    expect(sdk.disconnect).toHaveBeenCalledOnce()
    expect(sdk.unsubscriptions.every(unsubscribe => unsubscribe.mock.calls.length === 1)).toBe(true)
  })

  it('drains an in-flight SDK message callback before disconnecting', async () => {
    const sdk = mockChannel()
    const ctx = new Context()
    let releaseInbound!: () => void
    const inboundGate = new Promise<void>((resolve) => { releaseInbound = resolve })
    let inboundStarted!: () => void
    const inboundEntered = new Promise<void>((resolve) => { inboundStarted = resolve })
    ctx.on('channel/inbound', async () => {
      inboundStarted()
      await inboundGate
    })
    const adapter = createAdapter(CONFIG, { channel: sdk.channel })
    const dispose = adapter.start(ctx)
    const handler = sdk.handlers.get('message') as MessageHandler

    const handling = Promise.resolve(handler(normalized()))
    await inboundEntered
    let disposed = false
    const disposal = Promise.resolve(dispose()).then(() => { disposed = true })
    await Promise.resolve()

    expect(disposed).toBe(false)
    expect(sdk.disconnect).not.toHaveBeenCalled()
    releaseInbound()
    await handling
    await disposal
    expect(sdk.disconnect).toHaveBeenCalledOnce()
  })

  it('logs a rejected identity/connection attempt instead of leaking it', async () => {
    const sdk = mockChannel(() => Promise.reject(new LarkChannelError('permission_denied', 'identity denied')))
    const ctx = new Context()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const adapter = createAdapter(CONFIG, { channel: sdk.channel })

    adapter.start(ctx)

    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith(expect.stringContaining('identity denied')) })
    expect(sdk.connect).toHaveBeenCalledOnce()
  })

  it('retries a transient pre-WebSocket identity failure through the Cordis timer', async () => {
    vi.useFakeTimers()
    try {
      let attempts = 0
      const sdk = mockChannel(() => {
        attempts += 1
        return attempts === 1
          ? Promise.reject(new LarkChannelError('not_connected', 'identity network error'))
          : Promise.resolve()
      })
      const ctx = new Context()
      await ctx.plugin(Timer)
      const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
      const adapter = createAdapter(CONFIG, { channel: sdk.channel })

      const dispose = adapter.start(ctx)
      await Promise.resolve()
      await Promise.resolve()
      expect(sdk.connect).toHaveBeenCalledOnce()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('retrying in 1000ms'))

      await vi.advanceTimersByTimeAsync(1000)
      expect(sdk.connect).toHaveBeenCalledTimes(2)
      await dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes SDK resources when the initial WebSocket handshake never became connected', async () => {
    const sdk = mockChannel(
      () => Promise.reject(new LarkChannelError('not_connected', 'handshake failed')),
      { state: 'reconnecting', reconnectAttempts: 1 },
    )
    const close = vi.fn()
    const disposeSafety = vi.fn(async () => {})
    Object.assign(sdk.channel, {
      rawWsClient: { close },
      safety: { dispose: disposeSafety },
    })
    const ctx = new Context()
    const adapter = createAdapter(CONFIG, { channel: sdk.channel })

    const dispose = adapter.start(ctx)
    await Promise.resolve()
    await Promise.resolve()
    await dispose()

    expect(close).toHaveBeenCalledWith({ force: true })
    expect(disposeSafety).toHaveBeenCalledOnce()
    expect(sdk.disconnect).toHaveBeenCalledOnce()
  })

  it('uses the SDK text sender for native replies in a topic', async () => {
    const sdk = mockChannel()
    const adapter = createAdapter(CONFIG, { channel: sdk.channel })
    await adapter.send({
      channel: 'feishu',
      direction: 'out',
      conversationId: 'oc_1',
      threadId: 'omt_1',
      replyToMessageId: 'om_1',
      text: 'reply',
    })
    expect(sdk.send).toHaveBeenCalledWith(
      'oc_1',
      { text: 'reply' },
      { replyTo: 'om_1', replyInThread: true },
    )
  })

  it('keeps every long-reply chunk in the native topic', async () => {
    const sdk = mockChannel()
    const adapter = createAdapter(CONFIG, { channel: sdk.channel })
    const reply = `${'a'.repeat(3499)}😀tail`
    await adapter.send({
      channel: 'feishu',
      direction: 'out',
      conversationId: 'oc_1',
      threadId: 'omt_1',
      replyToMessageId: 'om_1',
      text: reply,
    })

    expect(sdk.send).toHaveBeenCalledTimes(2)
    expect(sdk.send.mock.calls[0]).toEqual([
      'oc_1', { text: 'a'.repeat(3499) }, { replyTo: 'om_1', replyInThread: true },
    ])
    expect(sdk.send.mock.calls[1]).toEqual([
      'oc_1', { text: '😀tail' }, { replyTo: 'om_1', replyInThread: true },
    ])
    const sentText = sdk.send.mock.calls.map((call) => {
      const input = call[1]
      return 'text' in input ? input.text : ''
    }).join('')
    expect(sentText).toBe(reply)
  })

  it('lets the SDK own ordinary sending, chunking, retry, and fallback', async () => {
    const sdk = mockChannel()
    const adapter = createAdapter(CONFIG, { channel: sdk.channel })
    await adapter.send({ channel: 'feishu', direction: 'out', conversationId: 'ou_1', text: 'reply' })
    expect(sdk.send).toHaveBeenCalledWith('ou_1', { text: 'reply' }, {})
  })

  it('rejects a send without a conversation id', async () => {
    const sdk = mockChannel()
    const adapter = createAdapter(CONFIG, { channel: sdk.channel })
    await expect(adapter.send({ channel: 'feishu', direction: 'out', text: 'reply' }))
      .rejects.toThrow(/conversationId/)
    expect(sdk.send).not.toHaveBeenCalled()
  })

  it('maps the portable eyes ack to the SDK reaction helper', async () => {
    const sdk = mockChannel()
    const adapter = createAdapter(CONFIG, { channel: sdk.channel })
    expect(adapter.capabilities.react).toBe(true)
    await adapter.react?.({
      channel: 'feishu', direction: 'in', conversationId: 'oc_1', messageId: 'om_1', text: 'hi',
    }, '👀')
    expect(sdk.addReaction).toHaveBeenCalledWith('om_1', 'EYES')
  })

  it('fails loud for an unsupported Feishu reaction', async () => {
    const sdk = mockChannel()
    const adapter = createAdapter(CONFIG, { channel: sdk.channel })
    await expect(adapter.react?.({
      channel: 'feishu', direction: 'in', conversationId: 'oc_1', messageId: 'om_1', text: 'hi',
    }, '👍')).rejects.toThrow(/unsupported reaction/)
    expect(sdk.addReaction).not.toHaveBeenCalled()
  })
})
