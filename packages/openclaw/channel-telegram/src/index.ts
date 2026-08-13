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
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
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

/** The grammY `message:text` context fields this adapter consumes. */
export interface TelegramTextContext {
  message: { text: string }
  chat: { id: number }
  from?: { id: number }
}

/** Dependency injection seam so tests can substitute the bot. */
export interface AdapterDeps {
  /** grammY bot; when omitted, one is built from the token. */
  bot?: Bot
}

/**
 * Map a grammY text-message context to a normalized inbound message.
 * @param ctx - the grammY text-message context.
 * @returns the inbound message to emit as `channel/inbound`.
 */
export function toInbound(ctx: TelegramTextContext): ChannelMessage {
  return {
    channel: 'telegram',
    direction: 'in',
    threadId: String(ctx.chat.id),
    ...(ctx.from === undefined ? {} : { sender: String(ctx.from.id) }),
    text: ctx.message.text,
  }
}

/** Start grammY long polling and return its disposer. */
function startPolling(ctx: Context, bot: Bot, timeout: number): () => void {
  bot.catch((error) => {
    ctx.logger.warn(`channel-telegram: ${error.message ?? String(error)}`)
  })
  bot.on('message:text', (message) => {
    ctx.emit('channel/inbound', toInbound(message))
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
  return {
    id: 'telegram',
    capabilities: { receive: polling, send: true },
    start: ctx => polling ? startPolling(ctx, bot, timeout) : () => {},
    send: message => sendMessage(bot, message),
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
