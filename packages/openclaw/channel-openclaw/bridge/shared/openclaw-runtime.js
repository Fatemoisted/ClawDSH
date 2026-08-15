import { createHash } from 'node:crypto'
import { createLazySyncKeyedStore } from './durable-store.js'
import { NdjsonRpcClient, RpcMethodError } from './ndjson-rpc.js'
import { StagedMediaGuard } from './media.js'
import {
  validateAction,
  validateActionResult,
  validateEmptyParams,
  validateHandshake,
  validateHealth,
  validateSessionClose,
  validateSessionReset,
  validateSessionResetResult,
  validateTurnEnvelope,
  validateTurnNotification,
  validateTurnResult,
} from './protocol-v1.js'

const PROVIDER_ID = 'clawdsh'
const MODEL_ID = 'local'
const HARNESS_ID = 'clawdsh'
const SILENT_MARKER = 'NO_REPLY'
const ACTIONS = Object.freeze(['send', 'poll'])
const NOTIFICATIONS = Object.freeze(['text.delta', 'reasoning.delta', 'tool', 'status'])
const CAPABILITIES = Object.freeze({
  actions: ACTIONS,
  notifications: NOTIFICATIONS,
  extensions: Object.freeze([]),
})
const PUBLIC_BRIDGE_FAILURE = '[ClawDSH bridge CHANNEL_BRIDGE_FAILED] The authenticated local ClawDSH communication bridge is unavailable.'
const PROCESS_SHARED_BRIDGES = Symbol.for('clawdsh.channel-openclaw.process-shared-bridges.v1')

/** Manifest-backed bridge runtime defaults; every value remains operator-configurable. */
export const BRIDGE_CONFIG_DEFAULTS = Object.freeze({
  controlTimeoutMs: 10000,
  routeStateMaxEntries: 100000,
  deliveryStateMaxEntries: 100000,
})

/** Resolve the small plugin configuration once, before any harness invocation. */
export function resolveBridgeConfig(candidate) {
  const value = candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate : {}
  return Object.freeze({
    controlTimeoutMs: positiveConfig(value.controlTimeoutMs, 'controlTimeoutMs'),
    routeStateMaxEntries: positiveConfig(value.routeStateMaxEntries, 'routeStateMaxEntries'),
    deliveryStateMaxEntries: positiveConfig(value.deliveryStateMaxEntries, 'deliveryStateMaxEntries'),
  })
}

/** Read and validate the supervisor-injected immutable bridge environment. */
export function readBridgeEnvironment(expectedGeneration, env = process.env) {
  const generation = required(env, 'CLAWDSH_OPENCLAW_AGENT_HARNESS')
  if (generation !== expectedGeneration) {
    throw new Error(`expected ${expectedGeneration} AgentHarness environment, received ${generation}`)
  }
  const handshake = validateHandshake({
    protocolVersion: 1,
    gatewayInstanceId: required(env, 'CLAWDSH_CHANNEL_GATEWAY_INSTANCE_ID'),
    openclaw: {
      tag: required(env, 'CLAWDSH_OPENCLAW_TAG'),
      commitSha: required(env, 'CLAWDSH_OPENCLAW_COMMIT_SHA'),
      artifactSha512: required(env, 'CLAWDSH_OPENCLAW_ARTIFACT_SHA512'),
      nodeEngine: required(env, 'CLAWDSH_OPENCLAW_NODE_ENGINE'),
    },
    agentHarness: generation,
    capabilities: CAPABILITIES,
    startupNonce: required(env, 'CLAWDSH_CHANNEL_STARTUP_NONCE'),
  })
  return Object.freeze({
    endpoint: required(env, 'CLAWDSH_CHANNEL_ENDPOINT'),
    token: required(env, 'CLAWDSH_CHANNEL_TOKEN'),
    stagingRoot: required(env, 'CLAWDSH_CHANNEL_STAGING_ROOT'),
    maxFrameBytes: positiveEnv(env, 'CLAWDSH_CHANNEL_MAX_FRAME_BYTES'),
    maxInFlight: positiveEnv(env, 'CLAWDSH_CHANNEL_MAX_IN_FLIGHT'),
    maxMediaBytes: positiveEnv(env, 'CLAWDSH_CHANNEL_MAX_MEDIA_BYTES'),
    handshake,
  })
}

/** Synthetic provider whose only model is permanently pinned to the ClawDSH harness. */
export function createSyntheticProvider() {
  return {
    id: PROVIDER_ID,
    label: 'ClawDSH',
    auth: [],
    staticCatalog: {
      order: 'simple',
      run: async () => ({
        provider: {
          baseUrl: 'http://127.0.0.1:9/v1',
          apiKey: 'clawdsh-local',
          auth: 'token',
          api: 'openai-responses',
          agentRuntime: { id: HARNESS_ID },
          models: [{
            id: MODEL_ID,
            name: 'ClawDSH local agent',
            api: 'openai-responses',
            reasoning: true,
            input: ['text', 'image'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 200000,
            maxTokens: 32768,
            agentRuntime: { id: HARNESS_ID },
          }],
        },
      }),
    },
    resolveSyntheticAuth: () => ({ apiKey: 'clawdsh-local', source: 'clawdsh-bridge', mode: 'token' }),
  }
}

/**
 * Create a lazy AgentHarness bridge and public OpenClaw outbound action adapter.
 * Registration performs no IPC or media filesystem access.
 */
export function createOpenClawBridge(api, options) {
  let resources
  const ensureResources = () => {
    resources ??= createBridgeResources(api, options)
    return resources
  }

  const harness = {
    id: HARNESS_ID,
    label: 'ClawDSH local Agent',
    supports: context => supports(context, options),
    runAttempt: params => runAttemptFailClosed({ params, options, ensureResources }),
    reset: async params => {
      const current = ensureResources()
      await resetSession({
        params,
        routes: current.routes,
        routeTransitions: current.routeTransitions,
        routeControls: current.routeControls,
        routeOperations: current.routeOperations,
        environment: current.environment,
        client: current.client,
        timeoutMs: options.config.controlTimeoutMs,
      })
    },
    dispose: async () => { await resources?.client.dispose() },
  }
  return {
    harness,
    failAttempt: async (params, error) => {
      const result = await failedAttempt(params, undefined, error, options.transcript)
      return options.generation === 'v2' ? { ...result, terminal: { kind: 'ok' } } : result
    },
    get handshake() { return ensureResources().environment.handshake },
    capabilities: CAPABILITIES,
    start: async () => {
      const current = ensureResources()
      try {
        await current.client.connect()
        await recoverAllRouteTransitions({
          routes: current.routes,
          routeTransitions: current.routeTransitions,
          routeControls: current.routeControls,
          routeOperations: current.routeOperations,
          client: current.client,
          timeoutMs: options.config.controlTimeoutMs,
        })
        current.lifecycle.status = 'ready'
      } catch (error) {
        current.lifecycle.status = 'degraded'
        await current.client.dispose()
        throw error
      }
    },
    dispose: async () => { await resources?.client.dispose() },
  }
}

/**
 * Share the one authenticated transport across repeated OpenClaw plugin registry instances.
 * OpenClaw can register the process-wide AgentHarness from a different plugin instance than the
 * startup service. Every matching service instance holds a lease; the last lease owns disposal.
 */
export function createProcessSharedOpenClawBridge(api, options) {
  const state = processSharedBridgeState(options.generation)
  const lease = Symbol(`clawdsh-bridge-${options.generation}`)
  let identity
  let started = false
  const resolveIdentity = () => {
    identity ??= processSharedBridgeIdentity(options)
    return identity
  }
  const activeBridge = () => {
    const active = state.active
    return active !== undefined && active.identity === resolveIdentity() ? active.bridge : undefined
  }
  const harness = {
    id: HARNESS_ID,
    label: 'ClawDSH local Agent',
    supports: context => supports(context, options),
    runAttempt: params => {
      try {
        const active = activeBridge()
        if (active !== undefined) return active.harness.runAttempt(params)
        return failAttemptFor(params, new Error('the process-shared ClawDSH bridge is not active'), options)
      } catch (error) {
        return failAttemptFor(params, error, options)
      }
    },
    reset: params => {
      const active = activeBridge()
      if (active === undefined) throw new Error('the process-shared ClawDSH bridge is not active')
      return active.harness.reset(params)
    },
    // The startup service owns the shared connection lease and its final disposal.
    dispose: () => {},
  }
  return {
    harness,
    get handshake() {
      const active = activeBridge()
      if (active === undefined) throw new Error('the process-shared ClawDSH bridge is not active')
      return active.handshake
    },
    capabilities: CAPABILITIES,
    start: () => serializeProcessSharedBridge(state, async () => {
      if (started) return
      const candidateIdentity = resolveIdentity()
      if (state.active !== undefined) {
        if (state.active.identity !== candidateIdentity) {
          throw new Error('ClawDSH bridge configuration conflicts with the active process transport')
        }
        state.active.leases.add(lease)
        started = true
        return
      }
      const candidate = createOpenClawBridge(api, options)
      await candidate.start()
      state.active = { identity: candidateIdentity, bridge: candidate, leases: new Set([lease]) }
      started = true
    }),
    dispose: () => serializeProcessSharedBridge(state, async () => {
      if (!started) return
      started = false
      const active = state.active
      if (active === undefined || !active.leases.delete(lease)) {
        throw new Error('ClawDSH bridge process lease is inconsistent')
      }
      if (active.leases.size !== 0) return
      state.active = undefined
      await active.bridge.dispose()
    }),
  }
}

async function failAttemptFor(params, error, options) {
  const result = await failedAttempt(params, undefined, error, options.transcript)
  return options.generation === 'v2' ? { ...result, terminal: { kind: 'ok' } } : result
}

function processSharedBridgeIdentity(options) {
  const environment = readBridgeEnvironment(options.generation, options.env)
  return digest(JSON.stringify([
    options.generation,
    options.config.controlTimeoutMs,
    options.config.routeStateMaxEntries,
    options.config.deliveryStateMaxEntries,
    environment.endpoint,
    environment.token,
    environment.stagingRoot,
    environment.maxFrameBytes,
    environment.maxInFlight,
    environment.maxMediaBytes,
    environment.handshake,
  ]))
}

function processSharedBridgeState(generation) {
  const root = globalThis
  root[PROCESS_SHARED_BRIDGES] ??= new Map()
  const registry = root[PROCESS_SHARED_BRIDGES]
  if (!(registry instanceof Map)) throw new Error('ClawDSH process bridge registry is invalid')
  let state = registry.get(generation)
  if (state === undefined) {
    state = { active: undefined, operation: Promise.resolve() }
    registry.set(generation, state)
  }
  return state
}

function serializeProcessSharedBridge(state, operation) {
  const current = state.operation.then(operation, operation)
  state.operation = current.then(() => {}, () => {})
  return current
}

function currentHostConfig(api) {
  const current = api.runtime?.config?.current
  if (typeof current !== 'function') throw new Error('ClawDSH bridge runtime config getter is unavailable')
  const config = current()
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('ClawDSH bridge runtime config is invalid')
  }
  return config
}

function createBridgeResources(api, options) {
  const environment = readBridgeEnvironment(options.generation, options.env)
  const lifecycle = { status: 'starting' }
  const media = new StagedMediaGuard(environment.stagingRoot, environment.maxMediaBytes)
  const routes = createLazySyncKeyedStore(api, {
    namespace: `clawdsh-bridge-routes-${options.generation}`,
    maxEntries: options.config.routeStateMaxEntries,
    overflowPolicy: 'reject-new',
  })
  const routeTransitions = createLazySyncKeyedStore(api, {
    namespace: `clawdsh-bridge-route-transitions-${options.generation}`,
    maxEntries: options.config.routeStateMaxEntries,
    overflowPolicy: 'reject-new',
  })
  const routeControls = createLazySyncKeyedStore(api, {
    namespace: `clawdsh-bridge-route-controls-${options.generation}`,
    maxEntries: options.config.routeStateMaxEntries,
    overflowPolicy: 'reject-new',
  })
  const actions = createLazySyncKeyedStore(api, {
    namespace: `clawdsh-bridge-actions-${options.generation}`,
    maxEntries: options.config.deliveryStateMaxEntries,
    overflowPolicy: 'reject-new',
  })
  const liveRuns = new Map()
  const routeOperations = new Map()
  const client = new NdjsonRpcClient({
    endpoint: environment.endpoint,
    token: environment.token,
    handshake: environment.handshake,
    maxFrameBytes: environment.maxFrameBytes,
    maxInFlight: environment.maxInFlight,
    requestTimeoutMs: options.config.controlTimeoutMs,
    handlers: {
      'channel.action': (params, signal) => executeAction(
        api, media, actions, environment.handshake, params, signal,
      ),
      'channel.reconcile': (params, signal) => {
        signal.throwIfAborted()
        return reconcileAction(actions, environment.handshake, params)
      },
      'health.get': params => {
        validateEmptyParams(params)
        return localHealth(environment.handshake, lifecycle.status)
      },
    },
    onNotification: async (method, params) => {
      if (method !== 'turn.progress') throw new Error(`unexpected notification ${method}`)
      const notification = validateTurnNotification(params)
      const run = liveRuns.get(notification.runId)
      if (run === undefined) return
      if (notification.turnId !== run.turnId) throw new Error('turn.progress targets the wrong turn')
      if (notification.sequence !== run.nextSequence) throw new Error('turn.progress sequence is not contiguous')
      run.nextSequence += 1
      await projectProgress(run.params, notification)
    },
  })
  return {
    environment,
    lifecycle,
    media,
    routes,
    routeTransitions,
    routeControls,
    routeOperations,
    actions,
    liveRuns,
    client,
  }
}

async function runAttemptFailClosed(context) {
  try {
    const result = await runAttempt(context)
    return context.options.generation === 'v2'
      ? { ...result, terminal: result.aborted ? { kind: 'aborted', source: 'external' } : { kind: 'ok' } }
      : result
  } catch (error) {
    const result = await failedAttempt(context.params, undefined, error, context.options.transcript)
    return context.options.generation === 'v2' ? { ...result, terminal: { kind: 'ok' } } : result
  }
}

function supports(context, options) {
  if (context.provider !== PROVIDER_ID || context.modelId !== MODEL_ID || context.requestedRuntime !== HARNESS_ID) {
    return { supported: false, reason: 'ClawDSH requires the exact clawdsh/local runtime route' }
  }
  if (typeof options.supports === 'function') return options.supports(context)
  return { supported: true, priority: 1000, reason: 'locked ClawDSH local route' }
}

async function runAttempt(context) {
  const { params, options } = context
  const {
    environment,
    routes,
    routeTransitions,
    routeControls,
    routeOperations,
    liveRuns,
    media,
    client,
  } = context.ensureResources()
  options.assertActive?.(params)
  const openclawSessionKey = requiredString(
    params.sessionKey ?? params.sessionId,
    'OpenClaw session key',
  )
  const routeStateKey = digest(openclawSessionKey)
  const route = await serializeRouteOperation(routeOperations, routeStateKey, async () => {
    await recoverRouteTransition({
      key: routeStateKey,
      routes,
      routeTransitions,
      routeControls,
      client,
      timeoutMs: options.config.controlTimeoutMs,
    })
    return routeForAttempt(params, environment.handshake.gatewayInstanceId, routes)
  })
  const text = promptText(params)
  const recorderMessage = params.userTurnTranscriptRecorder?.message
  const messageId = requiredString(
    params.currentMessageId === undefined || params.currentMessageId === null
      ? (nonEmpty(params.runId) ? `openclaw-run:${params.runId}` : undefined)
      : String(params.currentMessageId),
    'OpenClaw stable inbound message or Gateway run id',
  )
  const idempotencyKey = nonEmpty(recorderMessage?.idempotencyKey)
    ? recorderMessage.idempotencyKey
    : digest(`inbound\0${routeKey(route)}\0${messageId}`)
  const turnId = `turn-${digest(idempotencyKey)}`
  const runId = `run-${digest(`${environment.handshake.gatewayInstanceId}\0${idempotencyKey}`)}`
  const envelopeBase = {
    protocolVersion: 1,
    idempotencyKey,
    turnId,
    runId,
    route,
    sender: principalFor(params, route.kind),
    ...mentionProjection(params),
    messageId,
    ...replyProjection(params),
    text,
  }
  let envelope
  try {
    const staged = await inboundMedia(params, options, media)
    envelope = validateTurnEnvelope({ ...envelopeBase, media: staged })
  } catch (error) {
    return await failedAttempt(params, envelopeBase, error, options.transcript)
  }

  const progress = { turnId, nextSequence: 0, params }
  liveRuns.set(runId, progress)
  let cancellation
  const abort = () => {
    cancellation = client.request('turn.cancel', {
      protocolVersion: 1,
      turnId,
      runId,
      reason: 'user',
    }, { timeoutMs: options.config.controlTimeoutMs })
      .then(result => { validateEmptyParams(result) })
    void cancellation.catch((_observedUntilAttemptFinally) => {
      // The attempt's finally block awaits this same promise and turns failure into a visible bridge result.
    })
  }
  params.abortSignal?.addEventListener('abort', abort, { once: true })
  try {
    options.assertActive?.(params)
    const raw = await client.request('turn.run', envelope, {
      signal: params.abortSignal,
      timeoutMs: Math.max(options.config.controlTimeoutMs, positiveAttemptTimeout(params.timeoutMs)),
    })
    const result = validateTurnResult(raw)
    if (result.turnId !== turnId || result.runId !== runId) throw new Error('ClawDSH turn result identity does not match its request')
    options.assertActive?.(params)
    return await attemptFromTurnResult(params, envelope, result, media, options.transcript)
  } catch (error) {
    if (params.abortSignal?.aborted) return abortedAttempt(params)
    if (error instanceof RpcMethodError && error.code === -32002) {
      cancellation = client.request('turn.cancel', {
        protocolVersion: 1,
        turnId,
        runId,
        reason: 'timeout',
      }, { timeoutMs: options.config.controlTimeoutMs })
        .then(result => { validateEmptyParams(result) })
      void cancellation.catch((_observedUntilAttemptFinally) => {
        // The attempt's finally block awaits this same promise and turns failure into a visible bridge result.
      })
    }
    return await failedAttempt(params, envelope, error, options.transcript)
  } finally {
    params.abortSignal?.removeEventListener('abort', abort)
    liveRuns.delete(runId)
    await cancellation
  }
}

async function resetSession(context) {
  const sessionKey = String(context.params.sessionKey ?? context.params.sessionId ?? '')
  if (sessionKey.length === 0) return
  const key = digest(sessionKey)
  await serializeRouteOperation(context.routeOperations, key, async () => {
    const operationId = routeControlOperationId(context.params)
    const hadPendingTransition = context.routeTransitions.lookup(key) !== undefined
    await recoverRouteTransition({ ...context, key })
    if (operationId !== undefined) {
      const completed = context.routeControls.lookup(key)
      if (completed !== undefined && validateRouteControl(completed).operationId === operationId) return
    } else if (hadPendingTransition) {
      return
    }
    const route = context.routes.lookup(key)
    if (route === undefined || route.openclawSessionKey !== sessionKey) return
    let transition
    if (context.params.reason === 'new' || context.params.reason === 'reset') {
      transition = {
        method: 'session.reset',
        params: validateSessionReset({
          protocolVersion: 1,
          route,
          nextGeneration: route.generation + 1,
          reason: context.params.reason,
        }),
        ...(operationId === undefined ? {} : { operationId }),
      }
    } else if (context.params.reason === 'deleted') {
      transition = {
        method: 'session.close',
        params: validateSessionClose({
          protocolVersion: 1,
          route,
          reason: 'gateway',
        }),
        ...(operationId === undefined ? {} : { operationId }),
      }
    } else {
      return
    }
    if (!context.routeTransitions.registerIfAbsent(key, transition)) {
      const raced = validateRouteTransition(context.routeTransitions.lookup(key), key)
      if (JSON.stringify(raced) !== JSON.stringify(transition)) {
        throw new Error('another OpenClaw route transition is already pending')
      }
    }
    await recoverRouteTransition({ ...context, key })
  })
}

async function recoverAllRouteTransitions(context) {
  for (const entry of context.routeTransitions.entries()) {
    await serializeRouteOperation(context.routeOperations, entry.key, async () => {
      await recoverRouteTransition({ ...context, key: entry.key })
    })
  }
}

async function recoverRouteTransition(context) {
  const candidate = context.routeTransitions.lookup(context.key)
  if (candidate === undefined) return
  const transition = validateRouteTransition(candidate, context.key)
  const current = context.routes.lookup(context.key)
  if (transition.method === 'session.reset') {
    const next = { ...transition.params.route, generation: transition.params.nextGeneration }
    assertRecoverableRoute(current, transition.params.route, next)
    const result = validateSessionResetResult(await context.client.request(
      'session.reset',
      transition.params,
      { timeoutMs: context.timeoutMs },
    ))
    if (routeKey(result.route) !== routeKey(next)) {
      throw new Error('ClawDSH reset acknowledged a different route')
    }
    context.routes.register(context.key, next)
  } else {
    assertRecoverableRoute(current, transition.params.route)
    const result = await context.client.request(
      'session.close',
      transition.params,
      { timeoutMs: context.timeoutMs },
    )
    validateEmptyParams(result)
    context.routes.delete(context.key)
  }
  if (transition.operationId !== undefined) {
    context.routeControls.register(context.key, {
      operationId: transition.operationId,
      method: transition.method,
    })
  }
  if (!context.routeTransitions.delete(context.key)) {
    throw new Error('OpenClaw route transition changed before durable completion')
  }
}

function validateRouteTransition(candidate, key) {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('OpenClaw route transition is not an object')
  }
  const fields = Object.keys(candidate).sort()
  const expected = candidate.operationId === undefined
    ? ['method', 'params']
    : ['method', 'operationId', 'params']
  if (JSON.stringify(fields) !== JSON.stringify(expected)) {
    throw new Error('OpenClaw route transition has unexpected fields')
  }
  let params
  if (candidate.method === 'session.reset') params = validateSessionReset(candidate.params)
  else if (candidate.method === 'session.close') params = validateSessionClose(candidate.params)
  else throw new Error('OpenClaw route transition has an unsupported method')
  if (digest(params.route.openclawSessionKey) !== key) {
    throw new Error('OpenClaw route transition key does not match its session')
  }
  if (candidate.operationId !== undefined && !/^[a-f0-9]{64}$/.test(candidate.operationId)) {
    throw new Error('OpenClaw route transition operation id is invalid')
  }
  return {
    method: candidate.method,
    params,
    ...(candidate.operationId === undefined ? {} : { operationId: candidate.operationId }),
  }
}

function validateRouteControl(candidate) {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('OpenClaw route control record is not an object')
  }
  if (JSON.stringify(Object.keys(candidate).sort()) !== JSON.stringify(['method', 'operationId'])) {
    throw new Error('OpenClaw route control record has unexpected fields')
  }
  if (candidate.method !== 'session.reset' && candidate.method !== 'session.close') {
    throw new Error('OpenClaw route control record has an unsupported method')
  }
  if (typeof candidate.operationId !== 'string' || !/^[a-f0-9]{64}$/.test(candidate.operationId)) {
    throw new Error('OpenClaw route control record operation id is invalid')
  }
  return candidate
}

function routeControlOperationId(params) {
  if (!nonEmpty(params.sessionId)) return undefined
  return digest(JSON.stringify([params.reason ?? null, params.sessionId]))
}

function assertRecoverableRoute(current, previous, next) {
  if (current === undefined) return
  const currentKey = routeKey(current)
  if (currentKey === routeKey(previous)) return
  if (next !== undefined && currentKey === routeKey(next)) return
  throw new Error('OpenClaw route state conflicts with its pending transition')
}

function serializeRouteOperation(operations, key, operation) {
  const previous = operations.get(key) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(operation)
  const settled = current.finally(() => {
    if (operations.get(key) === settled) operations.delete(key)
  })
  operations.set(key, settled)
  return settled
}

function routeForAttempt(params, gatewayInstanceId, store) {
  const openclawSessionKey = requiredString(params.sessionKey ?? params.sessionId, 'OpenClaw session key')
  const candidate = {
    gatewayInstanceId,
    openclawSessionKey,
    generation: 0,
    channel: requiredString(params.messageChannel ?? params.messageProvider, 'OpenClaw message channel'),
    account: String(params.agentAccountId ?? 'default'),
    conversation: requiredString(
      params.chatId ?? params.currentMessagingTarget ?? params.messageTo ?? params.currentChannelId,
      'OpenClaw conversation id',
    ),
    ...threadProjection(params),
    kind: params.chatType === 'direct' ? 'direct' : 'group',
  }
  const key = digest(openclawSessionKey)
  const current = store.lookup(key)
  if (current === undefined) {
    if (!store.registerIfAbsent(key, candidate)) {
      const raced = store.lookup(key)
      if (raced === undefined) throw new Error('failed to persist the OpenClaw session route')
      return assertSameRoute(candidate, raced)
    }
    return candidate
  }
  return assertSameRoute(candidate, current)
}

function assertSameRoute(candidate, current) {
  const fields = ['gatewayInstanceId', 'openclawSessionKey', 'channel', 'account', 'conversation', 'thread', 'kind']
  for (const field of fields) {
    if (candidate[field] !== current[field]) throw new Error('OpenClaw session key was reused for another channel route')
  }
  return current
}

async function executeAction(api, media, ledger, handshake, candidate, signal) {
  signal.throwIfAborted()
  const { action, ledgerKey, fingerprint } = actionIdentity(handshake, candidate)
  const existing = ledger.lookup(ledgerKey)
  if (existing !== undefined) {
    if (existing.actionId !== action.actionId || existing.fingerprint !== fingerprint) {
      throw new RpcMethodError(-32602, 'channel action id was reused with another payload')
    }
    if (existing.state === 'completed') return validateActionResult(existing.result)
    throw new RpcMethodError(-32010, 'channel action outcome requires recovery; automatic resend is forbidden')
  }
  if (!ledger.registerIfAbsent(ledgerKey, { state: 'running', actionId: action.actionId, fingerprint })) {
    throw new RpcMethodError(-32010, 'channel action is already running')
  }
  const hostConfig = currentHostConfig(api)
  const receipt = validateActionResult(await dispatchAction(
    api, hostConfig, media, action, handshake.gatewayInstanceId, signal,
  ))
  ledger.register(ledgerKey, { state: 'completed', actionId: action.actionId, fingerprint, result: receipt })
  return receipt
}

function reconcileAction(ledger, handshake, candidate) {
  const { action, ledgerKey, fingerprint } = actionIdentity(handshake, candidate)
  const existing = ledger.lookup(ledgerKey)
  if (existing === undefined) {
    throw new RpcMethodError(-32011, 'channel action has no durable bridge record; automatic resend is forbidden')
  }
  if (existing.actionId !== action.actionId || existing.fingerprint !== fingerprint) {
    throw new RpcMethodError(-32602, 'channel action id was reused with another payload')
  }
  if (existing.state === 'completed') return validateActionResult(existing.result)
  throw new RpcMethodError(-32010, 'channel action outcome requires recovery; automatic resend is forbidden')
}

function actionIdentity(handshake, candidate) {
  const action = validateAction(candidate)
  if (action.target.gatewayInstanceId !== handshake.gatewayInstanceId) {
    throw new RpcMethodError(-32602, 'channel action targets another Gateway instance')
  }
  if (!ACTIONS.includes(action.kind)) throw new RpcMethodError(-32601, `channel action ${action.kind} is unsupported`)
  return {
    action,
    ledgerKey: digest(action.actionId),
    fingerprint: digest(JSON.stringify(action)),
  }
}

async function dispatchAction(api, hostConfig, media, action, gatewayInstanceId, signal) {
  const deliveryId = `delivery-${digest(`${gatewayInstanceId}\0${action.actionId}`)}`
  let dispatched = false
  try {
    signal.throwIfAborted()
    const adapter = await api.runtime.channel.outbound.loadAdapter(action.target.channel)
    signal.throwIfAborted()
    if (adapter === undefined) throw new RpcMethodError(-32601, `OpenClaw channel ${action.target.channel} has no outbound adapter`)
    const to = resolveTarget(adapter, hostConfig, action)
    let result
    if (action.kind === 'poll') {
      if (typeof adapter.sendPoll !== 'function') throw new RpcMethodError(-32601, `channel ${action.target.channel} does not support polls`)
      signal.throwIfAborted()
      dispatched = true
      result = await adapter.sendPoll({
        cfg: hostConfig,
        to,
        poll: {
          question: action.question,
          options: [...action.options],
          maxSelections: action.multiple ? action.options.length : 1,
        },
        accountId: action.target.account,
        threadId: action.target.thread,
      })
    } else {
      result = await dispatchSend(hostConfig, media, adapter, action, to, signal, () => { dispatched = true })
    }
    const messageId = requiredString(result?.messageId, 'OpenClaw platform message id')
    return {
      protocolVersion: 1,
      deliveryId,
      subject: { kind: 'action', actionId: action.actionId },
      attempt: 1,
      status: 'confirmed',
      platformMessageId: messageId,
    }
  } catch (error) {
    if (error instanceof RpcMethodError && error.code === -32601 && !dispatched) throw error
    return {
      protocolVersion: 1,
      deliveryId,
      subject: { kind: 'action', actionId: action.actionId },
      attempt: 1,
      status: dispatched || action.kind === 'poll' ? 'ambiguous' : 'dead-letter',
      error: {
        code: dispatched ? 'OPENCLAW_DELIVERY_AMBIGUOUS' : 'OPENCLAW_DELIVERY_FAILED',
        message: dispatched
          ? 'OpenClaw may have dispatched the platform request; automatic resend is disabled.'
          : 'OpenClaw rejected the platform request before dispatch.',
        retryable: false,
      },
    }
  }
}

async function dispatchSend(hostConfig, media, adapter, action, to, signal, markDispatched) {
  signal.throwIfAborted()
  const verified = await media.verifyReferences(action.media)
  signal.throwIfAborted()
  const root = await media.root()
  const allowed = new Map(verified.map(item => [item.absolutePath, item.bytes]))
  const readAuthorized = async path => {
    signal.throwIfAborted()
    const bytes = allowed.get(path)
    if (bytes === undefined) throw new Error('OpenClaw requested an unverified media path')
    return bytes
  }
  const common = {
    cfg: hostConfig,
    to,
    text: action.text,
    accountId: action.target.account,
    threadId: action.target.thread,
    replyToId: action.replyTo,
    replyToIdSource: action.replyTo === undefined ? undefined : 'explicit',
    mediaAccess: { localRoots: [root], readFile: readAuthorized },
    mediaLocalRoots: [root],
    mediaReadFile: readAuthorized,
    onPlatformSendDispatch: async () => { markDispatched() },
  }
  if (verified.length === 0) {
    if (typeof adapter.sendText !== 'function') throw new RpcMethodError(-32601, `channel ${action.target.channel} does not support text send`)
    signal.throwIfAborted()
    markDispatched()
    return await adapter.sendText(common)
  }
  if (verified.length === 1) {
    if (typeof adapter.sendMedia !== 'function') throw new RpcMethodError(-32601, `channel ${action.target.channel} does not support media send`)
    signal.throwIfAborted()
    markDispatched()
    return await adapter.sendMedia({ ...common, mediaUrl: verified[0].absolutePath })
  }
  if (typeof adapter.sendPayload !== 'function') {
    throw new RpcMethodError(-32601, `channel ${action.target.channel} does not support atomic multi-media send`)
  }
  signal.throwIfAborted()
  markDispatched()
  return await adapter.sendPayload({
    ...common,
    payload: {
      text: action.text,
      mediaUrls: verified.map(item => item.absolutePath),
      trustedLocalMedia: true,
      ...(action.replyTo === undefined ? {} : { replyToId: action.replyTo }),
    },
  })
}

function resolveTarget(adapter, config, action) {
  if (typeof adapter.resolveTarget !== 'function') return action.target.conversation
  const result = adapter.resolveTarget({
    cfg: config,
    to: action.target.conversation,
    accountId: action.target.account,
    mode: 'explicit',
  })
  if (!result?.ok) throw new RpcMethodError(-32602, 'OpenClaw rejected the channel destination')
  return requiredString(result.to, 'resolved OpenClaw destination')
}

async function inboundMedia(params, options, media) {
  const facts = Array.isArray(params.media) ? params.media : []
  if (options.generation === 'v1') {
    if ((Array.isArray(params.images) && params.images.length > 0) || facts.length > 0) {
      throw new Error('OpenClaw AgentHarness v1 does not expose safe staged inbound media facts')
    }
    return []
  }
  if (Array.isArray(params.images) && params.images.length > 0 && facts.length === 0) {
    throw new Error('OpenClaw did not materialize inbound images in the configured staging root')
  }
  return await media.importFacts(facts)
}

async function attemptFromTurnResult(params, envelope, result, media, transcript) {
  if (result.status === 'cancelled') return abortedAttempt(params)
  if (result.status === 'failed') {
    return await failedAttempt(params, envelope, new Error(`${result.error.code}: ${result.error.message}`), transcript)
  }
  let text = result.status === 'silent' ? SILENT_MARKER : result.text
  let verified = []
  if (result.status === 'completed') verified = await media.verifyReferences(result.media)
  if (text.length === 0) text = SILENT_MARKER
  const assistant = assistantMessage(params, text)
  const user = userMessage(params, envelope)
  let assistantOwned = false
  if (transcript !== undefined) {
    try {
      const mirrored = await transcript.mirror({
        params,
        userMessage: user,
        assistantMessage: assistant,
        userIdempotencyKey: `clawdsh:${envelope.idempotencyKey}:user`,
        assistantIdempotencyKey: `clawdsh:${result.replayId}:assistant`,
      })
      assistantOwned = mirrored.assistantOwned
      params.userTurnTranscriptRecorder?.markRuntimePersisted?.(user)
    } catch (_transcriptMirrorFailed) {
      // OpenClaw remains transcript owner when the optional bridge mirror fails.
    }
  }
  return baseAttemptResult(params, {
    assistant,
    user,
    assistantOwned,
    usage: result.usage,
    media: verified,
  })
}

async function failedAttempt(params, envelope, _error, transcript) {
  const assistant = assistantMessage(params, PUBLIC_BRIDGE_FAILURE)
  const user = envelope?.route === undefined ? undefined : userMessage(params, envelope)
  let assistantOwned = false
  if (transcript !== undefined && user !== undefined) {
    try {
      const mirrored = await transcript.mirror({
        params,
        userMessage: user,
        assistantMessage: assistant,
        userIdempotencyKey: `clawdsh:${envelope.idempotencyKey}:user`,
        assistantIdempotencyKey: `clawdsh:${envelope.idempotencyKey}:failure`,
      })
      assistantOwned = mirrored.assistantOwned
    } catch (_transcriptMirrorFailed) {
      // OpenClaw remains transcript owner when the optional bridge mirror fails.
    }
  }
  return baseAttemptResult(params, { assistant, user, assistantOwned, media: [] })
}

function abortedAttempt(params) {
  return {
    ...baseAttemptFields(params),
    aborted: true,
    externalAbort: true,
    messagesSnapshot: [],
    assistantTexts: [],
    toolMetas: [],
    lastAssistant: undefined,
    currentAttemptAssistant: undefined,
  }
}

function baseAttemptResult(params, input) {
  const mediaPaths = input.media.map(item => item.absolutePath)
  return {
    ...baseAttemptFields(params),
    aborted: false,
    externalAbort: false,
    ...(input.assistantOwned ? { assistantTranscriptOwned: true } : {}),
    messagesSnapshot: input.user === undefined ? [input.assistant] : [input.user, input.assistant],
    assistantTexts: [input.assistant.content[0].text],
    toolMetas: [],
    lastAssistant: input.assistant,
    currentAttemptAssistant: input.assistant,
    ...(mediaPaths.length === 0 ? {} : {
      toolMediaUrls: mediaPaths,
      toolTrustedLocalMedia: true,
    }),
    ...(input.usage === undefined ? {} : { attemptUsage: normalizedUsage(input.usage) }),
  }
}

function baseAttemptFields(params) {
  return {
    timedOut: false,
    idleTimedOut: false,
    timedOutDuringCompaction: false,
    promptError: undefined,
    promptErrorSource: null,
    sessionIdUsed: params.sessionId,
    sessionFileUsed: params.sessionFile,
    didSendViaMessagingTool: false,
    messagingToolSentTexts: [],
    messagingToolSentMediaUrls: [],
    messagingToolSentTargets: [],
    cloudCodeAssistFormatError: false,
    replayMetadata: { hadPotentialSideEffects: false, replaySafe: true },
    itemLifecycle: { startedCount: 0, completedCount: 0, activeCount: 0 },
  }
}

function assistantMessage(params, text) {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: params.model?.api ?? 'openai-responses',
    provider: params.provider,
    model: params.modelId,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  }
}

function userMessage(params, envelope) {
  const recorded = params.userTurnTranscriptRecorder?.message
  if (recorded?.role === 'user') return recorded
  return {
    role: 'user',
    content: envelope.text,
    timestamp: Date.now(),
    sourceChannel: envelope.route.channel,
    senderId: envelope.sender.senderId,
  }
}

async function projectProgress(params, notification) {
  if (notification.kind === 'text.delta') {
    await params.onPartialReply?.({ text: notification.text, delta: notification.text })
    return
  }
  if (notification.kind === 'reasoning.delta') {
    await params.onReasoningStream?.({ text: notification.text, isReasoning: true })
    return
  }
  if (notification.kind === 'tool') {
    await params.onAgentEvent?.({
      stream: 'tool',
      data: {
        toolCallId: notification.toolCallId,
        name: notification.name,
        phase: notification.phase,
        ...(notification.summary === undefined ? {} : { summary: notification.summary }),
      },
      sessionKey: params.sessionKey,
    })
    return
  }
  await params.onAgentEvent?.({
    stream: 'status',
    data: { status: notification.status },
    sessionKey: params.sessionKey,
  })
}

function localHealth(handshake, status) {
  return validateHealth({
    protocolVersion: 1,
    status,
    checkedAt: new Date().toISOString(),
    handshake,
    accounts: [],
    diagnostics: [],
  })
}

function normalizedUsage(usage) {
  const input = usage.inputTokens
  const output = usage.outputTokens
  const cacheRead = usage.cacheReadTokens ?? 0
  const cacheWrite = usage.cacheWriteTokens ?? 0
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

function principalFor(params, routeKind) {
  const senderId = params.senderId ?? params.channelContext?.sender?.id
  if (!nonEmpty(senderId)) {
    if (params.senderIsOwner === true) {
      return {
        senderId: 'openclaw-owner',
        trust: routeKind === 'group' ? 'group-allowlisted' : 'owner',
      }
    }
    throw new Error('OpenClaw did not provide an admitted sender identity')
  }
  const displayName = params.senderName ?? params.senderUsername
  return {
    senderId,
    ...(nonEmpty(displayName) ? { displayName } : {}),
    // V1 proves that OpenClaw admitted this DM, but does not expose whether pairing or an allowlist did so.
    trust: routeKind === 'group' ? 'group-allowlisted' : params.senderIsOwner === true ? 'owner' : 'admitted',
  }
}

function mentionProjection(params) {
  const value = params.wasMentioned
    ?? params.channelContext?.chat?.wasMentioned
    ?? params.channelContext?.sender?.wasMentioned
  return typeof value === 'boolean' ? { wasMentioned: value } : {}
}

function replyProjection(params) {
  const replyTo = params.replyToId ?? params.channelContext?.chat?.replyToId
  return nonEmpty(replyTo) ? { replyTo: { messageId: replyTo } } : {}
}

function threadProjection(params) {
  const thread = params.messageThreadId ?? params.currentThreadTs
  return thread === undefined || thread === null || String(thread).length === 0 ? {} : { thread: String(thread) }
}

function promptText(params) {
  const text = params.transcriptPrompt ?? params.prompt
  return typeof text === 'string' ? text : ''
}

function routeKey(route) {
  return JSON.stringify([
    route.gatewayInstanceId,
    route.openclawSessionKey,
    route.generation,
    route.channel,
    route.account,
    route.conversation,
    route.thread ?? null,
    route.kind,
  ])
}

function positiveAttemptTimeout(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : 1
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

function required(env, name) {
  return requiredString(env[name], name)
}

function positiveEnv(env, name) {
  const value = Number(required(env, name))
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`)
  return value
}

function positiveConfig(value, name) {
  const resolved = value ?? BRIDGE_CONFIG_DEFAULTS[name]
  if (!Number.isSafeInteger(resolved) || resolved <= 0) throw new Error(`${name} must be a positive safe integer`)
  return resolved
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) throw new Error(`${label} is required`)
  return value
}

function nonEmpty(value) {
  return typeof value === 'string' && value.length > 0
}
