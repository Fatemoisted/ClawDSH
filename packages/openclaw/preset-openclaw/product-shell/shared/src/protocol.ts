/** ClawDSH product-control RPC protocol shared by the Host runtime and browser shell. */

/** Frozen wire-protocol version. */
export const CLAWDSH_PROTOCOL_VERSION = 1 as const

/** Loopback-only Connection RPC channel. */
export const CLAWDSH_RPC_CHANNEL = '/clawdsh-rpc' as const

/** Stable v1 endpoint names. */
export const CLAWDSH_RPC_ENDPOINTS = {
  bootstrapGet: 'bootstrap/get',
  capabilitiesList: 'capabilities/list',
  settingsDescribe: 'settings/describe',
  settingsMutate: 'settings/mutate',
  settingsReset: 'settings/reset',
  credentialsDescribe: 'credentials/describe',
  credentialsSet: 'credentials/set',
  credentialsUnset: 'credentials/unset',
} as const

/** Endpoint accepted by the v1 product control runtime. */
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
  readonly controlMode: 'local-read-write'
  readonly localControlOnly: true
  readonly runtimeState: 'starting' | 'ready'
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

/** Product editor selected independently from the serialized field schema. */
export type ClawdshSettingsEditor = 'generic' | 'automation-rules' | 'gateway-deployment'

/** Server-owned write policy for one exact settings path. */
export interface ClawdshSettingsFieldPermission {
  readonly path: readonly string[]
  readonly label: string
  readonly description?: string
  readonly access: 'editable' | 'managed'
}

/** One registered ClawDSH namespace, with all secret positions redacted. */
export interface ClawdshSettingsNamespaceDescriptor {
  readonly namespace: string
  readonly capabilityId: string
  readonly label: string
  readonly description: string
  readonly editor: ClawdshSettingsEditor
  readonly schema: unknown
  readonly value: unknown
  readonly base?: unknown
  readonly user?: unknown
  readonly desiredRevision: number
  readonly runtimeRevision: number
  readonly restartRequired: boolean
  readonly effectTime: ClawdshEffectTime
  readonly fields: readonly ClawdshSettingsFieldPermission[]
}

/** Ordered ClawDSH settings catalog. */
export interface ClawdshSettingsDescribeResponse {
  readonly version: typeof CLAWDSH_PROTOCOL_VERSION
  readonly namespaces: readonly ClawdshSettingsNamespaceDescriptor[]
}

/** One exact path edit; Automation saves `rules` atomically through one `set`. */
export type ClawdshSettingsMutation =
  | { readonly op: 'set'; readonly path: readonly string[]; readonly value: unknown }
  | { readonly op: 'unset'; readonly path: readonly string[] }

/** Atomic optimistic settings edit request with distinct allowlisted paths. */
export interface ClawdshSettingsMutateRequest {
  readonly version: typeof CLAWDSH_PROTOCOL_VERSION
  readonly namespace: string
  readonly expectedRevision: number
  readonly operations: readonly ClawdshSettingsMutation[]
}

/** Reset one namespace's user layer to profile base and schema defaults. */
export interface ClawdshSettingsResetRequest {
  readonly version: typeof CLAWDSH_PROTOCOL_VERSION
  readonly namespace: string
  readonly expectedRevision: number
}

/** Refreshed namespace returned after a settings mutation or reset. */
export interface ClawdshSettingsNamespaceResponse {
  readonly version: typeof CLAWDSH_PROTOCOL_VERSION
  readonly namespace: ClawdshSettingsNamespaceDescriptor
}

/** Secret-free state for one DSH-owned credential. */
export interface ClawdshCredentialDescriptor {
  readonly id: string
  readonly label: string
  readonly configured: boolean
  readonly writable: boolean
  readonly source?: string
  readonly effectTime: ClawdshEffectTime
}

/** Describe every statically allowlisted DSH-owned credential. */
export interface ClawdshCredentialsDescribeResponse {
  readonly version: typeof CLAWDSH_PROTOCOL_VERSION
  readonly credentials: readonly ClawdshCredentialDescriptor[]
}

/** Write-only credential request; the value never appears in a response type. */
export interface ClawdshCredentialSetRequest {
  readonly version: typeof CLAWDSH_PROTOCOL_VERSION
  readonly id: string
  readonly value: string
}

/** Credential removal request. */
export interface ClawdshCredentialUnsetRequest {
  readonly version: typeof CLAWDSH_PROTOCOL_VERSION
  readonly id: string
}

/** Refreshed secret-free credential state after set or unset. */
export interface ClawdshCredentialResponse {
  readonly version: typeof CLAWDSH_PROTOCOL_VERSION
  readonly credential: ClawdshCredentialDescriptor
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

/** Parse a strict optimistic settings edit request. */
export function parseClawdshSettingsMutateRequest(value: unknown): ClawdshSettingsMutateRequest {
  const record = versionedRecord(
    value,
    ['version', 'namespace', 'expectedRevision', 'operations'],
    'settings mutate request',
  )
  stringField(record.namespace, 'settings namespace')
  revisionField(record.expectedRevision, 'settings expectedRevision')
  if (!Array.isArray(record.operations) || record.operations.length === 0 || record.operations.length > 64) {
    throw new TypeError('settings operations must be a non-empty array of at most 64 operations')
  }
  const paths = new Set<string>()
  for (const candidate of record.operations) {
    const operation = exactRecord(candidate, ['op', 'path', 'value'], 'settings operation', ['value'])
    enumField(operation.op, ['set', 'unset'], 'settings operation.op')
    settingsPath(operation.path)
    const pathKey = JSON.stringify(operation.path)
    if (paths.has(pathKey)) throw new TypeError('settings operations must not repeat a path')
    paths.add(pathKey)
    if (operation.op === 'set') {
      if (!Object.hasOwn(operation, 'value')) throw new TypeError('settings set operation is missing value')
      jsonField(operation.value, 'settings operation.value')
    } else if (Object.hasOwn(operation, 'value')) {
      throw new TypeError('settings unset operation must not contain value')
    }
  }
  return value as ClawdshSettingsMutateRequest
}

/** Parse a strict optimistic namespace reset request. */
export function parseClawdshSettingsResetRequest(value: unknown): ClawdshSettingsResetRequest {
  const record = versionedRecord(
    value,
    ['version', 'namespace', 'expectedRevision'],
    'settings reset request',
  )
  stringField(record.namespace, 'settings namespace')
  revisionField(record.expectedRevision, 'settings expectedRevision')
  return value as ClawdshSettingsResetRequest
}

/** Parse a write-only credential set request. */
export function parseClawdshCredentialSetRequest(value: unknown): ClawdshCredentialSetRequest {
  const record = versionedRecord(value, ['version', 'id', 'value'], 'credential set request')
  stringField(record.id, 'credential id')
  if (typeof record.value !== 'string' || record.value.length === 0 || record.value.length > 65_536) {
    throw new TypeError('credential value must be a non-empty string of at most 65536 characters')
  }
  return value as ClawdshCredentialSetRequest
}

/** Parse a strict credential removal request. */
export function parseClawdshCredentialUnsetRequest(value: unknown): ClawdshCredentialUnsetRequest {
  const record = versionedRecord(value, ['version', 'id'], 'credential unset request')
  stringField(record.id, 'credential id')
  return value as ClawdshCredentialUnsetRequest
}

/** Validate bootstrap data received by the browser. */
export function parseClawdshBootstrapResponse(value: unknown): ClawdshBootstrapResponse {
  const record = exactRecord(
    value,
    ['version', 'product', 'controlMode', 'localControlOnly', 'runtimeState', 'routes'],
    'bootstrap response',
  )
  if (record.version !== 1
    || record.controlMode !== 'local-read-write'
    || record.localControlOnly !== true
    || (record.runtimeState !== 'starting' && record.runtimeState !== 'ready')) {
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

/** Validate an ordered settings response received by the browser. */
export function parseClawdshSettingsDescribeResponse(value: unknown): ClawdshSettingsDescribeResponse {
  const record = versionedRecord(value, ['version', 'namespaces'], 'settings describe response')
  if (!Array.isArray(record.namespaces)) throw new TypeError('settings namespaces must be an array')
  for (const descriptor of record.namespaces) parseSettingsDescriptor(descriptor)
  return value as ClawdshSettingsDescribeResponse
}

/** Validate a refreshed namespace response received by the browser. */
export function parseClawdshSettingsNamespaceResponse(value: unknown): ClawdshSettingsNamespaceResponse {
  const record = versionedRecord(value, ['version', 'namespace'], 'settings namespace response')
  parseSettingsDescriptor(record.namespace)
  return value as ClawdshSettingsNamespaceResponse
}

/** Validate a secret-free credential catalog received by the browser. */
export function parseClawdshCredentialsDescribeResponse(value: unknown): ClawdshCredentialsDescribeResponse {
  const record = versionedRecord(value, ['version', 'credentials'], 'credentials describe response')
  if (!Array.isArray(record.credentials)) throw new TypeError('credentials must be an array')
  for (const credential of record.credentials) parseCredentialDescriptor(credential)
  return value as ClawdshCredentialsDescribeResponse
}

/** Validate a secret-free credential mutation response received by the browser. */
export function parseClawdshCredentialResponse(value: unknown): ClawdshCredentialResponse {
  const record = versionedRecord(value, ['version', 'credential'], 'credential response')
  parseCredentialDescriptor(record.credential)
  return value as ClawdshCredentialResponse
}

function parseSettingsDescriptor(value: unknown): void {
  const record = exactRecord(
    value,
    [
      'namespace', 'capabilityId', 'label', 'description', 'editor', 'schema', 'value', 'base', 'user',
      'desiredRevision', 'runtimeRevision', 'restartRequired', 'effectTime', 'fields',
    ],
    'settings namespace descriptor',
    ['base', 'user'],
  )
  stringField(record.namespace, 'settings descriptor.namespace')
  stringField(record.capabilityId, 'settings descriptor.capabilityId')
  stringField(record.label, 'settings descriptor.label')
  stringField(record.description, 'settings descriptor.description')
  enumField(record.editor, ['generic', 'automation-rules', 'gateway-deployment'], 'settings descriptor.editor')
  jsonField(record.schema, 'settings descriptor.schema')
  jsonField(record.value, 'settings descriptor.value')
  if (record.base !== undefined) jsonField(record.base, 'settings descriptor.base')
  if (record.user !== undefined) jsonField(record.user, 'settings descriptor.user')
  revisionField(record.desiredRevision, 'settings descriptor.desiredRevision')
  revisionField(record.runtimeRevision, 'settings descriptor.runtimeRevision')
  booleanField(record.restartRequired, 'settings descriptor.restartRequired')
  enumField(record.effectTime, ['live', 'new-session', 'next-call', 'restart'], 'settings descriptor.effectTime')
  if (!Array.isArray(record.fields)) throw new TypeError('settings descriptor.fields must be an array')
  for (const field of record.fields) {
    const permission = exactRecord(
      field,
      ['path', 'label', 'description', 'access'],
      'settings field permission',
      ['description'],
    )
    settingsPath(permission.path)
    stringField(permission.label, 'settings field label')
    if (permission.description !== undefined) stringField(permission.description, 'settings field description')
    enumField(permission.access, ['editable', 'managed'], 'settings field access')
  }
}

function parseCredentialDescriptor(value: unknown): void {
  const record = exactRecord(
    value,
    ['id', 'label', 'configured', 'writable', 'source', 'effectTime'],
    'credential descriptor',
    ['source'],
  )
  stringField(record.id, 'credential descriptor.id')
  stringField(record.label, 'credential descriptor.label')
  booleanField(record.configured, 'credential descriptor.configured')
  booleanField(record.writable, 'credential descriptor.writable')
  if (record.source !== undefined) stringField(record.source, 'credential descriptor.source')
  enumField(record.effectTime, ['live', 'new-session', 'next-call', 'restart'], 'credential descriptor.effectTime')
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

function versionedRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  const record = exactRecord(value, keys, label)
  if (record.version !== CLAWDSH_PROTOCOL_VERSION) throw new TypeError(`${label}.version must be 1`)
  return record
}

const POLLUTION_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])

function settingsPath(value: unknown): asserts value is string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    throw new TypeError('settings path must be a non-empty string array of at most 32 segments')
  }
  for (const segment of value) {
    if (typeof segment !== 'string' || segment.length === 0 || POLLUTION_SEGMENTS.has(segment)) {
      throw new TypeError('settings path contains an invalid segment')
    }
  }
}

function revisionField(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`)
  }
}

function jsonField(value: unknown, label: string): void {
  const visiting = new WeakSet<object>()
  const visit = (candidate: unknown): void => {
    if (candidate === null || typeof candidate === 'string' || typeof candidate === 'boolean') return
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) throw new TypeError(`${label} contains a non-finite number`)
      return
    }
    if (typeof candidate !== 'object') throw new TypeError(`${label} must contain only JSON values`)
    if (visiting.has(candidate)) throw new TypeError(`${label} contains a cycle`)
    visiting.add(candidate)
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item)
    } else {
      const prototype = Object.getPrototypeOf(candidate)
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`${label} contains a non-plain object`)
      }
      for (const [key, item] of Object.entries(candidate)) {
        if (POLLUTION_SEGMENTS.has(key)) throw new TypeError(`${label} contains a forbidden object key`)
        visit(item)
      }
    }
    visiting.delete(candidate)
  }
  visit(value)
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
