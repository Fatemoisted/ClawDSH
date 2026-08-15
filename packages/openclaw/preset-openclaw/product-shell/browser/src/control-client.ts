import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import {
  CLAWDSH_READ_REQUEST,
  CLAWDSH_RPC_CHANNEL,
  CLAWDSH_RPC_ENDPOINTS,
  parseClawdshActivityListRequest,
  parseClawdshActivityListResponse,
  parseClawdshCapabilitiesResponse,
  parseClawdshCredentialResponse,
  parseClawdshCredentialsDescribeResponse,
  parseClawdshSettingsDescribeResponse,
  parseClawdshSettingsNamespaceResponse,
  type ClawdshCapabilitiesResponse,
  type ClawdshActivityListRequest,
  type ClawdshActivityListResponse,
  type ClawdshCredentialResponse,
  type ClawdshCredentialsDescribeResponse,
  type ClawdshSettingsDescribeResponse,
  type ClawdshSettingsMutateRequest,
  type ClawdshSettingsNamespaceResponse,
  type ClawdshSettingsResetRequest,
} from '../../shared/src/protocol.ts'

/** Minimal public Connection face used by the product control client. */
export type ClawdshControlConnection = Pick<ConnectionHandle, 'isLoopback' | 'rpc'>

/** Injectable browser control face used by product pages and tests. */
export interface ClawdshControlClient {
  readonly loadCapabilities: () => Promise<ClawdshCapabilitiesResponse>
  readonly loadSettings: () => Promise<ClawdshSettingsDescribeResponse>
  readonly mutateSetting: (request: ClawdshSettingsMutateRequest) => Promise<ClawdshSettingsNamespaceResponse>
  readonly resetSettings: (request: ClawdshSettingsResetRequest) => Promise<ClawdshSettingsNamespaceResponse>
  readonly loadCredentials: () => Promise<ClawdshCredentialsDescribeResponse>
  readonly setCredential: (id: string, value: string) => Promise<ClawdshCredentialResponse>
  readonly unsetCredential: (id: string) => Promise<ClawdshCredentialResponse>
  readonly listActivity: (
    request: ClawdshActivityListRequest,
    signal?: AbortSignal,
  ) => Promise<ClawdshActivityListResponse>
}

/** Stable product-control failure retaining the server's public error code. */
export class ClawdshControlError extends Error {
  /** @param code - public RPC error taxonomy. @param message - sanitized server message. */
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'ClawdshControlError'
  }
}

function assertLoopback(connection: ClawdshControlConnection): void {
  if (!connection.isLoopback) throw new ClawdshControlError('local-control-required', 'ClawDSH 控制面仅在本机可用')
}

async function call(
  connection: ClawdshControlConnection,
  endpoint: string,
  payload: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  assertLoopback(connection)
  const result = signal === undefined
    ? await connection.rpc.call(CLAWDSH_RPC_CHANNEL, endpoint, payload)
    : await connection.rpc.call(CLAWDSH_RPC_CHANNEL, endpoint, payload, signal)
  if (!result.ok) throw new ClawdshControlError(result.error.code, result.error.message)
  return result.value
}

/** Read the sanitized capability projection through the loopback-only control channel. */
export async function loadClawdshCapabilities(
  connection: ClawdshControlConnection,
): Promise<ClawdshCapabilitiesResponse> {
  return parseClawdshCapabilitiesResponse(await call(
    connection,
    CLAWDSH_RPC_ENDPOINTS.capabilitiesList,
    CLAWDSH_READ_REQUEST,
  ))
}

/** Read every allowlisted ClawDSH settings namespace. */
export async function loadClawdshSettings(
  connection: ClawdshControlConnection,
): Promise<ClawdshSettingsDescribeResponse> {
  return parseClawdshSettingsDescribeResponse(await call(
    connection,
    CLAWDSH_RPC_ENDPOINTS.settingsDescribe,
    CLAWDSH_READ_REQUEST,
  ))
}

/** Atomically commit one namespace's path-addressed optimistic mutations. */
export async function mutateClawdshSetting(
  connection: ClawdshControlConnection,
  request: ClawdshSettingsMutateRequest,
): Promise<ClawdshSettingsNamespaceResponse> {
  return parseClawdshSettingsNamespaceResponse(await call(
    connection,
    CLAWDSH_RPC_ENDPOINTS.settingsMutate,
    request,
  ))
}

/** Clear one namespace's complete user layer. */
export async function resetClawdshSettings(
  connection: ClawdshControlConnection,
  request: ClawdshSettingsResetRequest,
): Promise<ClawdshSettingsNamespaceResponse> {
  return parseClawdshSettingsNamespaceResponse(await call(
    connection,
    CLAWDSH_RPC_ENDPOINTS.settingsReset,
    request,
  ))
}

/** Read secret-free state for DSH-owned credentials only. */
export async function loadClawdshCredentials(
  connection: ClawdshControlConnection,
): Promise<ClawdshCredentialsDescribeResponse> {
  return parseClawdshCredentialsDescribeResponse(await call(
    connection,
    CLAWDSH_RPC_ENDPOINTS.credentialsDescribe,
    CLAWDSH_READ_REQUEST,
  ))
}

/** Write one credential without retaining or returning its value. */
export async function setClawdshCredential(
  connection: ClawdshControlConnection,
  id: string,
  value: string,
): Promise<ClawdshCredentialResponse> {
  return parseClawdshCredentialResponse(await call(
    connection,
    CLAWDSH_RPC_ENDPOINTS.credentialsSet,
    { version: 1, id, value },
  ))
}

/** Remove one DSH-owned credential by allowlisted id. */
export async function unsetClawdshCredential(
  connection: ClawdshControlConnection,
  id: string,
): Promise<ClawdshCredentialResponse> {
  return parseClawdshCredentialResponse(await call(
    connection,
    CLAWDSH_RPC_ENDPOINTS.credentialsUnset,
    { version: 1, id },
  ))
}

/** Read one Session-bound semantic Activity page with caller cancellation. */
export async function loadClawdshActivity(
  connection: ClawdshControlConnection,
  request: ClawdshActivityListRequest,
  signal?: AbortSignal,
): Promise<ClawdshActivityListResponse> {
  const parsedRequest = parseClawdshActivityListRequest(request)
  const response = parseClawdshActivityListResponse(await call(
    connection,
    CLAWDSH_RPC_ENDPOINTS.activityList,
    parsedRequest,
    signal,
  ))
  if (response.records.some(record => record.sessionId !== parsedRequest.sessionId)) {
    throw new TypeError('activity response contains a record from another Session')
  }
  return response
}

/** Bind all product-control operations to one live Connection. */
export function createClawdshControlClient(connection: ClawdshControlConnection): ClawdshControlClient {
  return {
    loadCapabilities: () => loadClawdshCapabilities(connection),
    loadSettings: () => loadClawdshSettings(connection),
    mutateSetting: request => mutateClawdshSetting(connection, request),
    resetSettings: request => resetClawdshSettings(connection, request),
    loadCredentials: () => loadClawdshCredentials(connection),
    setCredential: (id, value) => setClawdshCredential(connection, id, value),
    unsetCredential: id => unsetClawdshCredential(connection, id),
    listActivity: (request, signal) => loadClawdshActivity(connection, request, signal),
  }
}
