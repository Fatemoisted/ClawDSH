import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import { CredentialProvider, credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialInfo, CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import { LarkChannelError } from '@larksuiteoapi/node-sdk'
import type { LarkChannel, NormalizedMessage } from '@larksuiteoapi/node-sdk'
import type { ChannelMessage } from '@clawdsh/dsh-channel-core'
import {
  createAdapter,
  FEISHU_DEFAULT_APP_ID_ENV,
  FEISHU_DEFAULT_APP_SECRET_ENV,
  toInbound,
} from '../src/index.ts'

const CONFIG = { appId: 'app', appSecret: 'secret' }

/** Minimal Harness credentials backend used to exercise the real context seam. */
class StubCredentials extends CredentialProvider {
  readonly resolved: CredentialRef[] = []

  async resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    this.resolved.push(ref)
    return { value: ` value-${String(ref)} `, source: 'stub' }
  }

  async describe(_ref: CredentialRef): Promise<CredentialInfo> {
    return { configured: true, source: 'stub', writable: false }
  }

  async set(_ref: CredentialRef, _value: string): Promise<void> {}
  async unset(_ref: CredentialRef): Promise<void> {}
}

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

async function settleMicrotasks(): Promise<void> {
  for (let index = 0; index < 6; index++) await Promise.resolve()
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

  it('preserves the SDK structured decision for an unmentioned group message', () => {
    expect(toInbound(normalized({ chatType: 'group', mentionedBot: false }))).toMatchObject({
      conversationId: 'oc_1',
      chatType: 'group',
      mention: { detectable: true, botMentioned: false },
    })
  })

  it('maps an SDK mention-all broadcast to a structured bot mention', () => {
    expect(toInbound(normalized({
      chatType: 'group',
      mentionedBot: false,
      mentionAll: true,
      content: '@所有人 status update',
    }))).toMatchObject({
      conversationId: 'oc_1',
      chatType: 'group',
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

  it('resolves both default references through the Harness credentials service', async () => {
    const sdk = mockChannel()
    const channelFactory = vi.fn(() => sdk.channel)
    const ctx = new Context()
    await ctx.plugin(StubCredentials)
    const adapter = createAdapter({}, { channelFactory })

    const dispose = adapter.start(ctx)
    await vi.waitFor(() => { expect(sdk.connect).toHaveBeenCalledOnce() })

    expect(channelFactory).toHaveBeenCalledWith({
      appId: `value-${FEISHU_DEFAULT_APP_ID_ENV}`,
      appSecret: `value-${FEISHU_DEFAULT_APP_SECRET_ENV}`,
    })
    expect((ctx.credentials as StubCredentials).resolved).toEqual([
      credentialRef(FEISHU_DEFAULT_APP_ID_ENV),
      credentialRef(FEISHU_DEFAULT_APP_SECRET_ENV),
    ])
    expect(adapter.capabilities).toEqual({ receive: true, send: true, react: true })
    await dispose()
  })

  it('keeps literal config as the compatibility override and ignores reference updates', async () => {
    const sdk = mockChannel()
    const channelFactory = vi.fn(() => sdk.channel)
    const resolveCredential = vi.fn(async () => 'unused')
    const ctx = new Context()
    const adapter = createAdapter({
      appId: ' literal-app ',
      appIdEnv: 'CUSTOM_FEISHU_APP_ID',
      appSecret: ' literal-secret ',
      appSecretEnv: 'CUSTOM_FEISHU_APP_SECRET',
      domain: 'lark',
    }, { channelFactory, resolveCredential })

    const dispose = adapter.start(ctx)
    await vi.waitFor(() => { expect(sdk.connect).toHaveBeenCalledOnce() })
    expect(channelFactory).toHaveBeenCalledWith({
      appId: 'literal-app',
      appSecret: 'literal-secret',
      domain: 'lark',
    })
    expect(resolveCredential).not.toHaveBeenCalled()

    ctx.emit('credentials/updated', credentialRef('CUSTOM_FEISHU_APP_SECRET'))
    await settleMicrotasks()
    expect(channelFactory).toHaveBeenCalledOnce()
    await dispose()
  })

  it('falls back to the Harness launch environment when no credentials service is mounted', async () => {
    vi.stubEnv('CLAWDSH_TEST_FEISHU_APP_ID', ' launch-app ')
    vi.stubEnv('CLAWDSH_TEST_FEISHU_APP_SECRET', ' launch-secret ')
    try {
      const sdk = mockChannel()
      const channelFactory = vi.fn(() => sdk.channel)
      const adapter = createAdapter({
        appIdEnv: 'CLAWDSH_TEST_FEISHU_APP_ID',
        appSecretEnv: 'CLAWDSH_TEST_FEISHU_APP_SECRET',
      }, { channelFactory })

      const dispose = adapter.start(new Context())
      await vi.waitFor(() => { expect(sdk.connect).toHaveBeenCalledOnce() })
      expect(channelFactory).toHaveBeenCalledWith({ appId: 'launch-app', appSecret: 'launch-secret' })
      await dispose()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('fails loudly and remains unavailable when either credential is absent', async () => {
    const channelFactory = vi.fn()
    const ctx = new Context()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const adapter = createAdapter({}, {
      channelFactory,
      resolveCredential: async () => undefined,
    })

    const dispose = adapter.start(ctx)
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(FEISHU_DEFAULT_APP_ID_ENV))
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(FEISHU_DEFAULT_APP_SECRET_ENV))
    })
    expect(channelFactory).not.toHaveBeenCalled()
    expect(adapter.capabilities).toEqual({ receive: false, send: false, react: false })
    expect(() => adapter.send({
      channel: 'feishu', direction: 'out', conversationId: 'oc_1', text: 'reply',
    })).toThrow(/no app credentials resolved/)
    await dispose()
  })

  it('drains and rebuilds the SDK channel after either referenced credential changes', async () => {
    const first = mockChannel()
    const second = mockChannel()
    const channels = [first.channel, second.channel]
    let appSecret = 'secret-one'
    const resolveCredential = vi.fn(async (_ctx: Context, ref: CredentialRef) => (
      ref === credentialRef(FEISHU_DEFAULT_APP_ID_ENV) ? 'app-one' : appSecret
    ))
    const channelFactory = vi.fn(() => {
      const next = channels.shift()
      if (next === undefined) throw new Error('unexpected extra Lark channel')
      return next
    })
    const ctx = new Context()
    const adapter = createAdapter({}, { channelFactory, resolveCredential })
    const dispose = adapter.start(ctx)
    await vi.waitFor(() => { expect(first.connect).toHaveBeenCalledOnce() })

    ctx.emit('credentials/updated', credentialRef('UNRELATED_FEISHU_SECRET'))
    await settleMicrotasks()
    expect(channelFactory).toHaveBeenCalledOnce()

    appSecret = 'secret-two'
    ctx.emit('credentials/updated', credentialRef(FEISHU_DEFAULT_APP_SECRET_ENV))
    await vi.waitFor(() => { expect(second.connect).toHaveBeenCalledOnce() })
    expect(first.disconnect).toHaveBeenCalledOnce()
    expect(channelFactory).toHaveBeenCalledTimes(2)
    expect(resolveCredential).toHaveBeenCalledTimes(4)
    await dispose()
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

  it('attempts every failed-handshake cleanup step even when earlier teardown throws', async () => {
    const sdk = mockChannel(
      () => Promise.reject(new LarkChannelError('not_connected', 'handshake failed')),
      { state: 'reconnecting', reconnectAttempts: 1 },
    )
    const close = vi.fn(() => { throw new Error('socket close failed') })
    const disposeSafety = vi.fn(async () => { throw new Error('safety dispose failed') })
    Object.assign(sdk.channel, {
      rawWsClient: { close },
      safety: { dispose: disposeSafety },
    })
    const ctx = new Context()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const adapter = createAdapter(CONFIG, { channel: sdk.channel })

    const dispose = adapter.start(ctx)
    await Promise.resolve()
    await Promise.resolve()
    await dispose()

    expect(close).toHaveBeenCalledWith({ force: true })
    expect(disposeSafety).toHaveBeenCalledOnce()
    expect(sdk.disconnect).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('failed to fully disconnect'))
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

  it('splits an ordinary long reply without cutting a surrogate pair', async () => {
    const sdk = mockChannel()
    const adapter = createAdapter(CONFIG, { channel: sdk.channel })
    const reply = `${'a'.repeat(3499)}😀tail`
    await adapter.send({
      channel: 'feishu',
      direction: 'out',
      conversationId: 'oc_1',
      replyToMessageId: 'om_1',
      text: reply,
    })

    expect(sdk.send.mock.calls).toEqual([
      ['oc_1', { text: 'a'.repeat(3499) }, { replyTo: 'om_1' }],
      ['oc_1', { text: '😀tail' }, {}],
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

  it('maps a common portable ack to Feishu\'s named reaction', async () => {
    const sdk = mockChannel()
    const adapter = createAdapter(CONFIG, { channel: sdk.channel })
    await adapter.react?.({
      channel: 'feishu', direction: 'in', conversationId: 'oc_1', messageId: 'om_1', text: 'hi',
    }, '👍')
    expect(sdk.addReaction).toHaveBeenCalledWith('om_1', 'THUMBSUP')
  })

  it('skips the ack reaction when the inbound event has no message id', async () => {
    const sdk = mockChannel()
    const adapter = createAdapter(CONFIG, { channel: sdk.channel })
    await adapter.react?.({
      channel: 'feishu', direction: 'in', conversationId: 'oc_1', text: 'hi',
    }, '👀')
    expect(sdk.addReaction).not.toHaveBeenCalled()
  })

  it('falls back to eyes for an arbitrary core identity ack emoji', async () => {
    const sdk = mockChannel()
    const adapter = createAdapter(CONFIG, { channel: sdk.channel })
    await adapter.react?.({
      channel: 'feishu', direction: 'in', conversationId: 'oc_1', messageId: 'om_1', text: 'hi',
    }, '🐚')
    expect(sdk.addReaction).toHaveBeenCalledWith('om_1', 'EYES')
  })
})
