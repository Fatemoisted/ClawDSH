import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  createOpenClawBridge,
  createSyntheticProvider,
} from '../shared/openclaw-runtime.js'

test('runtime inspection requires neither supervisor environment nor state access', () => {
  let stateCalls = 0
  const api = mockApi()
  api.runtime.state.openSyncKeyedStore = () => {
    stateCalls += 1
    throw new Error('state must remain lazy')
  }
  const bridge = createOpenClawBridge(api, {
    generation: 'v1',
    env: {},
    config: { controlTimeoutMs: 2000, routeStateMaxEntries: 100, deliveryStateMaxEntries: 100 },
  })
  assert.equal(stateCalls, 0)
  assert.equal(bridge.harness.supports({
    provider: 'clawdsh', modelId: 'local', requestedRuntime: 'clawdsh',
  }).supported, true)
  assert.equal(stateCalls, 0)
  bridge.dispose()
})

test('registration is lazy and the exact clawdsh/local route is fail-closed', async t => {
  const fixture = await gatewayFixture(t)
  let connections = 0
  fixture.server.on('connection', () => { connections += 1 })
  const bridge = createOpenClawBridge(mockApi(), {
    generation: 'v1',
    env: bridgeEnv(fixture.endpoint, join(fixture.directory, 'staging-root-does-not-exist')),
    config: { controlTimeoutMs: 2000, routeStateMaxEntries: 100, deliveryStateMaxEntries: 100 },
  })
  t.after(() => { bridge.dispose() })
  assert.equal(connections, 0)
  assert.deepEqual(bridge.harness.supports({
    provider: 'clawdsh', modelId: 'local', requestedRuntime: 'clawdsh',
  }), { supported: true, priority: 1000, reason: 'locked ClawDSH local route' })
  assert.equal(bridge.harness.supports({
    provider: 'clawdsh', modelId: 'local', requestedRuntime: 'auto',
  }).supported, false)
  assert.equal(bridge.harness.supports({
    provider: 'openai', modelId: 'local', requestedRuntime: 'clawdsh',
  }).supported, false)
  assert.equal(connections, 0)

  await bridge.start()
  assert.equal(connections, 1)

  const result = await bridge.harness.runAttempt(attemptParams())
  assert.equal(connections, 1)
  assert.equal(result.aborted, false)
  assert.deepEqual(result.assistantTexts, ['DSH answer'])
  assert.equal(result.promptError, undefined)
  assert.deepEqual(fixture.turn.route, {
    gatewayInstanceId: 'gateway-test',
    openclawSessionKey: 'openclaw-session',
    generation: 0,
    channel: 'telegram',
    account: 'primary',
    conversation: 'chat-42',
    kind: 'direct',
  })
  assert.equal(fixture.turn.sender.trust, 'owner')

  await bridge.harness.runAttempt({
    ...attemptParams(),
    sessionId: 'openclaw-non-owner-session-id',
    sessionKey: 'openclaw-non-owner-session',
    runId: 'run-non-owner',
    senderIsOwner: false,
    currentMessageId: 'message-non-owner',
  })
  assert.equal(fixture.turn.sender.trust, 'admitted')

  await bridge.harness.reset({
    sessionId: 'openclaw-session-id',
    sessionKey: 'openclaw-session',
    reason: 'reset',
  })
  assert.equal(fixture.reset.nextGeneration, 1)
})

test('external plugin fallback restores the reset generation after bridge recreation', async t => {
  const fixture = await gatewayFixture(t)
  const stateDirectory = join(fixture.directory, 'openclaw-state')
  const config = { controlTimeoutMs: 2000, routeStateMaxEntries: 100, deliveryStateMaxEntries: 100 }
  const externalApi = () => {
    const api = mockApi()
    api.runtime.state.openSyncKeyedStore = () => {
      throw new Error('openKeyedStore is only available for trusted plugins in this release.')
    }
    api.runtime.state.resolveStateDir = () => stateDirectory
    return api
  }

  const first = createOpenClawBridge(externalApi(), {
    generation: 'v1', env: bridgeEnv(fixture.endpoint, fixture.directory), config,
  })
  await first.harness.runAttempt(attemptParams())
  await first.harness.reset({ sessionKey: 'openclaw-session', reason: 'reset' })
  first.dispose()

  const second = createOpenClawBridge(externalApi(), {
    generation: 'v1', env: bridgeEnv(fixture.endpoint, fixture.directory), config,
  })
  t.after(() => { second.dispose() })
  await second.harness.runAttempt({
    ...attemptParams(), runId: 'run-after-restart', currentMessageId: 'message-after-restart',
  })
  assert.equal(fixture.turn.route.generation, 1)
})

test('bridge startup recovers a reset acknowledged before its route commit', async t => {
  const fixture = await gatewayFixture(t)
  const stores = new Map()
  let failRouteCommit = true
  const api = mockApi()
  api.runtime.state.openSyncKeyedStore = ({ namespace }) => {
    if (!stores.has(namespace)) stores.set(namespace, syncStore())
    const store = stores.get(namespace)
    if (namespace !== 'clawdsh-bridge-routes-v1') return store
    return {
      ...store,
      register(key, value) {
        if (value.generation === 1 && failRouteCommit) {
          failRouteCommit = false
          throw new Error('simulated crash before durable route commit')
        }
        store.register(key, value)
      },
    }
  }
  const config = { controlTimeoutMs: 2000, routeStateMaxEntries: 100, deliveryStateMaxEntries: 100 }
  const first = createOpenClawBridge(api, {
    generation: 'v1', env: bridgeEnv(fixture.endpoint, fixture.directory), config,
  })
  await first.harness.runAttempt(attemptParams())
  await assert.rejects(
    first.harness.reset({
      sessionId: 'openclaw-session-id',
      sessionKey: 'openclaw-session',
      reason: 'reset',
    }),
    /simulated crash before durable route commit/,
  )
  first.dispose()

  const second = createOpenClawBridge(api, {
    generation: 'v1', env: bridgeEnv(fixture.endpoint, fixture.directory), config,
  })
  t.after(() => { second.dispose() })
  await second.start()
  await second.harness.reset({
    sessionId: 'openclaw-session-id',
    sessionKey: 'openclaw-session',
    reason: 'reset',
  })
  await second.harness.runAttempt({
    ...attemptParams(), runId: 'run-after-recovery', currentMessageId: 'message-after-recovery',
  })

  assert.equal(fixture.resetCount, 2)
  assert.equal(fixture.turn.route.generation, 1)
})

test('a disconnected bridge returns a visible terminal answer instead of throwing', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'clawdsh-runtime-offline-'))
  await chmod(directory, 0o700)
  t.after(async () => { await rm(directory, { recursive: true, force: true }) })
  const bridge = createOpenClawBridge(mockApi(), {
    generation: 'v1',
    env: bridgeEnv(join(directory, 'missing.sock'), directory),
    config: { controlTimeoutMs: 30, routeStateMaxEntries: 100, deliveryStateMaxEntries: 100 },
  })
  t.after(() => { bridge.dispose() })
  const result = await bridge.harness.runAttempt(attemptParams())
  assert.equal(result.aborted, false)
  assert.match(result.assistantTexts[0], /^\[ClawDSH bridge CHANNEL_BRIDGE_FAILED\]/)
  assert.equal(result.promptError, undefined)
})

test('a Gateway-originated turn uses its stable OpenClaw run id without a platform message id', async t => {
  const fixture = await gatewayFixture(t)
  const bridge = createOpenClawBridge(mockApi(), {
    generation: 'v1',
    env: bridgeEnv(fixture.endpoint, fixture.directory),
    config: { controlTimeoutMs: 2000, routeStateMaxEntries: 100, deliveryStateMaxEntries: 100 },
  })
  t.after(() => { bridge.dispose() })
  const params = attemptParams()
  delete params.currentMessageId
  await bridge.harness.runAttempt(params)
  assert.equal(fixture.turn.messageId, 'openclaw-run:run-test')
})

test('an attempt without a stable platform message or Gateway run id fails before DSH execution', async t => {
  const fixture = await gatewayFixture(t)
  const bridge = createOpenClawBridge(mockApi(), {
    generation: 'v1',
    env: bridgeEnv(fixture.endpoint, fixture.directory),
    config: { controlTimeoutMs: 2000, routeStateMaxEntries: 100, deliveryStateMaxEntries: 100 },
  })
  t.after(() => { bridge.dispose() })
  const params = attemptParams()
  delete params.currentMessageId
  delete params.runId
  const result = await bridge.harness.runAttempt(params)
  assert.match(result.assistantTexts[0], /^\[ClawDSH bridge CHANNEL_BRIDGE_FAILED\]/)
  assert.equal(fixture.turn, undefined)
})

test('an OpenClaw retry keeps the DSH run identity stable for one inbound idempotency key', async t => {
  const fixture = await gatewayFixture(t)
  const bridge = createOpenClawBridge(mockApi(), {
    generation: 'v1',
    env: bridgeEnv(fixture.endpoint, fixture.directory),
    config: { controlTimeoutMs: 2000, routeStateMaxEntries: 100, deliveryStateMaxEntries: 100 },
  })
  t.after(() => { bridge.dispose() })

  await bridge.harness.runAttempt(attemptParams())
  const firstRunId = fixture.turn.runId
  await bridge.harness.runAttempt({ ...attemptParams(), runId: 'a-different-openclaw-attempt' })

  assert.equal(fixture.turn.runId, firstRunId)
  assert.match(firstRunId, /^run-[a-f0-9]{64}$/)
  assert.notEqual(firstRunId, 'run-test')
})

test('OpenClaw runtime context never replaces the current user transcript body', async t => {
  const fixture = await gatewayFixture(t)
  const bridge = createOpenClawBridge(mockApi(), {
    generation: 'v1',
    env: bridgeEnv(fixture.endpoint, fixture.directory),
    config: { controlTimeoutMs: 2000, routeStateMaxEntries: 100, deliveryStateMaxEntries: 100 },
  })
  t.after(() => { bridge.dispose() })

  await bridge.harness.runAttempt({
    ...attemptParams(),
    prompt: 'current user text',
    currentInboundContext: { text: 'OpenClaw-owned runtime context' },
  })
  assert.equal(fixture.turn.text, 'current user text')

  await bridge.harness.runAttempt({
    ...attemptParams(),
    currentMessageId: 'message-43',
    prompt: 'decorated prompt',
    transcriptPrompt: 'persisted current message',
    currentInboundContext: { text: 'OpenClaw-owned runtime context' },
  })
  assert.equal(fixture.turn.text, 'persisted current message')
})

test('a send failure after adapter dispatch is ambiguous and is never resent', async t => {
  const fixture = await gatewayFixture(t)
  const api = mockApi()
  let sends = 0
  api.runtime.channel.outbound.loadAdapter = async () => ({
    sendText: async () => {
      sends += 1
      throw new Error('confirmation lost after platform call')
    },
  })
  const bridge = createOpenClawBridge(api, {
    generation: 'v1',
    env: bridgeEnv(fixture.endpoint, fixture.directory),
    config: { controlTimeoutMs: 2000, routeStateMaxEntries: 100, deliveryStateMaxEntries: 100 },
  })
  t.after(() => { bridge.dispose() })
  await bridge.start()
  const action = {
    protocolVersion: 1,
    actionId: 'action-ambiguous',
    target: {
      gatewayInstanceId: 'gateway-test',
      channel: 'telegram',
      account: 'primary',
      conversation: 'chat-42',
    },
    kind: 'send',
    text: 'hello',
    media: [],
  }

  const first = await fixture.requestBridge('channel.action', action)
  const replay = await fixture.requestBridge('channel.action', action)
  const reconciled = await fixture.requestBridge('channel.reconcile', action)
  assert.equal(first.status, 'ambiguous')
  assert.deepEqual(replay, first)
  assert.deepEqual(reconciled, first)
  await assert.rejects(fixture.requestBridge('channel.reconcile', {
    ...action,
    actionId: 'action-without-bridge-record',
  }), /no durable bridge record/)
  assert.equal(sends, 1)
})

test('synthetic provider exposes exactly one harness-owned model', async () => {
  const provider = createSyntheticProvider()
  assert.equal(provider.id, 'clawdsh')
  const catalog = await provider.staticCatalog.run()
  assert.deepEqual(catalog.provider.models.map(model => [model.id, model.agentRuntime.id]), [['local', 'clawdsh']])
  assert.equal(Object.hasOwn(catalog.provider, 'fallbacks'), false)
})

function mockApi() {
  const stores = new Map()
  return {
    config: {},
    runtime: {
      state: {
        openSyncKeyedStore({ namespace }) {
          if (!stores.has(namespace)) stores.set(namespace, syncStore())
          return stores.get(namespace)
        },
      },
      channel: { outbound: { loadAdapter: async () => undefined } },
    },
  }
}

function syncStore() {
  const values = new Map()
  return {
    register: (key, value) => { values.set(key, structuredClone(value)) },
    registerIfAbsent: (key, value) => {
      if (values.has(key)) return false
      values.set(key, structuredClone(value))
      return true
    },
    lookup: key => values.has(key) ? structuredClone(values.get(key)) : undefined,
    consume: key => {
      const value = values.get(key)
      values.delete(key)
      return value
    },
    delete: key => values.delete(key),
    entries: () => [...values].map(([key, value]) => ({ key, value, createdAt: 0 })),
    clear: () => { values.clear() },
  }
}

function bridgeEnv(endpoint, stagingRoot) {
  return {
    CLAWDSH_CHANNEL_ENDPOINT: endpoint,
    CLAWDSH_CHANNEL_TOKEN: 'token-test',
    CLAWDSH_CHANNEL_STARTUP_NONCE: 'nonce-test',
    CLAWDSH_CHANNEL_GATEWAY_INSTANCE_ID: 'gateway-test',
    CLAWDSH_CHANNEL_STAGING_ROOT: stagingRoot,
    CLAWDSH_CHANNEL_MAX_FRAME_BYTES: '65536',
    CLAWDSH_CHANNEL_MAX_IN_FLIGHT: '16',
    CLAWDSH_CHANNEL_MAX_MEDIA_BYTES: '1048576',
    CLAWDSH_OPENCLAW_TAG: 'v2026.7.1-2',
    CLAWDSH_OPENCLAW_COMMIT_SHA: '0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c',
    CLAWDSH_OPENCLAW_ARTIFACT_SHA512: 'b'.repeat(128),
    CLAWDSH_OPENCLAW_NODE_ENGINE: '>=22.22.3',
    CLAWDSH_OPENCLAW_AGENT_HARNESS: 'v1',
  }
}

function attemptParams() {
  return {
    sessionId: 'openclaw-session-id',
    sessionKey: 'openclaw-session',
    runId: 'run-test',
    timeoutMs: 1000,
    provider: 'clawdsh',
    modelId: 'local',
    model: { api: 'openai-responses' },
    prompt: 'hello DSH',
    messageChannel: 'telegram',
    agentAccountId: 'primary',
    chatId: 'chat-42',
    chatType: 'direct',
    senderId: 'user-42',
    senderName: 'User',
    senderIsOwner: true,
    currentMessageId: 'message-42',
  }
}

async function gatewayFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'clawdsh-runtime-'))
  await chmod(directory, 0o700)
  const endpoint = join(directory, 'gateway.sock')
  const state = { turn: undefined, reset: undefined, resetCount: 0 }
  const sockets = new Set()
  const pending = new Map()
  let bridgeSocket
  let nextRequestId = 0
  const server = createServer(socket => {
    bridgeSocket = socket
    sockets.add(socket)
    socket.on('close', () => { sockets.delete(socket) })
    let buffered = Buffer.alloc(0)
    socket.on('data', chunk => {
      buffered = Buffer.concat([buffered, chunk])
      while (true) {
        const newline = buffered.indexOf(0x0a)
        if (newline < 0) break
        const frame = JSON.parse(buffered.subarray(0, newline).toString('utf8'))
        buffered = buffered.subarray(newline + 1)
        if (frame.kind === 'handshake') {
          socket.write(`${JSON.stringify({ kind: 'handshake-ack', protocolVersion: 1 })}\n`)
        } else if (frame.method === 'turn.run') {
          state.turn = frame.params
          socket.write(`${JSON.stringify({
            jsonrpc: '2.0',
            id: frame.id,
            result: {
              protocolVersion: 1,
              turnId: frame.params.turnId,
              runId: frame.params.runId,
              replayId: 'replay-test',
              status: 'completed',
              sessionId: 'dsh-session',
              text: 'DSH answer',
              media: [],
            },
          })}\n`)
        } else if (frame.method === 'session.reset') {
          state.reset = frame.params
          state.resetCount += 1
          socket.write(`${JSON.stringify({
            jsonrpc: '2.0',
            id: frame.id,
            result: {
              protocolVersion: 1,
              route: { ...frame.params.route, generation: frame.params.nextGeneration },
            },
          })}\n`)
        } else if (frame.id !== undefined && frame.method === undefined) {
          const entry = pending.get(String(frame.id))
          if (entry !== undefined) {
            pending.delete(String(frame.id))
            if (frame.error === undefined) entry.resolve(frame.result)
            else entry.reject(new Error(String(frame.error.message)))
          }
        }
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
  const requestBridge = (method, params) => new Promise((resolve, reject) => {
    if (bridgeSocket === undefined) {
      reject(new Error('bridge socket is not connected'))
      return
    }
    const id = `gateway-${++nextRequestId}`
    pending.set(id, { resolve, reject })
    bridgeSocket.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  })
  return Object.assign(state, { directory, endpoint, server, requestBridge })
}
