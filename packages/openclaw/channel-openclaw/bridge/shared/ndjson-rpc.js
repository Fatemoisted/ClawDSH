import { connect as connectSocket } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'

/** JSON-RPC failure received from, or intentionally returned to, the local peer. */
export class RpcMethodError extends Error {
  /**
   * @param {number} code - JSON-RPC error code.
   * @param {string} message - Sanitized error message.
   * @param {unknown} [data] - Optional structured diagnostic.
   */
  constructor(code, message, data) {
    super(message)
    this.name = 'RpcMethodError'
    this.code = code
    this.data = data
  }
}

/** Bounded, authenticated, reconnecting NDJSON JSON-RPC client. */
export class NdjsonRpcClient {
  #config
  #connection
  #connecting
  #disposed = false
  #counter = 0

  /**
   * @param {object} config - Transport configuration.
   * @param {string} config.endpoint - Unix socket or Windows named-pipe endpoint.
   * @param {string} config.token - Per-startup bearer used only by the first frame.
   * @param {object} config.handshake - ChannelBridgeHandshakeV1 payload.
   * @param {number} config.maxFrameBytes - Maximum UTF-8 bytes before LF.
   * @param {number} config.maxInFlight - Bidirectional concurrent request cap.
   * @param {number} config.requestTimeoutMs - Timeout for handshake and RPC calls.
   * @param {Record<string, (params: object, signal: AbortSignal) => unknown>} [config.handlers] - Peer request methods.
   * @param {(method: string, params: object) => void | Promise<void>} [config.onNotification] - Peer notification sink.
   */
  constructor(config) {
    if (!isNonEmptyString(config?.endpoint)) throw new Error('ClawDSH bridge endpoint is required')
    if (!isNonEmptyString(config?.token)) throw new Error('ClawDSH bridge token is required')
    if (!isObject(config?.handshake)) throw new Error('ClawDSH bridge handshake is required')
    positiveInteger(config.maxFrameBytes, 'maxFrameBytes')
    positiveInteger(config.maxInFlight, 'maxInFlight')
    positiveInteger(config.requestTimeoutMs, 'requestTimeoutMs')
    this.#config = Object.freeze({ ...config })
  }

  /** Whether an authenticated socket is currently usable. */
  get connected() {
    return this.#connection?.authenticated === true && !this.#connection.closed
  }

  /** Establish and authenticate the local socket, coalescing concurrent callers. */
  async connect() {
    if (this.#disposed) throw new Error('ClawDSH bridge client is disposed')
    if (this.connected) return
    if (this.#connecting !== undefined) return await this.#connecting
    const connecting = this.#open()
    this.#connecting = connecting
    try {
      await connecting
    } finally {
      if (this.#connecting === connecting) this.#connecting = undefined
    }
  }

  /**
   * Send one JSON-RPC request.
   * @param {string} method - Fixed protocol method.
   * @param {object} params - Validated method parameters.
   * @param {{signal?: AbortSignal, timeoutMs?: number}} [options] - Local wait controls.
   * @returns {Promise<unknown>} Peer result.
   */
  async request(method, params, options = {}) {
    if (!isNonEmptyString(method) || !isObject(params)) throw new Error('invalid bridge RPC request')
    options.signal?.throwIfAborted()
    await this.connect()
    options.signal?.throwIfAborted()
    const connection = this.#requireConnection()
    if (connection.pending.size >= this.#config.maxInFlight) {
      throw new RpcMethodError(-32001, 'too many in-flight bridge requests')
    }
    const id = `${this.#config.handshake.startupNonce}:${++this.#counter}`
    const timeoutMs = options.timeoutMs ?? this.#config.requestTimeoutMs
    positiveInteger(timeoutMs, 'request timeout')
    return await new Promise((resolve, reject) => {
      let timer
      const finish = () => {
        if (timer !== undefined) clearTimeout(timer)
        options.signal?.removeEventListener('abort', abort)
      }
      const abort = () => {
        const pending = connection.pending.get(id)
        if (pending === undefined) return
        connection.pending.delete(id)
        finish()
        reject(abortError(options.signal?.reason))
      }
      timer = setTimeout(() => {
        const pending = connection.pending.get(id)
        if (pending === undefined) return
        connection.pending.delete(id)
        options.signal?.removeEventListener('abort', abort)
        reject(new RpcMethodError(-32002, `bridge request ${method} timed out`))
      }, timeoutMs)
      timer.unref?.()
      connection.pending.set(id, {
        resolve: value => { finish(); resolve(value) },
        reject: error => { finish(); reject(error) },
      })
      options.signal?.addEventListener('abort', abort, { once: true })
      if (options.signal?.aborted) {
        abort()
        return
      }
      void this.#send(connection, { jsonrpc: '2.0', id, method, params }).catch(error => {
        const pending = connection.pending.get(id)
        if (pending === undefined) return
        connection.pending.delete(id)
        pending.reject(asError(error))
      })
    })
  }

  /** Send one negotiated JSON-RPC notification. */
  async notify(method, params) {
    if (!isNonEmptyString(method) || !isObject(params)) throw new Error('invalid bridge RPC notification')
    await this.connect()
    await this.#send(this.#requireConnection(), { jsonrpc: '2.0', method, params })
  }

  /** Permanently close the client and reject pending calls. */
  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    const connection = this.#connection
    if (connection !== undefined) this.#fail(connection, new Error('ClawDSH bridge client disposed'))
  }

  async #open() {
    const socket = connectSocket(this.#config.endpoint)
    socket.setNoDelay(true)
    const connection = {
      socket,
      authenticated: false,
      closed: false,
      buffered: Buffer.alloc(0),
      pending: new Map(),
      incoming: 0,
      writeTail: Promise.resolve(),
      handshake: Promise.withResolvers(),
    }
    connection.handshake.promise.catch(() => {})
    this.#connection = connection
    socket.on('data', chunk => { this.#consume(connection, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)) })
    socket.on('error', error => { this.#fail(connection, error) })
    socket.on('close', () => { this.#fail(connection, new Error('ClawDSH bridge socket disconnected')) })
    try {
      await Promise.race([
        new Promise((resolve, reject) => {
          if (!socket.connecting) resolve()
          else {
            socket.once('connect', resolve)
            socket.once('error', reject)
          }
        }),
        delay(this.#config.requestTimeoutMs, undefined, { ref: false }).then(() => {
          throw new RpcMethodError(-32002, 'bridge socket connection timed out')
        }),
      ])
      await this.#send(connection, {
        kind: 'handshake',
        token: this.#config.token,
        handshake: this.#config.handshake,
      })
      await Promise.race([
        connection.handshake.promise,
        delay(this.#config.requestTimeoutMs, undefined, { ref: false }).then(() => {
          throw new RpcMethodError(-32002, 'bridge handshake timed out')
        }),
      ])
    } catch (error) {
      this.#fail(connection, asError(error))
      throw error
    }
  }

  #consume(connection, chunk) {
    if (connection.closed) return
    connection.buffered = Buffer.concat([connection.buffered, chunk])
    while (!connection.closed) {
      const newline = connection.buffered.indexOf(0x0a)
      if (newline < 0) {
        if (connection.buffered.byteLength > this.#config.maxFrameBytes) {
          this.#fail(connection, new Error('bridge frame exceeds maxFrameBytes'))
        }
        return
      }
      if (newline > this.#config.maxFrameBytes) {
        this.#fail(connection, new Error('bridge frame exceeds maxFrameBytes'))
        return
      }
      let line = connection.buffered.subarray(0, newline)
      connection.buffered = connection.buffered.subarray(newline + 1)
      if (line.at(-1) === 0x0d) line = line.subarray(0, -1)
      if (line.byteLength === 0) {
        this.#fail(connection, new Error('empty bridge frame'))
        return
      }
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(line)
        const value = JSON.parse(text)
        if (!isObject(value)) throw new Error('bridge frame must be a JSON object')
        this.#receive(connection, value)
      } catch (error) {
        this.#fail(connection, asError(error))
      }
    }
  }

  #receive(connection, message) {
    if (!connection.authenticated) {
      exactKeys(message, ['kind', 'protocolVersion'], 'handshake acknowledgement')
      if (message.kind !== 'handshake-ack' || message.protocolVersion !== 1) {
        throw new Error('invalid bridge handshake acknowledgement')
      }
      connection.authenticated = true
      connection.handshake.resolve()
      return
    }
    if (message.jsonrpc !== '2.0') throw new Error('invalid bridge JSON-RPC version')
    if (typeof message.method === 'string') {
      this.#receiveCall(connection, message)
      return
    }
    this.#receiveResponse(connection, message)
  }

  #receiveCall(connection, message) {
    const notification = !Object.hasOwn(message, 'id')
    exactKeys(message, notification ? ['jsonrpc', 'method', 'params'] : ['jsonrpc', 'id', 'method', 'params'], 'JSON-RPC call')
    if (!isObject(message.params)) throw new Error('bridge JSON-RPC params must be an object')
    if (notification) {
      if (message.method !== 'turn.progress') throw new Error(`unsupported bridge notification ${message.method}`)
      const sink = this.#config.onNotification
      if (sink === undefined) throw new Error('turn.progress was not negotiated')
      if (connection.incoming >= this.#config.maxInFlight) {
        throw new Error('too many in-flight bridge notifications')
      }
      connection.incoming += 1
      void Promise.resolve().then(() => sink(message.method, message.params))
        .catch(error => this.#fail(connection, asError(error)))
        .finally(() => { connection.incoming -= 1 })
      return
    }
    if (!validId(message.id)) throw new Error('invalid bridge JSON-RPC request id')
    if (connection.incoming >= this.#config.maxInFlight) {
      void this.#replyError(connection, message.id, new RpcMethodError(-32001, 'too many in-flight bridge requests'))
      return
    }
    const handler = this.#config.handlers?.[message.method]
    if (handler === undefined) {
      void this.#replyError(connection, message.id, new RpcMethodError(-32601, `unsupported bridge method ${message.method}`))
      return
    }
    connection.incoming += 1
    const controller = new AbortController()
    void Promise.resolve().then(() => handler(message.params, controller.signal)).then(
      result => this.#send(connection, { jsonrpc: '2.0', id: message.id, result: result ?? {} }),
      error => this.#replyError(connection, message.id, normalizeRpcError(error)),
    ).catch(error => this.#fail(connection, asError(error))).finally(() => { connection.incoming -= 1 })
  }

  #receiveResponse(connection, message) {
    if (!validId(message.id)) throw new Error('bridge JSON-RPC response has no valid id')
    const hasResult = Object.hasOwn(message, 'result')
    const hasError = Object.hasOwn(message, 'error')
    if (hasResult === hasError) throw new Error('bridge JSON-RPC response must contain exactly one result or error')
    exactKeys(message, hasResult ? ['jsonrpc', 'id', 'result'] : ['jsonrpc', 'id', 'error'], 'JSON-RPC response')
    const pending = connection.pending.get(String(message.id))
    if (pending === undefined) return
    connection.pending.delete(String(message.id))
    if (hasError) {
      if (!isObject(message.error)) throw new Error('bridge JSON-RPC error must be an object')
      exactKeys(message.error, Object.hasOwn(message.error, 'data') ? ['code', 'message', 'data'] : ['code', 'message'], 'JSON-RPC error')
      if (!Number.isInteger(message.error.code) || typeof message.error.message !== 'string') {
        throw new Error('invalid bridge JSON-RPC error')
      }
      pending.reject(new RpcMethodError(message.error.code, message.error.message, message.error.data))
      return
    }
    pending.resolve(message.result)
  }

  async #replyError(connection, id, error) {
    const payload = { code: error.code, message: error.message }
    if (error.data !== undefined) payload.data = error.data
    await this.#send(connection, { jsonrpc: '2.0', id, error: payload })
  }

  #send(connection, value) {
    if (connection.closed) return Promise.reject(new Error('ClawDSH bridge socket is closed'))
    const data = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8')
    if (data.byteLength - 1 > this.#config.maxFrameBytes) {
      return Promise.reject(new Error('outbound bridge frame exceeds maxFrameBytes'))
    }
    const write = async () => {
      if (connection.closed) throw new Error('ClawDSH bridge socket is closed')
      if (connection.socket.write(data)) return
      await new Promise((resolve, reject) => {
        const cleanup = () => {
          connection.socket.off('drain', drained)
          connection.socket.off('error', failed)
          connection.socket.off('close', closed)
        }
        const drained = () => { cleanup(); resolve() }
        const failed = error => { cleanup(); reject(error) }
        const closed = () => { cleanup(); reject(new Error('bridge socket closed during write')) }
        connection.socket.once('drain', drained)
        connection.socket.once('error', failed)
        connection.socket.once('close', closed)
      })
    }
    const promise = connection.writeTail.then(write)
    connection.writeTail = promise.catch(() => {})
    return promise
  }

  #fail(connection, cause) {
    if (connection.closed) return
    connection.closed = true
    connection.handshake.reject(cause)
    for (const pending of connection.pending.values()) pending.reject(cause)
    connection.pending.clear()
    if (!connection.socket.destroyed) connection.socket.destroy()
    if (this.#connection === connection) this.#connection = undefined
  }

  #requireConnection() {
    const connection = this.#connection
    if (connection === undefined || connection.closed || !connection.authenticated) {
      throw new Error('ClawDSH bridge socket is not authenticated')
    }
    return connection
  }
}

function exactKeys(value, keys, label) {
  const expected = new Set(keys)
  const actual = Object.keys(value)
  if (actual.length !== expected.size || actual.some(key => !expected.has(key))) {
    throw new Error(`${label} contains unexpected fields`)
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0')
}

function validId(value) {
  return (typeof value === 'string' && value.length > 0) || (Number.isSafeInteger(value) && value >= 0)
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`)
}

function normalizeRpcError(error) {
  if (error instanceof RpcMethodError && [-32601, -32602, -32010, -32011].includes(error.code)) {
    return new RpcMethodError(error.code, sanitizePublicError(error.message))
  }
  return new RpcMethodError(-32000, 'OpenClaw bridge method failed.')
}

function sanitizePublicError(message) {
  return message.replace(/[\r\n]+/g, ' ').slice(0, 500) || 'OpenClaw bridge method failed.'
}

function abortError(reason) {
  if (reason instanceof Error) return reason
  const error = new Error('bridge request aborted')
  error.name = 'AbortError'
  return error
}

function asError(value) {
  return value instanceof Error ? value : new Error(String(value))
}
