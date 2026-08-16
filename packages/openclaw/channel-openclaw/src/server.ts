/** Authenticated local IPC server and Channel Provider implementation. @module @clawdsh/dsh-channel-openclaw/server */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { connect, createServer, type Server, type Socket } from 'node:net'
import { chmod, lstat, mkdir, unlink } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  ChannelProviderId,
  canonicalChannelJson,
  channelActionV1Schema,
  channelActionResultV1Schema,
  channelBridgeHandshakeV1Schema,
  channelDeliveryReportV1Schema,
  channelHealthV1Schema,
  channelSessionCloseV1Schema,
  channelSessionResetV1Schema,
  channelTurnCancelV1Schema,
  channelTurnEnvelopeV1Schema,
  deliveryReceiptAdvances,
  serializeKeyedOperation,
  type ChannelActionV1,
  type ChannelActionResultV1,
  type ChannelBridgeHandshakeV1,
  type ChannelDeliveryReceiptV1,
  type ChannelHealthV1,
  type ChannelProviderV1,
  type ChannelTurnNotificationV1,
} from '@clawdsh/dsh-channel'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { NdjsonConnection, isObject, type JsonObject } from './framing.ts'
import { lockFor, type OpenClawRuntimeLock, type OpenClawTrack } from './locks.ts'
import { JsonRpcPeer, type RpcHandler } from './rpc.ts'
import {
  openClawChannelDomainSpec,
  type ProviderActionRecord,
  type ProviderDeliveryRecord,
} from './storage.ts'

/** IPC limits and identity set by the supervising plugin. */
export interface ChannelIpcConfig {
  /** Immutable OpenClaw host track admitted by the handshake. */
  readonly track: OpenClawTrack
  /** Stable identity separating one managed Gateway's routes and storage. */
  readonly gatewayInstanceId: string
  /** Absolute Unix socket path inside the private state directory. */
  readonly endpoint: string
  /** Maximum UTF-8 bytes in one JSON object frame. */
  readonly maxFrameBytes: number
  /** Maximum concurrent requests in either direction. */
  readonly maxInFlight: number
  /** Deadline for each DSH-to-Gateway RPC wait; expiry does not cancel remote work. */
  readonly requestTimeoutMs: number
  /** Deadline for the first authenticated handshake on a new socket. */
  readonly handshakeTimeoutMs: number
}

interface InFlightAction {
  readonly digest: string
  readonly promise: Promise<ChannelActionResultV1>
}

/** Per-startup secrets injected only into the supervised bridge process. */
export interface ChannelIpcSecrets {
  /** Ephemeral bearer token compared in constant time during handshake. */
  readonly token: string
  /** Ephemeral nonce bound into the immutable bridge identity. */
  readonly startupNonce: string
}

/** Authenticated local Provider plus lifecycle controls used by the supervisor. */
export class OpenClawChannelProvider implements ChannelProviderV1 {
  /** Single channel provider identity. */
  readonly id = ChannelProviderId('openclaw')
  /** Per-start secrets exposed only to the supervised bridge process. */
  readonly secrets: ChannelIpcSecrets = {
    token: randomBytes(32).toString('base64url'),
    startupNonce: randomBytes(32).toString('base64url'),
  }
  /** First bridge identity that passed token, nonce, and host-lock validation. */
  readonly firstHandshake: Promise<ChannelBridgeHandshakeV1>

  private readonly lock: OpenClawRuntimeLock
  private readonly deliveries: KvTable<string, ProviderDeliveryRecord>
  private readonly actions: KvTable<string, ProviderActionRecord>
  private readonly handshakeReady = Promise.withResolvers<ChannelBridgeHandshakeV1>()
  private server: Server | undefined
  private connection: NdjsonConnection | undefined
  private peer: JsonRpcPeer | undefined
  private readonly peerDrains = new Map<JsonRpcPeer, Promise<void>>()
  private readonly actionOperations = new Map<string, InFlightAction>()
  private readonly deliveryOperations = new Map<string, Promise<void>>()
  private handshake: ChannelBridgeHandshakeV1 | undefined
  private lifecycle: ChannelHealthV1['status'] = 'starting'
  private diagnostic: string | undefined
  private shutdownStarted = false
  private serverClose: Promise<void> | undefined
  private disposePromise: Promise<void> | undefined

  private constructor(
    private readonly ctx: Context,
    readonly config: ChannelIpcConfig,
    private readonly domain: Domain<typeof openClawChannelDomainSpec>,
  ) {
    this.lock = lockFor(config.track)
    this.deliveries = domain.table('deliveries')
    this.actions = domain.table('actions')
    this.firstHandshake = this.handshakeReady.promise
  }

  /**
   * Open provider storage and bind its local endpoint.
   * @param ctx - Context providing channel routing and durable storage.
   * @param config - Explicit IPC identity, endpoint, and resource limits.
   * @returns A bound provider ready to authenticate one bridge.
   */
  static async create(ctx: Context, config: ChannelIpcConfig): Promise<OpenClawChannelProvider> {
    if (process.platform === 'win32') {
      throw new Error('channel-openclaw: Windows named-pipe ACL enforcement requires a native seam and is fail-closed in this release')
    }
    const domain = await ctx.storageDomain.open(openClawChannelDomainSpec)
    const provider = new OpenClawChannelProvider(ctx, config, domain)
    try {
      for (const [key, record] of provider.actions.entries()) {
        if (record.phase === 'running') {
          await provider.actions.put(key, { ...record, phase: 'needs-recovery', updatedAt: Date.now() })
        }
      }
      await provider.listen()
      return provider
    } catch (error) {
      await domain.close()
      throw error
    }
  }

  /**
   * Capability-check and forward one action, persisting its receipt before returning.
   * @param candidate - Strict V1 action supplied by a channel consumer.
   * @param signal - Optional cancellation for the local RPC wait.
   * @returns The validated platform receipt, directory result, or resolution result.
   */
  async action(candidate: ChannelActionV1, signal?: AbortSignal): Promise<ChannelActionResultV1> {
    signal?.throwIfAborted()
    const action = channelActionV1Schema.parse(candidate)
    const handshake = this.requireHandshake()
    if (action.target.gatewayInstanceId !== handshake.gatewayInstanceId) {
      throw new Error('channel-openclaw: action targets another Gateway instance')
    }
    if (!handshake.capabilities.actions.includes(action.kind)) {
      throw new Error(`channel-openclaw: Gateway does not support action ${action.kind}`)
    }
    if ((action.kind === 'send' || action.kind === 'edit') && action.media.length > 0) {
      throw new Error('channel-openclaw: outbound media awaits a DSH staging writer and is not simulated')
    }
    if (!isMutation(action)) return await this.dispatchAction(action, 'channel.action', signal)
    const key = action.actionId
    const digest = digestJson(action)
    const inFlight = this.actionOperations.get(key)
    if (inFlight !== undefined) {
      if (inFlight.digest !== digest) throw new Error('channel-openclaw: action id was reused with different input')
      throw new Error('channel-openclaw: action is already running; concurrent dispatch is forbidden')
    }
    // Reserve synchronously before the first durable await so a same-key call
    // cannot also observe an absent row and dispatch a duplicate mutation.
    const operation = Promise.resolve().then(() => this.executeMutation(action, key, digest, signal))
    this.actionOperations.set(key, { digest, promise: operation })
    void operation.finally(() => {
      this.actionOperations.delete(key)
    }).catch((_actionFailureReturnedToCaller: unknown) => {
      // The caller owns the original rejection; this observes finally()'s derived branch only.
    })
    return await operation
  }

  /** Execute one mutation after its action-id reservation is visible. */
  private async executeMutation(
    action: ChannelActionV1,
    key: string,
    digest: string,
    signal?: AbortSignal,
  ): Promise<ChannelActionResultV1> {
    signal?.throwIfAborted()
    const previous = this.actions.get(key)
    let reconcile = false
    if (previous !== undefined) {
      if (previous.digest !== digest) throw new Error('channel-openclaw: action id was reused with different input')
      if (previous.phase === 'completed') return previous.result
      if (previous.phase === 'running') {
        throw new Error('channel-openclaw: action is already running; concurrent dispatch is forbidden')
      }
      reconcile = true
    } else {
      await this.actions.put(key, { digest, action, phase: 'running', updatedAt: Date.now() })
    }
    try {
      const method = reconcile ? 'channel.reconcile' : 'channel.action'
      const result = await this.dispatchAction(action, method, signal)
      await this.actions.put(key, { digest, action, phase: 'completed', result, updatedAt: Date.now() })
      return result
    } catch (error) {
      await this.actions.put(key, { digest, action, phase: 'needs-recovery', updatedAt: Date.now() })
      throw error
    }
  }

  /** Dispatch one authorized action and validate its exact result identity. */
  private async dispatchAction(
    action: ChannelActionV1,
    method: 'channel.action' | 'channel.reconcile',
    signal?: AbortSignal,
  ): Promise<ChannelActionResultV1> {
    const raw = await this.requirePeer().request(method, action as unknown as JsonObject, signal)
    const result = channelActionResultV1Schema.parse(raw)
    const actionId = 'subject' in result ? result.subject.actionId : result.actionId
    if (actionId !== action.actionId) {
      throw new Error('channel-openclaw: action result does not match the request')
    }
    if ('subject' in result) await this.persistReceipt(result)
    return result
  }

  /** Query bridge account health, degrading to a local diagnostic on transport failure. */
  async health(signal?: AbortSignal): Promise<ChannelHealthV1> {
    signal?.throwIfAborted()
    const peer = this.peer
    if (peer !== undefined && this.handshake !== undefined) {
      try {
        const health = channelHealthV1Schema.parse(await peer.request('health.get', {}, signal))
        if (health.status === 'ready' && !this.shutdownStarted) {
          this.lifecycle = 'ready'
          this.diagnostic = undefined
        }
        return health
      } catch (_healthProbeFailed) {
        return this.localHealth('degraded', 'Gateway health probe failed.')
      }
    }
    return this.localHealth(this.lifecycle, this.diagnostic)
  }

  /**
   * Publish optional progress only when the authenticated handshake enabled its kind.
   * @param notification - Validated presentation-only turn progress.
   */
  notifyProgress(notification: ChannelTurnNotificationV1): void {
    const peer = this.peer
    const handshake = this.handshake
    if (peer !== undefined && handshake !== undefined) this.notifyProgressOn(peer, handshake, notification)
  }

  /** Stop accepting new peers while retaining the active bridge for Gateway cleanup. */
  beginShutdown(): void {
    if (this.shutdownStarted) return
    this.shutdownStarted = true
    this.lifecycle = 'stopping'
    const server = this.server
    this.server = undefined
    if (server !== undefined) {
      this.serverClose = new Promise<void>((resolvePromise, reject) => {
        server.close((error) => {
          if (error === undefined) resolvePromise()
          else reject(error)
        })
      })
    }
  }

  /** Disconnect the current peer and release the endpoint and durable ledger. */
  dispose(): Promise<void> {
    this.disposePromise ??= this.disposeOwned()
    return this.disposePromise
  }

  private async disposeOwned(): Promise<void> {
    this.beginShutdown()
    const failures: Error[] = []
    const connection = this.connection
    const peer = this.peer
    this.connection = undefined
    this.peer = undefined
    const shutdownCause = new Error('channel-openclaw: Provider is shutting down')
    const ownedPeerDrain = peer === undefined ? undefined : this.trackPeerShutdown(peer, shutdownCause)
    for (const detachedPeer of this.peerDrains.keys()) void this.trackPeerShutdown(detachedPeer, shutdownCause)
    connection?.close()
    try {
      await ownedPeerDrain
      await this.drainPeers()
    } catch (error) {
      failures.push(errorMessageError(error))
    }
    await this.drainOperations()
    try {
      await this.serverClose
    } catch (error) {
      failures.push(errorMessageError(error))
    }
    try {
      await removeSocket(this.config.endpoint)
    } catch (error) {
      failures.push(errorMessageError(error))
    }
    try {
      await this.domain.close()
    } catch (error) {
      failures.push(errorMessageError(error))
    }
    this.lifecycle = 'stopped'
    const firstFailure = failures[0]
    if (firstFailure !== undefined && failures.length === 1) throw firstFailure
    if (failures.length > 1) throw new AggregateError(failures, 'channel-openclaw: Provider cleanup was incomplete')
  }

  /** Track a detached peer while its admitted handlers settle naturally. */
  private trackPeerDetach(peer: JsonRpcPeer, cause?: Error): Promise<void> {
    return this.trackPeer(peer, peer.detach(cause))
  }

  /** Upgrade an active or detached peer to aborting Provider shutdown. */
  private trackPeerShutdown(peer: JsonRpcPeer, cause?: Error): Promise<void> {
    return this.trackPeer(peer, peer.close(cause))
  }

  /** Retain one peer until its stable drain completes. */
  private trackPeer(peer: JsonRpcPeer, drain: Promise<void>): Promise<void> {
    this.peerDrains.set(peer, drain)
    void drain.then(
      () => { if (this.peerDrains.get(peer) === drain) this.peerDrains.delete(peer) },
      () => { if (this.peerDrains.get(peer) === drain) this.peerDrains.delete(peer) },
    )
    return drain
  }

  /** Await every peer drain admitted before or during shutdown. */
  private async drainPeers(): Promise<void> {
    while (this.peerDrains.size > 0) {
      await Promise.all([...this.peerDrains.values()])
    }
  }

  /** Await every keyed action and receipt operation admitted before shutdown. */
  private async drainOperations(): Promise<void> {
    while (this.actionOperations.size > 0 || this.deliveryOperations.size > 0) {
      await Promise.allSettled([
        ...[...this.actionOperations.values()].map(entry => entry.promise),
        ...this.deliveryOperations.values(),
      ])
    }
  }

  private async listen(): Promise<void> {
    await prepareSocket(this.config.endpoint, this.config.handshakeTimeoutMs)
    const server = createServer((socket) => { this.accept(socket) })
    this.server = server
    await new Promise<void>((resolvePromise, reject) => {
      const failed = (error: Error): void => { server.off('listening', ready); reject(error) }
      const ready = (): void => { server.off('error', failed); resolvePromise() }
      server.once('error', failed)
      server.once('listening', ready)
      server.listen(this.config.endpoint)
    })
    await chmod(this.config.endpoint, 0o600)
  }

  private accept(socket: Socket): void {
    if (this.connection !== undefined || this.shutdownStarted) {
      socket.destroy()
      return
    }
    socket.setNoDelay(true)
    const connection = new NdjsonConnection(socket, this.config.maxFrameBytes)
    this.connection = connection
    let authenticated = false
    const timer = setTimeout(() => {
      if (!authenticated) connection.close(new Error('channel-openclaw: bridge handshake timed out'))
    }, this.config.handshakeTimeoutMs)
    timer.unref()
    connection.onClose((error) => {
      clearTimeout(timer)
      if (this.connection === connection) {
        const peer = this.peer
        this.connection = undefined
        this.peer = undefined
        if (peer !== undefined) {
          void this.trackPeerDetach(peer, error)
        }
        this.lifecycle = this.shutdownStarted ? 'stopping' : 'degraded'
        this.diagnostic = error?.message === 'channel-openclaw: bridge authentication failed'
          ? error.message
          : error === undefined
            ? 'Gateway bridge disconnected.'
            : 'Gateway bridge disconnected unexpectedly.'
      }
    })
    connection.onValue((frame) => {
      try {
        const handshake = this.authenticate(frame)
        authenticated = true
        clearTimeout(timer)
        this.handshake = handshake
        this.lifecycle = 'starting'
        this.diagnostic = undefined
        const peerHolder: { current?: JsonRpcPeer } = {}
        const peer = new JsonRpcPeer(
          connection,
          this.handlers(handshake, (notification) => {
            const admittedPeer = peerHolder.current
            /* v8 ignore next -- JsonRpcPeer defers handlers to a microtask after its constructor returns and the peer is assigned. */
            if (admittedPeer !== undefined) this.notifyProgressOn(admittedPeer, handshake, notification)
          }),
          this.config.maxInFlight,
          this.config.requestTimeoutMs,
        )
        peerHolder.current = peer
        this.peer = peer
        void connection.send({ kind: 'handshake-ack', protocolVersion: 1 }).catch((error: unknown) => {
          connection.close(errorMessageError(error))
        })
        this.handshakeReady.resolve(handshake)
      } catch (_authenticationFailed) {
        connection.close(new Error('channel-openclaw: bridge authentication failed'))
      }
    })
  }

  private authenticate(frame: JsonObject): ChannelBridgeHandshakeV1 {
    if (frame.kind !== 'handshake' || typeof frame.token !== 'string' || !isObject(frame.handshake)) {
      throw new Error('invalid handshake envelope')
    }
    const actual = Buffer.from(frame.token)
    const expected = Buffer.from(this.secrets.token)
    if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) throw new Error('invalid token')
    const handshake = channelBridgeHandshakeV1Schema.parse(frame.handshake)
    if (handshake.gatewayInstanceId !== this.config.gatewayInstanceId
      || handshake.startupNonce !== this.secrets.startupNonce
      || handshake.openclaw.tag !== this.lock.tag
      || handshake.openclaw.commitSha !== this.lock.commitSha
      || handshake.openclaw.artifactSha512 !== this.lock.artifactSha512
      || handshake.openclaw.nodeEngine !== this.lock.nodeEngine
      || handshake.agentHarness !== this.lock.agentHarness) {
      throw new Error('bridge identity does not match the immutable host lock')
    }
    return handshake
  }

  private handlers(
    handshake: ChannelBridgeHandshakeV1,
    notifyProgress: (notification: ChannelTurnNotificationV1) => void,
  ): Readonly<Record<string, RpcHandler>> {
    return {
      'turn.run': async (params, signal) => {
        const turn = channelTurnEnvelopeV1Schema.parse(params)
        this.assertGateway(turn.route.gatewayInstanceId)
        return await this.ctx.channels.runTurn(turn, {
          signal,
          notify: notifyProgress,
        })
      },
      'turn.cancel': async (params) => {
        await this.ctx.channels.cancel(channelTurnCancelV1Schema.parse(params))
        return {}
      },
      'session.reset': async (params) => {
        const request = channelSessionResetV1Schema.parse(params)
        this.assertGateway(request.route.gatewayInstanceId)
        return await this.ctx.channels.reset(request)
      },
      'session.close': async (params) => {
        const request = channelSessionCloseV1Schema.parse(params)
        this.assertGateway(request.route.gatewayInstanceId)
        await this.ctx.channels.close(request)
        return {}
      },
      'health.get': () => this.localHealth(this.lifecycle, this.diagnostic),
      'delivery.report': async (params) => {
        const report = channelDeliveryReportV1Schema.parse(params)
        if (!handshake.capabilities.extensions.includes('delivery.report')) {
          throw new Error('channel-openclaw: delivery.report was not negotiated')
        }
        await this.persistReceipt(report.receipt)
        await this.ctx.channels.reportDelivery(report)
        return {}
      },
    }
  }

  /** Send progress only to the peer that admitted the corresponding turn. */
  private notifyProgressOn(
    peer: JsonRpcPeer,
    handshake: ChannelBridgeHandshakeV1,
    notification: ChannelTurnNotificationV1,
  ): void {
    if (!handshake.capabilities.notifications.includes(notification.kind)) return
    void peer.notify('turn.progress', notification as unknown as JsonObject).catch(() => {})
  }

  private persistReceipt(receipt: ChannelDeliveryReceiptV1): Promise<void> {
    const key = receipt.deliveryId
    return serializeKeyedOperation(this.deliveryOperations, key, async () => {
      const previous = this.deliveries.get(key)
      if (previous !== undefined) {
        if (JSON.stringify(previous.receipt.subject) !== JSON.stringify(receipt.subject)) {
          throw new Error('channel-openclaw: delivery id was reused for another subject')
        }
        if (JSON.stringify(previous.receipt) === JSON.stringify(receipt)) return
        if (!deliveryReceiptAdvances(previous.receipt, receipt)) {
          throw new Error('channel-openclaw: delivery receipt regressed after a durable state')
        }
      }
      await this.deliveries.put(key, { receipt, updatedAt: Date.now() })
    })
  }

  private assertGateway(gatewayInstanceId: string): void {
    if (gatewayInstanceId !== this.config.gatewayInstanceId) {
      throw new Error('channel-openclaw: request targets another Gateway instance')
    }
  }

  private requirePeer(): JsonRpcPeer {
    if (this.peer === undefined) throw new Error('channel-openclaw: Gateway bridge is disconnected')
    return this.peer
  }

  private requireHandshake(): ChannelBridgeHandshakeV1 {
    if (this.handshake === undefined || this.peer === undefined) throw new Error('channel-openclaw: Gateway bridge is disconnected')
    return this.handshake
  }

  private localHealth(status: ChannelHealthV1['status'], diagnostic?: string): ChannelHealthV1 {
    return {
      protocolVersion: 1,
      status,
      checkedAt: new Date().toISOString(),
      ...(this.handshake === undefined ? {} : { handshake: this.handshake }),
      accounts: [],
      diagnostics: diagnostic === undefined ? [] : [{ code: 'CHANNEL_GATEWAY', message: diagnostic }],
    }
  }
}

/** Require a private parent and remove only a stale socket at the exact configured path. */
async function prepareSocket(endpoint: string, probeTimeoutMs: number): Promise<void> {
  if (!isAbsolute(endpoint)) throw new Error('channel-openclaw: POSIX endpoint must be an absolute Unix socket path')
  const parent = dirname(endpoint)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  const parentInfo = await lstat(parent)
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink() || (parentInfo.mode & 0o077) !== 0) {
    throw new Error('channel-openclaw: Unix socket parent must be a private 0700 directory')
  }
  try {
    const existing = await lstat(endpoint)
    if (!existing.isSocket()) throw new Error('channel-openclaw: IPC endpoint exists and is not a socket')
    await requireStaleSocket(endpoint, probeTimeoutMs)
    await unlink(endpoint)
  } catch (error) {
    if (!isMissing(error)) throw error
  }
}

/** Reject a live listener and accept only connection-refused or disappeared socket entries. */
async function requireStaleSocket(endpoint: string, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const socket = connect(endpoint)
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      if (error === undefined) resolvePromise()
      else reject(error)
    }
    const timer = setTimeout(() => {
      finish(new Error('channel-openclaw: existing IPC endpoint probe timed out'))
    }, timeoutMs)
    socket.once('connect', () => {
      finish(new Error('channel-openclaw: IPC endpoint is already active'))
    })
    socket.once('error', (error) => {
      if (hasErrorCode(error, 'ECONNREFUSED') || hasErrorCode(error, 'ENOENT')) finish()
      else finish(error)
    })
  })
}

/** Remove only this plugin's exact socket after server close. */
async function removeSocket(endpoint: string): Promise<void> {
  try {
    const info = await lstat(endpoint)
    if (info.isSocket()) await unlink(endpoint)
  } catch (error) {
    if (!isMissing(error)) throw error
  }
}

/** Node error-code guard for absent paths. */
function isMissing(error: unknown): boolean {
  return hasErrorCode(error, 'ENOENT')
}

/** Match one Node filesystem or socket error code. */
function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

/** Ensure a callback receives an Error. */
function errorMessageError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

/** Whether an action can produce an externally visible platform side effect. */
function isMutation(action: ChannelActionV1): boolean {
  return action.kind === 'send' || action.kind === 'edit' || action.kind === 'delete'
    || action.kind === 'react' || action.kind === 'poll' || action.kind === 'typing'
}

/** Canonical JSON identity for durable action input comparison. */
function digestJson(value: unknown): string {
  return createHash('sha256')
    .update(canonicalChannelJson(value, 'channel-openclaw', 'literal'))
    .digest('hex')
}
