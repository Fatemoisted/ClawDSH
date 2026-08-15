import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import {
  CLAWDSH_READ_REQUEST,
  CLAWDSH_RPC_CHANNEL,
  CLAWDSH_RPC_ENDPOINTS,
  parseClawdshCapabilitiesResponse,
  type ClawdshCapabilitiesResponse,
} from '../../shared/src/protocol.ts'

/** Minimal public Connection face used by the product control client. */
export type ClawdshControlConnection = Pick<ConnectionHandle, 'isLoopback' | 'rpc'>

/** Read the sanitized capability projection through the loopback-only control channel. */
export async function loadClawdshCapabilities(
  connection: ClawdshControlConnection,
): Promise<ClawdshCapabilitiesResponse> {
  if (!connection.isLoopback) throw new Error('ClawDSH browser: settings are available only on loopback')
  const result = await connection.rpc.call(
    CLAWDSH_RPC_CHANNEL,
    CLAWDSH_RPC_ENDPOINTS.capabilitiesList,
    CLAWDSH_READ_REQUEST,
  )
  if (!result.ok) {
    throw new Error(`capabilities/list failed: ${result.error.code}: ${result.error.message}`)
  }
  return parseClawdshCapabilitiesResponse(result.value)
}
