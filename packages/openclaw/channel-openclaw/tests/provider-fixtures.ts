import { connect, type Socket } from 'node:net'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import {
  ChannelDeliveryId,
  ChannelMessageId,
  channelActionV1Schema,
  channelSessionCloseV1Schema,
  channelSessionResetV1Schema,
  channelTurnCancelV1Schema,
  channelTurnEnvelopeV1Schema,
  type ChannelActionV1,
  type ChannelBridgeHandshakeV1,
  type ChannelDeliveryReceiptV1,
} from '@clawdsh/dsh-channel'
import { PRODUCTION_OPENCLAW_LOCK } from '../src/locks.ts'
import type { ChannelIpcConfig } from '../src/server.ts'

/** Shared in-memory domain media used to simulate a Provider restart. */
export interface ProviderMedia {
  readonly deliveries: Map<string, unknown>
  readonly actions: Map<string, unknown>
  closes: number
}

/** Side-effect-free terminal-result fixture. */
export const SAFE_TURN_EFFECTS = {
  hadPotentialSideEffects: false,
  replaySafe: true,
  didSendViaMessagingTool: false,
  messagingToolSentTexts: [],
  messagingToolSentMediaUrls: [],
  messagingToolSentTargets: [],
} as const

/** Create a context with durable tables and observable channel-driver calls. */
export function providerContext(media: ProviderMedia = { deliveries: new Map(), actions: new Map(), closes: 0 }) {
  const table = (name: 'deliveries' | 'actions') => {
    const values = media[name]
    return {
      get: (key: string) => values.get(key),
      entries: () => values.entries(),
      put: async (key: string, value: unknown) => { values.set(key, value) },
    }
  }
  const domain = {
    table,
    close: async () => { media.closes += 1 },
  }
  const channels = {
    runTurn: vi.fn(async (_request: unknown, _execution: unknown) => ({
      protocolVersion: 1,
      turnId: 'turn-1',
      runId: 'run-1',
      replayId: 'replay-1',
      effects: SAFE_TURN_EFFECTS,
      status: 'silent',
      sessionId: 'channel-session-1',
    })),
    cancel: vi.fn(async () => {}),
    reset: vi.fn(async (request: { route: unknown }) => ({ protocolVersion: 1, route: request.route })),
    close: vi.fn(async () => {}),
    reportDelivery: vi.fn(async () => {}),
  }
  return {
    ctx: { storageDomain: { open: async () => domain }, channels } as never,
    channels,
    media,
  }
}

/** Allocate a private test state directory and IPC config. */
export async function providerConfig(overrides: Partial<ChannelIpcConfig> = {}): Promise<{
  readonly root: string
  readonly config: ChannelIpcConfig
}> {
  const root = await mkdtemp(join(tmpdir(), 'channel-openclaw-provider-'))
  const state = join(root, 'state')
  await mkdir(state, { mode: 0o700 })
  return {
    root,
    config: {
      track: 'production',
      gatewayInstanceId: 'gateway-1',
      endpoint: join(state, 'bridge.sock'),
      maxFrameBytes: 64 * 1024,
      maxInFlight: 8,
      requestTimeoutMs: 1_000,
      handshakeTimeoutMs: 1_000,
      ...overrides,
    },
  }
}

/** Remove a provider test root. */
export async function removeProviderRoot(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true })
}

/** Exact production bridge identity, with capability overrides for one test. */
export function bridgeHandshake(
  startupNonce: string,
  capabilities: Partial<ChannelBridgeHandshakeV1['capabilities']> = {},
): Record<string, unknown> {
  return {
    protocolVersion: 1,
    gatewayInstanceId: 'gateway-1',
    openclaw: {
      tag: PRODUCTION_OPENCLAW_LOCK.tag,
      commitSha: PRODUCTION_OPENCLAW_LOCK.commitSha,
      artifactSha512: PRODUCTION_OPENCLAW_LOCK.artifactSha512,
      nodeEngine: PRODUCTION_OPENCLAW_LOCK.nodeEngine,
    },
    agentHarness: 'v1',
    capabilities: {
      actions: ['send', 'edit', 'delete', 'react', 'poll', 'typing', 'directory.self'],
      notifications: ['text.delta', 'status'],
      extensions: ['delivery.report'],
      ...capabilities,
    },
    startupNonce,
  }
}

/** Strict default inbound turn. */
export function turn(overrides: Record<string, unknown> = {}) {
  return channelTurnEnvelopeV1Schema.parse({
    protocolVersion: 1,
    idempotencyKey: 'inbound-1',
    turnId: 'turn-1',
    runId: 'run-1',
    route: {
      gatewayInstanceId: 'gateway-1',
      openclawSessionKey: 'session-1',
      generation: 0,
      channel: 'telegram',
      account: 'account-1',
      conversation: 'conversation-1',
      kind: 'direct',
    },
    sender: { senderId: 'sender-1', trust: 'owner' },
    messageId: 'message-1',
    text: 'hello',
    media: [],
    ...overrides,
  })
}

/** Strict default send action. */
export function sendAction(overrides: Record<string, unknown> = {}): ChannelActionV1 {
  return channelActionV1Schema.parse({
    protocolVersion: 1,
    actionId: 'action-1',
    target: {
      gatewayInstanceId: 'gateway-1',
      channel: 'telegram',
      account: 'account-1',
      conversation: 'conversation-1',
    },
    kind: 'send',
    text: 'reply',
    media: [],
    ...overrides,
  })
}

/** Confirmed action receipt matching the supplied action. */
export function confirmed(action: ChannelActionV1, overrides: Record<string, unknown> = {}): ChannelDeliveryReceiptV1 {
  return {
    protocolVersion: 1,
    deliveryId: ChannelDeliveryId(`delivery-${action.actionId}`),
    subject: { kind: 'action', actionId: action.actionId },
    attempt: 1,
    platformMessageId: ChannelMessageId(`platform-${action.actionId}`),
    status: 'confirmed',
    ...overrides,
  }
}

/** Strict control fixtures accepted by the Provider request router. */
export const cancelRequest = () => channelTurnCancelV1Schema.parse({
  protocolVersion: 1, turnId: 'turn-1', runId: 'run-1', reason: 'user',
})
export const resetRequest = () => channelSessionResetV1Schema.parse({
  protocolVersion: 1,
  route: turn().route,
  nextGeneration: 1,
  reason: 'reset',
})
export const closeRequest = () => channelSessionCloseV1Schema.parse({
  protocolVersion: 1, route: turn().route, reason: 'gateway',
})

interface PendingBridgeRequest {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
}

/** Raw bridge peer for authentication plus JSON-RPC request/response tests. */
export class BridgeClient {
  readonly frames: Record<string, unknown>[] = []
  readonly requests: Record<string, unknown>[] = []
  readonly notifications: Record<string, unknown>[] = []
  onProviderRequest: (frame: Record<string, unknown>) => unknown = (frame) => {
    const params = frame.params as ChannelActionV1
    return confirmed(params)
  }

  private socket: Socket | undefined
  private buffer = ''
  private nextId = 0
  private readonly pending = new Map<string, PendingBridgeRequest>()
  private readonly waiters: Array<() => void> = []

  async connect(endpoint: string): Promise<void> {
    this.socket = connect(endpoint)
    this.socket.setEncoding('utf8')
    this.socket.on('data', (chunk) => { this.consume(String(chunk)) })
    await new Promise<void>((resolve, reject) => {
      this.socket?.once('connect', resolve)
      this.socket?.once('error', reject)
    })
  }

  send(value: Record<string, unknown>): void {
    this.socket?.write(`${JSON.stringify(value)}\n`)
  }

  async authenticate(token: string, handshake: Record<string, unknown>): Promise<void> {
    this.send({ kind: 'handshake', token, handshake })
    await this.waitFor(frame => frame.kind === 'handshake-ack')
  }

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = `bridge-${++this.nextId}`
    this.send({ jsonrpc: '2.0', id, method, params })
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }) })
  }

  notify(method: string, params: Record<string, unknown>): void {
    this.send({ jsonrpc: '2.0', method, params })
  }

  async waitFor(predicate: (frame: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
    const existing = this.frames.find(predicate)
    if (existing !== undefined) return existing
    await new Promise<void>((resolve) => { this.waiters.push(resolve) })
    return await this.waitFor(predicate)
  }

  async waitForClose(): Promise<void> {
    if (this.socket?.destroyed === true) return
    await new Promise<void>((resolve) => { this.socket?.once('close', () => { resolve() }) })
  }

  close(): void {
    this.socket?.destroy()
  }

  private consume(chunk: string): void {
    this.buffer += chunk
    while (true) {
      const newline = this.buffer.indexOf('\n')
      if (newline < 0) return
      const frame = JSON.parse(this.buffer.slice(0, newline)) as Record<string, unknown>
      this.buffer = this.buffer.slice(newline + 1)
      this.frames.push(frame)
      const id = typeof frame.id === 'string' || typeof frame.id === 'number' ? String(frame.id) : undefined
      if (typeof frame.method === 'string') {
        if (id === undefined) this.notifications.push(frame)
        else {
          this.requests.push(frame)
          void Promise.resolve().then(() => this.onProviderRequest(frame)).then(
            (result) => { this.send({ jsonrpc: '2.0', id, result }) },
            (error: unknown) => {
              this.send({
                jsonrpc: '2.0', id,
                error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
              })
            },
          )
        }
      } else if (id !== undefined) {
        const pending = this.pending.get(id)
        if (pending !== undefined) {
          this.pending.delete(id)
          if (typeof frame.error === 'object' && frame.error !== null) {
            pending.reject(new Error(String((frame.error as Record<string, unknown>).message)))
          } else pending.resolve(frame.result)
        }
      }
      for (const resolve of this.waiters.splice(0)) resolve()
    }
  }
}
