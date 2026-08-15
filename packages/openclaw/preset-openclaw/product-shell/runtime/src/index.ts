/** ClawDSH product-shell Host routes and loopback-only read control plane. */

import { accessSync, constants } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context, FiberState } from '@deepseek-ai/cordis'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { isJsExpr, type Entry } from '@deepseek-ai/cordis-plugin-loader'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { AgentPresets } from '@deepseek-ai/dsh-agent-presets'
import { serveStatic } from '@deepseek-ai/dsh-host-frontend-static'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { load } from 'js-yaml'
import {
  CLAWDSH_PROTOCOL_VERSION,
  CLAWDSH_RPC_CHANNEL,
  CLAWDSH_RPC_ENDPOINTS,
  parseClawdshBootstrapResponse,
  parseClawdshCapabilitiesResponse,
  parseClawdshReadRequest,
  type ClawdshBootstrapResponse,
  type ClawdshCapabilitiesResponse,
  type ClawdshCapability,
  type ClawdshCapabilityComponent,
  type ClawdshFiberPhase,
  type ClawdshLoaderEntry,
  type ClawdshLoaderState,
  type ClawdshPluginOrigin,
} from '../../shared/src/protocol.ts'
import { PRODUCTION_CHANNEL_CATALOG } from './production-channel-catalog.ts'
import { ClawdshActivityControl } from './activity-control.ts'
import { ClawdshSettingsControl } from './settings-control.ts'

/** Stable Cordis plugin name. */
export const name = 'clawdsh-product-runtime'

/** Services required by the static routes, Loader projection, and RPC registration. */
export const inject = ['webServer', 'connection', 'loader', 'agentPresets', 'settings', 'credentials']

const PRODUCT_PREFIX = '/clawdsh'
const PRODUCT_ROOT = '/clawdsh/'
const LOOPBACK_HOST = '127.0.0.1'
const COMMUNICATION_PLANE_ID = 'clawdsh-communication-plane'

const FIBER_STATE = {
  PENDING: 0 as FiberState.PENDING,
  LOADING: 1 as FiberState.LOADING,
  ACTIVE: 2 as FiberState.ACTIVE,
  FAILED: 3 as FiberState.FAILED,
  DISPOSED: 4 as FiberState.DISPOSED,
  UNLOADING: 5 as FiberState.UNLOADING,
} as const

const FIBER_PHASE = {
  [FIBER_STATE.PENDING]: 'pending',
  [FIBER_STATE.LOADING]: 'loading',
  [FIBER_STATE.ACTIVE]: 'active',
  [FIBER_STATE.FAILED]: 'failed',
  [FIBER_STATE.DISPOSED]: null,
  [FIBER_STATE.UNLOADING]: 'unloading',
} as const satisfies Record<FiberState, ClawdshFiberPhase>

const FIBER_LOADER_STATE = {
  [FIBER_STATE.PENDING]: 'starting',
  [FIBER_STATE.LOADING]: 'starting',
  [FIBER_STATE.ACTIVE]: 'active',
  [FIBER_STATE.FAILED]: 'failed',
  [FIBER_STATE.DISPOSED]: 'misconfigured',
  [FIBER_STATE.UNLOADING]: 'starting',
} as const satisfies Record<FiberState, ClawdshLoaderState>

interface ComponentDefinition {
  readonly id: string
  readonly label: string
  readonly packages: readonly string[]
  readonly required: boolean
  readonly stateSource?: 'preset'
}

interface CapabilityDefinition {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly dependencies: readonly string[]
  readonly effectTime: ClawdshCapability['effectTime']
  readonly required: boolean
  readonly stateComponentId: string
  readonly components: readonly ComponentDefinition[]
  readonly channels?: typeof PRODUCTION_CHANNEL_CATALOG
}

const CAPABILITY_DEFINITIONS: readonly CapabilityDefinition[] = [
  {
    id: 'soul',
    label: 'Soul',
    description: 'Contributes the ClawDSH identity and behavior rules to each new Session.',
    dependencies: [],
    effectTime: 'new-session',
    required: false,
    stateComponentId: 'soul',
    components: [
      {
        id: 'soul',
        label: 'Soul',
        packages: ['@clawdsh/dsh-soul'],
        required: false,
        stateSource: 'preset',
      },
    ],
  },
  {
    id: 'channels',
    label: 'Channels',
    description: 'Routes social messages through the locked OpenClaw Gateway sidecar.',
    dependencies: ['Channel Protocol', 'Agent Bridge'],
    effectTime: 'restart',
    required: false,
    stateComponentId: 'openclaw-gateway-provider',
    components: [
      {
        id: 'channel-protocol',
        label: 'Channel Protocol',
        packages: ['@clawdsh/dsh-channel'],
        required: true,
      },
      {
        id: 'agent-bridge',
        label: 'Agent Bridge',
        packages: ['@clawdsh/dsh-channel-agent'],
        required: true,
      },
      {
        id: 'openclaw-gateway-provider',
        label: 'OpenClaw Gateway Provider',
        packages: ['@clawdsh/dsh-channel-openclaw'],
        required: false,
      },
    ],
    channels: PRODUCTION_CHANNEL_CATALOG,
  },
  {
    id: 'memory',
    label: 'Memory',
    description: 'Stores durable personal memory and performs semantic recall with Ark Embeddings.',
    dependencies: ['Ark Embeddings'],
    effectTime: 'restart',
    required: false,
    stateComponentId: 'memory',
    components: [
      { id: 'memory', label: 'Memory', packages: ['@clawdsh/dsh-memory'], required: false },
      {
        id: 'ark-embeddings',
        label: 'Ark Embeddings',
        packages: ['@clawdsh/dsh-embeddings-ark'],
        required: true,
      },
    ],
  },
  {
    id: 'skills',
    label: 'Skills Hub',
    description: 'Discovers and governs ClawHub-compatible Skills.',
    dependencies: [],
    effectTime: 'restart',
    required: false,
    stateComponentId: 'skills-hub',
    components: [
      {
        id: 'skills-hub',
        label: 'Skills Hub',
        packages: ['@clawdsh/dsh-skills-hub'],
        required: false,
      },
    ],
  },
  {
    id: 'automation',
    label: 'Automation',
    description: 'Runs personal-assistant tasks from explicit schedules and rules.',
    dependencies: [],
    effectTime: 'restart',
    required: false,
    stateComponentId: 'automation',
    components: [
      {
        id: 'automation',
        label: 'Automation',
        packages: ['@clawdsh/dsh-automation'],
        required: false,
      },
    ],
  },
  {
    id: 'activity',
    label: 'Activity',
    description: 'Projects privacy-preserving semantic activity for the current Session.',
    dependencies: [],
    effectTime: 'restart',
    required: true,
    stateComponentId: 'activity',
    components: [
      {
        id: 'activity',
        label: 'Activity',
        packages: ['@clawdsh/dsh-activity'],
        required: true,
      },
    ],
  },
] as const

const BOOTSTRAP_RESPONSE: ClawdshBootstrapResponse = {
  version: CLAWDSH_PROTOCOL_VERSION,
  product: { id: 'clawdsh', name: 'ClawDSH', modeLabel: 'ClawDSH 模式' },
  controlMode: 'local-read-write',
  localControlOnly: true,
  runtimeState: 'starting',
  routes: {
    conversation: '/clawdsh/',
    settings: '/clawdsh/settings',
    activity: '/clawdsh/activity',
    harnessAdvanced: '/',
  },
}

interface AssetPathResult {
  readonly ok: boolean
  readonly path?: string
  readonly status?: 400 | 403
}

interface ProductRuntimeState {
  evidence?: StartupEvidence
}

function resolveDistIndex(): string {
  const distIndex = fileURLToPath(new URL('../web/index.html', import.meta.url))
  try {
    accessSync(distIndex, constants.R_OK)
  } catch {
    throw new Error(
      'clawdsh-product-runtime: browser assets are not built; '
      + 'run pnpm --dir packages/openclaw/preset-openclaw/product-shell run build',
    )
  }
  return distIndex
}

function pluginOrigin(moduleName: string): ClawdshPluginOrigin {
  if (moduleName.startsWith('@clawdsh/')) return 'clawdsh'
  if (moduleName.startsWith('@deepseek-ai/') || moduleName.startsWith('cordis:')) return 'platform'
  return 'community'
}

function loaderEntry(entry: Entry): ClawdshLoaderEntry {
  const enabled = !entry.disabled
  const fiberState = entry.fiber?.state
  return {
    entryId: entry.id,
    localId: entry.options.id,
    moduleName: entry.options.name,
    enabled,
    fiberPhase: fiberState === undefined ? null : FIBER_PHASE[fiberState],
    state: enabled
      ? fiberState === undefined ? 'misconfigured' : FIBER_LOADER_STATE[fiberState]
      : 'disabled',
    source: pluginOrigin(entry.options.name),
  }
}

function loaderInventory(entries: Iterable<Entry>): readonly ClawdshLoaderEntry[] {
  return [...entries]
    .filter(entry => !entry.options.group)
    .map(loaderEntry)
}

function componentView(
  definition: ComponentDefinition,
  inventory: readonly ClawdshLoaderEntry[],
  evidence: ProductEvidence,
  disabledByParent: boolean,
): ClawdshCapabilityComponent {
  if (definition.stateSource === 'preset') {
    const state = evidence.enabled.soul === undefined
      ? 'misconfigured'
      : evidence.enabled.soul ? evidence.soulPreset : 'disabled'
    return {
      ...definition,
      stateSource: 'preset',
      loaderEntries: [],
      state,
    }
  }
  const loaderEntries = inventory.filter(entry => definition.packages.includes(entry.moduleName))
  const activeEntries = loaderEntries.filter(entry => entry.enabled)
  let state: ClawdshLoaderState
  if (loaderEntries.length === 0) {
    state = disabledByParent ? 'disabled' : definition.required ? 'misconfigured' : 'disabled'
  }
  else if (activeEntries.length === 0) state = 'disabled'
  else if (activeEntries.some(entry => entry.state === 'failed')) state = 'failed'
  else if (activeEntries.some(entry => entry.state === 'misconfigured')) state = 'misconfigured'
  else if (activeEntries.every(entry => entry.state === 'active')) state = 'active'
  else state = 'starting'
  if (state === 'active') {
    const enabled = definition.id === 'memory'
      ? evidence.enabled.memory
      : definition.id === 'skills-hub'
        ? evidence.enabled.skills
        : definition.id === 'automation'
          ? evidence.enabled.automation
          : definition.id === 'activity'
            ? evidence.enabled.activity
            : undefined
    if (definition.id === 'openclaw-gateway-provider') state = evidence.openClawGateway
    else if (enabled !== undefined) state = enabled ? 'active' : 'disabled'
    else if (definition.id === 'memory'
      || definition.id === 'skills-hub'
      || definition.id === 'automation'
      || definition.id === 'activity') state = 'misconfigured'
  }
  return { ...definition, stateSource: 'loader', loaderEntries, state }
}

interface ProductEvidence {
  readonly soulPreset: ClawdshLoaderState
  readonly channelPlane: ClawdshLoaderState
  readonly openClawGateway: ClawdshLoaderState
  readonly enabled: RuntimeEnablement
}

interface StartupEvidence {
  readonly soulPreset: ClawdshLoaderState
  readonly enabled: RuntimeEnablement
}

interface RuntimeEnablement {
  readonly soul: boolean | undefined
  readonly memory: boolean | undefined
  readonly skills: boolean | undefined
  readonly automation: boolean | undefined
  readonly activity: boolean | undefined
}

const DEFAULT_RUNTIME_ENABLEMENT: RuntimeEnablement = {
  soul: true,
  memory: true,
  skills: true,
  automation: false,
  activity: true,
}

interface OpenClawControlSnapshot {
  readonly enabled: boolean
  readonly state: 'disabled' | 'starting' | 'active' | 'failed'
}

interface OpenClawControl {
  readonly snapshot: () => OpenClawControlSnapshot | Promise<OpenClawControlSnapshot>
}

interface CompositionRow {
  readonly id?: unknown
  readonly name?: unknown
  readonly disabled?: unknown
  readonly group?: unknown
  readonly config?: unknown
}

function containsManagedSoul(rows: unknown): boolean {
  if (!Array.isArray(rows)) return false
  return rows.some((candidate: unknown) => {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return false
    const row = candidate as CompositionRow
    if (row.id === 'soul'
      && row.name === '@clawdsh/dsh-soul'
      && !Object.hasOwn(row, 'disabled')) return true
    return row.group === true && containsManagedSoul(row.config)
  })
}

function hasManagedSoul(composition: string): boolean {
  try {
    return containsManagedSoul(load(composition, { schema: entryListSchema }))
  } catch {
    return false
  }
}

function communicationPlaneState(entries: readonly Entry[]): ClawdshLoaderState {
  const group = entries.find(entry => entry.options.id === COMMUNICATION_PLANE_ID && entry.options.group)
  if (group === undefined) return 'misconfigured'
  try {
    const configuredDisabled = isJsExpr(group.options.disabled)
      ? Boolean(group.evaluate(group.options.disabled.__jsExpr))
      : Boolean(group.options.disabled)
    return configuredDisabled ? 'disabled' : loaderEntry(group).state
  } catch {
    return 'misconfigured'
  }
}

async function openClawGatewayState(ctx: Context): Promise<ClawdshLoaderState> {
  const control = ctx.get('clawdshOpenClawControl') as OpenClawControl | undefined
  if (control === undefined || typeof control.snapshot !== 'function') return 'misconfigured'
  try {
    const snapshot: unknown = await control.snapshot()
    if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) return 'misconfigured'
    const enabled = (snapshot as Record<string, unknown>)['enabled']
    const state = (snapshot as Record<string, unknown>)['state']
    if (enabled === false && state === 'disabled') return 'disabled'
    if (enabled === true && state === 'starting') return 'starting'
    if (enabled === true && state === 'active') return 'active'
    if (enabled === true && state === 'failed') return 'failed'
    return 'misconfigured'
  } catch {
    return 'misconfigured'
  }
}

async function startupEvidence(
  ctx: Context,
  settingsControl: ClawdshSettingsControl,
): Promise<StartupEvidence> {
  const enabled: RuntimeEnablement = {
    soul: settingsControl.runtimeEnabled('clawdsh-soul'),
    memory: settingsControl.runtimeEnabled('clawdsh-memory'),
    skills: settingsControl.runtimeEnabled('clawdsh-skills-hub'),
    automation: settingsControl.runtimeEnabled('clawdsh-automation'),
    activity: settingsControl.runtimeEnabled('clawdsh-activity'),
  }
  const presets = ctx.get('agentPresets') as AgentPresets | undefined
  const common = { enabled }
  if (presets === undefined) return { ...common, soulPreset: 'misconfigured' }
  if (presets.defaultId !== 'clawdsh') return { ...common, soulPreset: 'disabled' }
  try {
    const preset = await presets.resolve('clawdsh')
    if (preset.broken !== undefined) return { ...common, soulPreset: 'misconfigured' }
    if (!hasManagedSoul(await presets.read('clawdsh'))) {
      return { ...common, soulPreset: 'misconfigured' }
    }
    await presets.standingKeyFor('clawdsh')
    return { ...common, soulPreset: 'active' }
  } catch {
    return { ...common, soulPreset: 'failed' }
  }
}

function aggregateCapabilityState(
  definition: CapabilityDefinition,
  components: readonly ClawdshCapabilityComponent[],
): ClawdshLoaderState {
  const state = components.find(component => component.id === definition.stateComponentId)?.state
  if (state === undefined) throw new Error(`ClawDSH capability ${definition.id} has no state component`)
  if (definition.id === 'memory' && state === 'disabled') return 'disabled'
  const required = components.filter(component => component.required)
  if (required.some(component => component.state === 'failed')) return 'failed'
  if (required.some(component => component.state === 'misconfigured' || component.state === 'disabled')) {
    return 'misconfigured'
  }
  if (required.some(component => component.state === 'starting')) return 'starting'
  return state
}

function capabilityView(
  definition: CapabilityDefinition,
  inventory: readonly ClawdshLoaderEntry[],
  evidence: ProductEvidence,
): ClawdshCapability {
  const disabledByParent = definition.id === 'channels' && evidence.channelPlane === 'disabled'
  const components = definition.components.map(component => (
    componentView(component, inventory, evidence, disabledByParent)
  ))
  const state = definition.id === 'channels' && evidence.channelPlane !== 'active'
    ? evidence.channelPlane
    : aggregateCapabilityState(definition, components)
  const common = {
    id: definition.id,
    label: definition.label,
    description: definition.description,
    dependencies: definition.dependencies,
    effectTime: definition.effectTime,
    required: definition.required,
    state,
    components,
  }
  return definition.channels === undefined ? common : { ...common, channels: definition.channels }
}

function capabilitiesResponse(
  entries: Iterable<Entry>,
  soulPreset: ClawdshLoaderState,
  openClawGateway: ClawdshLoaderState = 'misconfigured',
  enabled: RuntimeEnablement = DEFAULT_RUNTIME_ENABLEMENT,
): ClawdshCapabilitiesResponse {
  const allEntries = [...entries]
  const inventory = loaderInventory(allEntries)
  const evidence: ProductEvidence = {
    soulPreset,
    channelPlane: communicationPlaneState(allEntries),
    openClawGateway,
    enabled,
  }
  return jsonBoundary({
    version: CLAWDSH_PROTOCOL_VERSION,
    readOnly: true,
    capabilities: CAPABILITY_DEFINITIONS.map(definition => capabilityView(definition, inventory, evidence)),
    loaderInventory: inventory,
  }, parseClawdshCapabilitiesResponse)
}

function bootstrapResponse(runtimeState: ClawdshBootstrapResponse['runtimeState'] = 'starting'): ClawdshBootstrapResponse {
  return jsonBoundary({ ...BOOTSTRAP_RESPONSE, runtimeState }, parseClawdshBootstrapResponse)
}

function jsonBoundary<T>(value: T, parse: (candidate: unknown) => T): T {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new TypeError('ClawDSH RPC response is not JSON serializable')
  return parse(JSON.parse(encoded) as unknown)
}

function badRequest(message: string): RpcResult<never> {
  return { ok: false, error: { code: 'bad-request', message, details: { issues: [] } } }
}

function starting(): RpcResult<never> {
  return {
    ok: false,
    error: {
      code: 'internal',
      message: 'ClawDSH control is starting; retry shortly',
      details: {},
    },
  }
}

function assetPath(rawUrl: string | undefined): AssetPathResult {
  const pathname = new URL(rawUrl ?? PRODUCT_ROOT, 'http://clawdsh.invalid').pathname
  if (!pathname.startsWith(PRODUCT_ROOT)) return { ok: false, status: 400 }
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname.slice(PRODUCT_ROOT.length))
  } catch {
    return { ok: false, status: 400 }
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return { ok: false, status: 403 }
  if (decoded.split('/').some(segment => segment === '..')) return { ok: false, status: 403 }
  return { ok: true, path: `/${decoded}` }
}

function registerProductRoutes(ctx: Context, distIndex: string): void {
  const distRoot = dirname(distIndex)
  const renderIndex = async (): Promise<string> =>
    ctx.webServer.applyIndexTaps(await readFile(distIndex, 'utf8'))
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PRODUCT_PREFIX,
    handler: (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405)
        res.end()
        return
      }
      const search = new URL(req.url ?? PRODUCT_PREFIX, 'http://clawdsh.invalid').search
      res.writeHead(308, { location: `${PRODUCT_ROOT}${search}` })
      res.end()
    },
  }), 'clawdsh-product-runtime: /clawdsh redirect')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: PRODUCT_PREFIX,
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405)
        res.end()
        return
      }
      const resolved = assetPath(req.url)
      if (!resolved.ok) {
        res.writeHead(resolved.status ?? 400)
        res.end()
        return
      }
      await serveStatic(resolved.path ?? '/', res, distRoot, distIndex, renderIndex)
    },
  }), 'clawdsh-product-runtime: /clawdsh static routes')
}

function registerRpc(
  ctx: Context,
  settingsControl: ClawdshSettingsControl,
  activityControl: ClawdshActivityControl,
  runtimeState: ProductRuntimeState,
): void {
  ctx.connection.rpc.handle(CLAWDSH_RPC_CHANNEL, async (endpoint, payload, signal) => {
    if (endpoint === CLAWDSH_RPC_ENDPOINTS.bootstrapGet
      || endpoint === CLAWDSH_RPC_ENDPOINTS.capabilitiesList) {
      try {
        parseClawdshReadRequest(payload)
      } catch {
        return badRequest('invalid ClawDSH protocol v1 request')
      }
      if (endpoint === CLAWDSH_RPC_ENDPOINTS.bootstrapGet) {
        return {
          ok: true,
          value: bootstrapResponse(settingsControl.isReady() ? 'ready' : 'starting'),
        }
      }
      if (!settingsControl.isReady() || runtimeState.evidence === undefined) return starting()
      const entries = [...ctx.loader.entries()]
      const evidence = runtimeState.evidence
      const enabled: RuntimeEnablement = {
        ...evidence.enabled,
        soul: settingsControl.desiredEnabled('clawdsh-soul'),
      }
      return {
        ok: true,
        value: capabilitiesResponse(
          entries,
          evidence.soulPreset,
          await openClawGatewayState(ctx),
          enabled,
        ),
      }
    }
    if (endpoint === CLAWDSH_RPC_ENDPOINTS.activityList) {
      if (!settingsControl.isReady()) return starting()
      return activityControl.handle(payload, signal)
    }
    const controlled = await settingsControl.handle(endpoint, payload)
    if (controlled !== undefined) return controlled
    return badRequest('unsupported ClawDSH protocol v1 endpoint')
  }, { authority: 'loopback' })
}

function scheduleReadyLine(
  ctx: Context,
  settingsControl: ClawdshSettingsControl,
  runtimeState: ProductRuntimeState,
): void {
  let live = true
  ctx.effect(() => () => { live = false }, 'clawdsh-product-runtime: readiness guard')
  void Promise.resolve()
    .then(() => ctx.loader.await())
    .then(async () => {
      if (!settingsControl.captureRuntime()) return
      const evidence = await startupEvidence(ctx, settingsControl)
      if (!live || ctx.get('webServer') === undefined) return
      runtimeState.evidence = evidence
      settingsControl.markReady()
      console.log(`clawdsh web: http://${LOOPBACK_HOST}:${String(ctx.webServer.port)}${PRODUCT_ROOT}`)
    })
    .catch(() => {
      // Loader owns the activation failure; product readiness remains silent.
    })
}

/**
 * Mount the product routes and loopback read control plane.
 * @param ctx - Host context carrying WebServer, Connection, and Loader.
 */
export function apply(ctx: Context): void {
  const distIndex = internals.resolveDistIndex()
  const settingsControl = new ClawdshSettingsControl(ctx)
  const activityControl = new ClawdshActivityControl(ctx)
  const runtimeState: ProductRuntimeState = {}
  registerProductRoutes(ctx, distIndex)
  registerRpc(ctx, settingsControl, activityControl, runtimeState)
  scheduleReadyLine(ctx, settingsControl, runtimeState)
}

/** Narrow test seams for filesystem location and pure response projections. */
export const internals = {
  resolveDistIndex,
  assetPath,
  bootstrapResponse,
  capabilitiesResponse,
  hasManagedSoul,
  openClawGatewayState,
  pluginOrigin,
  registerProductRoutes,
}
