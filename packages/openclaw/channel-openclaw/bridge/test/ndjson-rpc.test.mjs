import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { NdjsonRpcClient, RpcMethodError } from '../shared/ndjson-rpc.js'

const handshake = {
  protocolVersion: 1,
  gatewayInstanceId: 'gateway-test',
  openclaw: {
    tag: 'v-test',
    commitSha: 'a'.repeat(40),
    artifactSha512: 'artifact',
    nodeEngine: '>=22',
  },
  agentHarness: 'v1',
  capabilities: {
    actions: ['send'],
    notifications: ['status'],
    extensions: [],
  },
  startupNonce: 'nonce-test',
}

test('authenticates once and carries bidirectional JSON-RPC', async t => {
  const actionResponse = Promise.withResolvers()
  const progress = Promise.withResolvers()
  const frames = []
  const fixture = await socketFixture(t, (socket, frame) => {
    frames.push(frame)
    if (frames.length === 1) {
      assert.deepEqual(frame, { kind: 'handshake', token: 'secret-test', handshake })
      send(socket, { kind: 'handshake-ack', protocolVersion: 1 })
      send(socket, {
        jsonrpc: '2.0',
        method: 'turn.progress',
        params: { kind: 'status', turnId: 'turn', runId: 'run', sequence: 0, status: 'running' },
      })
      send(socket, { jsonrpc: '2.0', id: 'gateway-1', method: 'channel.action', params: { action: true } })
      return
    }
    assert.equal(Object.hasOwn(frame, 'token'), false)
    if (frame.method === 'health.get') {
      send(socket, { jsonrpc: '2.0', id: frame.id, result: { ok: true } })
    } else if (frame.id === 'gateway-1') {
      actionResponse.resolve(frame)
    }
  })
  const client = new NdjsonRpcClient({
    endpoint: fixture.endpoint,
    token: 'secret-test',
    handshake,
    maxFrameBytes: 4096,
    maxInFlight: 4,
    requestTimeoutMs: 2000,
    handlers: { 'channel.action': params => ({ echoed: params.action }) },
    onNotification: (_method, params) => { progress.resolve(params) },
  })
  t.after(async () => { await client.dispose() })
  assert.deepEqual(await client.request('health.get', {}), { ok: true })
  assert.deepEqual(await progress.promise, {
    kind: 'status', turnId: 'turn', runId: 'run', sequence: 0, status: 'running',
  })
  assert.deepEqual(await actionResponse.promise, {
    jsonrpc: '2.0', id: 'gateway-1', result: { echoed: true },
  })
  assert.equal(frames.filter(frame => Object.hasOwn(frame, 'token')).length, 1)
})

test('enforces the outgoing in-flight cap without sending a second request', async t => {
  let rpcFrames = 0
  const firstFrame = Promise.withResolvers()
  const fixture = await socketFixture(t, (socket, frame) => {
    if (frame.kind === 'handshake') send(socket, { kind: 'handshake-ack', protocolVersion: 1 })
    else {
      rpcFrames += 1
      firstFrame.resolve()
    }
  })
  const client = new NdjsonRpcClient({
    endpoint: fixture.endpoint,
    token: 'secret-test',
    handshake,
    maxFrameBytes: 4096,
    maxInFlight: 1,
    requestTimeoutMs: 5000,
  })
  const first = client.request('turn.run', {})
  await assert.rejects(() => client.request('health.get', {}), error => {
    assert.ok(error instanceof RpcMethodError)
    assert.equal(error.code, -32001)
    return true
  })
  await firstFrame.promise
  await client.dispose()
  await assert.rejects(first, /disposed/)
  assert.equal(rpcFrames, 1)
})

test('dispose aborts and drains an inbound handler before resolving', async t => {
  const entered = Promise.withResolvers()
  const release = Promise.withResolvers()
  let receivedSignal
  let writes = 0
  const fixture = await socketFixture(t, (socket, frame) => {
    if (frame.kind === 'handshake') {
      send(socket, { kind: 'handshake-ack', protocolVersion: 1 })
      send(socket, { jsonrpc: '2.0', id: 'pending-action', method: 'channel.action', params: {} })
    }
  })
  const client = new NdjsonRpcClient({
    endpoint: fixture.endpoint,
    token: 'secret-test',
    handshake,
    maxFrameBytes: 4096,
    maxInFlight: 2,
    requestTimeoutMs: 2000,
    handlers: {
      'channel.action': async (_params, signal) => {
        receivedSignal = signal
        entered.resolve()
        await release.promise
        writes += 1
        return {}
      },
    },
  })
  await client.connect()
  await entered.promise

  let stopped = false
  const stopping = client.dispose().then(() => { stopped = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(receivedSignal.aborted, true)
  assert.equal(stopped, false)
  release.resolve()
  await stopping
  assert.equal(writes, 1)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(writes, 1)
})

test('keeps arbitrary handler failures behind the bridge IPC boundary', async t => {
  const responses = []
  const responsesReady = Promise.withResolvers()
  const fixture = await socketFixture(t, (socket, frame) => {
    if (frame.kind === 'handshake') {
      send(socket, { kind: 'handshake-ack', protocolVersion: 1 })
      send(socket, { jsonrpc: '2.0', id: 'unsafe', method: 'channel.action', params: {} })
      send(socket, { jsonrpc: '2.0', id: 'public', method: 'channel.public', params: {} })
      return
    }
    responses.push(frame)
    if (responses.length === 2) responsesReady.resolve()
  })
  const client = new NdjsonRpcClient({
    endpoint: fixture.endpoint,
    token: 'secret-test',
    handshake,
    maxFrameBytes: 4096,
    maxInFlight: 4,
    requestTimeoutMs: 2000,
    handlers: {
      'channel.action': () => { throw new Error('failed at /Users/operator with token sk-secret') },
      'channel.public': () => { throw new RpcMethodError(-32601, 'channel action is unsupported') },
    },
  })
  t.after(async () => { await client.dispose() })
  await client.connect()
  await responsesReady.promise
  assert.deepEqual(responses, [
    {
      jsonrpc: '2.0', id: 'unsafe',
      error: { code: -32000, message: 'OpenClaw bridge method failed.' },
    },
    {
      jsonrpc: '2.0', id: 'public',
      error: { code: -32601, message: 'channel action is unsupported' },
    },
  ])
  assert.doesNotMatch(JSON.stringify(responses), /Users\/operator|sk-secret/)
})

test('does not send a request cancelled while the handshake is pending', async t => {
  const pendingHandshake = Promise.withResolvers()
  const methods = []
  const fixture = await socketFixture(t, (socket, frame) => {
    if (frame.kind === 'handshake') pendingHandshake.resolve(socket)
    else methods.push(frame.method)
  })
  const client = new NdjsonRpcClient({
    endpoint: fixture.endpoint,
    token: 'secret-test',
    handshake,
    maxFrameBytes: 4096,
    maxInFlight: 2,
    requestTimeoutMs: 2000,
  })
  t.after(async () => { await client.dispose() })
  const controller = new AbortController()
  const request = client.request('turn.run', {}, { signal: controller.signal })
  const socket = await pendingHandshake.promise
  controller.abort(new Error('cancelled during handshake'))
  send(socket, { kind: 'handshake-ack', protocolVersion: 1 })
  await assert.rejects(request, /cancelled during handshake/)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(methods, [])
})

test('disconnects on invalid UTF-8 instead of accepting replacement text', async t => {
  const fixture = await socketFixture(t, (socket, frame) => {
    if (frame.kind === 'handshake') {
      send(socket, { kind: 'handshake-ack', protocolVersion: 1 })
      return
    }
    socket.write(Buffer.from([0xc3, 0x28, 0x0a]))
  })
  const client = new NdjsonRpcClient({
    endpoint: fixture.endpoint,
    token: 'secret-test',
    handshake,
    maxFrameBytes: 4096,
    maxInFlight: 2,
    requestTimeoutMs: 2000,
  })
  t.after(async () => { await client.dispose() })
  await assert.rejects(() => client.request('health.get', {}), /encoded data|UTF-8|disconnected/i)
  assert.equal(client.connected, false)
})

async function socketFixture(t, receive) {
  const directory = await mkdtemp(join(tmpdir(), 'clawdsh-rpc-'))
  await chmod(directory, 0o700)
  const endpoint = join(directory, 'bridge.sock')
  const sockets = new Set()
  const server = createServer(socket => {
    sockets.add(socket)
    socket.on('close', () => { sockets.delete(socket) })
    let buffered = Buffer.alloc(0)
    socket.on('data', chunk => {
      buffered = Buffer.concat([buffered, chunk])
      while (true) {
        const newline = buffered.indexOf(0x0a)
        if (newline < 0) break
        const line = buffered.subarray(0, newline)
        buffered = buffered.subarray(newline + 1)
        receive(socket, JSON.parse(line.toString('utf8')))
      }
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(endpoint, resolve)
  })
  t.after(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise(resolve => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  })
  return { endpoint }
}

function send(socket, value) {
  socket.write(`${JSON.stringify(value)}\n`)
}
