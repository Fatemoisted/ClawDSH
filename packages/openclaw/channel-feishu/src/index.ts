/**
 * Feishu/Lark adapter over the `ctx.channels` seam.
 *
 * Platform behavior is deliberately delegated to the official
 * `@larksuiteoapi/node-sdk` LarkChannel: authenticated bot identity,
 * WebSocket lifecycle/reconnect, normalization, stale/duplicate protection,
 * outbound chunking/retry/fallback, native replies, and reactions. This
 * package only translates the SDK's normalized contract to ClawDSH's channel
 * contract and attaches it to Cordis lifecycle.
 * @module @clawdsh/dsh-channel-feishu
 */

import * as Lark from '@larksuiteoapi/node-sdk'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/cordis-plugin-timer'
import { registerChannelAdapter, splitTextByUtf16Limit } from '@clawdsh/dsh-channel-core'
import type { ChannelAdapter, ChannelMessage } from '@clawdsh/dsh-channel-core'

/** Cordis plugin name. */
export const name = 'channel-feishu'

/** The channel registry this adapter contributes to. */
export const inject = ['channels', 'timer']

/** Adapter-level retry starts only when identity failed before the SDK created a WebSocket. */
const INITIAL_CONNECT_RETRY_MS = 1000
const MAX_CONNECT_RETRY_MS = 30_000

/** Feishu API domain: mainland Feishu or international Lark. */
export type FeishuDomain = 'feishu' | 'lark'

/** Plugin config: app identity plus which Open Platform region to dial. */
export interface Config {
  /** Feishu app ID (from the developer console); must not be committed. */
  appId: string
  /** Feishu app secret; must not be committed. */
  appSecret: string
  /** Open Platform region; `feishu` (default) or `lark`. */
  domain?: FeishuDomain
}

/** Runtime schema for the Feishu adapter. */
export const Config: z<Config> = z.object({
  appId: z.string().required(),
  appSecret: z.string().required(),
  domain: z.union([z.const('feishu'), z.const('lark')]).default('feishu'),
})

/** Dependency injection seam so tests can substitute the high-level SDK channel. */
export interface AdapterDeps {
  channel?: Lark.LarkChannel
}

/** Resolve the SDK `Domain` enum from the plugin's domain string. */
function resolveDomain(domain: FeishuDomain | undefined): Lark.Domain {
  return domain === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu
}

/**
 * Construct the official high-level Lark channel.
 *
 * Policy stays in channel-core, so the SDK must not pre-filter mentions.
 * SDK text batching is also disabled: its scope is `chatId`, while ClawDSH's
 * durable routing additionally separates `threadId`; merging here could move
 * two topics into the last message's session. The SDK still owns stale-event
 * rejection, TTL de-duplication, and the in-flight processing lock.
 *
 * @param config - validated app identity and Open Platform region.
 * @returns the configured official high-level Lark channel.
 */
export function buildLarkChannel(config: Config): Lark.LarkChannel {
  return Lark.createLarkChannel({
    appId: config.appId,
    appSecret: config.appSecret,
    transport: 'websocket',
    domain: resolveDomain(config.domain),
    source: 'clawdsh',
    policy: {
      requireMention: false,
      respondToMentionAll: true,
    },
    safety: {
      chatQueue: { enabled: false },
    },
  })
}

/**
 * Map one SDK-normalized message to the channel seam.
 * @param message - a normalized message produced after bot identity is known.
 * @returns the inbound channel message, or `undefined` for an empty body.
 */
export function toInbound(message: Lark.NormalizedMessage): ChannelMessage | undefined {
  const text = message.content.trim()
  if (text === '') return undefined
  const isDirect = message.chatType === 'p2p'
  const conversationId = isDirect ? (message.senderId || message.chatId) : message.chatId
  if (conversationId === '') return undefined
  return {
    channel: 'feishu',
    direction: 'in',
    conversationId,
    ...(message.threadId === undefined ? {} : { threadId: message.threadId }),
    chatType: isDirect ? 'direct' : 'group',
    mention: {
      detectable: true,
      // `respondToMentionAll` is enabled on the SDK policy above, so preserve
      // that accepted broadcast as an explicit mention for channel-core's
      // centralized group gate too.
      botMentioned: isDirect || message.mentionedBot || message.mentionAll,
    },
    ...(message.senderId === '' ? {} : { sender: message.senderId }),
    messageId: message.messageId,
    text,
  }
}

/** Render an arbitrary SDK/lifecycle failure for one log line. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Permanent credential/shape failures cannot recover through reconnecting. */
function isRetryableConnectError(error: unknown): boolean {
  return !(error instanceof Lark.LarkChannelError)
    || !['permission_denied', 'format_error', 'ssrf_blocked', 'target_revoked'].includes(error.code)
}

/** SDK 1.73 lifecycle surface needed only when connect never reached `connected=true`. */
interface FailedConnectInternals {
  safety?: { dispose(): Promise<void> }
}

/**
 * Dispose the high-level channel, including the SDK 1.73 failed-handshake gap:
 * its public `disconnect()` returns early before `connected=true`, despite an
 * already-created public `rawWsClient` and private safety timers. Successful
 * connections stay entirely on the public SDK lifecycle.
 */
async function disconnectChannel(channel: Lark.LarkChannel, connectedOnce: boolean): Promise<void> {
  const failures: unknown[] = []
  if (!connectedOnce) {
    try {
      channel.rawWsClient?.close({ force: true })
    } catch (error: unknown) {
      failures.push(error)
    }
    const internals = channel as unknown as FailedConnectInternals
    try {
      await internals.safety?.dispose()
    } catch (error: unknown) {
      failures.push(error)
    }
  }
  try {
    await channel.disconnect()
  } catch (error: unknown) {
    failures.push(error)
  }
  if (failures.length > 0) throw new AggregateError(failures, 'failed to fully disconnect Lark channel')
}

/** Attach the SDK channel to Cordis and return a disposer that drains connection teardown. */
function startChannel(ctx: Context, channel: Lark.LarkChannel): () => Promise<void> {
  const inFlightMessages = new Set<Promise<void>>()
  const unsubscribeMessage = channel.on('message', (message) => {
    const inbound = toInbound(message)
    if (inbound === undefined) return
    const operation = ctx.parallel('channel/inbound', inbound)
    inFlightMessages.add(operation)
    // SDK 1.73's queue-disabled dispatcher does not retain the callback
    // promise. Observe it here for lifecycle tracking while returning the
    // original promise for SDK versions that do await handlers.
    void operation.then(
      () => { inFlightMessages.delete(operation) },
      () => { inFlightMessages.delete(operation) },
    )
    return operation
  })
  const unsubscribeError = channel.on('error', (error) => {
    ctx.logger.warn(`channel-feishu: ${describe(error)}`)
  })
  let disposed = false
  let connectedOnce = false
  let attempt = 0
  let cancelRetry: (() => void) | undefined
  let connecting: Promise<void> | undefined
  const connect = (): void => {
    if (disposed) return
    connecting = channel.connect()
    void connecting.then(() => {
      connectedOnce = true
      attempt = 0
    }, (error: unknown) => {
      if (disposed) return
      // Once the SDK has constructed its WSClient, its built-in autoReconnect
      // remains authoritative. The adapter retries only the earlier identity
      // path, where getConnectionStatus() is still undefined and the SDK has
      // no reconnecting component yet.
      const sdkOwnsReconnect = channel.getConnectionStatus() !== undefined
      if (!isRetryableConnectError(error) || sdkOwnsReconnect) {
        ctx.logger.warn(`channel-feishu: connect failed: ${describe(error)}`)
        return
      }
      const delay = Math.min(INITIAL_CONNECT_RETRY_MS * 2 ** attempt, MAX_CONNECT_RETRY_MS)
      attempt += 1
      ctx.logger.warn(`channel-feishu: connect failed: ${describe(error)}; retrying in ${delay}ms`)
      cancelRetry = ctx.timeout(() => {
        cancelRetry = undefined
        connect()
      }, delay)
    })
  }
  connect()
  return async () => {
    disposed = true
    cancelRetry?.()
    cancelRetry = undefined
    unsubscribeMessage()
    unsubscribeError()
    // A disposer may race the initial identity probe/handshake. Wait for that
    // attempt to settle before asking the SDK to close its socket and queues.
    await (connecting ?? Promise.resolve()).catch(() => undefined)
    while (inFlightMessages.size > 0) {
      await Promise.allSettled([...inFlightMessages])
    }
    try {
      await disconnectChannel(channel, connectedOnce)
    } catch (error: unknown) {
      ctx.logger.warn(`channel-feishu: disconnect failed: ${describe(error)}`)
    }
  }
}

/** Send one text reply through the SDK's chunk/retry/fallback implementation. */
async function sendMessage(channel: Lark.LarkChannel, message: ChannelMessage): Promise<void> {
  if (message.conversationId === undefined || message.conversationId === '') {
    throw new Error('feishu: send requires a conversationId')
  }
  const options = {
    ...(message.replyToMessageId === undefined ? {} : { replyTo: message.replyToMessageId }),
    ...(message.threadId === undefined ? {} : { replyInThread: true }),
  }
  // node-sdk 1.73 splits with plain String.slice, which can cut a surrogate
  // pair at the 3500 UTF-16-unit boundary. Pre-split every message safely and
  // keep the SDK responsible for authenticated delivery/retry/fallback. A
  // normal chat quotes only the first chunk (matching the SDK); a topic keeps
  // the native reply target on every chunk so none falls back to chat create.
  const chunks = splitTextByUtf16Limit(message.text, 3500)
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index]
    if (chunk === undefined) continue
    const chunkOptions = index === 0 || message.threadId !== undefined ? options : {}
    await channel.send(message.conversationId, { text: chunk }, chunkOptions)
  }
}

/** Portable reactions with an unambiguous Feishu named-reaction equivalent. */
const FEISHU_REACTION_BY_ACK: ReadonlyMap<string, string> = new Map([
  ['👀', 'EYES'],
  ['EYES', 'EYES'],
  ['👍', 'THUMBSUP'],
  ['THUMBSUP', 'THUMBSUP'],
  ['🙏', 'THANKS'],
  ['THANKS', 'THANKS'],
  ['😊', 'SMILE'],
  ['🙂', 'SMILE'],
  ['SMILE', 'SMILE'],
  ['✅', 'DONE'],
  ['DONE', 'DONE'],
  ['❤', 'HEART'],
  ['❤️', 'HEART'],
  ['HEART', 'HEART'],
  ['🎉', 'PARTY'],
  ['PARTY', 'PARTY'],
] as const)

/** Map a portable ack to Feishu's named type, safely degrading to eyes. */
function resolveReactionType(emoji: string): string {
  return FEISHU_REACTION_BY_ACK.get(emoji) ?? 'EYES'
}

/** Attach an acknowledgement reaction using the SDK's typed helper. */
async function react(channel: Lark.LarkChannel, message: ChannelMessage, emoji: string): Promise<void> {
  if (message.messageId === undefined) return
  await channel.addReaction(message.messageId, resolveReactionType(emoji))
}

/**
 * Build the Feishu adapter from validated config.
 * @param config - validated app identity and region.
 * @param deps - optional high-level SDK channel for tests.
 * @returns the adapter to register with `ctx.channels`.
 */
export function createAdapter(config: Config, deps: AdapterDeps = {}): ChannelAdapter {
  const channel = deps.channel ?? buildLarkChannel(config)
  return {
    id: 'feishu',
    capabilities: { receive: true, send: true, react: true },
    start: ctx => startChannel(ctx, channel),
    send: message => sendMessage(channel, message),
    react: (message, emoji) => react(channel, message, emoji),
  }
}

/** Mount the Feishu adapter into the shared Harness-backed channel registry. */
export function apply(ctx: Context, config: Config): void {
  registerChannelAdapter(ctx, () => createAdapter(config))
}
