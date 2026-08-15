import { describe, expect, it, vi } from 'vitest'
import type { JsonObject, NdjsonConnection } from '../src/framing.ts'
import { ChannelRpcError, JsonRpcPeer } from '../src/rpc.ts'

class FakeConnection {
  readonly sent: JsonObject[] = []
  readonly close = vi.fn()
  sendError: unknown
  sendGate: Promise<void> | undefined
  private valueReceiver: (value: JsonObject) => void = () => {}
  private closeReceiver: (error?: Error) => void = () => {}

  onValue(receiver: (value: JsonObject) => void): void { this.valueReceiver = receiver }
  onClose(receiver: (error?: Error) => void): void { this.closeReceiver = receiver }
  async send(value: JsonObject): Promise<void> {
    if (this.sendError !== undefined) throw this.sendError
    if (this.sendGate !== undefined) await this.sendGate
    this.sent.push(value)
  }
  receive(value: JsonObject): void { this.valueReceiver(value) }
  disconnect(error?: Error): void { this.closeReceiver(error) }
}

function peer(
  connection: FakeConnection,
  handlers: Record<string, (params: unknown) => unknown> = {},
  max = 2,
  timeoutMs = 1_000,
): JsonRpcPeer {
  return new JsonRpcPeer(connection as unknown as NdjsonConnection, handlers, max, timeoutMs)
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => { setImmediate(resolve) })
}

describe('bidirectional JSON-RPC peer', () => {
  it('resolves results and peer errors, and ignores unknown response ids', async () => {
    const connection = new FakeConnection()
    const rpc = peer(connection)

    const success = rpc.request('health.get', {})
    expect(connection.sent[0]).toMatchObject({ jsonrpc: '2.0', id: 'dsh-1', method: 'health.get' })
    connection.receive({ jsonrpc: '2.0', id: 'dsh-1', result: { status: 'ready' } })
    await expect(success).resolves.toEqual({ status: 'ready' })

    const failed = rpc.request('channel.action', {})
    connection.receive({
      jsonrpc: '2.0', id: 'dsh-2', error: { code: -32099, message: 'platform failed', data: { retry: false } },
    })
    await expect(failed).rejects.toMatchObject({
      name: 'ChannelRpcError', rpcCode: -32099, message: 'platform failed', data: { retry: false },
    })

    connection.receive({ jsonrpc: '2.0', id: 'never-issued', result: null })
  })

  it('expires the local request wait without cancelling remote work or retaining capacity', async () => {
    vi.useFakeTimers()
    const connection = new FakeConnection()
    const rpc = peer(connection, {}, 1, 25)
    const expired = rpc.request('channel.action', {}).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(25)
    expect(await expired).toMatchObject({ rpcCode: -32002, message: 'Gateway RPC request channel.action timed out' })

    connection.receive({ jsonrpc: '2.0', id: 'dsh-1', result: { late: true } })
    const next = rpc.request('health.get', {})
    connection.receive({ jsonrpc: '2.0', id: 'dsh-2', result: { status: 'ready' } })
    await expect(next).resolves.toEqual({ status: 'ready' })
    vi.useRealTimers()
  })

  it('makes late abort and deadline callbacks harmless after a response settles', async () => {
    const abortConnection = new FakeConnection()
    const controller = new AbortController()
    vi.spyOn(controller.signal, 'removeEventListener').mockImplementation(() => {})
    const abortRpc = peer(abortConnection)
    const abortWait = abortRpc.request('health.get', {}, controller.signal)
    abortConnection.receive({ jsonrpc: '2.0', id: 'dsh-1', result: {} })
    await expect(abortWait).resolves.toEqual({})
    controller.abort()

    const clear = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => {})
    const timeoutConnection = new FakeConnection()
    const timeoutRpc = peer(timeoutConnection, {}, 2, 5)
    const timeoutWait = timeoutRpc.request('health.get', {})
    timeoutConnection.receive({ jsonrpc: '2.0', id: 'dsh-1', result: {} })
    await expect(timeoutWait).resolves.toEqual({})
    await new Promise<void>((resolve) => { setTimeout(resolve, 10) })
    clear.mockRestore()
  })

  it('rejects requests after disconnect, enforces outbound capacity, and forgets aborted waits', async () => {
    const connection = new FakeConnection()
    const rpc = peer(connection, {}, 1)
    const first = rpc.request('first', {})
    await expect(rpc.request('second', {})).rejects.toMatchObject({ rpcCode: -32001 })

    const controller = new AbortController()
    const reason = new Error('cancel wait')
    const abortingConnection = new FakeConnection()
    const aborting = peer(abortingConnection)
    const wait = aborting.request('wait', {}, controller.signal)
    controller.abort(reason)
    await expect(wait).rejects.toBe(reason)
    abortingConnection.receive({ jsonrpc: '2.0', id: 'dsh-1', result: 'late' })

    const preAborted = AbortSignal.abort('not-an-error')
    expect(() => aborting.request('wait', {}, preAborted)).toThrow()

    const stringController = new AbortController()
    const stringWait = aborting.request('wait', {}, stringController.signal)
    stringController.abort('string reason')
    await expect(stringWait).rejects.toThrow(/RPC request aborted/)

    const disconnected = new Error('link lost')
    connection.disconnect(disconnected)
    await expect(first).rejects.toBe(disconnected)
    await rpc.close()
    connection.receive({ jsonrpc: '1.0', id: 'ignored-after-close', result: null })
    expect(connection.close).not.toHaveBeenCalled()
    await expect(rpc.request('after', {})).rejects.toThrow(/disconnected/)
  })

  it('close aborts and drains admitted inbound handlers', async () => {
    const connection = new FakeConnection()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let signal: AbortSignal | undefined
    let writes = 0
    const rpc = new JsonRpcPeer(connection as unknown as NdjsonConnection, {
      slow: async (_params, currentSignal) => {
        signal = currentSignal
        entered.resolve(undefined)
        await release.promise
        writes += 1
      },
    }, 1, 1_000)
    connection.receive({ jsonrpc: '2.0', id: 1, method: 'slow', params: {} })
    await entered.promise

    let closed = false
    const closing = rpc.close().then(() => { closed = true })
    await flush()
    expect(signal?.aborted).toBe(true)
    expect(closed).toBe(false)
    release.resolve(undefined)
    await closing
    await expect(rpc.close()).resolves.toBeUndefined()
    expect(writes).toBe(1)
    await flush()
    expect(writes).toBe(1)
  })

  it('transport detach preserves admitted work and later close upgrades it to aborting shutdown', async () => {
    const connection = new FakeConnection()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let signal: AbortSignal | undefined
    const rpc = new JsonRpcPeer(connection as unknown as NdjsonConnection, {
      slow: async (_params, currentSignal) => {
        signal = currentSignal
        entered.resolve(undefined)
        await release.promise
      },
    }, 1, 1_000)
    connection.receive({ jsonrpc: '2.0', id: 1, method: 'slow', params: {} })
    await entered.promise

    connection.disconnect(new Error('transient link loss'))
    await flush()
    expect(signal?.aborted).toBe(false)
    let detached = false
    const drain = rpc.detach().then(() => { detached = true })
    await flush()
    expect(detached).toBe(false)

    const shutdown = rpc.close(new Error('Provider shutdown'))
    expect(signal?.aborted).toBe(true)
    release.resolve(undefined)
    await Promise.all([drain, shutdown])
  })

  it('does not send if the signal aborts while its listener is being installed', async () => {
    const connection = new FakeConnection()
    const controller = new AbortController()
    const reason = new Error('abort during listener installation')
    const add = controller.signal.addEventListener.bind(controller.signal)
    vi.spyOn(controller.signal, 'addEventListener').mockImplementation((type, listener, options) => {
      add(type, listener, options)
      controller.abort(reason)
    })
    await expect(peer(connection).request('channel.action', {}, controller.signal)).rejects.toBe(reason)
    expect(connection.sent).toEqual([])
  })

  it('ignores a late transport rejection after the local request wait is aborted', async () => {
    const connection = new FakeConnection()
    const write = Promise.withResolvers<undefined>()
    connection.sendGate = write.promise
    const controller = new AbortController()
    const waiting = peer(connection).request('channel.action', {}, controller.signal)

    controller.abort(new Error('stop waiting'))
    await expect(waiting).rejects.toThrow('stop waiting')
    write.reject(new Error('late write rejection'))
    await flush()
  })

  it('rejects a request whose frame cannot be sent, preserving Error and normalizing non-Error failures', async () => {
    const errorConnection = new FakeConnection()
    const failure = new Error('socket closed')
    errorConnection.sendError = failure
    await expect(peer(errorConnection).request('method', {})).rejects.toBe(failure)

    const stringConnection = new FakeConnection()
    stringConnection.sendError = 'write rejected'
    await expect(peer(stringConnection).request('method', {})).rejects.toEqual(new Error('write rejected'))
  })

  it('sends notifications only while connected', async () => {
    const connection = new FakeConnection()
    const rpc = peer(connection)
    await rpc.notify('turn.progress', { sequence: 0 })
    expect(connection.sent).toContainEqual({ jsonrpc: '2.0', method: 'turn.progress', params: { sequence: 0 } })
    await rpc.close()
    await expect(rpc.notify('turn.progress', {})).resolves.toBeUndefined()
  })

  it('bounds notifications while a transport write is backpressured', async () => {
    const connection = new FakeConnection()
    let release!: () => void
    connection.sendGate = new Promise<void>((resolve) => { release = resolve })
    const rpc = peer(connection, {}, 1)
    const first = rpc.notify('turn.progress', { sequence: 0 })
    await expect(rpc.notify('turn.progress', { sequence: 1 })).rejects.toMatchObject({ rpcCode: -32001 })
    expect(connection.sent).toEqual([])
    release()
    await first
    connection.sendGate = undefined
    await expect(rpc.notify('turn.progress', { sequence: 2 })).resolves.toBeUndefined()
  })

  it('dispatches requests, notifications, handler failures, and nullish results', async () => {
    const connection = new FakeConnection()
    const seen = vi.fn()
    const rpc = peer(connection, {
      ok: (params) => { seen(params); return undefined },
      fail: () => { throw new Error('handler failed at /Users/operator with token sk-secret') },
    }, 3)
    connection.receive({ jsonrpc: '2.0', id: 1, method: 'ok', params: { value: 1 } })
    connection.receive({ jsonrpc: '2.0', method: 'ok', params: { notification: true } })
    connection.receive({ jsonrpc: '2.0', id: 'failure', method: 'fail', params: {} })
    await flush()
    expect(seen).toHaveBeenCalledTimes(2)
    expect(connection.sent).toContainEqual({ jsonrpc: '2.0', id: 1, result: null })
    expect(connection.sent).toContainEqual({
      jsonrpc: '2.0', id: 'failure', error: {
        code: -32000,
        message: 'ClawDSH rejected the authenticated bridge request.',
      },
    })
    expect(JSON.stringify(connection.sent)).not.toMatch(/Users\/operator|sk-secret/)
    await rpc.close()
  })

  it('reports unknown methods and bad params, closing for invalid notifications', async () => {
    const requestConnection = new FakeConnection()
    peer(requestConnection)
    requestConnection.receive({ jsonrpc: '2.0', id: 7, method: 'missing', params: {} })
    requestConnection.receive({ jsonrpc: '2.0', id: 8, method: 'missing-params', params: 'bad' })
    requestConnection.receive({ jsonrpc: '2.0', method: 'unknown-notification', params: {} })
    await flush()
    expect(requestConnection.sent).toContainEqual({
      jsonrpc: '2.0', id: 7, error: { code: -32601, message: 'unknown method missing' },
    })
    expect(requestConnection.sent).toContainEqual({
      jsonrpc: '2.0', id: 8, error: { code: -32601, message: 'unknown method missing-params' },
    })
    expect(requestConnection.close).toHaveBeenCalledWith(expect.objectContaining({ rpcCode: -32601 }))

    const paramsConnection = new FakeConnection()
    peer(paramsConnection, { method: () => null })
    paramsConnection.receive({ jsonrpc: '2.0', id: 9, method: 'method', params: [] })
    paramsConnection.receive({ jsonrpc: '2.0', method: 'method', params: [] })
    expect(paramsConnection.close).toHaveBeenCalledWith(expect.objectContaining({ rpcCode: -32602 }))
    await flush()
    expect(paramsConnection.sent).toContainEqual({
      jsonrpc: '2.0', id: 9, error: { code: -32602, message: 'params must be an object' },
    })
  })

  it('enforces inbound capacity for requests and notifications', async () => {
    let release!: () => void
    const blocking = new Promise<void>((resolve) => { release = resolve })
    const requestConnection = new FakeConnection()
    peer(requestConnection, { slow: async () => { await blocking } }, 1)
    requestConnection.receive({ jsonrpc: '2.0', id: 1, method: 'slow', params: {} })
    requestConnection.receive({ jsonrpc: '2.0', id: 2, method: 'slow', params: {} })
    await flush()
    expect(requestConnection.sent).toContainEqual({
      jsonrpc: '2.0', id: 2, error: { code: -32001, message: 'too many in-flight requests' },
    })

    const notificationConnection = new FakeConnection()
    peer(notificationConnection, { slow: async () => { await blocking } }, 1)
    notificationConnection.receive({ jsonrpc: '2.0', method: 'slow', params: {} })
    notificationConnection.receive({ jsonrpc: '2.0', method: 'slow', params: {} })
    expect(notificationConnection.close).toHaveBeenCalledWith(expect.objectContaining({ rpcCode: -32001 }))
    release()
    await flush()
  })

  it.each([
    ['wrong version', { jsonrpc: '1.0', id: 'x', result: null }],
    ['response without id', { jsonrpc: '2.0', result: null }],
    ['response without result or error', { jsonrpc: '2.0', id: 'x' }],
    ['response with result and error', { jsonrpc: '2.0', id: 'x', result: null, error: { code: 1, message: 'bad' } }],
    ['response with an extra field', { jsonrpc: '2.0', id: 'x', result: null, extra: true }],
    ['response with an infinite numeric id', { jsonrpc: '2.0', id: Number.POSITIVE_INFINITY, result: null }],
    ['error with invalid fields', { jsonrpc: '2.0', id: 'x', error: { code: 'bad', message: 4 } }],
    ['error with an extra field', { jsonrpc: '2.0', id: 'x', error: { code: 1, message: 'bad', extra: true } }],
    ['request with an extra field', { jsonrpc: '2.0', id: 'x', method: 'ok', params: {}, extra: true }],
    ['request with a null id', { jsonrpc: '2.0', id: null, method: 'ok', params: {} }],
  ])('closes on %s', (_label, frame) => {
    const connection = new FakeConnection()
    peer(connection, { ok: () => null })
    connection.receive(frame)
    expect(connection.close).toHaveBeenCalledWith(expect.objectContaining({ rpcCode: -32600 }))
  })

  it('swallows a failed error reply after the transport closes', async () => {
    const connection = new FakeConnection()
    connection.sendError = new Error('closed')
    peer(connection, { fail: () => { throw new Error('handler') } })
    connection.receive({ jsonrpc: '2.0', id: 1, method: 'fail', params: {} })
    await flush()

    const notification = new FakeConnection()
    peer(notification, { fail: () => { throw new Error('notification failure') } })
    notification.receive({ jsonrpc: '2.0', method: 'fail', params: {} })
    await flush()

    const successReply = new FakeConnection()
    successReply.sendError = new Error('reply transport closed')
    peer(successReply, { ok: () => 'result' })
    successReply.receive({ jsonrpc: '2.0', id: 1, method: 'ok', params: {} })
    await flush()
  })

  it('constructs explicit protocol errors', () => {
    const error = new ChannelRpcError('failure', -1, { cause: 'test' })
    expect(error).toMatchObject({ name: 'ChannelRpcError', message: 'failure', rpcCode: -1, data: { cause: 'test' } })
  })
})
