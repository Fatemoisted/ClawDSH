import { EventEmitter } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  Events,
  GatewayIntentBits,
  Partials,
  type Client,
} from 'discord.js'
import { describe, expect, it, vi } from 'vitest'
import type { ChannelMessage } from '@clawdsh/dsh-channel-core'
import {
  buildDiscordClientOptions,
  createAdapter,
  DISCORD_DEFAULT_BOT_TOKEN_ENV,
  toInbound,
  type DiscordTextMessage,
} from '../src/index.ts'

const BOT_ID = 'bot-1'
const TEST_TOKEN = 'discord-unit-test-token'

interface MockClientOptions {
  userId?: string
  login?: (token: string) => Promise<string>
  destroy?: () => Promise<void>
  fetch?: (id: string) => Promise<unknown>
}

/** Minimal EventEmitter-backed discord.js Client surface used by the adapter. */
function mockClient(options: MockClientOptions = {}) {
  const emitter = new EventEmitter()
  const login = vi.fn(options.login ?? (async () => TEST_TOKEN))
  const destroy = vi.fn(options.destroy ?? (async () => {}))
  const fetch = vi.fn(options.fetch ?? (async () => null))
  const rawClient = Object.assign(emitter, {
    login,
    destroy,
    channels: { fetch },
    user: options.userId === undefined ? { id: BOT_ID } : { id: options.userId },
  })
  return {
    client: rawClient as unknown as Client,
    emit: (event: string, ...args: unknown[]) => emitter.emit(event, ...args),
    login,
    destroy,
    fetch,
  }
}

/** Minimal sendable/text channel without any message-cache behavior. */
function mockTextChannel() {
  const send = vi.fn(async (_payload: unknown) => ({}))
  const react = vi.fn(async (_messageId: string, _emoji: string) => ({}))
  return {
    channel: {
      isSendable: () => true,
      isTextBased: () => true,
      send,
      messages: { react },
    },
    send,
    react,
  }
}

function discordMessage(overrides: Partial<DiscordTextMessage> = {}): DiscordTextMessage {
  return {
    id: 'message-1',
    content: 'hello',
    channelId: 'channel-1',
    guildId: 'guild-1',
    author: { id: 'user-1', bot: false },
    channel: { isThread: () => false },
    mentions: { users: { has: () => false }, repliedUser: null },
    ...overrides,
  }
}

async function settleMicrotasks(): Promise<void> {
  for (let index = 0; index < 6; index++) await Promise.resolve()
}

describe('the Discord channel adapter', () => {
  describe('message normalization', () => {
    it('maps a direct message as an implicitly bot-addressed conversation', () => {
      expect(toInbound(discordMessage({ guildId: null }), undefined)).toEqual({
        channel: 'discord',
        direction: 'in',
        conversationId: 'channel-1',
        chatType: 'direct',
        mention: { detectable: true, botMentioned: true },
        sender: 'user-1',
        messageId: 'message-1',
        text: 'hello',
      })
    })

    it('detects a guild mention and removes only exact markup for this bot', () => {
      const has = vi.fn((id: string) => id === BOT_ID)
      expect(toInbound(discordMessage({
        content: `<@${BOT_ID}> hello <@other> <@!${BOT_ID}>`,
        mentions: { users: { has } },
      }), BOT_ID)).toMatchObject({
        chatType: 'group',
        mention: { detectable: true, botMentioned: true },
        text: 'hello <@other>',
      })
      expect(has).toHaveBeenCalledWith(BOT_ID)
    })

    it('uses discord.js structured reply mentions even when the body has no markup', () => {
      expect(toInbound(discordMessage({
        content: 'follow up',
        mentions: { users: { has: () => false }, repliedUser: { id: BOT_ID } },
      }), BOT_ID)).toMatchObject({
        mention: { detectable: true, botMentioned: true },
        text: 'follow up',
      })
    })

    it('does not treat everyone or role-derived provider matches as a direct bot mention', () => {
      const broadHas = vi.fn(() => true)
      const mentions = {
        users: { has: () => false },
        repliedUser: null,
        has: broadHas,
      }
      expect(toInbound(discordMessage({ content: '@everyone status', mentions }), BOT_ID)).toMatchObject({
        mention: { detectable: true, botMentioned: false },
        text: '@everyone status',
      })
      expect(broadHas).not.toHaveBeenCalled()
    })

    it('preserves an unmentioned guild body and fails detection closed without bot identity', () => {
      expect(toInbound(discordMessage({ content: '<@other> hello' }), undefined)).toMatchObject({
        mention: { detectable: false, botMentioned: false },
        text: '<@other> hello',
      })
    })

    it('maps a guild thread to its parent conversation and provider thread target', () => {
      expect(toInbound(discordMessage({
        channelId: 'thread-1',
        channel: { isThread: () => true, parentId: 'channel-parent' },
      }), BOT_ID)).toMatchObject({
        conversationId: 'channel-parent',
        threadId: 'thread-1',
        chatType: 'group',
      })
    })

    it('falls back to the thread id when Discord supplies no parent id', () => {
      expect(toInbound(discordMessage({
        channelId: 'thread-1',
        channel: { isThread: () => true, parentId: null },
      }), BOT_ID)).toMatchObject({ conversationId: 'thread-1' })
      expect(toInbound(discordMessage({
        channelId: 'thread-1',
        channel: { isThread: () => true, parentId: null },
      }), BOT_ID)?.threadId).toBeUndefined()
    })

    it('ignores bot, webhook, system, and empty text events', () => {
      expect(toInbound(discordMessage({ author: { id: 'bot-2', bot: true } }), BOT_ID)).toBeUndefined()
      expect(toInbound(discordMessage({ webhookId: 'webhook-1' }), BOT_ID)).toBeUndefined()
      expect(toInbound(discordMessage({ system: true }), BOT_ID)).toBeUndefined()
      expect(toInbound(discordMessage({
        content: `<@${BOT_ID}>   `,
        mentions: { users: { has: () => true } },
      }), BOT_ID)).toBeUndefined()
    })
  })

  describe('Gateway options and credentials', () => {
    it('uses least-privilege text intents and the DM channel partial by default', () => {
      expect(buildDiscordClientOptions()).toEqual({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.DirectMessages,
        ],
        partials: [Partials.Channel],
        allowedMentions: { parse: [], repliedUser: false },
      })
    })

    it('adds only MessageContent when the privileged intent is requested', () => {
      const options = buildDiscordClientOptions(true)
      expect(options.intents).toEqual([
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ])
    })

    it('resolves the default Harness credential reference for each login and normalizes Bot syntax', async () => {
      const sdk = mockClient()
      const resolveToken = vi.fn(async () => `  Bot ${TEST_TOKEN}  `)
      const ctx = new Context()
      const adapter = createAdapter({}, { clientFactory: () => sdk.client, resolveToken })

      const dispose = adapter.start(ctx)
      await vi.waitFor(() => { expect(sdk.login).toHaveBeenCalledWith(TEST_TOKEN) })
      expect(resolveToken).toHaveBeenCalledWith(
        ctx,
        credentialRef(DISCORD_DEFAULT_BOT_TOKEN_ENV),
      )
      expect(adapter.capabilities.receive).toBe(true)
      await dispose()
    })

    it('uses a configured literal token without asking the credential resolver', async () => {
      const sdk = mockClient()
      const resolveToken = vi.fn(async () => 'unused')
      const adapter = createAdapter(
        { botToken: ` Bot ${TEST_TOKEN} ` },
        { clientFactory: () => sdk.client, resolveToken },
      )

      const dispose = adapter.start(new Context())
      await vi.waitFor(() => { expect(sdk.login).toHaveBeenCalledWith(TEST_TOKEN) })
      expect(resolveToken).not.toHaveBeenCalled()
      await dispose()
    })

    it('stays unavailable without a resolved token and never calls login', async () => {
      const sdk = mockClient()
      const ctx = new Context()
      const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
      const adapter = createAdapter({}, {
        clientFactory: () => sdk.client,
        resolveToken: async () => undefined,
      })

      const dispose = adapter.start(ctx)
      await vi.waitFor(() => {
        expect(warn).toHaveBeenCalledWith(expect.stringContaining(DISCORD_DEFAULT_BOT_TOKEN_ENV))
      })
      expect(adapter.capabilities.receive).toBe(false)
      expect(sdk.login).not.toHaveBeenCalled()
      await dispose()
    })
  })

  describe('Gateway lifecycle', () => {
    it('retries a transient login failure through the Harness timer with a fresh client', async () => {
      vi.useFakeTimers()
      try {
        const first = mockClient({ login: async () => { throw new Error('network down') } })
        const second = mockClient()
        const clients = [first, second]
        const clientFactory = vi.fn(() => {
          const next = clients.shift()
          if (next === undefined) throw new Error('unexpected extra Discord client')
          return next.client
        })
        const ctx = new Context()
        await ctx.plugin(Timer)
        const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
        const adapter = createAdapter({}, { clientFactory, resolveToken: async () => TEST_TOKEN })

        const dispose = adapter.start(ctx)
        await settleMicrotasks()
        expect(first.login).toHaveBeenCalledOnce()
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('retrying in 1000ms'))
        expect(adapter.capabilities.receive).toBe(false)

        await vi.advanceTimersByTimeAsync(1000)
        await settleMicrotasks()
        expect(first.destroy).toHaveBeenCalledOnce()
        expect(second.login).toHaveBeenCalledWith(TEST_TOKEN)
        expect(adapter.capabilities.receive).toBe(true)

        await dispose()
        await vi.advanceTimersByTimeAsync(60_000)
        expect(clientFactory).toHaveBeenCalledTimes(2)
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not retry a permanent auth failure and redacts the token from every warning', async () => {
      vi.useFakeTimers()
      try {
        const failure = Object.assign(new Error(`invalid token ${TEST_TOKEN}`), { code: 'TokenInvalid' })
        const sdk = mockClient({ login: async () => { throw failure } })
        const clientFactory = vi.fn(() => sdk.client)
        const ctx = new Context()
        await ctx.plugin(Timer)
        const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
        const adapter = createAdapter({}, { clientFactory, resolveToken: async () => TEST_TOKEN })

        const dispose = adapter.start(ctx)
        await settleMicrotasks()
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('stopped permanently'))
        expect(warn.mock.calls.flat().join(' ')).not.toContain(TEST_TOKEN)

        await vi.advanceTimersByTimeAsync(60_000)
        expect(clientFactory).toHaveBeenCalledOnce()
        expect(sdk.login).toHaveBeenCalledOnce()
        expect(adapter.capabilities.receive).toBe(false)
        await dispose()
      } finally {
        vi.useRealTimers()
      }
    })

    it('treats disallowed Gateway intents as permanent configuration failures', async () => {
      vi.useFakeTimers()
      try {
        const failure = Object.assign(new Error('disallowed intents'), { code: 4014 })
        const sdk = mockClient({ login: async () => { throw failure } })
        const ctx = new Context()
        await ctx.plugin(Timer)
        const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
        const adapter = createAdapter({}, {
          clientFactory: () => sdk.client,
          resolveToken: async () => TEST_TOKEN,
        })

        const dispose = adapter.start(ctx)
        await settleMicrotasks()
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('stopped permanently'))
        await vi.advanceTimersByTimeAsync(60_000)
        expect(sdk.login).toHaveBeenCalledOnce()
        await dispose()
      } finally {
        vi.useRealTimers()
      }
    })

    it.each([4004, 4013, 4014])(
      'uses terminal Gateway close code %s when discord.js rejects login without a code',
      async (gatewayCode) => {
        vi.useFakeTimers()
        try {
          let rejectLogin!: (error: Error) => void
          const pendingLogin = new Promise<string>((_resolve, reject) => { rejectLogin = reject })
          const sdk = mockClient({ login: () => pendingLogin })
          const clientFactory = vi.fn(() => sdk.client)
          const ctx = new Context()
          await ctx.plugin(Timer)
          const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
          const adapter = createAdapter({}, {
            clientFactory,
            resolveToken: async () => TEST_TOKEN,
          })

          const dispose = adapter.start(ctx)
          await settleMicrotasks()
          sdk.emit(Events.ShardDisconnect, { code: gatewayCode }, 0)
          rejectLogin(new Error('plain discord.js login rejection'))
          await settleMicrotasks()

          expect(warn).toHaveBeenCalledWith(expect.stringContaining(`Gateway close ${gatewayCode}`))
          await vi.advanceTimersByTimeAsync(60_000)
          expect(clientFactory).toHaveBeenCalledOnce()
          expect(sdk.login).toHaveBeenCalledOnce()
          expect(adapter.capabilities.receive).toBe(false)
          await dispose()
        } finally {
          vi.useRealTimers()
        }
      },
    )

    it('marks receive unavailable while discord.js reconnects and restores it on resume', async () => {
      const sdk = mockClient()
      const adapter = createAdapter({}, {
        clientFactory: () => sdk.client,
        resolveToken: async () => TEST_TOKEN,
      })
      const dispose = adapter.start(new Context())
      await vi.waitFor(() => { expect(adapter.capabilities.receive).toBe(true) })

      sdk.emit(Events.ShardReconnecting, 0)
      expect(adapter.capabilities.receive).toBe(false)
      sdk.emit(Events.ShardResume, 0, 1)
      expect(adapter.capabilities.receive).toBe(true)
      await dispose()
    })

    it('rebuilds the client and re-resolves only the matching updated credential', async () => {
      const first = mockClient()
      const second = mockClient()
      const clients = [first, second]
      let token = 'credential-one'
      const resolveToken = vi.fn(async () => token)
      const clientFactory = vi.fn(() => {
        const next = clients.shift()
        if (next === undefined) throw new Error('unexpected extra Discord client')
        return next.client
      })
      const ctx = new Context()
      const adapter = createAdapter({}, { clientFactory, resolveToken })
      const dispose = adapter.start(ctx)
      await vi.waitFor(() => { expect(first.login).toHaveBeenCalledWith('credential-one') })

      ctx.emit('credentials/updated', credentialRef('UNRELATED_TOKEN'))
      await settleMicrotasks()
      expect(clientFactory).toHaveBeenCalledOnce()

      token = 'credential-two'
      ctx.emit('credentials/updated', credentialRef(DISCORD_DEFAULT_BOT_TOKEN_ENV))
      await vi.waitFor(() => { expect(second.login).toHaveBeenCalledWith('credential-two') })
      expect(first.destroy).toHaveBeenCalledOnce()
      expect(resolveToken).toHaveBeenCalledTimes(2)
      await dispose()
    })

    it('does not admit a replacement until a failed client destroy can be retried', async () => {
      let destroyAttempts = 0
      const first = mockClient({
        destroy: async () => {
          destroyAttempts += 1
          if (destroyAttempts === 1) throw new Error('temporary destroy failure')
        },
      })
      const second = mockClient()
      const clients = [first, second]
      const clientFactory = vi.fn(() => {
        const next = clients.shift()
        if (next === undefined) throw new Error('unexpected extra Discord client')
        return next.client
      })
      const ctx = new Context()
      const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
      const adapter = createAdapter({}, {
        clientFactory,
        resolveToken: async () => TEST_TOKEN,
      })
      const dispose = adapter.start(ctx)
      await vi.waitFor(() => { expect(first.login).toHaveBeenCalledOnce() })

      ctx.emit('credentials/updated', credentialRef(DISCORD_DEFAULT_BOT_TOKEN_ENV))
      await vi.waitFor(() => {
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('client destroy failed'))
      })
      expect(clientFactory).toHaveBeenCalledOnce()
      expect(adapter.capabilities.receive).toBe(false)

      ctx.emit('credentials/updated', credentialRef(DISCORD_DEFAULT_BOT_TOKEN_ENV))
      await vi.waitFor(() => { expect(second.login).toHaveBeenCalledWith(TEST_TOKEN) })
      expect(first.destroy).toHaveBeenCalledTimes(2)
      expect(clientFactory).toHaveBeenCalledTimes(2)
      await dispose()
    })

    it('single-flights concurrent client destruction and makes disposal wait for it', async () => {
      let releaseDestroy!: () => void
      const destroyGate = new Promise<void>((resolve) => { releaseDestroy = resolve })
      const first = mockClient({ destroy: () => destroyGate })
      const second = mockClient()
      const clients = [first, second]
      const clientFactory = vi.fn(() => {
        const next = clients.shift()
        if (next === undefined) throw new Error('unexpected extra Discord client')
        return next.client
      })
      const ctx = new Context()
      const adapter = createAdapter({}, {
        clientFactory,
        resolveToken: async () => TEST_TOKEN,
      })
      const dispose = adapter.start(ctx)
      await vi.waitFor(() => { expect(first.login).toHaveBeenCalledOnce() })

      ctx.emit('credentials/updated', credentialRef(DISCORD_DEFAULT_BOT_TOKEN_ENV))
      await vi.waitFor(() => { expect(first.destroy).toHaveBeenCalledOnce() })
      let disposalFinished = false
      const disposal = Promise.resolve(dispose()).then(() => { disposalFinished = true })
      await settleMicrotasks()
      expect(first.destroy).toHaveBeenCalledOnce()
      expect(disposalFinished).toBe(false)

      releaseDestroy()
      await disposal
      expect(first.destroy).toHaveBeenCalledOnce()
      expect(clientFactory).toHaveBeenCalledOnce()
    })

    it('drains an admitted inbound route before destroying its Discord client', async () => {
      const events: string[] = []
      const sdk = mockClient({ destroy: async () => { events.push('destroy') } })
      const ctx = new Context()
      let releaseInbound!: () => void
      const inboundGate = new Promise<void>((resolve) => { releaseInbound = resolve })
      let markInboundStarted!: () => void
      const inboundStarted = new Promise<void>((resolve) => { markInboundStarted = resolve })
      let received: ChannelMessage | undefined
      ctx.on('channel/inbound', async (message) => {
        received = message
        events.push('inbound start')
        markInboundStarted()
        await inboundGate
        events.push('inbound end')
      })
      const adapter = createAdapter({}, {
        clientFactory: () => sdk.client,
        resolveToken: async () => TEST_TOKEN,
      })
      const dispose = adapter.start(ctx)
      await vi.waitFor(() => { expect(sdk.login).toHaveBeenCalledOnce() })

      sdk.emit(Events.MessageCreate, discordMessage())
      await inboundStarted
      let disposed = false
      const disposal = Promise.resolve(dispose()).then(() => { disposed = true })
      await settleMicrotasks()

      expect(received).toMatchObject({ channel: 'discord', conversationId: 'channel-1', text: 'hello' })
      expect(disposed).toBe(false)
      expect(sdk.destroy).not.toHaveBeenCalled()

      releaseInbound()
      await disposal
      expect(events).toEqual(['inbound start', 'inbound end', 'destroy'])
      expect(sdk.destroy).toHaveBeenCalledOnce()
    })
  })

  describe('outbound delivery', () => {
    it('targets the thread, splits on the UTF-16 limit, quotes only the first chunk, and suppresses pings', async () => {
      const textChannel = mockTextChannel()
      const sdk = mockClient({ fetch: async () => textChannel.channel })
      const adapter = createAdapter({ botToken: TEST_TOKEN }, { clientFactory: () => sdk.client })
      const reply = `${'a'.repeat(1999)}😀tail`

      await adapter.send({
        channel: 'discord',
        direction: 'out',
        conversationId: 'channel-parent',
        threadId: 'thread-1',
        replyToMessageId: 'message-1',
        text: reply,
      })

      expect(sdk.fetch).toHaveBeenCalledWith('thread-1')
      expect(textChannel.send.mock.calls).toEqual([
        [{
          content: 'a'.repeat(1999),
          allowedMentions: { parse: [], repliedUser: false },
          reply: { messageReference: 'message-1', failIfNotExists: false },
        }],
        [{
          content: '😀tail',
          allowedMentions: { parse: [], repliedUser: false },
        }],
      ])
      expect(textChannel.send.mock.calls
        .map(([payload]) => (payload as { content: string }).content)
        .join('')).toBe(reply)
    })

    it('propagates a failed chunk and does not attempt later chunks', async () => {
      const send = vi.fn()
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('Discord send failed'))
      const channel = {
        isSendable: () => true,
        isTextBased: () => true,
        send,
        messages: { react: vi.fn() },
      }
      const sdk = mockClient({ fetch: async () => channel })
      const adapter = createAdapter({ botToken: TEST_TOKEN }, { clientFactory: () => sdk.client })

      await expect(adapter.send({
        channel: 'discord',
        direction: 'out',
        conversationId: 'channel-1',
        text: 'a'.repeat(4001),
      })).rejects.toThrow('Discord send failed')
      expect(send).toHaveBeenCalledTimes(2)
    })

    it('rejects missing and non-sendable targets before posting', async () => {
      const send = vi.fn()
      const sdk = mockClient({
        fetch: async () => ({ isSendable: () => false, send }),
      })
      const adapter = createAdapter({ botToken: TEST_TOKEN }, { clientFactory: () => sdk.client })

      await expect(adapter.send({ channel: 'discord', direction: 'out', text: 'reply' }))
        .rejects.toThrow(/conversationId or threadId/)
      await expect(adapter.send({
        channel: 'discord', direction: 'out', conversationId: 'forum-1', text: 'reply',
      })).rejects.toThrow(/not sendable/)
      expect(send).not.toHaveBeenCalled()
    })

    it('reacts through MessageManager by id without requiring a cached message', async () => {
      const textChannel = mockTextChannel()
      const sdk = mockClient({ fetch: async () => textChannel.channel })
      const adapter = createAdapter({ botToken: TEST_TOKEN }, { clientFactory: () => sdk.client })

      await adapter.react?.({
        channel: 'discord',
        direction: 'in',
        conversationId: 'channel-parent',
        threadId: 'thread-1',
        messageId: 'message-1',
        text: 'hello',
      }, '👀')

      expect(sdk.fetch).toHaveBeenCalledWith('thread-1')
      expect(textChannel.react).toHaveBeenCalledWith('message-1', '👀')
    })

    it('skips a reaction that has no provider message id', async () => {
      const textChannel = mockTextChannel()
      const sdk = mockClient({ fetch: async () => textChannel.channel })
      const adapter = createAdapter({ botToken: TEST_TOKEN }, { clientFactory: () => sdk.client })

      await adapter.react?.({
        channel: 'discord', direction: 'in', conversationId: 'channel-1', text: 'hello',
      }, '👀')
      expect(sdk.fetch).not.toHaveBeenCalled()
      expect(textChannel.react).not.toHaveBeenCalled()
    })
  })
})
