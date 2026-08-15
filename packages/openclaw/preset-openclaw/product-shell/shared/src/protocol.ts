/** ClawDSH product-control RPC protocol shared by the Host runtime and browser shell. */

/** Frozen wire-protocol version. */
export const CLAWDSH_PROTOCOL_VERSION = 1 as const

/** Loopback-only Connection RPC channel. */
export const CLAWDSH_RPC_CHANNEL = '/clawdsh-rpc' as const

/** Stable v1 endpoint names. */
export const CLAWDSH_RPC_ENDPOINTS = {
  bootstrapGet: 'bootstrap/get',
  capabilitiesList: 'capabilities/list',
} as const

/** Endpoint accepted by the read-only v1 control runtime. */
export type ClawdshRpcEndpoint = typeof CLAWDSH_RPC_ENDPOINTS[keyof typeof CLAWDSH_RPC_ENDPOINTS]

/** Every v1 request carries only its protocol version until an endpoint adds fields. */
export interface ClawdshReadRequest {
  readonly version: typeof CLAWDSH_PROTOCOL_VERSION
}

/** Stable product routes returned at bootstrap. */
export interface ClawdshProductRoutes {
  readonly conversation: '/clawdsh/'
  readonly settings: '/clawdsh/settings'
  readonly activity: '/clawdsh/activity'
  readonly harnessAdvanced: '/'
}

/** Initial product identity and route response. */
export interface ClawdshBootstrapResponse {
  readonly version: typeof CLAWDSH_PROTOCOL_VERSION
  readonly product: {
    readonly id: 'clawdsh'
    readonly name: 'ClawDSH'
    readonly modeLabel: 'ClawDSH 模式'
  }
  readonly readOnly: true
  readonly localControlOnly: true
  readonly routes: ClawdshProductRoutes
}

/** Product provenance independent from Loader placement. */
export type ClawdshPluginOrigin = 'clawdsh' | 'platform' | 'community'

/** Fiber lifecycle projected without returning a live Cordis object. */
export type ClawdshFiberPhase = 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null

/** User-facing Loader composition state. */
export type ClawdshLoaderState = 'disabled' | 'starting' | 'active' | 'failed' | 'misconfigured'

/** Evidence level for a channel in the locked production catalog. */
export type ClawdshSupportState = 'cataloged' | 'installable' | 'certified' | 'enabled'

/** One JSON-only Loader row. */
export interface ClawdshLoaderEntry {
  readonly entryId: string
  readonly localId: string
  readonly moduleName: string
  readonly enabled: boolean
  readonly fiberPhase: ClawdshFiberPhase
  readonly state: ClawdshLoaderState
  readonly source: ClawdshPluginOrigin
}

/** When a desired setting takes effect. */
export type ClawdshEffectTime = 'live' | 'new-session' | 'next-call' | 'restart'

/** One implementation unit inside a product capability. */
export interface ClawdshCapabilityComponent {
  readonly id: string
  readonly label: string
  readonly packages: readonly string[]
  readonly required: boolean
  readonly stateSource: 'loader' | 'preset'
  readonly loaderEntries: readonly ClawdshLoaderEntry[]
  readonly state: ClawdshLoaderState
}

/** One entry from the exact locked OpenClaw production channel catalog. */
export interface ClawdshChannelCatalogEntry {
  readonly id: string
  readonly label: string
  readonly provenance: 'core' | 'bundled' | 'repo-official' | 'external'
  readonly support: ClawdshSupportState
}

/** Product capability with explicit dependencies and runtime evidence. */
export interface ClawdshCapability {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly dependencies: readonly string[]
  readonly effectTime: ClawdshEffectTime
  readonly required: boolean
  readonly state: ClawdshLoaderState
  readonly components: readonly ClawdshCapabilityComponent[]
  readonly channels?: readonly ClawdshChannelCatalogEntry[]
}

/** Read-only capability and Loader projection. */
export interface ClawdshCapabilitiesResponse {
  readonly version: typeof CLAWDSH_PROTOCOL_VERSION
  readonly readOnly: true
  readonly capabilities: readonly ClawdshCapability[]
  readonly loaderInventory: readonly ClawdshLoaderEntry[]
}

/** Exact v1 request value. */
export const CLAWDSH_READ_REQUEST: ClawdshReadRequest = { version: CLAWDSH_PROTOCOL_VERSION }

/** Parse and reject unknown request fields at the Host wire boundary. */
export function parseClawdshReadRequest(value: unknown): ClawdshReadRequest {
  const record = exactRecord(value, ['version'], 'request')
  if (record.version !== CLAWDSH_PROTOCOL_VERSION) {
    throw new TypeError('request.version must be 1')
  }
  return CLAWDSH_READ_REQUEST
}

/** Validate bootstrap data received by the browser. */
export function parseClawdshBootstrapResponse(value: unknown): ClawdshBootstrapResponse {
  const record = exactRecord(
    value,
    ['version', 'product', 'readOnly', 'localControlOnly', 'routes'],
    'bootstrap response',
  )
  if (record.version !== 1 || record.readOnly !== true || record.localControlOnly !== true) {
    throw new TypeError('bootstrap response has invalid protocol flags')
  }
  const product = exactRecord(record.product, ['id', 'name', 'modeLabel'], 'bootstrap product')
  if (product.id !== 'clawdsh' || product.name !== 'ClawDSH' || product.modeLabel !== 'ClawDSH 模式') {
    throw new TypeError('bootstrap response has invalid product identity')
  }
  const routes = exactRecord(
    record.routes,
    ['conversation', 'settings', 'activity', 'harnessAdvanced'],
    'bootstrap routes',
  )
  if (routes.conversation !== '/clawdsh/'
    || routes.settings !== '/clawdsh/settings'
    || routes.activity !== '/clawdsh/activity'
    || routes.harnessAdvanced !== '/') {
    throw new TypeError('bootstrap response has invalid product routes')
  }
  return value as ClawdshBootstrapResponse
}

/** Validate capability data received by the browser. */
export function parseClawdshCapabilitiesResponse(value: unknown): ClawdshCapabilitiesResponse {
  const record = exactRecord(
    value,
    ['version', 'readOnly', 'capabilities', 'loaderInventory'],
    'capabilities response',
  )
  if (record.version !== 1 || record.readOnly !== true) {
    throw new TypeError('capabilities response has invalid protocol flags')
  }
  if (!Array.isArray(record.loaderInventory) || !Array.isArray(record.capabilities)) {
    throw new TypeError('capabilities response arrays are required')
  }
  for (const entry of record.loaderInventory) parseLoaderEntry(entry)
  for (const capability of record.capabilities) parseCapability(capability)
  return value as ClawdshCapabilitiesResponse
}

function parseCapability(value: unknown): void {
  const record = exactRecord(
    value,
    ['id', 'label', 'description', 'dependencies', 'effectTime', 'required', 'state', 'components', 'channels'],
    'capability',
    ['channels'],
  )
  stringField(record.id, 'capability.id')
  stringField(record.label, 'capability.label')
  stringField(record.description, 'capability.description')
  stringArray(record.dependencies, 'capability.dependencies')
  enumField(record.effectTime, ['live', 'new-session', 'next-call', 'restart'], 'capability.effectTime')
  booleanField(record.required, 'capability.required')
  loaderState(record.state, 'capability.state')
  if (!Array.isArray(record.components)) throw new TypeError('capability.components must be an array')
  for (const component of record.components) parseComponent(component)
  if (record.channels !== undefined) {
    if (!Array.isArray(record.channels)) throw new TypeError('capability.channels must be an array')
    for (const channel of record.channels) parseChannel(channel)
  }
}

function parseComponent(value: unknown): void {
  const record = exactRecord(
    value,
    ['id', 'label', 'packages', 'required', 'stateSource', 'loaderEntries', 'state'],
    'capability component',
  )
  stringField(record.id, 'component.id')
  stringField(record.label, 'component.label')
  stringArray(record.packages, 'component.packages')
  booleanField(record.required, 'component.required')
  enumField(record.stateSource, ['loader', 'preset'], 'component.stateSource')
  loaderState(record.state, 'component.state')
  if (!Array.isArray(record.loaderEntries)) throw new TypeError('component.loaderEntries must be an array')
  for (const entry of record.loaderEntries) parseLoaderEntry(entry)
}

function parseChannel(value: unknown): void {
  const record = exactRecord(value, ['id', 'label', 'provenance', 'support'], 'channel catalog entry')
  stringField(record.id, 'channel.id')
  stringField(record.label, 'channel.label')
  enumField(record.provenance, ['core', 'bundled', 'repo-official', 'external'], 'channel.provenance')
  enumField(record.support, ['cataloged', 'installable', 'certified', 'enabled'], 'channel.support')
}

function parseLoaderEntry(value: unknown): void {
  const record = exactRecord(
    value,
    ['entryId', 'localId', 'moduleName', 'enabled', 'fiberPhase', 'state', 'source'],
    'loader entry',
  )
  stringField(record.entryId, 'loader.entryId')
  stringField(record.localId, 'loader.localId')
  stringField(record.moduleName, 'loader.moduleName')
  booleanField(record.enabled, 'loader.enabled')
  if (record.fiberPhase !== null) {
    enumField(record.fiberPhase, ['pending', 'loading', 'active', 'failed', 'unloading'], 'loader.fiberPhase')
  }
  loaderState(record.state, 'loader.state')
  enumField(record.source, ['clawdsh', 'platform', 'community'], 'loader.source')
}

function loaderState(value: unknown, label: string): void {
  enumField(value, ['disabled', 'starting', 'active', 'failed', 'misconfigured'], label)
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`)
  }
  const record = value as Record<string, unknown>
  const allowed = new Set(keys)
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new TypeError(`${label} contains unknown field ${JSON.stringify(key)}`)
  }
  const optionalSet = new Set(optional)
  for (const key of keys) {
    if (!optionalSet.has(key) && !Object.hasOwn(record, key)) {
      throw new TypeError(`${label} is missing ${key}`)
    }
  }
  return record
}

function stringField(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value === '') throw new TypeError(`${label} must be a non-empty string`)
}

function booleanField(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be boolean`)
}

function stringArray(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new TypeError(`${label} must be a string array`)
  }
}

function enumField(value: unknown, values: readonly string[], label: string): asserts value is string {
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new TypeError(`${label} has an unsupported value`)
  }
}
