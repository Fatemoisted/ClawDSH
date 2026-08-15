import { describe, expect, it, vi } from 'vitest'
import {
  CLAWDSH_READ_REQUEST,
  CLAWDSH_RPC_CHANNEL,
  CLAWDSH_RPC_ENDPOINTS,
} from '../../shared/src/protocol.ts'
import {
  createClawdshControlClient,
  loadClawdshCapabilities,
  loadClawdshCredentials,
  loadClawdshSettings,
  mutateClawdshSetting,
  setClawdshCredential,
  type ClawdshControlConnection,
} from '../src/control-client.ts'
import {
  CAPABILITIES_FIXTURE,
  CREDENTIALS_FIXTURE,
  SETTINGS_FIXTURE,
} from './fixtures.ts'

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

    await expect(loadClawdshCapabilities(connection)).rejects.toThrow('仅在本机可用')
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

  it('uses strict settings endpoints and preserves optimistic-conflict codes', async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: SETTINGS_FIXTURE })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'settings-conflict', message: 'stale settings revision', details: { issues: [] } },
      })
    const connection = { isLoopback: true, rpc: { call } } as unknown as ClawdshControlConnection

    await expect(loadClawdshSettings(connection)).resolves.toEqual(SETTINGS_FIXTURE)
    const request = {
      version: 1 as const,
      namespace: 'clawdsh-memory',
      expectedRevision: 0,
      operations: [{ op: 'set' as const, path: ['enabled'], value: false }],
    }
    await expect(mutateClawdshSetting(connection, request)).rejects.toMatchObject({
      code: 'settings-conflict',
    })
    expect(call).toHaveBeenNthCalledWith(
      2,
      CLAWDSH_RPC_CHANNEL,
      CLAWDSH_RPC_ENDPOINTS.settingsMutate,
      request,
    )
  })

  it('never accepts a credential value from a Host response', async () => {
    const secret = 'credential-canary-value'
    const call = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: CREDENTIALS_FIXTURE })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          version: 1,
          credential: { ...CREDENTIALS_FIXTURE.credentials[0], value: secret },
        },
      })
    const connection = { isLoopback: true, rpc: { call } } as unknown as ClawdshControlConnection

    await expect(loadClawdshCredentials(connection)).resolves.toEqual(CREDENTIALS_FIXTURE)
    await expect(setClawdshCredential(connection, 'ark-api-key', secret)).rejects.toThrow('unknown field')
  })

  it('binds the complete product-control face to one Connection', () => {
    const connection = { isLoopback: true, rpc: { call: vi.fn() } } as unknown as ClawdshControlConnection
    expect(Object.keys(createClawdshControlClient(connection)).sort()).toEqual([
      'loadCapabilities',
      'loadCredentials',
      'loadSettings',
      'mutateSetting',
      'resetSettings',
      'setCredential',
      'unsetCredential',
    ])
  })
})
