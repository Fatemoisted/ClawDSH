import { describe, expect, it, vi } from 'vitest'

const start = vi.hoisted(() => vi.fn())
vi.mock('../src/supervisor.ts', () => ({
  OpenClawSupervisor: { start },
}))

import { Config, apply, inject, name } from '../src/index.ts'
import * as Invariant from '../src/invariant.ts'
import type { Config as PluginConfig } from '../src/index.ts'

function config(): PluginConfig {
  return {
    track: 'production',
    gatewayInstanceId: 'gateway-1',
    artifactPath: '/runtime/openclaw.tgz',
    runtimeRoot: '/runtime',
    hostRoot: '/runtime/node_modules/openclaw',
    extensions: [],
    nodePath: '/runtime/node',
    configPath: '/state/openclaw.json',
    stateDir: '/state',
    stagingRoot: '/state/staging',
    maxMediaBytes: 5 * 1024 * 1024,
    endpoint: '/state/bridge.sock',
    gatewayPort: 18_789,
    maxFrameBytes: 1024,
    maxInFlight: 4,
    requestTimeoutMs: 500,
    handshakeTimeoutMs: 500,
    startupTimeoutMs: 1_000,
    shutdownGraceMs: 500,
    diagnosticBytes: 4096,
  }
}

describe('channel-openclaw plugin', () => {
  it('publishes explicit plugin metadata and schema defaults no deployment fields', () => {
    expect(name).toBe('channel-openclaw')
    expect(inject).toEqual(['channels', 'storageDomain', 'subprocess'])
    expect(Config(config())).toMatchObject(config())
    const withoutExtensions = config()
    Reflect.deleteProperty(withoutExtensions, 'extensions')
    expect(Config(withoutExtensions)).toMatchObject({ extensions: [] })
    expect(() => Config({} as PluginConfig)).toThrow()
    const invalid: Record<string, unknown> = {}
    Object.assign(invalid, config(), { gatewayPort: 1.5 })
    expect(() => Config(invalid as unknown as PluginConfig)).toThrow()
  })

  it('registers the verified provider and installs ordered lifecycle cleanup', async () => {
    const unregister = vi.fn()
    const dispose = vi.fn(async () => {})
    const supervisor = { provider: { id: 'openclaw' }, dispose }
    start.mockResolvedValueOnce(supervisor)
    const yielded: Array<() => unknown> = []
    const ctx = {
      channels: { registerProvider: vi.fn(() => unregister) },
      effect: vi.fn((factory: () => Generator<() => unknown>) => { yielded.push(...factory()) }),
    }
    await apply(ctx as never, config())
    expect(ctx.channels.registerProvider).toHaveBeenCalledWith(supervisor.provider)
    expect(yielded).toHaveLength(2)
    await yielded[0]?.()
    yielded[1]?.()
    expect(dispose).toHaveBeenCalledOnce()
    expect(unregister).toHaveBeenCalledOnce()
  })

  it('disposes the supervisor if registration fails', async () => {
    const dispose = vi.fn(async () => {})
    start.mockResolvedValueOnce({ provider: {}, dispose })
    const ctx = {
      channels: { registerProvider: () => { throw new Error('duplicate') } },
    }
    await expect(apply(ctx as never, config())).rejects.toThrow(/duplicate/)
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('unregisters and disposes if lifecycle publication fails', async () => {
    const unregister = vi.fn()
    const dispose = vi.fn(async () => {})
    start.mockResolvedValueOnce({ provider: {}, dispose })
    const ctx = {
      channels: { registerProvider: () => unregister },
      effect: () => { throw new Error('effect failed') },
    }
    await expect(apply(ctx as never, config())).rejects.toThrow(/effect failed/)
    expect(unregister).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
  })
})

describe('channel-openclaw invariant companion', () => {
  it('reserves package ownership with the explained empty installer', async () => {
    const unregister = vi.fn()
    const register = vi.fn((_packageName: string, install: () => void) => {
      install()
      return unregister
    })
    const disposer = await Invariant.apply({ invariants: { register } } as never)
    expect(Invariant.name).toBe('channel-openclaw-invariant')
    expect(Invariant.inject).toEqual(['invariants'])
    expect(register).toHaveBeenCalledWith('@clawdsh/dsh-channel-openclaw', expect.any(Function))
    expect(disposer).toBe(unregister)
  })
})
