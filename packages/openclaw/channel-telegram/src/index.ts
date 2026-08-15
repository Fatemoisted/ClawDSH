/**
 * A Telegram channel adapter over the `ctx.legacyChannels` seam, backed by grammY.
 *
 * Inbound messages arrive through grammY's long polling: the adapter runs a
 * `Bot` with a `message` handler that maps text and caption bodies onto
 * `channel/inbound`. Outbound replies post through `bot.api.sendMessage`,
 * preserving topics and native replies. Durable cross-process inbox/outbox
 * de-duplication is intentionally not claimed by this adapter.
 *
 * Webhook delivery remains outside this adapter. Supported Telegram images
 * are imported through the Harness attachment seam after channel admission.
 * @module @clawdsh/dsh-channel-telegram
 */

import { Bot } from 'grammy'
import type { ReactionTypeEmoji } from 'grammy/types'
import { autoRetry } from '@grammyjs/auto-retry'
import { hydrateFiles } from '@grammyjs/files'
import type { FileApiFlavor } from '@grammyjs/files'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/cordis-plugin-timer'
import type { ImageAttachmentRef, ImageMediaType, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  createChannelMaintenanceQueue,
  normalizeChannelCredential,
  registerLegacyChannelAdapter,
  resolveChannelCredential,
  splitTextByUtf16Limit,
} from '@clawdsh/dsh-channel-core'
import type { ChannelAdapter, ChannelImageSource, ChannelMessage } from '@clawdsh/dsh-channel-core'

/** Cordis plugin name. */
export const name = 'channel-telegram'

/** The channel registry this adapter contributes to. */
export const inject = ['legacyChannels', 'timer']

/** Outer lifecycle retry after grammY's own polling/API retry policy gives up. */
const INITIAL_POLLING_RETRY_MS = 1000
const MAX_POLLING_RETRY_MS = 30_000
/** Default total deadline for importing one Telegram file. */
export const DEFAULT_IMAGE_DOWNLOAD_TIMEOUT_MS = 30_000

/** Default Harness credential reference for the Telegram bot token. */
export const TELEGRAM_DEFAULT_BOT_TOKEN_ENV = 'TELEGRAM_BOT_TOKEN'

/** One current-to-stable Telegram chat id mapping kept across a group migration. */
export interface TelegramChatIdAlias {
  /** Current Telegram chat id used for provider delivery. */
  chatId: string
  /** Stable prior chat id used only to derive the durable Harness session. */
  sessionChatId: string
}

/** Plugin config: the bot token plus long-polling tuning. */
export interface Config {
  /** Literal token for programmatic use; prefer {@link botTokenEnv}. */
  botToken?: string
  /** Harness credential reference resolved when opening Telegram. */
  botTokenEnv?: string
  /** When `false`, the adapter is send-only and does not poll for inbound messages. */
  polling?: boolean
  /** Long-poll hold timeout in seconds (Telegram clamps to 1–60). */
  timeout?: number
  /** Total deadline in milliseconds for downloading one admitted image. */
  imageDownloadTimeoutMs?: number
  /** Persisted current-to-stable chat ids for migrations observed before this process. */
  chatIdAliases?: TelegramChatIdAlias[]
}

/** Runtime schema for the Telegram adapter. */
export const Config: z<Config> = z.object({
  botToken: z.string().role('secret'),
  botTokenEnv: z.string().role('credential-ref').default(TELEGRAM_DEFAULT_BOT_TOKEN_ENV),
  polling: z.boolean().default(true),
  timeout: z.number().step(1).min(1).max(60).default(30),
  imageDownloadTimeoutMs: z.number().step(1).min(1000).max(MAX_TIMER_DELAY_MS)
    .default(DEFAULT_IMAGE_DOWNLOAD_TIMEOUT_MS),
  chatIdAliases: z.array(z.object({
    chatId: z.string().required(),
    sessionChatId: z.string().required(),
  })).default([]),
})

/** One Telegram entity used for provider-structured mention detection. */
interface TelegramMessageEntity {
  type: string
  offset: number
  length: number
  user?: { id: number }
}

/** Telegram's metadata for one generated size of a photo. */
interface TelegramPhotoSize {
  file_id: string
  width: number
  height: number
  file_size?: number
}

/** Telegram document metadata used only when the document is a supported raster image. */
interface TelegramDocument {
  file_id: string
  file_name?: string
  mime_type?: string
  file_size?: number
}

/** The grammY message context fields this adapter consumes. */
export interface TelegramTextContext {
  message: {
    text?: string
    caption?: string
    entities?: TelegramMessageEntity[]
    caption_entities?: TelegramMessageEntity[]
    photo?: TelegramPhotoSize[]
    document?: TelegramDocument
    message_id: number
    message_thread_id?: number
    reply_to_message?: {
      message_id: number
      from?: { id: number; is_bot?: boolean; username?: string }
    }
    migrate_to_chat_id?: number
    migrate_from_chat_id?: number
  }
  chat: { id: number; type: string }
  from?: { id: number }
  me?: { id: number; username?: string }
}

/** Dependency injection seam so tests can substitute the bot. */
export interface AdapterDeps {
  /** grammY bot; when omitted, one is built from the token. */
  bot?: Bot
  /** Bot factory; production uses `new Bot(token)`. */
  botFactory?: (token: string) => Bot
  /** Credential resolver override; production uses Harness credentials / launch environment. */
  resolveToken?: (ctx: Context, ref: CredentialRef) => Promise<string | undefined>
  /** File transport override; production uses the Node fetch implementation. */
  fetch?: typeof globalThis.fetch
}

/**
 * Map a grammY message context to a normalized inbound message.
 * @param ctx - the grammY message context.
 * @param sessionConversationId - stable session identity when the delivery chat id replaced an older id.
 * @returns the inbound message to emit, or `undefined` without usable text or image input.
 */
export function toInbound(
  ctx: TelegramTextContext,
  sessionConversationId?: string,
): ChannelMessage | undefined {
  const body = ctx.message.text ?? ctx.message.caption ?? ''
  const images = telegramImages(ctx.message)
  if (body === '' && images.length === 0) return undefined
  const entities = ctx.message.text === undefined
    ? (ctx.message.caption_entities ?? [])
    : (ctx.message.entities ?? [])
  const mentionRanges = botMentionRanges(body, entities, ctx.me)
  const text = removeEntityRanges(body, mentionRanges).trim()
  if (text === '' && images.length === 0) return undefined
  const isDirect = ctx.chat.type === 'private'
  const repliedToBot = ctx.me !== undefined
    && ctx.message.reply_to_message?.from?.id === ctx.me.id
  return {
    channel: 'telegram',
    direction: 'in',
    conversationId: String(ctx.chat.id),
    ...(sessionConversationId === undefined || sessionConversationId === String(ctx.chat.id)
      ? {}
      : { sessionConversationId }),
    ...(ctx.message.message_thread_id === undefined
      ? {}
      : { threadId: String(ctx.message.message_thread_id) }),
    chatType: isDirect ? 'direct' : 'group',
    mention: {
      detectable: isDirect || ctx.me !== undefined,
      botMentioned: isDirect || mentionRanges.length > 0 || repliedToBot,
    },
    ...(ctx.from === undefined ? {} : { sender: String(ctx.from.id) }),
    messageId: String(ctx.message.message_id),
    text,
    ...(images.length === 0 ? {} : { images }),
  }
}

/** Map one Telegram photo/image-document payload to an ephemeral provider source. */
function telegramImages(message: TelegramTextContext['message']): ChannelImageSource[] {
  if (message.photo !== undefined && message.photo.length > 0) {
    const photo = message.photo.reduce((largest, candidate) => {
      const candidateArea = candidate.width * candidate.height
      const largestArea = largest.width * largest.height
      if (candidateArea !== largestArea) return candidateArea > largestArea ? candidate : largest
      return (candidate.file_size ?? 0) > (largest.file_size ?? 0) ? candidate : largest
    })
    return [{
      sourceId: photo.file_id,
      mediaType: 'image/jpeg',
      ...(photo.file_size === undefined ? {} : { bytes: photo.file_size }),
    }]
  }
  const document = message.document
  const mediaType = imageMediaType(document?.mime_type)
  if (document === undefined || mediaType === undefined) return []
  return [{
    sourceId: document.file_id,
    mediaType,
    ...(document.file_size === undefined ? {} : { bytes: document.file_size }),
    ...(document.file_name === undefined ? {} : { name: document.file_name }),
  }]
}

/** Accept only raster formats supported by the Harness attachment seam. */
function imageMediaType(value: string | undefined): ImageMediaType | undefined {
  const normalized = value?.toLocaleLowerCase()
  if (normalized === 'image/png' || normalized === 'image/jpeg'
    || normalized === 'image/webp' || normalized === 'image/gif') return normalized
  return undefined
}

/** Return structured entity ranges that identify the current bot. */
function botMentionRanges(
  body: string,
  entities: readonly TelegramMessageEntity[],
  me: TelegramTextContext['me'],
): Array<{ offset: number; length: number }> {
  if (me === undefined) return []
  const username = me.username?.toLocaleLowerCase()
  const ranges: Array<{ offset: number; length: number }> = []
  for (const entity of entities) {
    if (entity.type === 'text_mention' && entity.user?.id === me.id) {
      ranges.push(entity)
      continue
    }
    if (username === undefined) continue
    const token = body.slice(entity.offset, entity.offset + entity.length)
    if (entity.type === 'mention' && token.toLocaleLowerCase() === `@${username}`) {
      ranges.push(entity)
      continue
    }
    // Telegram represents `/help@ClawBot` as one `bot_command` entity.
    // Match grammY's command addressing rule (commands start at offset zero),
    // but remove only the `@ClawBot` target so the model still receives
    // `/help` and can route it through the ordinary prompt/tool surface.
    if (entity.type !== 'bot_command' || entity.offset !== 0) continue
    const separator = token.lastIndexOf('@')
    if (separator <= 1 || token.slice(separator + 1).toLocaleLowerCase() !== username) continue
    ranges.push({ offset: entity.offset + separator, length: entity.length - separator })
  }
  return ranges
}

/** Remove UTF-16 entity spans (Telegram's offset unit) without shifting later spans. */
function removeEntityRanges(
  body: string,
  ranges: readonly { offset: number; length: number }[],
): string {
  return [...ranges]
    .sort((left, right) => right.offset - left.offset)
    .reduce((text, range) => text.slice(0, range.offset) + text.slice(range.offset + range.length), body)
}

/** Render an error without exposing the currently active token. */
function describe(error: unknown, secret?: string): string {
  const rendered = error instanceof Error ? error.message : String(error)
  return secret === undefined || secret === '' ? rendered : rendered.replaceAll(secret, '[redacted]')
}

/** Resolve one chat alias chain and reject cycles before it can split routing. */
function resolveChatAlias(aliases: ReadonlyMap<string, string>, chatId: string): string {
  const seen = new Set<string>()
  let current = chatId
  while (true) {
    if (seen.has(current)) throw new TypeError('telegram: chatIdAliases must not contain a cycle')
    seen.add(current)
    const next = aliases.get(current)
    if (next === undefined) return current
    current = next
  }
}

/** Build validated current-to-stable chat aliases from deployment config. */
function createChatAliases(configured: readonly TelegramChatIdAlias[]): Map<string, string> {
  const aliases = new Map<string, string>()
  for (const alias of configured) {
    const chatId = String(parseTelegramId(alias.chatId, 'chatIdAliases.chatId'))
    const sessionChatId = String(parseTelegramId(alias.sessionChatId, 'chatIdAliases.sessionChatId'))
    const existing = aliases.get(chatId)
    if (existing !== undefined && existing !== sessionChatId) {
      throw new TypeError(`telegram: conflicting chatIdAliases entries for ${chatId}`)
    }
    if (chatId !== sessionChatId) aliases.set(chatId, sessionChatId)
  }
  for (const chatId of aliases.keys()) resolveChatAlias(aliases, chatId)
  return aliases
}

/** Read the old and current chat ids from one Telegram migration service message. */
function chatMigration(message: TelegramTextContext): TelegramChatIdAlias | undefined {
  const migrateTo = message.message.migrate_to_chat_id
  const migrateFrom = message.message.migrate_from_chat_id
  if (migrateTo === undefined && migrateFrom === undefined) return undefined
  const chatId = String(migrateTo ?? message.chat.id)
  return { chatId, sessionChatId: String(migrateFrom ?? message.chat.id) }
}

/** Telegram API error code without coupling lifecycle policy to a concrete error class. */
function telegramErrorCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('error_code' in error)) return undefined
  const code = error.error_code
  return typeof code === 'number' ? code : undefined
}

/** Authentication and competing-poller conflicts require operator action. */
function isRetryablePollingError(error: unknown): boolean {
  const code = telegramErrorCode(error)
  return code !== 401 && code !== 409
}

/** Start grammY long polling and return its retrying, drain-aware disposer. */
function startPolling(
  ctx: Context,
  bot: Bot,
  timeout: number,
  aliases: ReadonlyMap<string, string>,
  blockedMigratedChats: Set<string>,
  activeToken: string | undefined,
  setPollingState: (receiving: boolean, authenticationFailed?: boolean) => void,
): () => Promise<void> {
  bot.catch((error) => {
    ctx.logger.warn(`channel-telegram: ${describe(error, activeToken)}`)
  })
  bot.on('message', async (message) => {
    const migration = chatMigration(message)
    if (migration !== undefined) {
      const current = String(parseTelegramId(migration.chatId, 'migrate chat id'))
      const previous = String(parseTelegramId(migration.sessionChatId, 'migrate prior chat id'))
      if (resolveChatAlias(aliases, current) !== resolveChatAlias(aliases, previous)) {
        blockedMigratedChats.add(current)
        ctx.logger.warn(
          `channel-telegram: chat migrated from ${previous} to ${current}; `
          + `messages received for ${current} after this update are paused; `
          + 'earlier delivery may already have raced this service update; '
          + `add { chatId: '${current}', sessionChatId: '${previous}' } to chatIdAliases and remount`,
        )
      }
      return
    }
    const conversationId = String(message.chat.id)
    if (blockedMigratedChats.has(conversationId)) return
    const inbound = toInbound(message, resolveChatAlias(aliases, conversationId))
    if (inbound !== undefined) await ctx.parallel('channel/inbound', inbound)
  })
  let disposed = false
  let attempt = 0
  let cancelRetry: (() => void) | undefined
  let pollingTask: Promise<void> | undefined
  const scheduleRetry = (error: unknown): void => {
    if (disposed) return
    const code = telegramErrorCode(error)
    setPollingState(false, code === 401)
    if (!isRetryablePollingError(error)) {
      ctx.logger.warn(`channel-telegram: polling stopped permanently: ${describe(error, activeToken)}`)
      return
    }
    const delay = Math.min(INITIAL_POLLING_RETRY_MS * 2 ** attempt, MAX_POLLING_RETRY_MS)
    attempt += 1
    ctx.logger.warn(
      `channel-telegram: polling stopped: ${describe(error, activeToken)}; retrying in ${delay}ms`,
    )
    cancelRetry = ctx.timeout(() => {
      cancelRetry = undefined
      start()
    }, delay)
  }
  const start = (): void => {
    if (disposed) return
    try {
      pollingTask = bot.start({
        allowed_updates: ['message'],
        timeout,
        onStart: () => {
          attempt = 0
          setPollingState(true)
        },
      })
      void pollingTask.then(
        () => { scheduleRetry(new Error('polling task ended unexpectedly')) },
        (error: unknown) => { scheduleRetry(error) },
      )
    } catch (error: unknown) {
      scheduleRetry(error)
    }
  }
  start()
  return async () => {
    disposed = true
    setPollingState(false)
    cancelRetry?.()
    cancelRetry = undefined
    try {
      await bot.stop()
    } catch (error) {
      ctx.logger.warn(`channel-telegram: polling stop failed: ${describe(error, activeToken)}`)
    }
    // grammY resolves start() only after polling has stopped and all active
    // middleware has completed, so awaiting it makes adapter disposal a drain.
    await (pollingTask ?? Promise.resolve()).catch(() => undefined)
  }
}

/** Post an outbound reply through `sendMessage`. */
async function sendMessage(bot: Bot, message: ChannelMessage): Promise<void> {
  if (message.conversationId === undefined || message.conversationId === '') {
    throw new Error('telegram: send requires a conversationId (chat id)')
  }
  const topicOptions = {
    ...(message.threadId === undefined
      ? {}
      : { message_thread_id: parseTelegramId(message.threadId, 'threadId') }),
  }
  const replyOptions = {
    ...(message.replyToMessageId === undefined
      ? {}
      : {
        reply_parameters: {
          message_id: parseTelegramId(message.replyToMessageId, 'replyToMessageId'),
          allow_sending_without_reply: true,
        },
      }),
  }
  const chunks = splitTextByUtf16Limit(message.text, 4096)
  for (let index = 0; index < chunks.length; index++) {
    const options = {
      ...topicOptions,
      ...(index === 0 ? replyOptions : {}),
    }
    const chunk = chunks[index]
    if (chunk === undefined) continue
    if (Object.keys(options).length === 0) {
      await bot.api.sendMessage(message.conversationId, chunk)
    } else {
      await bot.api.sendMessage(message.conversationId, chunk, options)
    }
  }
}

/** Parse one provider integer id without accepting truncation or NaN. */
function parseTelegramId(value: string, field: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new Error(`telegram: ${field} must be an integer`)
  return parsed
}

/** Attach an ack emoji reaction to an inbound message through `setMessageReaction`. */
async function react(bot: Bot, message: ChannelMessage, emoji: string): Promise<void> {
  if (message.conversationId === undefined || message.messageId === undefined) return
  // The channel contract carries an arbitrary emoji; grammY types the platform's
  // supported reaction set. An unsupported emoji is rejected by the API at
  // runtime and surfaces as the caller's logged warning, not silently.
  const reaction: ReactionTypeEmoji['emoji'] = emoji as ReactionTypeEmoji['emoji']
  await bot.api.setMessageReaction(
    message.conversationId,
    parseTelegramId(message.messageId, 'messageId'),
    [{ type: 'emoji', emoji: reaction }],
  )
}

/** Install official bounded retry and file-result hydration once per Bot instance. */
const configuredBots = new WeakSet<Bot>()

function configureBot(bot: Bot, token: string): void {
  if (configuredBots.has(bot)) return
  bot.api.config.use(autoRetry({
    maxRetryAttempts: 3,
    maxDelaySeconds: 30,
    // auto-retry 2.0.2 otherwise retries HttpError in an unbounded inner loop,
    // outside maxRetryAttempts. Surface a persistent network failure so core
    // delivery and shutdown remain finite; 429/5xx responses stay retried.
    rethrowHttpErrors: true,
  }))
  bot.api.config.use(hydrateFiles(token))
  configuredBots.add(bot)
}

/** Download all selected Telegram files with Harness aggregate and per-image limits. */
async function materializeImages(
  ctx: Context,
  bot: Bot,
  token: string | undefined,
  message: ChannelMessage,
  downloadTimeoutMs: number,
  fetchFile: typeof globalThis.fetch,
): Promise<readonly ImageAttachmentRef[]> {
  const sources = message.images ?? []
  if (sources.length === 0) return []
  const attachments = ctx.get('attachments')
  if (attachments === undefined) throw new Error('telegram: Harness attachment service is unavailable')
  const limits = attachments.imageLimits
  if (sources.length > limits.maxImagesPerMessage) {
    throw new Error(`telegram: message exceeds the configured ${limits.maxImagesPerMessage}-image limit`)
  }
  let declaredBytes = 0
  for (const source of sources) {
    if (!limits.mediaTypes.includes(source.mediaType)) {
      throw new Error(`telegram: ${source.mediaType} is disabled by the Harness attachment policy`)
    }
    if (source.bytes === undefined) continue
    if (!Number.isSafeInteger(source.bytes) || source.bytes < 0) {
      throw new Error('telegram: provider returned an invalid image byte length')
    }
    if (source.bytes > limits.maxImageBytes) throw new Error('telegram: image exceeds the configured byte limit')
    declaredBytes += source.bytes
    if (declaredBytes > limits.maxMessageImageBytes) {
      throw new Error('telegram: images exceed the configured aggregate byte limit')
    }
  }

  const inputs: SaveImageAttachment[] = []
  let actualBytes = 0
  for (const source of sources) {
    const remaining = limits.maxMessageImageBytes - actualBytes
    const maximum = Math.min(limits.maxImageBytes, remaining)
    const data = await downloadTelegramFile(ctx, bot, source, maximum, downloadTimeoutMs, token, fetchFile)
    actualBytes += data.byteLength
    inputs.push({
      data,
      mediaType: source.mediaType,
      ...(source.name === undefined ? {} : { name: source.name }),
    })
  }
  await Promise.all(inputs.map(input => attachments.validateImage(input)))
  const refs = []
  for (const input of inputs) refs.push(await attachments.saveImage(input))
  return refs
}

/** Stream one official grammY hydrated file URL into one bounded buffer under a total deadline. */
async function downloadTelegramFile(
  ctx: Context,
  bot: Bot,
  source: ChannelImageSource,
  maximum: number,
  timeoutMs: number,
  token: string | undefined,
  fetchFile: typeof globalThis.fetch,
): Promise<Uint8Array> {
  const controller = new AbortController()
  const cancelTimeout = ctx.timeout(() => {
    controller.abort(new Error(`Telegram image download timed out after ${timeoutMs}ms`))
  }, timeoutMs)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const api = bot.api as FileApiFlavor<typeof bot.api>
    // grammY exposes the same runtime signal contract through the
    // `abort-controller` polyfill type, which is structurally narrower than
    // Node's native AbortSignal even though its API client accepts this signal.
    type GrammyFileSignal = Parameters<FileApiFlavor<typeof bot.api>['getFile']>[1]
    const file = await api.getFile(
      source.sourceId,
      controller.signal as unknown as GrammyFileSignal,
    )
    const response = await fetchFile(file.getUrl(), { signal: controller.signal })
    if (!response.ok) throw new Error(`download returned HTTP ${response.status}`)
    if (response.body === null) throw new Error('download returned no response body')
    reader = response.body.getReader()
    const initialCapacity = Math.min(source.bytes ?? 64 * 1024, maximum)
    let data = new Uint8Array(initialCapacity)
    let total = 0
    while (true) {
      const result = await reader.read()
      if (result.done) break
      const chunk = result.value
      total += chunk.byteLength
      if (total > maximum) throw new Error('download exceeds the configured byte limit')
      const offset = total - chunk.byteLength
      if (total > data.byteLength) {
        const doubled = data.byteLength === 0 ? 64 * 1024 : data.byteLength * 2
        const expanded = new Uint8Array(Math.min(maximum, Math.max(total, doubled)))
        expanded.set(data.subarray(0, offset))
        data = expanded
      }
      data.set(chunk, offset)
    }
    return total === data.byteLength ? data : data.slice(0, total)
  } catch (error: unknown) {
    controller.abort(error)
    void reader?.cancel().catch(() => undefined)
    throw new Error(`telegram: image download failed: ${describe(error, token)}`)
  } finally {
    cancelTimeout()
  }
}

/** Start credential resolution, polling, hot rotation, and drain-first teardown. */
function startLifecycle(
  ctx: Context,
  config: Config,
  tokenRef: CredentialRef,
  polling: boolean,
  timeout: number,
  aliases: ReadonlyMap<string, string>,
  blockedMigratedChats: Set<string>,
  suppliedBot: Bot | undefined,
  makeBot: (token: string) => Bot,
  setBot: (bot: Bot | undefined) => void,
  setToken: (token: string | undefined) => void,
  capabilities: ChannelAdapter['capabilities'],
  resolveTokenOverride: AdapterDeps['resolveToken'],
): () => Promise<void> {
  let active: { bot: Bot; stop: () => Promise<void> } | undefined
  let activeToken: string | undefined
  let disposed = false
  const maintenance = createChannelMaintenanceQueue((error) => {
    ctx.logger.warn(`channel-telegram: lifecycle failed: ${describe(error, activeToken)}`)
  })

  const activate = async (): Promise<void> => {
    const token = suppliedBot === undefined
      ? await resolveChannelCredential(
        ctx,
        config.botToken,
        tokenRef,
        resolveTokenOverride,
      )
      : normalizeChannelCredential(config.botToken) ?? normalizeChannelCredential(suppliedBot.token)
    if (disposed) return
    if (suppliedBot === undefined && token === undefined) {
      capabilities.receive = false
      capabilities.send = false
      capabilities.react = false
      ctx.logger.warn(`channel-telegram: no bot token resolved for ${String(tokenRef)}`)
      return
    }
    if (token === undefined) {
      throw new Error('channel-telegram: a supplied bot must expose its token or use config.botToken')
    }
    let next: Bot
    let stop: () => Promise<void>
    try {
      next = suppliedBot ?? makeBot(token)
      configureBot(next, token)
      activeToken = token
      setToken(token)
      setBot(next)
      capabilities.send = true
      capabilities.react = true
      stop = polling
        ? startPolling(ctx, next, timeout, aliases, blockedMigratedChats, token, (
          receiving,
          authenticationFailed,
        ) => {
          capabilities.receive = receiving
          if (authenticationFailed === true) {
            capabilities.send = false
            capabilities.react = false
          }
        })
        : async () => {}
    } catch (error: unknown) {
      activeToken = undefined
      setToken(undefined)
      setBot(undefined)
      capabilities.receive = false
      capabilities.send = false
      capabilities.react = false
      throw new Error(`channel-telegram: activation failed: ${describe(error, token)}`)
    }
    active = { bot: next, stop }
  }

  const deactivate = async (): Promise<void> => {
    const current = active
    if (current === undefined) return
    capabilities.receive = false
    await current.stop()
    if (active === current) {
      active = undefined
      activeToken = undefined
      setToken(undefined)
      setBot(undefined)
      capabilities.send = false
      capabilities.react = false
    }
  }

  const replace = async (): Promise<void> => {
    await deactivate()
    if (!disposed) await activate()
  }
  maintenance.enqueue(activate)
  const disposeCredentialUpdate = ctx.on('credentials/updated', (updated) => {
    if (suppliedBot !== undefined || normalizeChannelCredential(config.botToken) !== undefined
      || updated !== tokenRef || disposed) return
    maintenance.enqueue(replace)
  })

  return async () => {
    disposed = true
    disposeCredentialUpdate()
    await maintenance.settle(deactivate, (error) => {
      ctx.logger.warn(`channel-telegram: lifecycle stop failed: ${describe(error, activeToken)}`)
    })
  }
}

/**
 * Build the Telegram adapter from validated config.
 * @param config - validated plugin config carrying the bot token and polling tuning.
 * @param deps - optional dependency injection (test-only bot).
 * @returns the adapter to register with `ctx.legacyChannels`.
 */
export function createAdapter(config: Config = {}, deps: AdapterDeps = {}): ChannelAdapter {
  const tokenRef = credentialRef(config.botTokenEnv ?? TELEGRAM_DEFAULT_BOT_TOKEN_ENV)
  const polling = config.polling ?? true
  const timeout = config.timeout ?? 30
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60) {
    throw new TypeError('telegram: timeout must be an integer from 1 to 60 seconds')
  }
  const imageDownloadTimeoutMs = config.imageDownloadTimeoutMs ?? DEFAULT_IMAGE_DOWNLOAD_TIMEOUT_MS
  if (!Number.isSafeInteger(imageDownloadTimeoutMs)
    || imageDownloadTimeoutMs < 1000 || imageDownloadTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new TypeError('telegram: imageDownloadTimeoutMs must be an integer from 1000 to 2147483647')
  }
  const aliases = createChatAliases(config.chatIdAliases ?? [])
  const blockedMigratedChats = new Set<string>()
  const makeBot = (token: string): Bot => deps.botFactory?.(token) ?? new Bot(token)
  let bot = deps.bot
  let activeToken: string | undefined
  let runtimeContext: Context | undefined
  const capabilities = {
    receive: false,
    send: bot !== undefined,
    react: bot !== undefined,
  }
  const requireBot = (): Bot => {
    if (bot === undefined) throw new Error(`telegram: no bot token resolved for ${String(tokenRef)}`)
    return bot
  }
  return {
    id: 'telegram',
    capabilities,
    start: (ctx) => {
      runtimeContext = ctx
      const stop = startLifecycle(
        ctx,
        config,
        tokenRef,
        polling,
        timeout,
        aliases,
        blockedMigratedChats,
        deps.bot,
        makeBot,
        (next) => { bot = next },
        (next) => { activeToken = next },
        capabilities,
        deps.resolveToken,
      )
      return async () => {
        await stop()
        if (runtimeContext === ctx) runtimeContext = undefined
      }
    },
    send: message => sendMessage(requireBot(), message),
    materializeImages: (message) => {
      if (runtimeContext === undefined) throw new Error('telegram: adapter is not started')
      return materializeImages(
        runtimeContext,
        requireBot(),
        activeToken,
        message,
        imageDownloadTimeoutMs,
        deps.fetch ?? globalThis.fetch,
      )
    },
    react: (message, emoji) => react(requireBot(), message, emoji),
  }
}

/**
 * Mount the Telegram adapter into the channel registry.
 * @param ctx - Cordis context carrying the `legacyChannels` service.
 * @param config - validated plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  registerLegacyChannelAdapter(ctx, () => createAdapter(config))
}
