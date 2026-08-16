import { describe, expect, it, vi } from 'vitest'
import {
  apply,
  CHANNEL_AGENT_SETTINGS_NAMESPACE,
  ChannelAgentDriver,
  Config,
  inject,
  MANAGED_OWNER_PRESET,
  MANAGED_SAFE_PRESET,
  name,
  type Config as ChannelAgentConfig,
} from '../src/index.ts'

function config(overrides: Partial<ChannelAgentConfig> = {}): ChannelAgentConfig {
  const value: ChannelAgentConfig = {
    ownerPreset: MANAGED_OWNER_PRESET,
    safePreset: MANAGED_SAFE_PRESET,
    cwd: '/profile/workspace',
    stagingRoot: '/profile/staging',
    maxMediaBytes: 1024,
    shutdownGraceMs: 1000,
  }
  return Object.assign(value, overrides)
}

describe('channel-agent managed configuration', () => {
  it('defaults only installer-owned preset identities and has no communication-plane dependency', () => {
    const parsed = Config({
      cwd: '/workspace',
      stagingRoot: '/state/staging',
      maxMediaBytes: 1024,
      shutdownGraceMs: 1000,
    } as ChannelAgentConfig)
    expect(name).toBe('channel-agent')
    expect(MANAGED_OWNER_PRESET).toBe('clawdsh')
    expect(MANAGED_SAFE_PRESET).toBe('clawdsh-messaging-safe')
    expect(parsed).toMatchObject({
      ownerPreset: 'clawdsh',
      safePreset: 'clawdsh-messaging-safe',
    })
    expect(inject).toEqual([
      'channels',
      'agents',
      'sessions',
      'sessionPersistence',
      'agentDefaultModel',
      'agentPresets',
      'attachments',
      'storageDomain',
      'tools',
      'settings',
    ])
    expect(inject).not.toContain('subprocess')
    expect(inject).not.toContain('web')
  })

  it('rejects unsafe media and teardown limits before driver creation', () => {
    const base = {
      cwd: '/workspace',
      stagingRoot: '/state/staging',
      maxMediaBytes: 1024,
      shutdownGraceMs: 1000,
    }
    expect(() => Config({ ...base, maxMediaBytes: Number.MAX_SAFE_INTEGER + 1 } as ChannelAgentConfig)).toThrow()
    expect(() => Config({ ...base, shutdownGraceMs: Number.MAX_SAFE_INTEGER + 1 } as ChannelAgentConfig)).toThrow()
  })

  it('registers restart-scoped Settings and starts the driver from that immutable snapshot', async () => {
    const base = config()
    const snapshot = config({ cwd: '/user/workspace', shutdownGraceMs: 2000 })
    const get = vi.fn(() => snapshot)
    const register = vi.fn((_namespace: unknown, _schema: unknown, options: {
      base: ChannelAgentConfig
      applies: 'restart'
      validate(value: ChannelAgentConfig): void
    }) => {
      expect(options).toMatchObject({ base, applies: 'restart' })
      options.validate(snapshot)
      return { get }
    })
    const driver = { dispose: vi.fn(async () => {}) }
    const create = vi.spyOn(ChannelAgentDriver, 'create').mockResolvedValueOnce(driver as never)
    const ctx = {
      get: vi.fn((service: string) => service === 'settings' ? { register } : undefined),
      channels: { registerDriver: vi.fn() },
      effect: vi.fn(),
    }

    await apply(ctx as never, base)

    expect(register).toHaveBeenCalledWith(CHANNEL_AGENT_SETTINGS_NAMESPACE, Config, expect.objectContaining({
      applies: 'restart',
    }))
    expect(get).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledWith(ctx, snapshot)
    create.mockRestore()
  })

  it('rejects a relative cwd from Settings before driver creation', async () => {
    const base = config()
    const snapshot = config({ cwd: 'relative/workspace' })
    const register = vi.fn((_namespace: unknown, _schema: unknown, options: {
      validate(candidate: ChannelAgentConfig): void
    }) => {
      options.validate(snapshot)
      return { get: () => snapshot }
    })
    const create = vi.spyOn(ChannelAgentDriver, 'create')
    const ctx = {
      get: vi.fn(() => ({ register })),
      channels: { registerDriver: vi.fn() },
      effect: vi.fn(),
    }

    await expect(apply(ctx as never, base)).rejects.toThrow(/cwd must be absolute/)

    expect(create).not.toHaveBeenCalled()
    expect(ctx.channels.registerDriver).not.toHaveBeenCalled()
    create.mockRestore()
  })

  it.each([
    ['ownerPreset', 'unmanaged-owner'],
    ['safePreset', 'unmanaged-safe'],
    ['stagingRoot', '/unmanaged/staging'],
    ['maxMediaBytes', 2048],
  ] as const)('rejects a user-layer override of installer-managed %s before driver creation', async (field, value) => {
    const base = config()
    const snapshot = config()
    Reflect.set(snapshot, field, value)
    const register = vi.fn((_namespace: unknown, _schema: unknown, options: {
      validate(candidate: ChannelAgentConfig): void
    }) => {
      options.validate(snapshot)
      return { get: () => snapshot }
    })
    const create = vi.spyOn(ChannelAgentDriver, 'create')
    const ctx = {
      get: vi.fn(() => ({ register })),
      channels: { registerDriver: vi.fn() },
      effect: vi.fn(),
    }

    await expect(apply(ctx as never, base)).rejects.toThrow(new RegExp(`${field}.*installer-managed`))

    expect(create).not.toHaveBeenCalled()
    expect(ctx.channels.registerDriver).not.toHaveBeenCalled()
    create.mockRestore()
  })

  it('reports every installer-managed field changed by one Settings snapshot', async () => {
    const base = config()
    const snapshot = config({ ownerPreset: 'unmanaged-owner', safePreset: 'unmanaged-safe' })
    const register = vi.fn((_namespace: unknown, _schema: unknown, options: {
      validate(candidate: ChannelAgentConfig): void
    }) => {
      options.validate(snapshot)
      return { get: () => snapshot }
    })
    const create = vi.spyOn(ChannelAgentDriver, 'create')
    const ctx = {
      get: vi.fn(() => ({ register })),
      channels: { registerDriver: vi.fn() },
      effect: vi.fn(),
    }

    await expect(apply(ctx as never, base)).rejects.toThrow(
      /ownerPreset, safePreset are installer-managed/,
    )

    expect(create).not.toHaveBeenCalled()
    expect(ctx.channels.registerDriver).not.toHaveBeenCalled()
    create.mockRestore()
  })
})
