/**
 * A Feishu (Lark) channel adapter over the `ctx.channels` seam.
 *
 * Inbound messages arrive through a `node:http` webhook: the adapter ACKs the
 * platform within its confirmation window, echoes the URL-verification
 * challenge, parses both the classic v1 (`event_callback`) and v2
 * (`schema: "2.0"`) event formats, de-duplicates at-least-once delivery by
 * `uuid`/`event_id`, and maps `im.message.receive_v1` onto `channel/inbound`.
 * Outbound replies post through `im/v1/messages` with a cached
 * `tenant_access_token`.
 *
 * Webhook encryption (`encryptKey`), rich-text cards, and attachments are out
 * of scope for this first cut; the webhook is plaintext only.
 * @module @clawdsh/dsh-channel-feishu
 */

import { createServer } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ChannelAdapter, ChannelMessage } from '@clawdsh/dsh-channel-core'

/** Feishu OpenAPI base URL. */
const BASE = 'https://open.feishu.cn/open-apis'

/** Cap on retained de-duplication ids before the oldest is evicted. */
const SEEN_CAP = 10000

/** Cordis plugin name. */
export const name = 'channel-feishu'

/** The channel registry this adapter contributes to. */
export const inject = ['channels']

/** Plugin config: app identity plus webhook and credential tuning. */
export interface Config {
  /** Feishu app ID (from the developer console); must not be committed. */
  appId: string
  /** Feishu app secret; must not be committed. */
  appSecret: string
  /** Webhook listen port. */
  port?: number
  /** Webhook request path. */
  path?: string
  /** When set, the adapter fails to load: encrypted webhooks are not yet supported. */
  encryptKey?: string
  /** When set, inbound events whose token does not match are dropped. */
  verificationToken?: string
}

/** Runtime schema for the Feishu adapter. */
export const Config: z<Config> = z.object({
  appId: z.string().required(),
  appSecret: z.string().required(),
  port: z.number().default(8080),
  path: z.string().default('/feishu/webhook'),
  encryptKey: z.string().default(''),
  verificationToken: z.string().default(''),
})

/** The `im.message.receive_v1` message fields this adapter consumes. */
interface FeishuMessage {
  chat_id?: string
  open_chat_id?: string
  chat_type?: string
  message_type?: string
  content?: string
}

/** A normalized inbound event, independent of the v1/v2 wire format. */
interface FeishuEvent {
  dedupKey: string | undefined
  token: string | undefined
  senderOpenId: string | undefined
  message: FeishuMessage | undefined
}

/** Cached tenant token plus its expiry in epoch milliseconds. */
interface TokenCache {
  token: string
  expiresAt: number
}

/** Mutable bookkeeping shared between the webhook and the sender. */
export interface WebhookState {
  /** Per-thread reply target (`receive_id` + its type), keyed by inbound thread id. */
  receiveByThread: Map<string, { id: string; type: 'chat_id' | 'open_id' }>
  /** Recently seen event ids, for at-least-once de-duplication. */
  seen: Set<string>
}

/** Create a fresh, empty webhook state. */
export function createWebhookState(): WebhookState {
  return { receiveByThread: new Map(), seen: new Set() }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Read the sender's `open_id` from a v1/v2 event payload. */
function readSender(event: Record<string, unknown> | undefined): string | undefined {
  if (event === undefined) return undefined
  const sender = isRecord(event.sender) ? event.sender : undefined
  const senderId = isRecord(sender?.sender_id) ? sender.sender_id : undefined
  return typeof senderId?.open_id === 'string' ? senderId.open_id : undefined
}

/** Read the narrowed message fields from a v1/v2 event payload. */
function readMessage(event: Record<string, unknown> | undefined): FeishuMessage | undefined {
  if (event === undefined) return undefined
  const message = isRecord(event.message) ? event.message : undefined
  if (message === undefined) return undefined
  return {
    ...(typeof message.chat_id === 'string' ? { chat_id: message.chat_id } : {}),
    ...(typeof message.open_chat_id === 'string' ? { open_chat_id: message.open_chat_id } : {}),
    ...(typeof message.chat_type === 'string' ? { chat_type: message.chat_type } : {}),
    ...(typeof message.message_type === 'string' ? { message_type: message.message_type } : {}),
    ...(typeof message.content === 'string' ? { content: message.content } : {}),
  }
}

/** Normalize a v1 (`event_callback`) or v2 (`schema: "2.0"`) event body. */
function normalizeEvent(body: unknown): FeishuEvent | undefined {
  if (!isRecord(body)) return undefined
  if (body.type === 'event_callback') {
    const inner = isRecord(body.event) ? body.event : undefined
    if (inner?.type !== 'im.message.receive_v1') return undefined
    return {
      dedupKey: typeof body.uuid === 'string' ? body.uuid : undefined,
      token: typeof body.token === 'string' ? body.token : undefined,
      senderOpenId: readSender(inner),
      message: readMessage(inner),
    }
  }
  if (body.schema === '2.0') {
    const header = isRecord(body.header) ? body.header : undefined
    if (header?.event_type !== 'im.message.receive_v1') return undefined
    const inner = isRecord(body.event) ? body.event : undefined
    return {
      dedupKey: typeof header.event_id === 'string' ? header.event_id : undefined,
      token: typeof header.token === 'string' ? header.token : undefined,
      senderOpenId: readSender(inner),
      message: readMessage(inner),
    }
  }
  return undefined
}

/** Extract the text from a `message.content` JSON string such as `{"text":"hi"}`. */
function extractText(content: string | undefined): string {
  if (content === undefined) return ''
  try {
    const parsed: unknown = JSON.parse(content)
    if (isRecord(parsed) && typeof parsed.text === 'string') return parsed.text
  } catch {
    // Fall back to the raw content when it is not the expected JSON envelope.
  }
  return content
}

/** Map a normalized event to `channel/inbound`, with token check and de-duplication. */
function handleInbound(ctx: Context, config: Config, state: WebhookState, event: FeishuEvent): void {
  if (config.verificationToken !== undefined && config.verificationToken !== '' && event.token !== config.verificationToken) {
    return
  }
  if (event.dedupKey !== undefined) {
    if (state.seen.has(event.dedupKey)) return
    state.seen.add(event.dedupKey)
    if (state.seen.size > SEEN_CAP) {
      const oldest = state.seen.values().next().value
      if (oldest !== undefined) state.seen.delete(oldest)
    }
  }
  const message = event.message
  if (message === undefined || message.message_type !== 'text') return
  const text = extractText(message.content)
  if (text === '') return
  const senderOpenId = event.senderOpenId
  const isP2p = message.chat_type === 'p2p'
  const threadId = isP2p
    ? (senderOpenId ?? message.open_chat_id ?? message.chat_id ?? 'p2p')
    : (message.chat_id ?? message.open_chat_id ?? 'group')
  state.receiveByThread.set(threadId, {
    id: isP2p ? (senderOpenId ?? threadId) : threadId,
    type: isP2p ? 'open_id' : 'chat_id',
  })
  ctx.emit('channel/inbound', {
    channel: 'feishu',
    direction: 'in',
    threadId,
    ...(senderOpenId === undefined ? {} : { sender: senderOpenId }),
    text,
  })
}

/**
 * Process one parsed webhook body, returning the response to ACK back and, for
 * an inbound message, mapping it onto `channel/inbound`.
 * @param ctx - Cordis context to emit `channel/inbound` on.
 * @param config - validated plugin config.
 * @param state - shared webhook bookkeeping (reply targets and de-dup set).
 * @param body - the parsed JSON request body.
 * @returns the HTTP status and body to write to the webhook response.
 */
export function processWebhook(ctx: Context, config: Config, state: WebhookState, body: unknown): { status: number; body: unknown } {
  if (isRecord(body) && typeof body.challenge === 'string') {
    return { status: 200, body: { challenge: body.challenge } }
  }
  const event = normalizeEvent(body)
  if (event !== undefined) handleInbound(ctx, config, state, event)
  return { status: 200, body: {} }
}

/** Start the plaintext webhook server and return its disposer. */
function startWebhook(ctx: Context, config: Config, state: WebhookState): () => void {
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== (config.path ?? '/feishu/webhook')) {
      res.statusCode = 404
      res.end()
      return
    }
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => { raw += chunk })
    req.on('end', () => {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        res.statusCode = 400
        res.end()
        return
      }
      const result = processWebhook(ctx, config, state, parsed)
      res.statusCode = result.status
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(result.body))
    })
  })
  server.listen(config.port ?? 8080)
  return () => { server.close() }
}

/** `tenant_access_token` response fields. */
interface TenantTokenResponse {
  code: number
  msg?: string
  tenant_access_token?: string
  expire?: number
}

/** `im/v1/messages` response fields. */
interface SendResponse {
  code: number
  msg?: string
}

/** Obtain a cached tenant token, refreshing it near expiry. */
async function getTenantToken(config: Config, token: TokenCache): Promise<string> {
  const now = Date.now()
  if (token.token !== '' && token.expiresAt > now) return token.token
  const response = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }),
  })
  if (!response.ok) {
    throw new Error(`feishu: tenant_access_token failed with status ${response.status}`)
  }
  const body = (await response.json()) as TenantTokenResponse
  if (body.code !== 0 || body.tenant_access_token === undefined) {
    throw new Error(`feishu: tenant_access_token failed: ${body.msg ?? 'unknown error'}`)
  }
  token.token = body.tenant_access_token
  token.expiresAt = now + ((body.expire ?? 7200) - 60) * 1000
  return token.token
}

/** Post an outbound text message through `im/v1/messages`. */
async function sendMessage(config: Config, token: TokenCache, state: WebhookState, message: ChannelMessage): Promise<void> {
  if (message.threadId === undefined) {
    throw new Error('feishu: send requires a threadId')
  }
  const accessToken = await getTenantToken(config, token)
  const receive = state.receiveByThread.get(message.threadId) ?? { id: message.threadId, type: 'chat_id' as const }
  const response = await fetch(`${BASE}/im/v1/messages?receive_id_type=${receive.type}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      receive_id: receive.id,
      msg_type: 'text',
      content: JSON.stringify({ text: message.text }),
    }),
  })
  if (!response.ok) {
    throw new Error(`feishu: im/v1/messages failed with status ${response.status}`)
  }
  const body = (await response.json()) as SendResponse
  if (body.code !== 0) {
    throw new Error(`feishu: im/v1/messages failed: ${body.msg ?? 'unknown error'}`)
  }
}

/**
 * Build the Feishu adapter from validated config.
 * @param config - validated plugin config carrying app identity and webhook tuning.
 * @returns the adapter to register with `ctx.channels`.
 */
export function createAdapter(config: Config): ChannelAdapter {
  if (config.encryptKey !== undefined && config.encryptKey !== '') {
    throw new Error('feishu: encrypted webhooks (encryptKey) are not yet supported; omit encryptKey for plaintext mode')
  }
  const token: TokenCache = { token: '', expiresAt: 0 }
  const state = createWebhookState()
  return {
    id: 'feishu',
    capabilities: { receive: true, send: true },
    start: ctx => startWebhook(ctx, config, state),
    send: message => sendMessage(config, token, state, message),
  }
}

/**
 * Mount the Feishu adapter into the channel registry.
 * @param ctx - Cordis context carrying the `channels` service.
 * @param config - validated plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  const adapter = createAdapter(config)
  ctx.effect(() => ctx.channels.registerAdapter(adapter), 'channel-feishu.register()')
}
