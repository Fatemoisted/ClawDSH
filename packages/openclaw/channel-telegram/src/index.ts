/**
 * A Telegram channel adapter over the `ctx.channels` seam, backed by grammY.
 *
 * Inbound messages arrive through grammY's long polling: the adapter runs a
 * `Bot` with a `message:text` handler that maps each text message onto
 * `channel/inbound`, and grammY advances the `offset` past every consumed
 * update (idempotent under at-least-once delivery). Outbound replies post
 * through `bot.api.sendMessage`.
 *
 * Webhook delivery, `reply_parameters` quote-replies, and non-text messages
 * (captions, media) are out of scope for this first cut; only text messages
 * are relayed.
 * @module @clawdsh/dsh-channel-telegram
 */

import { Bot } from 'grammy'
import type { ReactionTypeEmoji } from 'grammy/types'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { registerChannelAdapter, stripZeroWidth } from '@clawdsh/dsh-channel-core'
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
  timeout: z.number().default(30),
})

/** One Telegram message entity (UTF-16 offsets into `text`). */
export interface TelegramEntity {
  type: string
  offset: number
  length: number
}

/** The grammY `message:text` context fields this adapter consumes. */
export interface TelegramTextContext {
  message: { text: string; message_id: number; entities?: readonly TelegramEntity[] }
  chat: { id: number; type?: string }
  from?: { id: number }
}

/** Dependency injection seam so tests can substitute the bot. */
export interface AdapterDeps {
  /** grammY bot; when omitted, one is built from the token. */
  bot?: Bot
  /** Identity-derived mention patterns for bot-mention detection. */
  mentionPatterns?: readonly RegExp[]
}

/**
 * Detect whether a message mentioned the bot: the bot's real username
 * compared against `mention` entities and the `@username` text substring
 * (case-insensitive), or any configured identity mention pattern. OpenClaw's
 * two-layer OR, ported verbatim.
 * @param text - the message text.
 * @param entities - Telegram message entities, when present.
 * @param botUsername - the bot's real Telegram username, when known.
 * @param patterns - identity-derived mention patterns.
 * @returns whether the bot was mentioned, or `undefined` when detection is
 *   impossible (no username and no patterns) — callers fail open.
 */
export function detectBotMention(
  text: string,
  entities: readonly TelegramEntity[] | undefined,
  botUsername: string | undefined,
  patterns: readonly RegExp[],
): boolean | undefined {
  const stripped = stripZeroWidth(text)
  let mentioned = false
  let detectable = false
  if (botUsername !== undefined && botUsername.length > 0) {
    detectable = true
    const needle = `@${botUsername.toLowerCase()}`
    const byText = stripped.toLowerCase().includes(needle)
    const byEntity = (entities ?? []).some(entity =>
      entity.type === 'mention' && stripped.slice(entity.offset, entity.offset + entity.length).toLowerCase() === needle)
    mentioned = byText || byEntity
  }
  if (patterns.length > 0) {
    detectable = true
    mentioned = mentioned || patterns.some(pattern => pattern.test(stripped))
  }
  return detectable ? mentioned : undefined
}

/**
 * Map a grammY text-message context to a normalized inbound message.
 * @param ctx - the grammY text-message context.
 * @param botUsername - the bot's Telegram username, for mention detection.
 * @param mentionPatterns - identity-derived mention patterns.
 * @returns the inbound message to emit as `channel/inbound`.
 */
export function toInbound(ctx: TelegramTextContext, botUsername?: string, mentionPatterns: readonly RegExp[] = []): ChannelMessage {
  const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup'
  const wasMentioned = detectBotMention(ctx.message.text, ctx.message.entities, botUsername, mentionPatterns)
  return {
    channel: 'telegram',
    direction: 'in',
    threadId: String(ctx.chat.id),
    ...(ctx.from === undefined ? {} : { sender: String(ctx.from.id) }),
    messageId: String(ctx.message.message_id),
    isGroup,
    ...(wasMentioned === undefined ? {} : { wasMentioned }),
    text: ctx.message.text,
  }
}

/** Start grammY long polling and return its disposer. */
function startPolling(ctx: Context, bot: Bot, timeout: number, mentionPatterns: readonly RegExp[]): () => void {
  bot.catch((error) => {
    ctx.logger.warn(`channel-telegram: ${error.message ?? String(error)}`)
  })
  bot.on('message:text', (message) => {
    // grammY populates botInfo from getMe during init(), before handlers fire.
    ctx.emit('channel/inbound', toInbound(message, bot.botInfo?.username, mentionPatterns))
  })
  void bot.start({ allowed_updates: ['message'], timeout })
  return () => { void bot.stop() }
}

/** Post an outbound reply through `sendMessage`. */
async function sendMessage(bot: Bot, message: ChannelMessage): Promise<void> {
  if (message.threadId === undefined) {
    throw new Error('telegram: send requires a threadId (chat id)')
  }
  await bot.api.sendMessage(message.threadId, message.text)
}

/** Attach an ack emoji reaction to an inbound message through `setMessageReaction`. */
async function react(bot: Bot, message: ChannelMessage, emoji: string): Promise<void> {
  if (message.threadId === undefined || message.messageId === undefined) return
  // The channel contract carries an arbitrary emoji; grammY types the platform's
  // supported reaction set. An unsupported emoji is rejected by the API at
  // runtime and surfaces as the caller's logged warning, not silently.
  const reaction: ReactionTypeEmoji['emoji'] = emoji as ReactionTypeEmoji['emoji']
  await bot.api.setMessageReaction(message.threadId, Number(message.messageId), [{ type: 'emoji', emoji: reaction }])
}

/**
 * Build the Telegram adapter from validated config.
 * @param config - validated plugin config carrying the bot token and polling tuning.
 * @param deps - optional dependency injection (test-only bot).
 * @returns the adapter to register with `ctx.channels`.
 */
export function createAdapter(config: Config, deps: AdapterDeps = {}): ChannelAdapter {
  const bot = deps.bot ?? new Bot(config.botToken)
  const polling = config.polling ?? true
  const timeout = config.timeout ?? 30
  const mentionPatterns = deps.mentionPatterns ?? []
  return {
    id: 'telegram',
    capabilities: { receive: polling, send: true, react: true },
    start: ctx => polling ? startPolling(ctx, bot, timeout, mentionPatterns) : () => {},
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
  registerChannelAdapter(ctx, mentionPatterns => createAdapter(config, { mentionPatterns }))
}
