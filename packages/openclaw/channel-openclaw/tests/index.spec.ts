import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'

const mocks = vi.hoisted(() => ({
  preflight: vi.fn(async () => ({
    lock: { track: 'production' },
    nodePath: '/runtime/node',
    executable: '/runtime/node_modules/openclaw/openclaw.mjs',
  })),
  validateConfig: vi.fn(),
  validateDeployment: vi.fn(async () => {}),
  start: vi.fn(),
}))
vi.mock('../src/supervisor.ts', () => ({
  OpenClawSupervisor: { start: mocks.start },
  preflightOpenClawDeployment: mocks.preflight,
  validateOpenClawConfig: mocks.validateConfig,
  validateOpenClawDeployment: mocks.validateDeployment,
}))

import {
  apply,
  CHANNEL_OPENCLAW_SETTINGS_NAMESPACE,
  Config,
  inject,
  name,
} from '../src/index.ts'
import * as Invariant from '../src/invariant.ts'
import type { Config as PluginConfig } from '../src/index.ts'

function config(overrides: Partial<PluginConfig> = {}): PluginConfig {
  const value: PluginConfig = {
    enabled: true,
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
  return Object.assign(value, overrides)
}

function context<T extends object>(value: T): T & {
  readonly reflect: { readonly provide: ReturnType<typeof vi.fn> }
  readonly clawdshOpenClawControl: {
    snapshot(): { enabled: boolean; state: string }
    validateDesired(config: PluginConfig): Promise<void>
  }
} {
  const target = value as T & Record<string, unknown>
  if (!Object.hasOwn(target, 'launchEnvironment')) {
    Reflect.set(target, 'launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'process', values: {} }]))
  }
  const provide = vi.fn((name: string, service: unknown) => { Reflect.set(target, name, service) })
  return Object.assign(target, {
    get: vi.fn((service: string) => Reflect.get(target, service)),
    reflect: { provide },
  }) as never
}

describe('channel-openclaw plugin', () => {
  beforeEach(() => {
    mocks.start.mockReset()
    mocks.preflight.mockReset()
    mocks.preflight.mockResolvedValue({
      lock: { track: 'production' },
      nodePath: '/runtime/node',
      executable: '/runtime/node_modules/openclaw/openclaw.mjs',
    })
    mocks.validateConfig.mockReset()
    mocks.validateDeployment.mockReset()
    mocks.validateDeployment.mockResolvedValue(undefined)
  })

  it('publishes explicit plugin metadata and schema defaults no deployment fields', () => {
    expect(name).toBe('channel-openclaw')
    expect(inject).toEqual(['channels', 'storageDomain', 'subprocess', 'settings'])
    expect(Config(config())).toMatchObject(config())
    const withoutExtensions = config()
    Reflect.deleteProperty(withoutExtensions, 'extensions')
    expect(Config(withoutExtensions)).toMatchObject({ extensions: [] })
    const withoutEnabled = config()
    Reflect.deleteProperty(withoutEnabled, 'enabled')
    expect(Config(withoutEnabled)).toMatchObject({ enabled: false })
    expect(Config({ enabled: false } as PluginConfig)).toMatchObject({
      enabled: false,
      track: 'production',
      extensions: [],
      nodePath: 'node',
    })
    const invalid: Record<string, unknown> = {}
    Object.assign(invalid, config(), { gatewayPort: 1.5 })
    expect(() => Config(invalid as unknown as PluginConfig)).toThrow()
  })

  it('stays mounted without preflight, IPC, a Gateway process, or Provider registration when disabled', async () => {
    const resolve = vi.fn(async () => ({ value: 'true', source: 'test' }))
    const ctx = context({
      credentials: { resolve },
      channels: { registerProvider: vi.fn() },
      effect: vi.fn(),
      storageDomain: { open: vi.fn() },
      subprocess: { resolveExecutable: vi.fn(), spawn: vi.fn() },
    })
    await apply(ctx as never, Config({ enabled: false } as PluginConfig))
    expect(ctx.clawdshOpenClawControl.snapshot()).toEqual({ enabled: false, state: 'disabled' })
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.preflight).not.toHaveBeenCalled()
    expect(ctx.channels.registerProvider).not.toHaveBeenCalled()
    expect(ctx.effect).not.toHaveBeenCalled()
    expect(ctx.storageDomain.open).not.toHaveBeenCalled()
    expect(ctx.subprocess.resolveExecutable).not.toHaveBeenCalled()
    expect(ctx.subprocess.spawn).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalled()
  })

  it('rejects enabled startup while the launch environment enables legacy channels', async () => {
    const ctx = context({
      launchEnvironment: createLaunchEnvironmentSnapshot([{
        source: 'process',
        values: { CLAWDSH_LEGACY_CHANNELS_ENABLED: 'on' },
      }]),
      channels: { registerProvider: vi.fn() },
      effect: vi.fn(),
    })

    await expect(apply(ctx as never, config()))
      .rejects.toThrow(/managed Gateway cannot be enabled.*CLAWDSH_LEGACY_CHANNELS_ENABLED/)

    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.preflight).not.toHaveBeenCalled()
    expect(ctx.channels.registerProvider).not.toHaveBeenCalled()
  })

  it('registers restart-scoped Settings and starts only from the captured user snapshot', async () => {
    const base = config({ enabled: false })
    const snapshot = config({ gatewayPort: 19_001 })
    const register = vi.fn((_namespace: unknown, _schema: unknown, options: {
      base: PluginConfig
      applies: 'restart'
      validate(value: PluginConfig): void
    }) => {
      expect(options).toMatchObject({ base, applies: 'restart' })
      options.validate(snapshot)
      return { get: vi.fn(() => snapshot) }
    })
    const unregister = vi.fn()
    const supervisor = {
      provider: { id: 'openclaw' },
      done: new Promise<'stopped' | 'failed'>(() => {}),
      dispose: vi.fn(async () => {}),
    }
    mocks.start.mockResolvedValueOnce(supervisor)
    const ctx = context({
      settings: { register },
      channels: { registerProvider: vi.fn(() => unregister) },
      effect: vi.fn(),
    })

    await apply(ctx as never, base)

    expect(register).toHaveBeenCalledWith(CHANNEL_OPENCLAW_SETTINGS_NAMESPACE, Config, expect.objectContaining({
      applies: 'restart',
    }))
    expect(mocks.validateConfig).toHaveBeenCalledWith(snapshot)
    expect(mocks.start).toHaveBeenCalledWith(ctx, snapshot)
    expect(ctx.clawdshOpenClawControl.snapshot()).toEqual({ enabled: true, state: 'active' })
  })

  it('does not start an enabled profile base when the restart snapshot disables the Gateway', async () => {
    const snapshot = config({ enabled: false })
    const ctx = context({
      settings: {
        register: vi.fn(() => ({ get: () => snapshot })),
      },
      channels: { registerProvider: vi.fn() },
      effect: vi.fn(),
      storageDomain: { open: vi.fn() },
      subprocess: { resolveExecutable: vi.fn(), spawn: vi.fn() },
    })

    await apply(ctx as never, config())

    expect(ctx.clawdshOpenClawControl.snapshot()).toEqual({ enabled: false, state: 'disabled' })
    expect(mocks.start).not.toHaveBeenCalled()
    expect(ctx.channels.registerProvider).not.toHaveBeenCalled()
    expect(ctx.storageDomain.open).not.toHaveBeenCalled()
    expect(ctx.subprocess.resolveExecutable).not.toHaveBeenCalled()
    expect(ctx.subprocess.spawn).not.toHaveBeenCalled()
  })

  it.each([
    ['track', 'canary'],
    ['gatewayInstanceId', 'unmanaged-gateway'],
    ['artifactPath', '/unmanaged/openclaw.tgz'],
    ['runtimeRoot', '/unmanaged/runtime'],
    ['hostRoot', '/unmanaged/openclaw'],
    ['nodePath', '/unmanaged/node'],
    ['configPath', '/unmanaged/openclaw.json'],
    ['stateDir', '/unmanaged/state'],
    ['stagingRoot', '/unmanaged/staging'],
    ['endpoint', '/unmanaged/bridge.sock'],
    ['extensions', [{
      pluginId: 'unmanaged',
      channelIds: ['unmanaged'],
      packageName: '@example/unmanaged',
      version: '1.0.0',
      integrity: `sha512-${'a'.repeat(128)}`,
      projectTree: { fileCount: 1, sha512: 'b'.repeat(128) },
    }]],
    ['maxMediaBytes', 6 * 1024 * 1024],
  ] as const)('rejects a user-layer override of installer-managed %s before startup', async (field, value) => {
    const base = config({ enabled: false })
    const snapshot = config({ enabled: false })
    Reflect.set(snapshot, field, value)
    const register = vi.fn((_namespace: unknown, _schema: unknown, options: {
      validate(candidate: PluginConfig): void
    }) => {
      options.validate(snapshot)
      return { get: () => snapshot }
    })
    const ctx = context({
      settings: { register },
      channels: { registerProvider: vi.fn() },
      effect: vi.fn(),
    })

    await expect(apply(ctx as never, base)).rejects.toThrow(new RegExp(`${field}.*installer-managed`))

    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.preflight).not.toHaveBeenCalled()
    expect(ctx.channels.registerProvider).not.toHaveBeenCalled()
  })

  it('fails loudly before registration when an enabled managed runtime is unavailable', async () => {
    mocks.start.mockRejectedValueOnce(new Error('managed runtime is unavailable'))
    const ctx = context({ channels: { registerProvider: vi.fn() }, effect: vi.fn() })
    await expect(apply(ctx as never, config())).rejects.toThrow(/managed runtime is unavailable/)
    expect(ctx.channels.registerProvider).not.toHaveBeenCalled()
    expect(ctx.effect).not.toHaveBeenCalled()
  })

  it('exposes desired validation through the always-mounted Host service', async () => {
    const ctx = context({ channels: { registerProvider: vi.fn() }, effect: vi.fn() })
    await apply(ctx as never, config({ enabled: false }))
    await expect(ctx.clawdshOpenClawControl.validateDesired(config({ enabled: false })))
      .resolves.toBeUndefined()
    expect(mocks.preflight).not.toHaveBeenCalled()

    const desired = config()
    mocks.preflight.mockRejectedValueOnce(new Error('managed runtime missing'))
    await expect(ctx.clawdshOpenClawControl.validateDesired(desired)).rejects.toThrow(/managed runtime missing/)
    expect(mocks.preflight).toHaveBeenCalledWith(ctx, desired)
    expect(mocks.validateDeployment).not.toHaveBeenCalled()
    expect(ctx.channels.registerProvider).not.toHaveBeenCalled()
    expect(ctx.effect).not.toHaveBeenCalled()
  })

  it('rejects a Settings enable before preflight when credentials enable legacy channels', async () => {
    const resolve = vi.fn(async () => ({ value: 'yes', source: 'test' }))
    const ctx = context({
      credentials: { resolve },
      channels: { registerProvider: vi.fn() },
      effect: vi.fn(),
    })
    await apply(ctx as never, config({ enabled: false }))

    await expect(ctx.clawdshOpenClawControl.validateDesired(config()))
      .rejects.toThrow(/managed Gateway cannot be enabled.*CLAWDSH_LEGACY_CHANNELS_ENABLED/)

    expect(resolve).toHaveBeenCalledWith('CLAWDSH_LEGACY_CHANNELS_ENABLED')
    expect(mocks.preflight).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it.each(['', '0', 'false', 'FALSE', 'no', 'OFF'])(
    'treats the legacy-channel value %j as disabled during Settings preflight',
    async (value) => {
      const ctx = context({
        launchEnvironment: createLaunchEnvironmentSnapshot([{
          source: 'process',
          values: { CLAWDSH_LEGACY_CHANNELS_ENABLED: value },
        }]),
        channels: { registerProvider: vi.fn() },
        effect: vi.fn(),
      })
      await apply(ctx as never, config({ enabled: false }))

      const desired = config()
      await expect(ctx.clawdshOpenClawControl.validateDesired(desired)).resolves.toBeUndefined()
      expect(mocks.preflight).toHaveBeenCalledWith(ctx, desired)
    },
  )

  it('fails loudly on an invalid legacy-channel enabled value without exposing it', async () => {
    const resolve = vi.fn(async () => ({ value: 'definitely-secret-invalid-value', source: 'test' }))
    const ctx = context({
      credentials: { resolve },
      channels: { registerProvider: vi.fn() },
      effect: vi.fn(),
    })
    await apply(ctx as never, config({ enabled: false }))

    const validation = ctx.clawdshOpenClawControl.validateDesired(config())
    await expect(validation).rejects.toThrow(/must be 1\/true\/yes\/on or 0\/false\/no\/off/)
    await expect(validation).rejects.not.toThrow(/definitely-secret-invalid-value/)
    expect(mocks.preflight).not.toHaveBeenCalled()
  })

  it('rejects managed desired fields before full preflight', async () => {
    const ctx = context({ channels: { registerProvider: vi.fn() }, effect: vi.fn() })
    await apply(ctx as never, config({ enabled: false }))
    const desired = config({ artifactPath: '/unmanaged/openclaw.tgz' })

    await expect(ctx.clawdshOpenClawControl.validateDesired(desired))
      .rejects.toThrow(/artifactPath.*installer-managed/)

    expect(mocks.preflight).not.toHaveBeenCalled()
    expect(ctx.channels.registerProvider).not.toHaveBeenCalled()
  })

  it('registers the verified provider and installs ordered lifecycle cleanup', async () => {
    const unregister = vi.fn()
    const dispose = vi.fn(async () => {})
    const supervisor = {
      provider: { id: 'openclaw' },
      done: new Promise<'stopped' | 'failed'>(() => {}),
      dispose,
    }
    mocks.start.mockResolvedValueOnce(supervisor)
    const yielded: Array<() => unknown> = []
    const ctx = context({
      channels: { registerProvider: vi.fn(() => unregister) },
      effect: vi.fn((factory: () => Generator<() => unknown>) => { yielded.push(...factory()) }),
    })
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
    mocks.start.mockResolvedValueOnce({
      provider: {},
      done: new Promise<'stopped' | 'failed'>(() => {}),
      dispose,
    })
    const ctx = context({
      channels: { registerProvider: () => { throw new Error('duplicate') } },
    })
    await expect(apply(ctx as never, config())).rejects.toThrow(/duplicate/)
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('unregisters and disposes if lifecycle publication fails', async () => {
    const unregister = vi.fn()
    const dispose = vi.fn(async () => {})
    mocks.start.mockResolvedValueOnce({
      provider: {},
      done: new Promise<'stopped' | 'failed'>(() => {}),
      dispose,
    })
    const ctx = context({
      channels: { registerProvider: () => unregister },
      effect: () => { throw new Error('effect failed') },
    })
    await expect(apply(ctx as never, config())).rejects.toThrow(/effect failed/)
    expect(unregister).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('publishes a sanitized failed state after an unexpected post-handshake exit', async () => {
    const terminal = Promise.withResolvers<'stopped' | 'failed'>()
    mocks.start.mockResolvedValueOnce({
      provider: {},
      done: terminal.promise,
      dispose: vi.fn(async () => {}),
    })
    const ctx = context({
      channels: { registerProvider: vi.fn(() => vi.fn()) },
      effect: vi.fn(),
    })

    await apply(ctx as never, config())
    terminal.resolve('failed')

    await vi.waitFor(() => {
      expect(ctx.clawdshOpenClawControl.snapshot()).toEqual({ enabled: true, state: 'failed' })
    })
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
