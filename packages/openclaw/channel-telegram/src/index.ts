/**
 * A Telegram channel adapter over the `ctx.channels` seam, backed by grammY.
 *
 * Inbound messages arrive through grammY's long polling: the adapter runs a
 * `Bot` with a `message` handler that maps text and caption bodies onto
 * `channel/inbound`, and grammY advances the `offset` past every consumed
 * update (idempotent under at-least-once delivery). Outbound replies post
 * through `bot.api.sendMessage`, preserving topics and native replies.
 *
 * Webhook delivery and attachment transfer remain outside this adapter's
 * normalized text surface.
 * @module @clawdsh/dsh-channel-telegram
 */

import { Bot } from 'grammy'
import type { ReactionTypeEmoji } from 'grammy/types'
import { autoRetry } from '@grammyjs/auto-retry'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { splitTextByUtf16Limit } from '@clawdsh/dsh-channel-core'
import type { ChannelAdapter, ChannelMessage } from '@clawdsh/dsh-channel-core'

/** Cordis plugin name. */
export const name = 'channel-telegram'

/** The channel registry this adapter contributes to. */
export const inject = ['channels']

/** Plugin config: the bot token plus long-polling tuning. */
export interface Config {
  /** Bot token from `@BotFather`; must not be committed. */
  botToken: string
  /** When `false`, the adapter is send-only and does not poll for inbound messages. */
  polling?: boolean
  /** Long-poll hold timeout in seconds (Telegram clamps to 1–60). */
  timeout?: number
}

/** Runtime schema for the Telegram adapter. */
export const Config: z<Config> = z.object({
  botToken: z.string().required(),
  polling: z.boolean().default(true),
  timeout: z.number().step(1).min(1).max(60).default(30),
})

/** One Telegram entity used for provider-structured mention detection. */
interface TelegramMessageEntity {
  type: string
  offset: number
  length: number
  user?: { id: number }
}

/** The grammY message context fields this adapter consumes. */
export interface TelegramTextContext {
  message: {
    text?: string
    caption?: string
    entities?: TelegramMessageEntity[]
    caption_entities?: TelegramMessageEntity[]
    message_id: number
    message_thread_id?: number
    reply_to_message?: {
      message_id: number
      from?: { id: number; is_bot?: boolean; username?: string }
    }
  }
  chat: { id: number; type: string }
  from?: { id: number }
  me?: { id: number; username?: string }
}

/** Dependency injection seam so tests can substitute the bot. */
export interface AdapterDeps {
  /** grammY bot; when omitted, one is built from the token. */
  bot?: Bot
}

/**
 * Map a grammY message context to a normalized inbound message.
 * @param ctx - the grammY message context.
 * @returns the inbound message to emit, or `undefined` without a text body.
 */
export function toInbound(ctx: TelegramTextContext): ChannelMessage | undefined {
  const body = ctx.message.text ?? ctx.message.caption
  if (body === undefined) return undefined
  const entities = ctx.message.text === undefined
    ? (ctx.message.caption_entities ?? [])
    : (ctx.message.entities ?? [])
  const mentionRanges = botMentionRanges(body, entities, ctx.me)
  const text = removeEntityRanges(body, mentionRanges).trim()
  if (text === '') return undefined
  const isDirect = ctx.chat.type === 'private'
  const repliedToBot = ctx.me !== undefined
    && ctx.message.reply_to_message?.from?.id === ctx.me.id
  return {
    channel: 'telegram',
    direction: 'in',
    conversationId: String(ctx.chat.id),
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
  }
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

/** Start grammY long polling and return its drain-aware disposer. */
function startPolling(ctx: Context, bot: Bot, timeout: number): () => Promise<void> {
  bot.catch((error) => {
    ctx.logger.warn(`channel-telegram: ${error.message}`)
  })
  bot.on('message', async (message) => {
    const inbound = toInbound(message)
    if (inbound !== undefined) await ctx.parallel('channel/inbound', inbound)
  })
  const pollingTask = bot.start({ allowed_updates: ['message'], timeout }).catch((error: unknown) => {
    ctx.logger.warn(`channel-telegram: polling start failed: ${error instanceof Error ? error.message : String(error)}`)
  })
  return async () => {
    try {
      await bot.stop()
    } catch (error) {
      ctx.logger.warn(`channel-telegram: polling stop failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    // grammY resolves start() only after polling has stopped and all active
    // middleware has completed, so awaiting it makes adapter disposal a drain.
    await pollingTask
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

/**
 * Build the Telegram adapter from validated config.
 * @param config - validated plugin config carrying the bot token and polling tuning.
 * @param deps - optional dependency injection (test-only bot).
 * @returns the adapter to register with `ctx.channels`.
 */
export function createAdapter(config: Config, deps: AdapterDeps = {}): ChannelAdapter {
  const bot = deps.bot ?? new Bot(config.botToken)
  bot.api.config.use(autoRetry({
    maxRetryAttempts: 3,
    maxDelaySeconds: 30,
    // auto-retry 2.0.2 otherwise retries HttpError in an unbounded inner loop,
    // outside maxRetryAttempts. Surface a persistent network failure so core
    // delivery and shutdown remain finite; 429/5xx responses stay retried.
    rethrowHttpErrors: true,
  }))
  const polling = config.polling ?? true
  const timeout = config.timeout ?? 30
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60) {
    throw new TypeError('telegram: timeout must be an integer from 1 to 60 seconds')
  }
  return {
    id: 'telegram',
    capabilities: { receive: polling, send: true, react: true },
    start: ctx => polling ? startPolling(ctx, bot, timeout) : () => {},
    send: message => sendMessage(bot, message),
    react: (message, emoji) => react(bot, message, emoji),
  }
}

/**
 * Mount the Telegram adapter into the channel registry.
 * @param ctx - Cordis context carrying the `channels` service.
 * @param config - validated plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  const adapter = createAdapter(config)
  ctx.effect(() => ctx.channels.registerAdapter(adapter), 'channel-telegram.register()')
}
