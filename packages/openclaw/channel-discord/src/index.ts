/**
 * Discord channel adapter over the `ctx.channels` seam, backed by discord.js.
 *
 * The platform SDK owns Gateway heartbeats/reconnect and REST rate limits. The
 * adapter only maps Discord messages, performs provider-native sends/reactions,
 * and attaches those operations to Harness lifecycle. Sessions, FIFO routing,
 * mention policy, agent execution, acknowledgement policy, and durable logs
 * remain in `@clawdsh/dsh-channel-core`.
 * @module @clawdsh/dsh-channel-discord
 */

import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
} from 'discord.js'
import type { ClientOptions, Message } from 'discord.js'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/cordis-plugin-timer'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { registerChannelAdapter, splitTextByUtf16Limit } from '@clawdsh/dsh-channel-core'
import type { ChannelAdapter, ChannelMessage } from '@clawdsh/dsh-channel-core'

/** Cordis plugin name. */
export const name = 'channel-discord'

/** Harness services used by the adapter. */
export const inject = ['channels', 'timer']

/** Default Harness credential reference for the Discord bot token. */
export const DISCORD_DEFAULT_BOT_TOKEN_ENV = 'DISCORD_BOT_TOKEN'

/** Discord's maximum message content length, measured in UTF-16 code units. */
const DISCORD_MESSAGE_LIMIT = 2000
const INITIAL_LOGIN_RETRY_MS = 1000
const MAX_LOGIN_RETRY_MS = 30_000

/** Plugin configuration. */
export interface Config {
  /** Literal token for programmatic use; prefer `botTokenEnv` so config never contains the secret. */
  botToken?: string
  /** Harness credential reference resolved when opening the Gateway. */
  botTokenEnv?: string
  /** Request the privileged guild Message Content intent. Off by default for least privilege. */
  messageContentIntent?: boolean
}

/** Runtime schema for the Discord adapter. */
export const Config: z<Config> = z.object({
  botToken: z.string().role('secret'),
  botTokenEnv: z.string().role('credential-ref').default(DISCORD_DEFAULT_BOT_TOKEN_ENV),
  messageContentIntent: z.boolean().default(false),
})

/** Minimal Discord message surface consumed by the pure normalizer. */
export interface DiscordTextMessage {
  id: string
  content: string
  channelId: string
  guildId: string | null
  author: { id: string; bot: boolean }
  webhookId?: string | null
  system?: boolean
  channel: {
    isThread(): boolean
    parentId?: string | null
  }
  mentions: {
    users: { has(user: string): boolean }
    repliedUser?: { id: string } | null
  }
}

/** Dependency-injection seams used by deterministic tests. */
export interface AdapterDeps {
  /** Client factory; production uses `new discord.js Client(options)`. */
  clientFactory?: (options: ClientOptions) => Client
  /** Credential resolver override; production uses Harness credentials / launch environment. */
  resolveToken?: (ctx: Context, ref: CredentialRef) => Promise<string | undefined>
}

/**
 * Build the least-privilege Discord client options for this text adapter.
 *
 * @param messageContentIntent - Whether to request Discord's privileged Message Content intent.
 * @returns Client options containing only the intents and partials required by this adapter.
 */
export function buildDiscordClientOptions(messageContentIntent = false): ClientOptions {
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
  ]
  if (messageContentIntent) intents.push(GatewayIntentBits.MessageContent)
  return {
    intents,
    partials: [Partials.Channel],
    allowedMentions: { parse: [], repliedUser: false },
  }
}

/** Remove only Discord's exact markup for the current bot, preserving every other mention. */
function removeBotMention(text: string, botId: string | undefined): string {
  if (botId === undefined) return text
  const escaped = botId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(new RegExp(`<@!?${escaped}>`, 'g'), '')
}

/**
 * Normalize one Discord text message for channel-core.
 * @param message - provider message event.
 * @param botId - current authenticated bot id, if login has established it.
 * @returns the normalized inbound message, or `undefined` for ignored/non-text events.
 */
export function toInbound(
  message: DiscordTextMessage,
  botId: string | undefined,
): ChannelMessage | undefined {
  if (message.author.bot || message.webhookId != null || message.system === true) return undefined
  const isDirect = message.guildId === null
  const botMentioned = botId !== undefined
    && (message.mentions.users.has(botId) || message.mentions.repliedUser?.id === botId)
  const text = removeBotMention(message.content, botMentioned || isDirect ? botId : undefined).trim()
  if (text === '') return undefined

  const isThread = message.channel.isThread()
  const parentId = isThread ? message.channel.parentId : undefined
  const conversationId = parentId == null || parentId === '' ? message.channelId : parentId
  return {
    channel: 'discord',
    direction: 'in',
    conversationId,
    ...(isThread && parentId != null && parentId !== '' ? { threadId: message.channelId } : {}),
    chatType: isDirect ? 'direct' : 'group',
    mention: {
      detectable: isDirect || botId !== undefined,
      botMentioned: isDirect || botMentioned,
    },
    sender: message.author.id,
    messageId: message.id,
    text,
  }
}

/** Render an error without ever exposing the currently used token. */
function describe(error: unknown, secret?: string): string {
  const rendered = error instanceof Error ? error.message : String(error)
  return secret === undefined || secret === '' ? rendered : rendered.replaceAll(secret, '[redacted]')
}

/** Extract a Discord/REST/Gateway error code without depending on one concrete error class. */
function errorCode(error: unknown): string | number | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const code = error.code
  return typeof code === 'string' || typeof code === 'number' ? code : undefined
}

/** Invalid tokens and invalid/disallowed intent sets cannot recover with the same configuration. */
function isRetryableLoginError(error: unknown, terminalGatewayCode?: number): boolean {
  // discord.js emits `ShardDisconnect` only for Gateway close codes it will no
  // longer reconnect. The subsequent login rejection is often a plain Error
  // without the close code, so the event is the authoritative signal.
  if (terminalGatewayCode !== undefined) return false
  const code = errorCode(error)
  return code !== 'TokenInvalid'
    && code !== 'DisallowedIntents'
    && code !== 4004
    && code !== 4013
    && code !== 4014
}

/** Strip an optional API-style prefix and surrounding whitespace from a token. */
function normalizeToken(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const token = value.trim().replace(/^Bot\s+/i, '')
  return token === '' ? undefined : token
}

/** Resolve one Gateway token through the same Harness credential layers as other providers. */
async function resolveBotToken(
  ctx: Context,
  config: Config,
  ref: CredentialRef,
  override: AdapterDeps['resolveToken'],
): Promise<string | undefined> {
  const literal = normalizeToken(config.botToken)
  if (literal !== undefined) return literal
  if (override !== undefined) return normalizeToken(await override(ctx, ref))
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) return normalizeToken((await credentials.resolve(ref))?.value)
  return normalizeToken(launchEnvironmentOf(ctx).get(String(ref))?.value)
}

/** Resolve a channel/thread send target from the normalized contract. */
function targetId(message: ChannelMessage): string | undefined {
  const target = message.threadId ?? message.conversationId
  return target === undefined || target === '' ? undefined : target
}

/** Post one outbound response, preserving thread and native-reply semantics. */
async function sendMessage(client: Client, message: ChannelMessage): Promise<void> {
  const target = targetId(message)
  if (target === undefined) throw new Error('discord: send requires a conversationId or threadId')
  const channel = await client.channels.fetch(target)
  if (channel === null || !channel.isSendable()) {
    throw new Error(`discord: channel ${target} is not sendable`)
  }
  const chunks = splitTextByUtf16Limit(message.text, DISCORD_MESSAGE_LIMIT)
  for (let index = 0; index < chunks.length; index++) {
    const content = chunks[index]
    if (content === undefined) continue
    await channel.send({
      content,
      allowedMentions: { parse: [], repliedUser: false },
      ...(index === 0 && message.replyToMessageId !== undefined
        ? {
          reply: {
            messageReference: message.replyToMessageId,
            failIfNotExists: false,
          },
        }
        : {}),
    })
  }
}

/** Attach an acknowledgement emoji without requiring the target message in cache. */
async function react(client: Client, message: ChannelMessage, emoji: string): Promise<void> {
  const target = targetId(message)
  if (target === undefined || message.messageId === undefined || message.messageId === '') return
  const channel = await client.channels.fetch(target)
  if (channel === null || !channel.isTextBased() || !('messages' in channel)) {
    throw new Error(`discord: channel ${target} cannot contain messages`)
  }
  await channel.messages.react(message.messageId, emoji)
}

/** Start Gateway delivery and return a retrying, credential-aware, drain-first disposer. */
function startGateway(
  ctx: Context,
  config: Config,
  ref: CredentialRef,
  makeClient: () => Client,
  initialClient: Client,
  setClient: (client: Client) => void,
  setReceiving: (receiving: boolean) => void,
  resolveTokenOverride: AdapterDeps['resolveToken'],
): () => Promise<void> {
  let client = initialClient
  let activeToken: string | undefined
  let disposed = false
  let generation = 0
  let attempt = 0
  let terminalGatewayCode: number | undefined
  let cancelRetry: (() => void) | undefined
  let loginTask: Promise<void> | undefined
  let maintenance = Promise.resolve()
  const inFlightMessages = new Set<Promise<void>>()
  const destroyedClients = new WeakSet<Client>()
  const destroyTasks = new WeakMap<Client, Promise<void>>()

  const onMessage = (message: Message): void => {
    const inbound = toInbound(message, client.user?.id)
    if (inbound === undefined) return
    const operation = ctx.parallel('channel/inbound', inbound)
    inFlightMessages.add(operation)
    void operation.then(
      () => { inFlightMessages.delete(operation) },
      (error: unknown) => {
        inFlightMessages.delete(operation)
        ctx.logger.warn(`channel-discord: inbound route failed: ${describe(error, activeToken)}`)
      },
    )
  }
  const onError = (error: Error): void => {
    ctx.logger.warn(`channel-discord: ${describe(error, activeToken)}`)
  }
  const onWarn = (warning: string): void => {
    ctx.logger.warn(`channel-discord: ${describe(warning, activeToken)}`)
  }
  const onReady = (): void => { setReceiving(true) }
  const onShardDisconnect = (event: { code: number }): void => {
    terminalGatewayCode = event.code
    setReceiving(false)
  }
  const onShardReconnecting = (): void => { setReceiving(false) }
  const onShardReady = (): void => { setReceiving(true) }
  const onInvalidated = (): void => { setReceiving(false) }

  const attach = (target: Client): void => {
    target.on(Events.MessageCreate, onMessage)
    target.on(Events.Error, onError)
    target.on(Events.Warn, onWarn)
    target.on(Events.ClientReady, onReady)
    target.on(Events.ShardDisconnect, onShardDisconnect)
    target.on(Events.ShardError, onError)
    target.on(Events.ShardReconnecting, onShardReconnecting)
    target.on(Events.ShardReady, onShardReady)
    target.on(Events.ShardResume, onShardReady)
    target.on(Events.Invalidated, onInvalidated)
  }
  const stopAdmission = (target: Client): void => {
    target.off(Events.MessageCreate, onMessage)
    // Once drain/replacement begins, stale lifecycle events from this client
    // must not flip the shared receive capability back to true.
    target.off(Events.ClientReady, onReady)
    target.off(Events.ShardDisconnect, onShardDisconnect)
    target.off(Events.ShardError, onError)
    target.off(Events.ShardReconnecting, onShardReconnecting)
    target.off(Events.ShardReady, onShardReady)
    target.off(Events.ShardResume, onShardReady)
    target.off(Events.Invalidated, onInvalidated)
  }
  const detach = (target: Client): void => {
    stopAdmission(target)
    target.off(Events.Error, onError)
    target.off(Events.Warn, onWarn)
  }
  const drain = async (): Promise<void> => {
    while (inFlightMessages.size > 0) {
      await Promise.allSettled([...inFlightMessages])
    }
  }
  const destroyClient = (target: Client): Promise<void> => {
    if (destroyedClients.has(target)) return Promise.resolve()
    const currentTask = destroyTasks.get(target)
    if (currentTask !== undefined) return currentTask
    const task = (async () => {
      await target.destroy()
      destroyedClients.add(target)
    })()
    destroyTasks.set(target, task)
    void task.then(
      () => {
        if (destroyTasks.get(target) === task) destroyTasks.delete(target)
      },
      () => {
        if (destroyTasks.get(target) === task) destroyTasks.delete(target)
      },
    )
    return task
  }

  const scheduleRetry = (
    error: unknown,
    token: string | undefined,
    localGeneration: number,
    gatewayCode: number | undefined,
  ): void => {
    if (disposed || localGeneration !== generation) return
    setReceiving(false)
    if (!isRetryableLoginError(error, gatewayCode)) {
      const codeSuffix = gatewayCode === undefined ? '' : ` (Gateway close ${gatewayCode})`
      ctx.logger.warn(`channel-discord: login stopped permanently: ${describe(error, token)}${codeSuffix}`)
      return
    }
    const delay = Math.min(INITIAL_LOGIN_RETRY_MS * 2 ** attempt, MAX_LOGIN_RETRY_MS)
    attempt += 1
    ctx.logger.warn(`channel-discord: login failed: ${describe(error, token)}; retrying in ${delay}ms`)
    cancelRetry = ctx.timeout(() => {
      cancelRetry = undefined
      queueReplacement()
    }, delay)
  }

  const connect = (): void => {
    if (disposed) return
    const target = client
    const localGeneration = generation
    terminalGatewayCode = undefined
    const task = (async () => {
      const token = await resolveBotToken(ctx, config, ref, resolveTokenOverride)
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- dispose/credential rotation can run while resolution is awaited.
      if (disposed || localGeneration !== generation) return
      if (token === undefined) {
        setReceiving(false)
        ctx.logger.warn(`channel-discord: no bot token resolved for ${String(ref)}`)
        return
      }
      activeToken = token
      await target.login(token)
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- dispose/credential rotation can run while login is awaited.
      if (disposed || localGeneration !== generation) return
      attempt = 0
      setReceiving(true)
    })()
    loginTask = task
    void task.then(undefined, (error: unknown) => {
      scheduleRetry(error, activeToken, localGeneration, terminalGatewayCode)
    }).finally(() => {
      if (loginTask === task) loginTask = undefined
    })
  }

  const replaceClient = async (): Promise<void> => {
    if (disposed) return
    cancelRetry?.()
    cancelRetry = undefined
    generation += 1
    const previous = client
    stopAdmission(previous)
    setReceiving(false)
    await drain()
    try {
      await destroyClient(previous)
    } catch (error: unknown) {
      ctx.logger.warn(`channel-discord: client destroy failed: ${describe(error, activeToken)}`)
      // Keep the failed client current so a later retry/credential update can
      // attempt cleanup again instead of admitting a second live Gateway.
      return
    }
    await (loginTask ?? Promise.resolve()).catch(() => undefined)
    detach(previous)
    activeToken = undefined
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- disposal can start while the prior client drains/destroys.
    if (disposed) return
    client = makeClient()
    setClient(client)
    attach(client)
    connect()
  }

  function queueReplacement(): void {
    maintenance = maintenance.then(replaceClient, replaceClient)
    void maintenance.catch((error: unknown) => {
      ctx.logger.warn(`channel-discord: client restart failed: ${describe(error, activeToken)}`)
    })
  }

  attach(client)
  connect()
  const disposeCredentialUpdate = ctx.on('credentials/updated', (updated) => {
    if (normalizeToken(config.botToken) !== undefined || updated !== ref || disposed) return
    attempt = 0
    queueReplacement()
  })

  return async () => {
    disposed = true
    generation += 1
    cancelRetry?.()
    cancelRetry = undefined
    disposeCredentialUpdate()
    stopAdmission(client)
    setReceiving(false)
    await drain()
    try {
      await destroyClient(client)
    } catch (error: unknown) {
      ctx.logger.warn(`channel-discord: client destroy failed: ${describe(error, activeToken)}`)
    }
    await (loginTask ?? Promise.resolve()).catch(() => undefined)
    await maintenance.catch(() => undefined)
    detach(client)
    activeToken = undefined
  }
}

/**
 * Build the Discord adapter from validated config.
 * @param config - token reference and optional privileged-intent switch.
 * @param deps - optional deterministic test seams.
 * @returns the adapter to register with `ctx.channels`.
 */
export function createAdapter(config: Config = {}, deps: AdapterDeps = {}): ChannelAdapter {
  const tokenRef = credentialRef(config.botTokenEnv ?? DISCORD_DEFAULT_BOT_TOKEN_ENV)
  const options = buildDiscordClientOptions(config.messageContentIntent ?? false)
  const makeClient = (): Client => deps.clientFactory?.(options) ?? new Client(options)
  let client = makeClient()
  const capabilities = { receive: false, send: true, react: true }
  return {
    id: 'discord',
    capabilities,
    start: ctx => startGateway(
      ctx,
      config,
      tokenRef,
      makeClient,
      client,
      (next) => { client = next },
      (receiving) => { capabilities.receive = receiving },
      deps.resolveToken,
    ),
    send: message => sendMessage(client, message),
    react: (message, emoji) => react(client, message, emoji),
  }
}

/** Mount the Discord adapter into the Harness channel registry. */
export function apply(ctx: Context, config: Config): void {
  registerChannelAdapter(ctx, () => createAdapter(config))
}
