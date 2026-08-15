/** Minimal bidirectional JSON-RPC 2.0 over the authenticated NDJSON connection. @module @clawdsh/dsh-channel-openclaw/rpc */

import { NdjsonConnection, isObject, type JsonObject } from './framing.ts'

/** One method implementation; params are validated by the package protocol schemas. */
export type RpcHandler = (params: unknown) => unknown

interface PendingRequest {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  readonly detachWait: () => void
}

/** Protocol failure returned by a peer. */
export class ChannelRpcError extends Error {
  constructor(
    message: string,
    readonly rpcCode: number,
    readonly data?: unknown,
  ) {
    super(message)
    this.name = 'ChannelRpcError'
  }
}

const PUBLIC_HANDLER_FAILURE = 'ClawDSH rejected the authenticated bridge request.'

/** One authenticated bidirectional JSON-RPC peer. */
export class JsonRpcPeer {
  private nextId = 0
  private incoming = 0
  private readonly pending = new Map<string, PendingRequest>()
  private outgoingNotifications = 0
  private closed = false

  constructor(
    private readonly connection: NdjsonConnection,
    private readonly handlers: Readonly<Record<string, RpcHandler>>,
    private readonly maxInFlight: number,
    private readonly requestTimeoutMs: number,
  ) {
    connection.onValue((value) => { this.receive(value) })
    connection.onClose((error) => { this.close(error) })
  }

  /**
   * Send one request and resolve its result. Aborting or timing out forgets only the local wait.
   * @param method - Negotiated JSON-RPC method.
   * @param params - Validated object parameters.
   * @param signal - Optional cancellation for this local wait.
   * @returns The untrusted result supplied by the peer.
   */
  request(method: string, params: JsonObject, signal?: AbortSignal): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('channel-openclaw: Gateway IPC is disconnected'))
    signal?.throwIfAborted()
    if (this.pending.size >= this.maxInFlight) {
      return Promise.reject(new ChannelRpcError('too many outbound in-flight requests', -32001))
    }
    const id = `dsh-${++this.nextId}`
    return new Promise<unknown>((resolvePromise, reject) => {
      const abort = (): void => {
        const pending = this.pending.get(id)
        if (pending === undefined) return
        this.pending.delete(id)
        pending.detachWait()
        pending.reject(signal?.reason instanceof Error ? signal.reason : new Error('channel-openclaw: RPC request aborted'))
      }
      const timer = setTimeout(() => {
        const pending = this.pending.get(id)
        if (pending === undefined) return
        this.pending.delete(id)
        pending.detachWait()
        pending.reject(new ChannelRpcError(`Gateway RPC request ${method} timed out`, -32002))
      }, this.requestTimeoutMs)
      timer.unref()
      this.pending.set(id, {
        resolve: resolvePromise,
        reject,
        detachWait: () => {
          clearTimeout(timer)
          signal?.removeEventListener('abort', abort)
        },
      })
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted === true) {
        abort()
        return
      }
      void this.connection.send({ jsonrpc: '2.0', id, method, params }).catch((error: unknown) => {
        const pending = this.pending.get(id)
        if (pending === undefined) return
        this.pending.delete(id)
        pending.detachWait()
        pending.reject(asError(error))
      })
    })
  }

  /**
   * Send a notification with no response.
   * @param method - Negotiated JSON-RPC notification method.
   * @param params - Validated object parameters.
   */
  async notify(method: string, params: JsonObject): Promise<void> {
    if (this.closed) return
    if (this.outgoingNotifications >= this.maxInFlight) {
      throw new ChannelRpcError('too many outbound in-flight notifications', -32001)
    }
    this.outgoingNotifications += 1
    try {
      await this.connection.send({ jsonrpc: '2.0', method, params })
    } finally {
      this.outgoingNotifications -= 1
    }
  }

  /**
   * Reject local waits without cancelling remote work.
   * @param cause - Optional transport failure returned to each local waiter.
   */
  close(cause?: Error): void {
    if (this.closed) return
    this.closed = true
    const error = cause ?? new Error('channel-openclaw: Gateway IPC disconnected')
    for (const pending of this.pending.values()) {
      pending.detachWait()
      pending.reject(error)
    }
    this.pending.clear()
  }

  private receive(message: JsonObject): void {
    if (message.jsonrpc !== '2.0') {
      this.connection.close(new ChannelRpcError('invalid JSON-RPC version', -32600))
      return
    }
    if (typeof message.method === 'string') {
      const notification = !Object.hasOwn(message, 'id')
      if (!hasExactKeys(message, notification
        ? ['jsonrpc', 'method', 'params']
        : ['jsonrpc', 'id', 'method', 'params'])) {
        this.connection.close(new ChannelRpcError('invalid JSON-RPC call envelope', -32600))
        return
      }
      if (!notification && !isRpcId(message.id)) {
        this.connection.close(new ChannelRpcError('invalid JSON-RPC request id', -32600))
        return
      }
      this.dispatchIncoming(message)
      return
    }
    const hasResult = Object.hasOwn(message, 'result')
    const hasError = Object.hasOwn(message, 'error')
    if (hasResult === hasError || !isRpcId(message.id)
      || !hasExactKeys(message, hasResult ? ['jsonrpc', 'id', 'result'] : ['jsonrpc', 'id', 'error'])) {
      this.connection.close(new ChannelRpcError('invalid JSON-RPC response envelope', -32600))
      return
    }
    if (hasError && (!isObject(message.error)
      || !hasExactKeys(message.error, Object.hasOwn(message.error, 'data') ? ['code', 'message', 'data'] : ['code', 'message'])
      || !Number.isInteger(message.error.code) || typeof message.error.message !== 'string')) {
      this.connection.close(new ChannelRpcError('invalid JSON-RPC error object', -32600))
      return
    }
    this.resolveResponse(message)
  }

  private dispatchIncoming(message: JsonObject): void {
    const id = Object.hasOwn(message, 'id') ? message.id as string | number : undefined
    const method = message.method as string
    const handler = this.handlers[method]
    if (handler === undefined) {
      if (id !== undefined) void this.replyError(id, -32601, `unknown method ${method}`)
      else this.connection.close(new ChannelRpcError(`unknown notification ${method}`, -32601))
      return
    }
    if (!isObject(message.params)) {
      if (id !== undefined) void this.replyError(id, -32602, 'params must be an object')
      else this.connection.close(new ChannelRpcError('notification params must be an object', -32602))
      return
    }
    if (this.incoming >= this.maxInFlight) {
      if (id !== undefined) void this.replyError(id, -32001, 'too many in-flight requests')
      else this.connection.close(new ChannelRpcError('too many in-flight notifications', -32001))
      return
    }
    this.incoming += 1
    void Promise.resolve().then(async () => await handler(message.params)).then(
      async (result) => {
        if (id !== undefined) await this.connection.send({ jsonrpc: '2.0', id, result: result ?? null })
      },
      async (error: unknown) => {
        if (id !== undefined) await this.replyError(id, -32000, publicHandlerFailure(error))
      },
    ).catch(() => {}).finally(() => { this.incoming -= 1 })
  }

  private resolveResponse(message: JsonObject): void {
    const id = String(message.id)
    const pending = this.pending.get(id)
    if (pending === undefined) return
    this.pending.delete(id)
    pending.detachWait()
    if (Object.hasOwn(message, 'error')) {
      const error = message.error as JsonObject
      pending.reject(new ChannelRpcError(error.message as string, error.code as number, error.data))
      return
    }
    pending.resolve(message.result)
  }

  private async replyError(id: string | number, code: number, message: string): Promise<void> {
    try {
      await this.connection.send({ jsonrpc: '2.0', id, error: { code, message } })
    } catch (_connectionClosedBeforeErrorReply) {
      // The request keeps running semantics independent from a transient socket.
    }
  }
}

/** Keep arbitrary dependency messages, paths, and credentials on the DSH side of IPC. */
function publicHandlerFailure(_error: unknown): string {
  return PUBLIC_HANDLER_FAILURE
}

/** Test whether an object has exactly the permitted own enumerable fields. */
function hasExactKeys(value: JsonObject, expected: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && expected.every(key => Object.hasOwn(value, key))
}

/** Accept the JSON-RPC id forms supported by this local protocol. */
function isRpcId(value: unknown): value is string | number {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
}

/** Normalize a thrown value at the RPC boundary. */
function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
