/** Loopback-only ClawDSH Settings and Credentials control methods. */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import {
  deepEqualJson,
  settingsNamespace,
  type SettingsDescriptor,
  type SettingsConflictError,
  type SettingsPathOp,
  type SettingsProvider,
} from '@deepseek-ai/dsh-settings'
import Schema from '@deepseek-ai/schemastery'
import {
  CLAWDSH_PROTOCOL_VERSION,
  CLAWDSH_RPC_ENDPOINTS,
  parseClawdshCredentialResponse,
  parseClawdshCredentialsDescribeResponse,
  parseClawdshCredentialSetRequest,
  parseClawdshCredentialUnsetRequest,
  parseClawdshReadRequest,
  parseClawdshSettingsDescribeResponse,
  parseClawdshSettingsMutateRequest,
  parseClawdshSettingsNamespaceResponse,
  parseClawdshSettingsResetRequest,
  type ClawdshCredentialDescriptor,
  type ClawdshCredentialResponse,
  type ClawdshCredentialsDescribeResponse,
  type ClawdshRpcEndpoint,
  type ClawdshSettingsDescribeResponse,
  type ClawdshSettingsMutation,
  type ClawdshSettingsNamespaceDescriptor,
  type ClawdshSettingsNamespaceResponse,
} from '../../shared/src/protocol.ts'
import {
  CREDENTIAL_MANIFEST,
  SETTINGS_MANIFEST,
  type ClawdshSettingsManifestEntry as RuntimeManifestEntry,
} from './settings-manifest.ts'

interface RuntimeSnapshot {
  readonly revision: number
  readonly value: unknown
}

interface OpenClawControl {
  readonly validateDesired: (value: unknown) => void | Promise<void>
  readonly snapshot?: () => unknown | Promise<unknown>
}

type SettingsControlResult = RpcResult<
  | ClawdshSettingsDescribeResponse
  | ClawdshSettingsNamespaceResponse
  | ClawdshCredentialsDescribeResponse
  | ClawdshCredentialResponse
>

const GATEWAY_NAMESPACE = 'clawdsh-channel-openclaw'
const ACTIVITY_NAMESPACE = 'clawdsh-activity'
const ACTIVITY_SETTINGS_SCHEMA = Schema.object({
  enabled: Schema.const(true).default(true),
})

function settingsRejected(namespace: string): RpcResult<never> {
  const publicNamespace = SETTINGS_MANIFEST.some(entry => entry.namespace === namespace)
    ? namespace
    : 'unknown'
  return {
    ok: false,
    error: {
      code: 'settings-rejected',
      message: 'ClawDSH refused the settings change',
      details: { ns: publicNamespace },
    },
  }
}

function settingsConflict(
  namespace: string,
  error: Pick<SettingsConflictError, 'expected' | 'actual'>,
): RpcResult<never> {
  return {
    ok: false,
    error: {
      code: 'settings-conflict',
      message: 'Settings changed after this page loaded; reload before saving again',
      details: { ns: namespace, expected: error.expected, actual: error.actual },
    },
  }
}

function isSettingsConflict(error: unknown): error is SettingsConflictError {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { code?: unknown; expected?: unknown; actual?: unknown }
  return candidate.code === 'SETTINGS_CONFLICT'
    && Number.isSafeInteger(candidate.expected)
    && Number.isSafeInteger(candidate.actual)
}

function credentialRejected(id: string): RpcResult<never> {
  const publicId = CREDENTIAL_MANIFEST.some(entry => entry.id === id) ? id : 'unknown'
  return {
    ok: false,
    error: {
      code: 'credential-rejected',
      message: 'ClawDSH refused the credential change',
      details: { ref: publicId },
    },
  }
}

function badRequest(): RpcResult<never> {
  return {
    ok: false,
    error: {
      code: 'bad-request',
      message: 'invalid ClawDSH protocol v1 request',
      details: { issues: [] },
    },
  }
}

function internalFailure(): RpcResult<never> {
  return {
    ok: false,
    error: {
      code: 'internal',
      message: 'ClawDSH control data is temporarily unavailable',
      details: {},
    },
  }
}

function startingFailure(): RpcResult<never> {
  return {
    ok: false,
    error: {
      code: 'internal',
      message: 'ClawDSH control is starting; retry shortly',
      details: {},
    },
  }
}

function jsonBoundary<T>(value: T, parse: (candidate: unknown) => T): T {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new TypeError('ClawDSH RPC response is not JSON serializable')
  return parse(JSON.parse(encoded) as unknown)
}

function plainRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return structuredClone(value as Record<string, unknown>)
}

function defineProjected(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  })
}

function projectRecord(
  value: Record<string, unknown>,
  fields: Readonly<Record<string, Schema>>,
): Record<string, unknown> {
  const projected: Record<string, unknown> = {}
  for (const [key, schema] of Object.entries(fields)) {
    if (!Object.hasOwn(value, key)) continue
    defineProjected(projected, key, projectRegisteredValue(value[key], schema))
  }
  return projected
}

function mergeProjected(
  target: Record<string, unknown>,
  value: unknown,
): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return
  for (const [key, child] of Object.entries(value)) defineProjected(target, key, child)
}

function canProjectRecord(schema: Schema): boolean {
  if (schema.type === 'object' || schema.type === 'dict' || schema.type === 'any') return true
  if ((schema.type === 'transform' || schema.type === 'lazy') && schema.inner !== undefined) {
    return canProjectRecord(schema.inner)
  }
  if (schema.type === 'union' || schema.type === 'intersect') {
    return (schema.list ?? []).some(canProjectRecord)
  }
  return false
}

/**
 * Copy a redacted Settings value through the registered schema without applying
 * defaults or transforms. Settings already removed schema-declared secrets;
 * this projection preserves those absences while dropping stale fields that
 * the current schema no longer owns.
 */
function projectRegisteredValue(value: unknown, schema: Schema): unknown {
  if (value === undefined) return undefined
  if ((schema.type === 'transform' || schema.type === 'lazy') && schema.inner !== undefined) {
    return projectRegisteredValue(value, schema.inner)
  }
  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    return projectRecord(value as Record<string, unknown>, schema.dict ?? {})
  }
  if (schema.type === 'dict') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    const projected: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      defineProjected(projected, key, schema.inner === undefined
        ? structuredClone(child)
        : projectRegisteredValue(child, schema.inner))
    }
    return projected
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return []
    return schema.inner === undefined
      ? structuredClone(value)
      : value.map(child => projectRegisteredValue(child, schema.inner!))
  }
  if (schema.type === 'tuple') {
    if (!Array.isArray(value)) return []
    return (schema.list ?? []).slice(0, value.length)
      .map((child, index) => projectRegisteredValue(value[index], child))
  }
  if (schema.type === 'intersect') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      const first = schema.list?.[0]
      return first === undefined ? structuredClone(value) : projectRegisteredValue(value, first)
    }
    const projected: Record<string, unknown> = {}
    for (const child of schema.list ?? []) mergeProjected(projected, projectRegisteredValue(value, child))
    return projected
  }
  if (schema.type === 'union') {
    for (const child of schema.list ?? []) {
      try {
        Schema.resolve(structuredClone(value), child, {}, true)
        return projectRegisteredValue(value, child)
      } catch {
        // Redaction can make a formerly valid union member incomplete; fall
        // through to the schema-wide safe projection below.
      }
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const projected: Record<string, unknown> = {}
      for (const child of (schema.list ?? []).filter(canProjectRecord)) {
        mergeProjected(projected, projectRegisteredValue(value, child))
      }
      return projected
    }
  }
  return structuredClone(value)
}

function mergeLayers(under: unknown, over: unknown): unknown {
  if (over === undefined) return under
  if (typeof under !== 'object' || under === null || Array.isArray(under)
    || typeof over !== 'object' || over === null || Array.isArray(over)) return over
  const merged: Record<string, unknown> = { ...under as Record<string, unknown> }
  for (const [key, value] of Object.entries(over)) {
    Object.defineProperty(merged, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: Object.hasOwn(merged, key) ? mergeLayers(merged[key], value) : value,
    })
  }
  return merged
}

function applyPathOperation(
  section: Record<string, unknown>,
  operation: ClawdshSettingsMutation,
): Record<string, unknown> {
  const [head, ...rest] = operation.path
  if (head === undefined) return section
  if (rest.length === 0) {
    if (operation.op === 'set') return { ...section, [head]: structuredClone(operation.value) }
    const { [head]: _removed, ...remaining } = section
    return remaining
  }
  const child = section[head]
  if (operation.op === 'unset'
    && (typeof child !== 'object' || child === null || Array.isArray(child))) return section
  const childSection = plainRecord(child)
  return { ...section, [head]: applyPathOperation(childSection, { ...operation, path: rest }) }
}

function resolveCandidate(descriptor: SettingsDescriptor, user: Record<string, unknown>): unknown {
  const schema = new Schema(descriptor.schema as Schema)
  const input = mergeLayers(descriptor.base, user)
  const resolved = (schema as unknown as (value: unknown) => unknown)(structuredClone(input))
  assertNoUnknownFields(resolved, schema)
  return resolved
}

function resolveResetCandidate(descriptor: SettingsDescriptor): unknown {
  const schema = new Schema(descriptor.schema as Schema)
  const input = projectRegisteredValue(descriptor.base, schema)
  const resolved = (schema as unknown as (value: unknown) => unknown)(structuredClone(input))
  assertNoUnknownFields(resolved, schema)
  return resolved
}

function assertNoUnknownFields(value: unknown, schema: Schema): void {
  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return
    const record = value as Record<string, unknown>
    const fields = schema.dict ?? {}
    for (const key of Object.keys(record)) {
      if (!Object.hasOwn(fields, key)) {
        throw new TypeError('ClawDSH settings contain fields outside the registered schema')
      }
      const child = fields[key]
      if (child !== undefined) assertNoUnknownFields(record[key], child)
    }
    return
  }
  if (schema.type === 'array') {
    if (Array.isArray(value) && schema.inner !== undefined) {
      for (const item of value) assertNoUnknownFields(item, schema.inner)
    }
    return
  }
  if (schema.type === 'dict') {
    if (typeof value === 'object' && value !== null && !Array.isArray(value) && schema.inner !== undefined) {
      for (const item of Object.values(value)) assertNoUnknownFields(item, schema.inner)
    }
    return
  }
  if (schema.type === 'tuple') {
    if (!Array.isArray(value)) return
    const list = schema.list ?? []
    if (value.length > list.length) {
      throw new TypeError('ClawDSH settings contain tuple entries outside the registered schema')
    }
    value.forEach((item, index) => {
      const child = list[index]
      if (child !== undefined) assertNoUnknownFields(item, child)
    })
    return
  }
  if (schema.type === 'union') {
    for (const child of schema.list ?? []) {
      try {
        ;(child as unknown as (candidate: unknown) => unknown)(structuredClone(value))
        assertNoUnknownFields(value, child)
        return
      } catch {
        // Another union member may own this value and its object fields.
      }
    }
    throw new TypeError('ClawDSH settings do not match a strict union member')
  }
  if ((schema.type === 'transform' || schema.type === 'lazy') && schema.inner !== undefined) {
    assertNoUnknownFields(value, schema.inner)
  }
}

function schemaHasPath(serialized: unknown, path: readonly string[]): boolean {
  let node: Schema | undefined = new Schema(serialized as Schema)
  for (const segment of path) {
    if (node.type === 'object') node = node.dict?.[segment]
    else if (node.type === 'dict' || node.type === 'array') node = node.inner
    else return false
    if (node === undefined) return false
  }
  return true
}

function manifestFor(namespace: string): RuntimeManifestEntry | undefined {
  return SETTINGS_MANIFEST.find(entry => entry.namespace === namespace)
}

function descriptorFor(
  settingsDescriptor: SettingsDescriptor,
  manifest: RuntimeManifestEntry,
  runtime: RuntimeSnapshot | undefined,
): ClawdshSettingsNamespaceDescriptor {
  const schema = new Schema(settingsDescriptor.schema as Schema)
  const desiredValue = projectRegisteredValue(settingsDescriptor.value, schema)
  const base = projectRegisteredValue(settingsDescriptor.base, schema)
  const user = projectRegisteredValue(settingsDescriptor.user, schema)
  const desiredRevision = settingsDescriptor.revision
  const restartSemantics = manifest.effectTime === 'restart'
  const runtimeRevision = restartSemantics && runtime !== undefined ? runtime.revision : desiredRevision
  const restartRequired = restartSemantics
    && runtime !== undefined
    && !deepEqualJson(desiredValue, runtime.value)
  const value: ClawdshSettingsNamespaceDescriptor = {
    namespace: manifest.namespace,
    capabilityId: manifest.capabilityId,
    label: manifest.label,
    description: manifest.description,
    editor: manifest.editor,
    schema: settingsDescriptor.schema,
    value: desiredValue,
    ...(settingsDescriptor.base === undefined ? {} : { base }),
    ...(settingsDescriptor.user === undefined ? {} : { user }),
    desiredRevision,
    runtimeRevision,
    restartRequired,
    effectTime: manifest.effectTime,
    fields: manifest.fields.filter(field => schemaHasPath(settingsDescriptor.schema, field.path)),
  }
  return jsonBoundary(value, (candidate) => {
    const response = parseClawdshSettingsNamespaceResponse({
      version: CLAWDSH_PROTOCOL_VERSION,
      namespace: candidate,
    })
    return response.namespace
  })
}

/** Implements the mutable methods behind the loopback-only product RPC channel. */
export class ClawdshSettingsControl {
  private readonly runtimeSnapshots = new Map<string, RuntimeSnapshot>()
  private runtimeCaptured = false
  private ready = false

  /** @param ctx - Host context carrying public Settings and Credentials services. */
  constructor(private readonly ctx: Context) {}

  /** Register product-owned namespaces before the control route becomes reachable. */
  registerManagedNamespaces(): void {
    const settings = this.settings()
    if (settings === undefined) return
    settings.register(settingsNamespace(ACTIVITY_NAMESPACE), ACTIVITY_SETTINGS_SCHEMA, {
      base: { enabled: true },
      applies: 'restart',
    })
  }

  /**
   * Freeze runtime values for every registered product namespace after the Loader settles.
   * Repeated calls preserve the first successfully captured runtime state.
   * @returns whether required Settings and Credentials services were available and captured.
   */
  captureRuntime(): boolean {
    if (this.runtimeCaptured) return true
    const settings = this.ctx.get('settings') as SettingsProvider | undefined
    if (settings === undefined || this.credentials() === undefined) return false
    const descriptors = settings.describe({ redactSecrets: true })
    for (const descriptor of descriptors) {
      const manifest = manifestFor(String(descriptor.ns))
      if (manifest === undefined) continue
      const schema = new Schema(descriptor.schema as Schema)
      this.runtimeSnapshots.set(String(descriptor.ns), {
        revision: descriptor.revision,
        value: projectRegisteredValue(descriptor.value, schema),
      })
    }
    this.runtimeCaptured = true
    return true
  }

  /** Make stateful control methods reachable after every startup snapshot is complete. */
  markReady(): void {
    if (!this.runtimeCaptured) throw new Error('ClawDSH runtime state was not captured')
    this.ready = true
  }

  /** @returns whether stateful product-control methods may serve complete data. */
  isReady(): boolean {
    return this.ready
  }

  /**
   * Read an `enabled` flag from the immutable startup snapshot.
   * @param namespace - statically allowlisted ClawDSH settings namespace.
   * @returns the captured boolean, or `undefined` when absent or malformed.
   */
  runtimeEnabled(namespace: string): boolean | undefined {
    const value = this.runtimeSnapshots.get(namespace)?.value
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    const enabled = (value as Record<string, unknown>)['enabled']
    return typeof enabled === 'boolean' ? enabled : undefined
  }

  /**
   * Read the current redacted desired `enabled` value without changing the
   * restart-scoped startup snapshots.
   * @param namespace - statically allowlisted ClawDSH settings namespace.
   * @returns the current boolean, or `undefined` when absent or malformed.
   */
  desiredEnabled(namespace: string): boolean | undefined {
    try {
      const descriptor = this.findRegistered(namespace)
      if (descriptor === undefined) return undefined
      const schema = new Schema(descriptor.schema as Schema)
      const value = projectRegisteredValue(descriptor.value, schema)
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
      const enabled = (value as Record<string, unknown>)['enabled']
      return typeof enabled === 'boolean' ? enabled : undefined
    } catch {
      return undefined
    }
  }

  /**
   * Handle a Settings or Credentials endpoint.
   * @param endpoint - v1 endpoint name from the Connection carrier.
   * @param payload - untrusted JSON request payload.
   * @returns an RPC result, or `undefined` when another control handler owns the endpoint.
   */
  async handle(endpoint: string, payload: unknown): Promise<SettingsControlResult | undefined> {
    if (endpoint === CLAWDSH_RPC_ENDPOINTS.settingsDescribe
      || endpoint === CLAWDSH_RPC_ENDPOINTS.settingsMutate
      || endpoint === CLAWDSH_RPC_ENDPOINTS.settingsReset
      || endpoint === CLAWDSH_RPC_ENDPOINTS.credentialsDescribe
      || endpoint === CLAWDSH_RPC_ENDPOINTS.credentialsSet
      || endpoint === CLAWDSH_RPC_ENDPOINTS.credentialsUnset) {
      if (!this.ready) return startingFailure()
    }
    switch (endpoint as ClawdshRpcEndpoint) {
      case CLAWDSH_RPC_ENDPOINTS.settingsDescribe:
        return this.describeSettings(payload)
      case CLAWDSH_RPC_ENDPOINTS.settingsMutate:
        return this.mutateSettings(payload)
      case CLAWDSH_RPC_ENDPOINTS.settingsReset:
        return this.resetSettings(payload)
      case CLAWDSH_RPC_ENDPOINTS.credentialsDescribe:
        return this.describeCredentials(payload)
      case CLAWDSH_RPC_ENDPOINTS.credentialsSet:
        return this.setCredential(payload)
      case CLAWDSH_RPC_ENDPOINTS.credentialsUnset:
        return this.unsetCredential(payload)
      default:
        return undefined
    }
  }

  private settings(): SettingsProvider | undefined {
    return this.ctx.get('settings') as SettingsProvider | undefined
  }

  private credentials(): CredentialProvider | undefined {
    return this.ctx.get('credentials') as CredentialProvider | undefined
  }

  private registeredDescriptors(): readonly SettingsDescriptor[] {
    return this.settings()?.describe({ redactSecrets: true }) ?? []
  }

  private findRegistered(namespace: string): SettingsDescriptor | undefined {
    return this.registeredDescriptors().find(descriptor => String(descriptor.ns) === namespace)
  }

  private namespaceDescriptor(namespace: string): ClawdshSettingsNamespaceDescriptor | undefined {
    const manifest = manifestFor(namespace)
    const descriptor = this.findRegistered(namespace)
    if (manifest === undefined || descriptor === undefined) return undefined
    return descriptorFor(descriptor, manifest, this.runtimeSnapshots.get(namespace))
  }

  private describeSettings(payload: unknown): SettingsControlResult {
    try {
      parseClawdshReadRequest(payload)
    } catch {
      return badRequest()
    }
    try {
      const registered = new Map(
        this.registeredDescriptors().map(descriptor => [String(descriptor.ns), descriptor]),
      )
      const value: ClawdshSettingsDescribeResponse = {
        version: CLAWDSH_PROTOCOL_VERSION,
        namespaces: SETTINGS_MANIFEST.flatMap((manifest) => {
          const descriptor = registered.get(manifest.namespace)
          return descriptor === undefined
            ? []
            : [descriptorFor(descriptor, manifest, this.runtimeSnapshots.get(manifest.namespace))]
        }),
      }
      return { ok: true, value: jsonBoundary(value, parseClawdshSettingsDescribeResponse) }
    } catch {
      return internalFailure()
    }
  }

  private async mutateSettings(payload: unknown): Promise<SettingsControlResult> {
    let request
    try {
      request = parseClawdshSettingsMutateRequest(payload)
    } catch {
      return badRequest()
    }
    const manifest = manifestFor(request.namespace)
    const settings = this.settings()
    const current = this.findRegistered(request.namespace)
    if (manifest === undefined
      || settings === undefined
      || current === undefined) {
      return settingsRejected(request.namespace)
    }
    for (const operation of request.operations) {
      const field = manifest.fields.find(candidate => (
        candidate.path.length === operation.path.length
        && candidate.path.every((segment, index) => segment === operation.path[index])
      ))
      if (field?.access !== 'editable' || !schemaHasPath(current.schema, operation.path)) {
        return settingsRejected(request.namespace)
      }
    }
    if (request.expectedRevision !== current.revision) {
      return settingsConflict(request.namespace, {
        expected: request.expectedRevision,
        actual: current.revision,
      })
    }
    try {
      const user = request.operations.reduce(
        (section, operation) => applyPathOperation(section, operation),
        plainRecord(current.user),
      )
      const desired = resolveCandidate(current, user)
      await this.validateGatewayDesired(request.namespace, desired)
      const operations: SettingsPathOp[] = request.operations.map(operation => operation.op === 'set'
        ? { op: 'set', path: operation.path, value: operation.value }
        : { op: 'unset', path: operation.path })
      await settings.mutate(settingsNamespace(request.namespace), operations, request.expectedRevision)
      const descriptor = this.namespaceDescriptor(request.namespace)
      if (descriptor === undefined) return settingsRejected(request.namespace)
      const value: ClawdshSettingsNamespaceResponse = {
        version: CLAWDSH_PROTOCOL_VERSION,
        namespace: descriptor,
      }
      return { ok: true, value: jsonBoundary(value, parseClawdshSettingsNamespaceResponse) }
    } catch (error) {
      if (isSettingsConflict(error)) return settingsConflict(request.namespace, error)
      return settingsRejected(request.namespace)
    }
  }

  private async resetSettings(payload: unknown): Promise<SettingsControlResult> {
    let request
    try {
      request = parseClawdshSettingsResetRequest(payload)
    } catch {
      return badRequest()
    }
    const settings = this.settings()
    const current = this.findRegistered(request.namespace)
    if (manifestFor(request.namespace) === undefined || settings === undefined || current === undefined) {
      return settingsRejected(request.namespace)
    }
    if (request.expectedRevision !== current.revision) {
      return settingsConflict(request.namespace, {
        expected: request.expectedRevision,
        actual: current.revision,
      })
    }
    try {
      const desired = resolveResetCandidate(current)
      await this.validateGatewayDesired(request.namespace, desired)
      await settings.replace(settingsNamespace(request.namespace), {}, request.expectedRevision)
      const descriptor = this.namespaceDescriptor(request.namespace)
      if (descriptor === undefined) return settingsRejected(request.namespace)
      const value: ClawdshSettingsNamespaceResponse = {
        version: CLAWDSH_PROTOCOL_VERSION,
        namespace: descriptor,
      }
      return { ok: true, value: jsonBoundary(value, parseClawdshSettingsNamespaceResponse) }
    } catch (error) {
      if (isSettingsConflict(error)) return settingsConflict(request.namespace, error)
      return settingsRejected(request.namespace)
    }
  }

  private async validateGatewayDesired(namespace: string, value: unknown): Promise<void> {
    if (namespace !== GATEWAY_NAMESPACE) return
    if (typeof value !== 'object' || value === null || Array.isArray(value)
      || (value as Record<string, unknown>)['enabled'] !== true) return
    const control = this.ctx.get('clawdshOpenClawControl') as OpenClawControl | undefined
    if (control === undefined || typeof control.validateDesired !== 'function') {
      throw new Error('OpenClaw managed runtime is unavailable')
    }
    await control.validateDesired(value)
  }

  private async credentialDescriptor(id: string): Promise<ClawdshCredentialDescriptor | undefined> {
    const manifest = CREDENTIAL_MANIFEST.find(entry => entry.id === id)
    const credentials = this.credentials()
    if (manifest === undefined || credentials === undefined) return undefined
    const info = await credentials.describe(credentialRef(manifest.ref))
    const value: ClawdshCredentialDescriptor = {
      id: manifest.id,
      label: manifest.label,
      configured: info.configured,
      writable: info.writable,
      ...(info.source === undefined ? {} : { source: info.source }),
      effectTime: manifest.effectTime,
    }
    return jsonBoundary(value, (candidate) => {
      const response = parseClawdshCredentialResponse({
        version: CLAWDSH_PROTOCOL_VERSION,
        credential: candidate,
      })
      return response.credential
    })
  }

  private async describeCredentials(payload: unknown): Promise<SettingsControlResult> {
    try {
      parseClawdshReadRequest(payload)
    } catch {
      return badRequest()
    }
    try {
      const credentials = await Promise.all(
        CREDENTIAL_MANIFEST.map(manifest => this.credentialDescriptor(manifest.id)),
      )
      if (credentials.some(credential => credential === undefined)) return credentialRejected('ark-api-key')
      const value: ClawdshCredentialsDescribeResponse = {
        version: CLAWDSH_PROTOCOL_VERSION,
        credentials: credentials as ClawdshCredentialDescriptor[],
      }
      return { ok: true, value: jsonBoundary(value, parseClawdshCredentialsDescribeResponse) }
    } catch {
      return internalFailure()
    }
  }

  private async setCredential(payload: unknown): Promise<SettingsControlResult> {
    let request
    try {
      request = parseClawdshCredentialSetRequest(payload)
    } catch {
      return badRequest()
    }
    const manifest = CREDENTIAL_MANIFEST.find(entry => entry.id === request.id)
    const credentials = this.credentials()
    if (manifest === undefined || credentials === undefined) return credentialRejected(request.id)
    try {
      await credentials.set(credentialRef(manifest.ref), request.value)
      const descriptor = await this.credentialDescriptor(request.id)
      if (descriptor === undefined) return credentialRejected(request.id)
      const value: ClawdshCredentialResponse = {
        version: CLAWDSH_PROTOCOL_VERSION,
        credential: descriptor,
      }
      return { ok: true, value: jsonBoundary(value, parseClawdshCredentialResponse) }
    } catch {
      return credentialRejected(request.id)
    }
  }

  private async unsetCredential(payload: unknown): Promise<SettingsControlResult> {
    let request
    try {
      request = parseClawdshCredentialUnsetRequest(payload)
    } catch {
      return badRequest()
    }
    const manifest = CREDENTIAL_MANIFEST.find(entry => entry.id === request.id)
    const credentials = this.credentials()
    if (manifest === undefined || credentials === undefined) return credentialRejected(request.id)
    try {
      await credentials.unset(credentialRef(manifest.ref))
      const descriptor = await this.credentialDescriptor(request.id)
      if (descriptor === undefined) return credentialRejected(request.id)
      const value: ClawdshCredentialResponse = {
        version: CLAWDSH_PROTOCOL_VERSION,
        credential: descriptor,
      }
      return { ok: true, value: jsonBoundary(value, parseClawdshCredentialResponse) }
    } catch {
      return credentialRejected(request.id)
    }
  }
}
