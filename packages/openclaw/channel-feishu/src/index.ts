/**
 * A Feishu (Lark) channel adapter over the `ctx.channels` seam, backed by the
 * official `@larksuiteoapi/node-sdk`.
 *
 * Inbound messages arrive through the SDK's WebSocket long-connection: the
 * adapter registers an `im.message.receive_v1` handler on a `Lark.EventDispatcher`,
 * starts a `Lark.WSClient` (which authenticates the connection and ACKs delivery
 * at-least-once), de-duplicates by `message_id`, and maps each text message onto
 * `channel/inbound`. Outbound replies post through `Lark.Client.im.message.create`
 * with the tenant token the SDK caches and refreshes on its own.
 *
 * Long-connection mode replaces the earlier `node:http` webhook: no
 * `verificationToken`/`encryptKey`, no inbound HTTP surface, no URL-verification
 * challenge. Rich-text cards, attachments, and `reply_in_thread` quoting are out
 * of scope for this cut; only text messages are relayed.
 * @module @clawdsh/dsh-channel-feishu
 */

import * as Lark from '@larksuiteoapi/node-sdk'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { registerChannelAdapter, stripZeroWidth } from '@clawdsh/dsh-channel-core'
import type { ChannelAdapter, ChannelMessage } from '@clawdsh/dsh-channel-core'

/** Cap on retained de-duplication message ids before the oldest is evicted. */
const SEEN_CAP = 10000

/** Cordis plugin name. */
export const name = 'channel-feishu'

/** The channel registry this adapter contributes to. */
export const inject = ['channels']

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

/** The `im.message.receive_v1` event fields this adapter consumes. */
interface FeishuReceiveEvent {
  sender?: {
    sender_id?: { open_id?: string; user_id?: string; union_id?: string }
  }
  message?: {
    message_id?: string
    chat_id?: string
    chat_type?: string
    message_type?: string
    content?: string
    mentions?: Array<{
      name?: string
      id?: { open_id?: string; user_id?: string; union_id?: string }
    }>
  }
}

/** Mutable bookkeeping shared between the inbound handler and the sender. */
export interface AdapterState {
  /** Per-thread reply target (`receive_id` + its type), keyed by inbound thread id. */
  receiveByThread: Map<string, { id: string; type: 'chat_id' | 'open_id' }>
  /** Recently seen message ids, for at-least-once de-duplication. */
  seen: Set<string>
}

/** Dependency injection seam so tests can substitute the API client. */
export interface AdapterDeps {
  /** Lark API client; when omitted, one is built from the app credentials. */
  client?: Lark.Client
  /** Identity-derived mention patterns for group-mention detection. */
  mentionPatterns?: readonly RegExp[]
}

/**
 * Create a fresh, empty adapter state.
 * @returns A state with an empty reply-target map and an empty de-dup set.
 */
export function createAdapterState(): AdapterState {
  return { receiveByThread: new Map(), seen: new Set() }
}

/** Resolve the SDK `Domain` enum from the plugin's `domain` string. */
function resolveDomain(domain: FeishuDomain | undefined): Lark.Domain {
  return domain === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu
}

/**
 * Extract the text from a `message.content` JSON string such as `{"text":"hi"}`.
 * @param content - the raw message content, or `undefined` when absent.
 * @returns the decoded `text` field, or the raw content when it is not the expected JSON envelope.
 */
export function extractText(content: string | undefined): string {
  if (content === undefined) return ''
  try {
    const parsed: unknown = JSON.parse(content)
    if (typeof parsed === 'object' && parsed !== null && 'text' in parsed) {
      const text = (parsed as { text?: unknown }).text
      if (typeof text === 'string') return text
    }
  } catch {
    // Fall back to the raw content when it is not the expected JSON envelope.
  }
  return content
}

/**
 * Map an `im.message.receive_v1` event to a normalized inbound message, or
 * `undefined` when it is not a non-empty text message.
 * @param event - the SDK-delivered receive event.
 * @param mentionPatterns - identity-derived mention patterns; absent means the
 *   adapter cannot evaluate mentions and `wasMentioned` stays absent (fail-open).
 * @returns the inbound thread id, optional sender, and text, or `undefined`.
 */
export function toInbound(
  event: FeishuReceiveEvent,
  mentionPatterns: readonly RegExp[] = [],
): { threadId: string; sender?: string; messageId?: string; isGroup?: boolean; wasMentioned?: boolean; text: string } | undefined {
  const message = event.message
  if (message === undefined || message.message_type !== 'text') return undefined
  const text = extractText(message.content)
  if (text === '') return undefined
  const senderOpenId = event.sender?.sender_id?.open_id
  const isDirect = message.chat_type === 'p2p' || message.chat_type === 'private'
  const threadId = isDirect
    ? (senderOpenId ?? message.chat_id ?? 'p2p')
    : (message.chat_id ?? 'group')
  // Minimal mention mapping: Feishu text does not inline @-tokens; mention
  // entries carry the app's display name, matched against the identity
  // patterns. Without patterns `wasMentioned` stays absent (fail-open).
  const wasMentioned = (message.mentions ?? []).some(mention =>
    mention.name !== undefined && mentionPatterns.some(pattern => pattern.test(stripZeroWidth(mention.name ?? ''))))
  return {
    threadId,
    ...(senderOpenId === undefined ? {} : { sender: senderOpenId }),
    ...(message.message_id === undefined ? {} : { messageId: message.message_id }),
    ...(message.chat_type === undefined ? {} : { isGroup: message.chat_type === 'group' }),
    // Presence is the detection-capability signal: without patterns the adapter
    // cannot evaluate mentions, so `wasMentioned` stays absent (fail-open).
    ...(!isDirect && mentionPatterns.length > 0 ? { wasMentioned } : {}),
    text,
  }
}

/** Deduplicate by message id, evicting the oldest past the cap. */
function dedup(state: AdapterState, messageId: string | undefined): boolean {
  if (messageId === undefined) return false
  if (state.seen.has(messageId)) return true
  state.seen.add(messageId)
  if (state.seen.size > SEEN_CAP) {
    const oldest = state.seen.values().next().value
    if (oldest !== undefined) state.seen.delete(oldest)
  }
  return false
}

/**
 * Handle one SDK-delivered receive event: de-duplicate, normalize, remember the
 * reply target, and emit `channel/inbound`.
 * @param ctx - Cordis context to emit `channel/inbound` on.
 * @param state - shared adapter bookkeeping (reply targets and de-dup set).
 * @param event - the SDK-delivered `im.message.receive_v1` event.
 * @param mentionPatterns - identity-derived mention patterns for group-mention detection.
 */
export function handleReceiveEvent(
  ctx: Context,
  state: AdapterState,
  event: FeishuReceiveEvent,
  mentionPatterns: readonly RegExp[] = [],
): void {
  const message = event.message
  if (dedup(state, message?.message_id)) return
  const inbound = toInbound(event, mentionPatterns)
  if (inbound === undefined) return
  const isDirect = message?.chat_type === 'p2p' || message?.chat_type === 'private'
  state.receiveByThread.set(inbound.threadId, {
    id: isDirect ? (inbound.sender ?? inbound.threadId) : inbound.threadId,
    type: isDirect ? 'open_id' : 'chat_id',
  })
  ctx.emit('channel/inbound', {
    channel: 'feishu',
    direction: 'in',
    threadId: inbound.threadId,
    ...(inbound.sender === undefined ? {} : { sender: inbound.sender }),
    ...(inbound.messageId === undefined ? {} : { messageId: inbound.messageId }),
    text: inbound.text,
  })
}

/** Build a Lark API client from validated config. */
function buildClient(config: Config): Lark.Client {
  return new Lark.Client({
    appId: config.appId,
    appSecret: config.appSecret,
    appType: Lark.AppType.SelfBuild,
    domain: resolveDomain(config.domain),
  })
}

/** Start the WebSocket long-connection and return its disposer. */
function startLongConnection(
  ctx: Context,
  config: Config,
  state: AdapterState,
  mentionPatterns: readonly RegExp[],
): () => void {
  const dispatcher = new Lark.EventDispatcher({})
  dispatcher.register({
    'im.message.receive_v1': (event) => {
      handleReceiveEvent(ctx, state, event, mentionPatterns)
    },
  })
  const wsClient = new Lark.WSClient({
    appId: config.appId,
    appSecret: config.appSecret,
    domain: resolveDomain(config.domain),
    loggerLevel: Lark.LoggerLevel.info,
  })
  void wsClient.start({ eventDispatcher: dispatcher }).catch((error: unknown) => {
    ctx.logger.warn(`channel-feishu: WebSocket start failed: ${error instanceof Error ? error.message : String(error)}`)
  })
  return () => { wsClient.close({ force: true }) }
}

/** Post an outbound text message through `im.message.create`. */
async function sendMessage(client: Lark.Client, state: AdapterState, message: ChannelMessage): Promise<void> {
  if (message.threadId === undefined) {
    throw new Error('feishu: send requires a threadId')
  }
  const receive = state.receiveByThread.get(message.threadId) ?? { id: message.threadId, type: 'chat_id' as const }
  const response = await client.im.message.create({
    params: { receive_id_type: receive.type },
    data: {
      receive_id: receive.id,
      msg_type: 'text',
      content: JSON.stringify({ text: message.text }),
    },
  })
  if (response.code !== 0) {
    throw new Error(`feishu: im.message.create failed: ${response.msg ?? 'unknown error'}`)
  }
}

/** Attach an ack emoji reaction to an inbound message through `im.message.reaction.create`. */
async function react(client: Lark.Client, message: ChannelMessage, emoji: string): Promise<void> {
  if (message.messageId === undefined) return
  const response = await client.im.messageReaction.create({
    path: { message_id: message.messageId },
    data: { reaction_type: { emoji_type: emoji } },
  })
  if (response.code !== 0) {
    throw new Error(`feishu: im.messageReaction.create failed: ${response.msg ?? 'unknown error'}`)
  }
}

/**
 * Build the Feishu adapter from validated config.
 * @param config - validated plugin config carrying app identity and region.
 * @param deps - optional dependency injection (test-only API client).
 * @returns the adapter to register with `ctx.channels`.
 */
export function createAdapter(config: Config, deps: AdapterDeps = {}): ChannelAdapter {
  const client = deps.client ?? buildClient(config)
  const state = createAdapterState()
  const mentionPatterns = deps.mentionPatterns ?? []
  return {
    id: 'feishu',
    capabilities: { receive: true, send: true, react: true },
    start: ctx => startLongConnection(ctx, config, state, mentionPatterns),
    send: message => sendMessage(client, state, message),
    react: (message, emoji) => react(client, message, emoji),
  }
}

/**
 * Mount the Feishu adapter into the channel registry.
 * @param ctx - Cordis context carrying the `channels` service.
 * @param config - validated plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  registerChannelAdapter(ctx, mentionPatterns => createAdapter(config, { mentionPatterns }))
}
