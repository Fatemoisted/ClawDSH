import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  createOpenClawBridge,
  createProcessSharedOpenClawBridge,
  createSyntheticProvider,
} from '../shared/openclaw-runtime.js'

test('runtime inspection requires neither supervisor environment nor state access', async () => {
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
  await bridge.dispose()
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
  t.after(async () => { await bridge.dispose() })
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

test('bridge health stays starting until startup recovery completes', async t => {
  const fixture = await gatewayFixture(t)
  const bridge = createOpenClawBridge(mockApi(), {
    generation: 'v1',
    env: bridgeEnv(fixture.endpoint, fixture.directory),
    config: { controlTimeoutMs: 2000, routeStateMaxEntries: 100, deliveryStateMaxEntries: 100 },
  })
  t.after(async () => { await bridge.dispose() })

  await bridge.harness.runAttempt(attemptParams())
  assert.equal((await fixture.requestBridge('health.get', {})).status, 'starting')
  await bridge.start()
  assert.equal((await fixture.requestBridge('health.get', {})).status, 'ready')
})

test('repeated OpenClaw registries share one authenticated transport until the last service stops', async t => {
  const fixture = await gatewayFixture(t)
  let connections = 0
  fixture.server.on('connection', () => { connections += 1 })
  const options = {
    generation: 'v1',
    env: bridgeEnv(fixture.endpoint, fixture.directory),
    config: { controlTimeoutMs: 2000, routeStateMaxEntries: 100, deliveryStateMaxEntries: 100 },
  }
  const first = createProcessSharedOpenClawBridge(mockApi(), options)
  const second = createProcessSharedOpenClawBridge(mockApi(), options)
  t.after(async () => { await Promise.allSettled([first.dispose(), second.dispose()]) })

  await first.start()
  await second.start()
  assert.equal(connections, 1)
  assert.deepEqual((await second.harness.runAttempt(attemptParams())).assistantTexts, ['DSH answer'])

  await first.dispose()
  assert.deepEqual((await second.harness.runAttempt({
    ...attemptParams(), runId: 'run-second-lease', currentMessageId: 'message-second-lease',
  })).assistantTexts, ['DSH answer'])
  assert.equal(connections, 1)

  await second.dispose()
  await fixture.waitForNoSockets()
  assert.equal(fixture.openSocketCount(), 0)
  const stopped = await first.harness.runAttempt({
    ...attemptParams(), runId: 'run-after-last-lease', currentMessageId: 'message-after-last-lease',
  })
  assert.match(stopped.assistantTexts[0], /^\[ClawDSH bridge CHANNEL_BRIDGE_FAILED\]/)
  assert.equal(connections, 1)
})

test('one process-shared registry creates a fresh transport after stop and restart', async t => {
  const fixture = await gatewayFixture(t)
  let connections = 0
  fixture.server.on('connection', () => { connections += 1 })
  const bridge = createProcessSharedOpenClawBridge(mockApi(), {
    generation: 'v1',
    env: bridgeEnv(fixture.endpoint, fixture.directory),
    config: { controlTimeoutMs: 2000, routeStateMaxEntries: 100, deliveryStateMaxEntries: 100 },
  })
  t.after(async () => { await bridge.dispose() })

  await bridge.start()
  assert.deepEqual((await bridge.harness.runAttempt(attemptParams())).assistantTexts, ['DSH answer'])
  await bridge.dispose()
  await fixture.waitForNoSockets()
  assert.equal(fixture.openSocketCount(), 0)

  await bridge.start()
  assert.deepEqual((await bridge.harness.runAttempt({
    ...attemptParams(), runId: 'run-after-restart', currentMessageId: 'message-after-restart',
  })).assistantTexts, ['DSH answer'])
  assert.equal(connections, 2)
  assert.equal(fixture.openSocketCount(), 1)
})

test('a live bridge resolves the current runtime config for every channel action', async t => {
  const fixture = await gatewayFixture(t)
  const api = mockApi()
  const observedConfigs = []
  api.runtime.channel.outbound.loadAdapter = async () => ({
    sendText: async input => {
      observedConfigs.push(input.cfg)
      return { messageId: `platform-${observedConfigs.length}` }
    },
  })
  const bridge = createProcessSharedOpenClawBridge(api, {
    generation: 'v1',
    env: bridgeEnv(fixture.endpoint, fixture.directory),
    config: { controlTimeoutMs: 2000, routeStateMaxEntries: 100, deliveryStateMaxEntries: 100 },
  })
  t.after(async () => { await bridge.dispose() })
  const firstConfig = { channels: { telegram: { botToken: 'token-first' } } }
  const secondConfig = { channels: { telegram: { botToken: 'token-second' } } }
  let currentConfig = firstConfig
  api.runtime.config.current = () => currentConfig

  await bridge.start()
  await fixture.requestBridge('channel.action', outboundAction('config-first'))
  currentConfig = secondConfig
  await fixture.requestBridge('channel.action', outboundAction('config-second'))

  assert.deepEqual(observedConfigs, [firstConfig, secondConfig])
})

test('last-lease disposal aborts and drains an in-flight channel action', async t => {
  const fixture = await gatewayFixture(t)
  const api = mockApi()
  const entered = Promise.withResolvers()
  const release = Promise.withResolvers()
  api.runtime.channel.outbound.loadAdapter = async () => ({
    sendText: async () => {
      entered.resolve()
      await release.promise
      return { messageId: 'platform-drained' }
    },
  })
  const bridge = createProcessSharedOpenClawBridge(api, {
    generation: 'v1',
    env: bridgeEnv(fixture.endpoint, fixture.directory),
    config: { controlTimeoutMs: 2000, routeStateMaxEntries: 100, deliveryStateMaxEntries: 100 },
  })
  t.after(async () => { await bridge.dispose() })
  await bridge.start()
  const action = outboundAction('drained-action')
  const response = fixture.requestBridge('channel.action', action)
  void response.catch(() => {})
  await entered.promise

  let stopped = false
  const stopping = bridge.dispose().then(() => { stopped = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(stopped, false)
  release.resolve()
  await stopping
  await assert.rejects(response, /bridge socket disconnected/)

  const ledger = api.runtime.state.openSyncKeyedStore({ namespace: 'clawdsh-bridge-actions-v1' })
  const key = createHash('sha256').update(action.actionId).digest('hex')
  const completed = ledger.lookup(key)
  assert.equal(completed.state, 'completed')
  assert.equal(completed.result.status, 'confirmed')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(ledger.lookup(key), completed)
})

test('process-shared transport rejects configuration and immutable environment mismatches', async t => {
  const fixture = await gatewayFixture(t)
  let connections = 0
  fixture.server.on('connection', () => { connections += 1 })
  const env = bridgeEnv(fixture.endpoint, fixture.directory)
  const config = { controlTimeoutMs: 2000, routeStateMaxEntries: 100, deliveryStateMaxEntries: 100 }
  const active = createProcessSharedOpenClawBridge(mockApi(), { generation: 'v1', env, config })
  const changedConfig = createProcessSharedOpenClawBridge(mockApi(), {
    generation: 'v1', env, config: { ...config, controlTimeoutMs: 2001 },
  })
  const changedEnvironment = createProcessSharedOpenClawBridge(mockApi(), {
    generation: 'v1', env: { ...env, CLAWDSH_CHANNEL_TOKEN: 'another-token' }, config,
  })
  t.after(async () => {
    await Promise.allSettled([active.dispose(), changedConfig.dispose(), changedEnvironment.dispose()])
  })

  await active.start()
  await assert.rejects(changedConfig.start(), /configuration conflicts with the active process transport/)
  await assert.rejects(changedEnvironment.start(), /configuration conflicts with the active process transport/)
  assert.equal(connections, 1)
  const mismatched = await changedConfig.harness.runAttempt(attemptParams())
  assert.match(mismatched.assistantTexts[0], /^\[ClawDSH bridge CHANNEL_BRIDGE_FAILED\]/)
  assert.equal(fixture.turn, undefined)
})

test('startup recovery failure releases the authenticated transport for another registry', async t => {
  const fixture = await gatewayFixture(t)
  let connections = 0
  fixture.server.on('connection', () => { connections += 1 })
  const api = mockApi()
  const route = {
    gatewayInstanceId: 'gateway-test',
    openclawSessionKey: 'openclaw-session',
    generation: 0,
    channel: 'telegram',
    account: 'primary',
    conversation: 'chat-42',
    kind: 'direct',
  }
  const key = createHash('sha256').update(route.openclawSessionKey).digest('hex')
  api.runtime.state.openSyncKeyedStore({ namespace: 'clawdsh-bridge-routes-v1' }).register(key, route)
  api.runtime.state.openSyncKeyedStore({ namespace: 'clawdsh-bridge-route-transitions-v1' }).register(key, {
    method: 'session.reset',
    params: {
      protocolVersion: 1,
      route,
      nextGeneration: 1,
      reason: 'reset',
    },
  })
  const options = {
    generation: 'v1',
    env: bridgeEnv(fixture.endpoint, fixture.directory),
    config: { controlTimeoutMs: 2000, routeStateMaxEntries: 100, deliveryStateMaxEntries: 100 },
  }
  const first = createProcessSharedOpenClawBridge(api, options)
  const second = createProcessSharedOpenClawBridge(api, options)
  t.after(async () => { await Promise.allSettled([first.dispose(), second.dispose()]) })

  fixture.failNextReset('startup recovery failed')
  await assert.rejects(first.start(), /startup recovery failed/)
  await fixture.waitForNoSockets()
  assert.equal(fixture.openSocketCount(), 0)

  await second.start()
  assert.equal(connections, 2)
  assert.deepEqual((await second.harness.runAttempt(attemptParams())).assistantTexts, ['DSH answer'])
  assert.equal(fixture.turn.route.generation, 1)
})

test('an owner-originated group remains group-allowlisted, including the owner-id fallback', async t => {
  const fixture = await gatewayFixture(t)
  const bridge = createOpenClawBridge(mockApi(), {
    generation: 'v1',
    env: bridgeEnv(fixture.endpoint, fixture.directory),
    config: { controlTimeoutMs: 2000, routeStateMaxEntries: 100, deliveryStateMaxEntries: 100 },
  })
  t.after(async () => { await bridge.dispose() })
  await bridge.harness.runAttempt({
    ...attemptParams(),
    sessionId: 'group-session-id',
    sessionKey: 'group-session',
    runId: 'group-owner-run',
    currentMessageId: 'group-owner-message',
    chatId: 'group-42',
    chatType: 'group',
  })
  assert.equal(fixture.turn.sender.trust, 'group-allowlisted')

  const fallback = {
    ...attemptParams(),
    sessionId: 'group-fallback-session-id',
    sessionKey: 'group-fallback-session',
    runId: 'group-owner-fallback-run',
    currentMessageId: 'group-owner-fallback-message',
    chatId: 'group-43',
    chatType: 'group',
  }
  delete fallback.senderId
  await bridge.harness.runAttempt(fallback)
  assert.deepEqual(fixture.turn.sender, { senderId: 'openclaw-owner', trust: 'group-allowlisted' })
})

test('validates the complete generated envelope before turn.run', async t => {
  const fixture = await gatewayFixture(t)
  const bridge = createOpenClawBridge(mockApi(), {
    generation: 'v1',
    env: bridgeEnv(fixture.endpoint, fixture.directory),
    config: { controlTimeoutMs: 2000, routeStateMaxEntries: 100, deliveryStateMaxEntries: 100 },
  })
  t.after(async () => { await bridge.dispose() })
  const result = await bridge.harness.runAttempt({ ...attemptParams(), senderName: 'unsafe\0display' })
  assert.deepEqual(result.assistantTexts, [
    '[ClawDSH bridge CHANNEL_BRIDGE_FAILED] The authenticated local ClawDSH communication bridge is unavailable.',
  ])
  assert.equal(fixture.turn, undefined)
})

test('keeps arbitrary RPC and terminal failure details out of assistant and transcript output', async t => {
  const fixture = await gatewayFixture(t)
  const mirrored = []
  const bridge = createOpenClawBridge(mockApi(), {
    generation: 'v1',
    env: bridgeEnv(fixture.endpoint, fixture.directory),
    config: { controlTimeoutMs: 2000, routeStateMaxEntries: 100, deliveryStateMaxEntries: 100 },
    transcript: {
      async mirror(input) {
        mirrored.push({ userMessage: input.userMessage, assistantMessage: input.assistantMessage })
        return { assistantOwned: false }
      },
    },
  })
  t.after(async () => { await bridge.dispose() })
  const privateDetails = 'write /Users/operator/private with sk-secret-bridge-value'
  const expected = [
    '[ClawDSH bridge CHANNEL_BRIDGE_FAILED] The authenticated local ClawDSH communication bridge is unavailable.',
  ]

  fixture.setTurnFailure({ kind: 'rpc', message: privateDetails })
  const rpcFailure = await bridge.harness.runAttempt(attemptParams())
  assert.deepEqual(rpcFailure.assistantTexts, expected)

  fixture.setTurnFailure({ kind: 'result', message: privateDetails })
  const terminalFailure = await bridge.harness.runAttempt({
    ...attemptParams(),
    sessionId: 'terminal-failure-session-id',
    sessionKey: 'terminal-failure-session',
    runId: 'terminal-failure-run',
    currentMessageId: 'terminal-failure-message',
  })
  assert.deepEqual(terminalFailure.assistantTexts, expected)
  const publicProjection = JSON.stringify({
    assistantTexts: [...rpcFailure.assistantTexts, ...terminalFailure.assistantTexts],
    mirrored,
  })
  assert(!publicProjection.includes('/Users/operator'))
  assert(!publicProjection.includes('sk-secret'))
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
  await first.dispose()

  const second = createOpenClawBridge(externalApi(), {
    generation: 'v1', env: bridgeEnv(fixture.endpoint, fixture.directory), config,
  })
  t.after(async () => { await second.dispose() })
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
  await first.dispose()

  const second = createOpenClawBridge(api, {
    generation: 'v1', env: bridgeEnv(fixture.endpoint, fixture.directory), config,
  })
  t.after(async () => { await second.dispose() })
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
  t.after(async () => { await bridge.dispose() })
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
  t.after(async () => { await bridge.dispose() })
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
  t.after(async () => { await bridge.dispose() })
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
  t.after(async () => { await bridge.dispose() })

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
  t.after(async () => { await bridge.dispose() })

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
  t.after(async () => { await bridge.dispose() })
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
  const api = {
    config: {},
    runtime: {
      config: { current: () => api.config },
      state: {
        openSyncKeyedStore({ namespace }) {
          if (!stores.has(namespace)) stores.set(namespace, syncStore())
          return stores.get(namespace)
        },
      },
      channel: { outbound: { loadAdapter: async () => undefined } },
    },
  }
  return api
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

function outboundAction(actionId) {
  return {
    protocolVersion: 1,
    actionId,
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
    socket.on('close', () => {
      sockets.delete(socket)
      for (const entry of pending.values()) entry.reject(new Error('bridge socket disconnected'))
      pending.clear()
    })
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
          if (state.turnFailure?.kind === 'rpc') {
            socket.write(`${JSON.stringify({
              jsonrpc: '2.0',
              id: frame.id,
              error: { code: -32000, message: state.turnFailure.message },
            })}\n`)
          } else {
            const result = state.turnFailure?.kind === 'result'
              ? {
                  protocolVersion: 1,
                  turnId: frame.params.turnId,
                  runId: frame.params.runId,
                  replayId: 'replay-test',
                  status: 'failed',
                  error: { code: 'DSH_FAILURE', message: state.turnFailure.message, retryable: false },
                }
              : {
                  protocolVersion: 1,
                  turnId: frame.params.turnId,
                  runId: frame.params.runId,
                  replayId: 'replay-test',
                  status: 'completed',
                  sessionId: 'dsh-session',
                  text: 'DSH answer',
                  media: [],
                }
            socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: frame.id, result })}\n`)
          }
        } else if (frame.method === 'session.reset') {
          state.reset = frame.params
          state.resetCount += 1
          if (state.resetFailure !== undefined) {
            const message = state.resetFailure
            state.resetFailure = undefined
            socket.write(`${JSON.stringify({
              jsonrpc: '2.0', id: frame.id, error: { code: -32000, message },
            })}\n`)
          } else {
            socket.write(`${JSON.stringify({
              jsonrpc: '2.0',
              id: frame.id,
              result: {
                protocolVersion: 1,
                route: { ...frame.params.route, generation: frame.params.nextGeneration },
              },
            })}\n`)
          }
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
  return Object.assign(state, {
    directory,
    endpoint,
    server,
    requestBridge,
    setTurnFailure: failure => { state.turnFailure = failure },
    failNextReset: message => { state.resetFailure = message },
    openSocketCount: () => sockets.size,
    waitForNoSockets: async () => {
      await Promise.all([...sockets].map(socket => new Promise(resolve => { socket.once('close', resolve) })))
    },
  })
}
