import { describe, expect, it, vi } from 'vitest'
import {
  CLAWDSH_READ_REQUEST,
  CLAWDSH_RPC_CHANNEL,
  CLAWDSH_RPC_ENDPOINTS,
} from '../../shared/src/protocol.ts'
import {
  loadClawdshCapabilities,
  type ClawdshControlConnection,
} from '../src/control-client.ts'
import { CAPABILITIES_FIXTURE } from './fixtures.ts'

describe('ClawDSH control client', () => {
  it('uses the shared capability endpoint and validates its response', async () => {
    const call = vi.fn().mockResolvedValue({ ok: true, value: CAPABILITIES_FIXTURE })
    const connection = { isLoopback: true, rpc: { call } } as unknown as ClawdshControlConnection

    await expect(loadClawdshCapabilities(connection)).resolves.toEqual(CAPABILITIES_FIXTURE)
    expect(call).toHaveBeenCalledWith(
      CLAWDSH_RPC_CHANNEL,
      CLAWDSH_RPC_ENDPOINTS.capabilitiesList,
      CLAWDSH_READ_REQUEST,
    )
  })

  it('refuses a non-loopback control plane before sending a request', async () => {
    const call = vi.fn()
    const connection = { isLoopback: false, rpc: { call } } as unknown as ClawdshControlConnection

    await expect(loadClawdshCapabilities(connection)).rejects.toThrow('only on loopback')
    expect(call).not.toHaveBeenCalled()
  })

  it('rejects malformed Host data instead of guessing capability ownership', async () => {
    const call = vi.fn().mockResolvedValue({
      ok: true,
      value: { ...CAPABILITIES_FIXTURE, unexpected: true },
    })
    const connection = { isLoopback: true, rpc: { call } } as unknown as ClawdshControlConnection

    await expect(loadClawdshCapabilities(connection)).rejects.toThrow('unknown field')
  })
})
