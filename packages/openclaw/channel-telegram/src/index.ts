/**
 * A Telegram channel adapter over the `ctx.channels` seam.
 *
 * Inbound messages arrive through `getUpdates` long-polling: the adapter
 * loops the Bot API, turns each `message` update into a normalized
 * `channel/inbound` event, and advances the `offset` past every consumed
 * update (idempotent under at-least-once delivery). Outbound replies are
 * posted through `sendMessage`.
 *
 * Webhook delivery, `reply_parameters` quote-replies, and non-text messages
 * (captions, media) are out of scope for this first cut.
 * @module @clawdsh/dsh-channel-telegram
 */

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

/** One `getUpdates` update, narrowed to the fields this adapter consumes. */
interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
}

/** One `message` update, narrowed to text plus the routing identity. */
interface TelegramMessage {
  text?: string
  chat: { id: number }
  from?: { id: number }
}

/** `getUpdates` response envelope. */
interface GetUpdatesResponse {
  ok: boolean
  result?: TelegramUpdate[]
  description?: string
}

/** Resolve after `ms`, or immediately when the signal aborts. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
  })
}

/** Emit `channel/inbound` for every text message in a `getUpdates` batch. */
function dispatch(ctx: Context, updates: TelegramUpdate[]): void {
  for (const update of updates) {
    const message = update.message
    if (message === undefined || message.text === undefined) continue
    ctx.emit('channel/inbound', {
      channel: 'telegram',
      direction: 'in',
      threadId: String(message.chat.id),
      ...(message.from === undefined ? {} : { sender: String(message.from.id) }),
      text: message.text,
    })
  }
}

/** Long-poll `getUpdates` until aborted, advancing the offset past every update. */
function startPolling(ctx: Context, base: string, timeout: number): () => void {
  const controller = new AbortController()
  let offset: number | undefined
  const loop = async (): Promise<void> => {
    while (!controller.signal.aborted) {
      try {
        const params = new URLSearchParams({
          timeout: String(timeout),
          allowed_updates: JSON.stringify(['message']),
        })
        if (offset !== undefined) params.set('offset', String(offset))
        const response = await fetch(`${base}getUpdates?${params.toString()}`, { signal: controller.signal })
        const body = (await response.json()) as GetUpdatesResponse
        if (!body.ok) throw new Error(`telegram: getUpdates failed: ${body.description ?? 'unknown error'}`)
        for (const update of body.result ?? []) {
          offset = update.update_id + 1
        }
        dispatch(ctx, body.result ?? [])
      } catch {
        // A transient transport failure backs off before the next poll; an
        // abort settles immediately and the loop condition then exits.
        await delay(1000, controller.signal)
      }
    }
  }
  void loop()
  return () => { controller.abort() }
}

/** Post an outbound reply through `sendMessage`. */
async function sendMessage(base: string, message: ChannelMessage): Promise<void> {
  if (message.threadId === undefined) {
    throw new Error('telegram: send requires a threadId (chat id)')
  }
  const response = await fetch(`${base}sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: message.threadId, text: message.text }),
  })
  if (!response.ok) {
    throw new Error(`telegram: sendMessage failed with status ${response.status}`)
  }
}

/**
 * Build the Telegram adapter from validated config.
 * @param config - validated plugin config carrying the bot token and polling tuning.
 * @returns the adapter to register with `ctx.channels`.
 */
export function createAdapter(config: Config): ChannelAdapter {
  const base = `https://api.telegram.org/bot${config.botToken}/`
  const polling = config.polling ?? true
  const timeout = config.timeout ?? 30
  return {
    id: 'telegram',
    capabilities: { receive: polling, send: true },
    start: ctx => polling ? startPolling(ctx, base, timeout) : () => {},
    send: message => sendMessage(base, message),
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
