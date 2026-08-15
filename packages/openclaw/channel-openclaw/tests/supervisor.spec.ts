import { chmod, lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenClawExtensionLock } from '../src/extensions.ts'
import type { OpenClawSupervisorConfig } from '../src/supervisor.ts'

const mocks = vi.hoisted(() => ({
  verifyFailClosedConfig: vi.fn(async () => {}),
  verifyManagedHost: vi.fn(async () => {}),
  verifyRuntimeInstallation: vi.fn(async () => {}),
  validateExtensionLocks: vi.fn(),
  verifyExtensionInstallations: vi.fn(async () => new Map<string, string>()),
  verifyExtensionRuntimeInspection: vi.fn(async () => {}),
  createProvider: vi.fn(),
}))

vi.mock('../src/extensions.ts', () => ({
  validateExtensionLocks: mocks.validateExtensionLocks,
  verifyExtensionInstallations: mocks.verifyExtensionInstallations,
  verifyExtensionRuntimeInspection: mocks.verifyExtensionRuntimeInspection,
}))

vi.mock('../src/integrity.ts', () => ({
  verifyFailClosedConfig: mocks.verifyFailClosedConfig,
  verifyManagedHost: mocks.verifyManagedHost,
  verifyRuntimeInstallation: mocks.verifyRuntimeInstallation,
}))

vi.mock('../src/server.ts', () => ({
  OpenClawChannelProvider: { create: mocks.createProvider },
}))

import {
  OpenClawSupervisor,
  preflightOpenClawDeployment,
  validateOpenClawConfig,
  validateOpenClawDeployment,
  verifyRuntimeInspection,
} from '../src/supervisor.ts'

interface FakeHandle {
  readonly done: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>
  readonly collected: {
    readonly stdout?: { readFrom(offset: number): { text: string; lossy: boolean } }
    readonly stderr?: { readFrom(offset: number): { text: string; lossy: boolean } }
  }
  readonly terminate: ReturnType<typeof vi.fn>
  readonly waitForExit: ReturnType<typeof vi.fn>
}

interface Fixture {
  readonly root: string
  readonly config: OpenClawSupervisorConfig
  readonly provider: {
    readonly secrets: { token: string; startupNonce: string }
    firstHandshake: Promise<unknown>
    readonly health: ReturnType<typeof vi.fn>
    readonly beginShutdown: ReturnType<typeof vi.fn>
    readonly dispose: ReturnType<typeof vi.fn>
  }
}

const roots: string[] = []

afterEach(async () => {
  await Promise.allSettled(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

beforeEach(() => {
  vi.clearAllMocks()
})

function inspection(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    plugin: { id: 'clawdsh-bridge', status: 'loaded', imported: true, error: null },
    shape: 'hybrid-capability',
    capabilityMode: 'hybrid',
    capabilities: [
      { kind: 'text-inference', ids: ['clawdsh'] },
      { kind: 'agent-harness', ids: ['clawdsh'] },
    ],
    diagnostics: [],
    compatibility: [],
    ...overrides,
  })
}

const extensionLock: OpenClawExtensionLock = {
  pluginId: 'qqbot',
  channelIds: ['qq'],
  packageName: '@openclaw/qqbot',
  version: '1.2.3',
  integrity: `sha512-${Buffer.alloc(64, 7).toString('base64')}`,
  projectTree: { fileCount: 2, sha512: '0'.repeat(128) },
}

function handle(
  stdout: string,
  options: {
    readonly exitCode?: number | null
    readonly signal?: NodeJS.Signals | null
    readonly lossyStdout?: boolean
    readonly lossyStderr?: boolean
    readonly includeStdout?: boolean
    readonly includeStderr?: boolean
    readonly done?: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>
    readonly exits?: boolean
  } = {},
): FakeHandle {
  return {
    done: options.done ?? Promise.resolve({ exitCode: options.exitCode ?? 0, signal: options.signal ?? null }),
    collected: {
      ...(options.includeStdout === false ? {} : {
        stdout: { readFrom: () => ({ text: stdout, lossy: options.lossyStdout ?? false }) },
      }),
      ...(options.includeStderr === false ? {} : {
        stderr: { readFrom: () => ({ text: '', lossy: options.lossyStderr ?? false }) },
      }),
    },
    terminate: vi.fn(),
    waitForExit: vi.fn(async () => options.exits ?? true),
  }
}

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'channel-openclaw-supervisor-'))
  roots.push(root)
  const stateDir = join(root, 'state')
  const stagingRoot = join(stateDir, 'staging')
  const hostRoot = join(root, 'runtime', 'node_modules', 'openclaw')
  await mkdir(stagingRoot, { recursive: true, mode: 0o700 })
  await mkdir(hostRoot, { recursive: true })
  await writeFile(join(hostRoot, 'openclaw.mjs'), 'export {}\n')
  await writeFile(join(stateDir, 'openclaw.json'), '{}\n')
  const provider = {
    secrets: { token: 'runtime-token', startupNonce: 'runtime-nonce' },
    firstHandshake: Promise.resolve({ protocolVersion: 1 }),
    health: vi.fn(async () => ({ status: 'ready' })),
    beginShutdown: vi.fn(),
    dispose: vi.fn(async () => {}),
  }
  mocks.createProvider.mockResolvedValue(provider)
  return {
    root,
    provider,
    config: {
      track: 'production',
      gatewayInstanceId: 'gateway-1',
      artifactPath: join(root, 'openclaw.tgz'),
      runtimeRoot: join(root, 'runtime'),
      hostRoot,
      extensions: [],
      nodePath: 'node',
      configPath: join(stateDir, 'openclaw.json'),
      stateDir,
      stagingRoot,
      maxMediaBytes: 5 * 1024 * 1024,
      endpoint: join(stateDir, 'bridge.sock'),
      gatewayPort: 18_789,
      maxFrameBytes: 1024,
      maxInFlight: 4,
      requestTimeoutMs: 750,
      handshakeTimeoutMs: 500,
      startupTimeoutMs: 500,
      shutdownGraceMs: 500,
      diagnosticBytes: 4096,
    },
  }
}

function contextWith(handles: FakeHandle[]) {
  const spawn = vi.fn((_options: unknown): FakeHandle => {
    const next = handles.shift()
    if (next === undefined) throw new Error('unexpected subprocess spawn')
    return next
  })
  return {
    ctx: {
      subprocess: {
        resolveExecutable: vi.fn(async () => '/opt/node'),
        spawn,
      },
    } as never,
    spawn,
  }
}

function successfulHandles(
  gateway = handle('', { done: new Promise(() => {}) }),
  extensionOutputs: readonly string[] = [],
): FakeHandle[] {
  return [
    handle('v24.19.0\n'),
    handle('{}\n'),
    handle(inspection()),
    ...extensionOutputs.map(output => handle(output)),
    gateway,
  ]
}

describe('runtime inspection contract', () => {
  it('accepts the exact hybrid provider and AgentHarness registrations in any order', () => {
    expect(() => { verifyRuntimeInspection(inspection()) }).not.toThrow()
    expect(() => { verifyRuntimeInspection(inspection({
      capabilities: [
        { kind: 'agent-harness', ids: ['clawdsh'] },
        { kind: 'text-inference', ids: ['clawdsh'] },
      ],
      diagnostics: [{ level: 'warning' }],
      compatibility: [{ severity: 'info' }],
    })) }).not.toThrow()
  })

  it.each([
    ['non-JSON', 'not json'],
    ['non-object', '[]'],
    ['missing plugin object', inspection({ plugin: null })],
    ['wrong plugin', inspection({ plugin: { id: 'other', status: 'loaded', imported: true } })],
    ['plugin error', inspection({ plugin: { id: 'clawdsh-bridge', status: 'loaded', imported: true, error: 'bad' } })],
    ['wrong shape', inspection({ shape: 'provider' })],
    ['missing capabilities', inspection({ capabilities: null })],
    ['invalid capability', inspection({ capabilities: [{ kind: 1, ids: [] }] })],
    ['non-string capability id', inspection({ capabilities: [{ kind: 'agent-harness', ids: [1] }] })],
    ['extra capability', inspection({ capabilities: [{ kind: 'other', ids: ['clawdsh'] }] })],
    ['missing diagnostics', inspection({ diagnostics: null })],
    ['diagnostic error', inspection({ diagnostics: [{ level: 'error' }] })],
    ['missing compatibility', inspection({ compatibility: null })],
    ['compatibility error', inspection({ compatibility: [{ severity: 'error' }] })],
    ['invalid diagnostic entry', inspection({ diagnostics: [null] })],
  ])('rejects %s', (_label, value) => {
    expect(() => { verifyRuntimeInspection(value) }).toThrow(/channel-openclaw/)
  })
})

describe('Windows supervisor boundary', () => {
  it.runIf(process.platform === 'win32')('fails closed before preflight when 0700 directory semantics are unavailable', async () => {
    const app = await fixture()
    const process = contextWith([])

    await expect(OpenClawSupervisor.start(process.ctx, app.config)).rejects.toThrow(/ordinary 0700/)
    expect(process.spawn).not.toHaveBeenCalled()
    expect(mocks.createProvider).not.toHaveBeenCalled()
  })
})

describe.skipIf(process.platform === 'win32')('managed POSIX Gateway supervision', () => {
  it('exposes structural and read-only deployment preflight before configuration is persisted', async () => {
    const app = await fixture()
    expect(() => { validateOpenClawConfig(app.config) }).not.toThrow()
    mocks.verifyRuntimeInstallation.mockRejectedValueOnce(new Error('managed runtime missing'))
    await expect(validateOpenClawDeployment(app.config)).rejects.toThrow(/managed runtime missing/)
    expect(mocks.createProvider).not.toHaveBeenCalled()
  })

  it('validates desired deployment without runtime state, a Provider, sockets, or subprocesses', async () => {
    const app = await fixture()
    await expect(validateOpenClawDeployment(app.config)).resolves.toBeUndefined()
    expect(mocks.createProvider).not.toHaveBeenCalled()
    await expect(lstat(join(app.config.stateDir, 'workspace'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preflights the installed CLI without creating runtime state, a Provider, or a Gateway', async () => {
    const app = await fixture()
    const process = contextWith(successfulHandles().slice(0, 3))
    await expect(preflightOpenClawDeployment(process.ctx, app.config)).resolves.toMatchObject({
      lock: { track: 'production' },
      nodePath: '/opt/node',
      executable: join(app.config.hostRoot, 'openclaw.mjs'),
    })
    expect(process.spawn).toHaveBeenCalledTimes(3)
    expect(mocks.createProvider).not.toHaveBeenCalled()
    await expect(lstat(join(app.config.stateDir, 'workspace'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preflights the locked runtime, starts with isolated environment, and tears down in order', async () => {
    const injectedEnvironment = {
      NODE_OPTIONS: '--import=/tmp/untrusted-loader.mjs',
      NODE_PATH: '/tmp/untrusted-modules',
      NODE_TEST_CONTEXT: 'untrusted-node-setting',
      LD_PRELOAD: '/tmp/untrusted-native.so',
      DYLD_INSERT_LIBRARIES: '/tmp/untrusted-native.dylib',
      OPENSSL_CONF: '/tmp/untrusted-openssl.cnf',
      SSLKEYLOGFILE: '/tmp/untrusted-tls-keys',
    }
    for (const [key, value] of Object.entries(injectedEnvironment)) vi.stubEnv(key, value)
    const app = await fixture()
    const gateway = handle('', { done: new Promise(() => {}) })
    const process = contextWith(successfulHandles(gateway))
    const supervisor = await OpenClawSupervisor.start(process.ctx, app.config)
    expect(mocks.verifyRuntimeInstallation).toHaveBeenCalledWith(
      expect.objectContaining({ track: 'production' }), app.config.runtimeRoot, app.config.hostRoot,
    )
    expect(mocks.verifyManagedHost).toHaveBeenCalledWith(
      expect.objectContaining({ tag: 'v2026.7.1-2' }), app.config.artifactPath, app.config.hostRoot,
    )
    expect(mocks.verifyFailClosedConfig).toHaveBeenCalledWith(
      app.config.configPath, expect.stringMatching(/bridge\/stable-v1\/?$/),
      app.config.stateDir,
      [],
    )
    expect(process.spawn).toHaveBeenCalledTimes(4)
    const gatewayCall = process.spawn.mock.calls[3]?.[0] as { argv: string[]; env: NodeJS.ProcessEnv }
    expect(gatewayCall.argv).toEqual(['/opt/node', join(app.config.hostRoot, 'openclaw.mjs'), 'gateway', 'run', '--port', '18789'])
    expect(gatewayCall.env).toMatchObject({
      OPENCLAW_NIX_MODE: '1',
      CLAWDSH_CHANNEL_TOKEN: 'runtime-token',
      CLAWDSH_CHANNEL_STARTUP_NONCE: 'runtime-nonce',
      CLAWDSH_CHANNEL_REQUEST_TIMEOUT_MS: '750',
      CLAWDSH_CHANNEL_MAX_MEDIA_BYTES: String(5 * 1024 * 1024),
      CLAWDSH_OPENCLAW_AGENT_HARNESS: 'v1',
    })
    expect(gatewayCall.env.PATH).toBeUndefined()
    for (const [call] of process.spawn.mock.calls) {
      const env = (call as { env: NodeJS.ProcessEnv }).env
      for (const key of Object.keys(injectedEnvironment)) {
        expect(Object.hasOwn(env, key), `${key} tombstone`).toBe(true)
        expect(env[key], `${key} value`).toBeUndefined()
      }
    }

    const firstDispose = supervisor.dispose()
    expect(supervisor.dispose()).toBe(firstDispose)
    await firstDispose
    expect(app.provider.beginShutdown).toHaveBeenCalledOnce()
    expect(gateway.terminate).toHaveBeenCalledOnce()
    expect(gateway.waitForExit).toHaveBeenCalledOnce()
    expect(app.provider.dispose).toHaveBeenCalledOnce()
  })

  it('reports an unexpected post-handshake process exit without exposing diagnostics', async () => {
    const app = await fixture()
    const terminal = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
    const gateway = handle('secret diagnostic canary', { done: terminal.promise })
    const supervisor = await OpenClawSupervisor.start(
      contextWith(successfulHandles(gateway)).ctx,
      app.config,
    )

    terminal.resolve({ exitCode: 23, signal: null })

    await expect(supervisor.done).resolves.toBe('failed')
    expect(app.provider.beginShutdown).toHaveBeenCalledOnce()
    expect(gateway.terminate).not.toHaveBeenCalled()
  })

  it('distinguishes an intentional teardown from an unexpected process exit', async () => {
    const app = await fixture()
    const terminal = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
    const gateway = handle('', { done: terminal.promise })
    gateway.terminate.mockImplementation(() => {
      terminal.resolve({ exitCode: null, signal: 'SIGTERM' })
    })
    const supervisor = await OpenClawSupervisor.start(
      contextWith(successfulHandles(gateway)).ctx,
      app.config,
    )

    const disposal = supervisor.dispose()

    await expect(supervisor.done).resolves.toBe('stopped')
    await disposal
    expect(app.provider.beginShutdown).toHaveBeenCalledOnce()
  })

  it('selects the isolated Canary V2 bridge without falling back to production', async () => {
    const app = await fixture()
    const process = contextWith(successfulHandles())
    const supervisor = await OpenClawSupervisor.start(process.ctx, { ...app.config, track: 'canary' })
    expect(mocks.verifyFailClosedConfig).toHaveBeenCalledWith(
      app.config.configPath,
      expect.stringMatching(/bridge\/canary-v2\/?$/),
      app.config.stateDir,
      [],
    )
    const gatewayCall = process.spawn.mock.calls[3]?.[0] as { env: NodeJS.ProcessEnv }
    expect(gatewayCall.env.CLAWDSH_OPENCLAW_AGENT_HARNESS).toBe('v2')
    await supervisor.dispose()
  })

  it('preflights every locked extension and binds inspection to its verified root', async () => {
    const app = await fixture()
    const gateway = handle('', { done: new Promise(() => {}) })
    mocks.verifyExtensionInstallations.mockResolvedValueOnce(new Map([['qqbot', '/verified/qqbot']]))
    const process = contextWith(successfulHandles(gateway, ['extension inspection']))
    const config = { ...app.config, extensions: [extensionLock] }
    const supervisor = await OpenClawSupervisor.start(process.ctx, config)

    expect(mocks.verifyExtensionInstallations).toHaveBeenCalledWith(
      config.extensions, config.stateDir, config.hostRoot,
    )
    expect(mocks.verifyFailClosedConfig).toHaveBeenCalledWith(
      config.configPath, expect.stringMatching(/bridge\/stable-v1\/?$/), config.stateDir, config.extensions,
    )
    const extensionCall = process.spawn.mock.calls[3]?.[0] as { argv: string[] }
    expect(extensionCall.argv).toEqual([
      '/opt/node', join(config.hostRoot, 'openclaw.mjs'),
      'plugins', 'inspect', 'qqbot', '--runtime', '--json',
    ])
    expect(mocks.verifyExtensionRuntimeInspection)
      .toHaveBeenCalledWith('extension inspection', extensionLock, '/verified/qqbot')
    expect(process.spawn).toHaveBeenCalledTimes(5)
    await supervisor.dispose()
  })

  it('refuses to start a Provider if a verified extension root disappears from preflight state', async () => {
    const app = await fixture()
    mocks.verifyExtensionInstallations.mockResolvedValueOnce(new Map())
    const process = contextWith(successfulHandles(undefined, ['extension inspection']))
    await expect(OpenClawSupervisor.start(process.ctx, { ...app.config, extensions: [extensionLock] }))
      .rejects.toThrow(/lost its verified package root/)
    expect(mocks.createProvider).not.toHaveBeenCalled()
  })

  it('rejects every invalid scalar or path relation before host launch', async () => {
    const app = await fixture()
    const cases: Array<[string, Partial<OpenClawSupervisorConfig>]> = [
      ['relative node path', { nodePath: 'bin/node' }],
      ['relative artifact', { artifactPath: 'openclaw.tgz' }],
      ['relative runtime', { runtimeRoot: 'runtime' }],
      ['zero frame bound', { maxFrameBytes: 0 }],
      ['fractional in-flight bound', { maxInFlight: 1.5 }],
      ['zero request timeout', { requestTimeoutMs: 0 }],
      ['zero media bound', { maxMediaBytes: 0 }],
      ['unsafe timeout', { startupTimeoutMs: Number.MAX_SAFE_INTEGER + 1 }],
      ['port zero', { gatewayPort: 0 }],
      ['port too high', { gatewayPort: 65_536 }],
      ['blank instance', { gatewayInstanceId: ' ' }],
    ]
    for (const [label, override] of cases) {
      const process = contextWith([])
      await expect(OpenClawSupervisor.start(process.ctx, { ...app.config, ...override }), label)
        .rejects.toThrow(/channel-openclaw/)
      expect(process.spawn, label).not.toHaveBeenCalled()
    }
  })

  it('rejects public, non-directory, escaping, and symlinked state paths', async () => {
    const publicApp = await fixture()
    await chmod(publicApp.config.stateDir, 0o755)
    await expect(OpenClawSupervisor.start(contextWith([]).ctx, publicApp.config)).rejects.toThrow(/ordinary 0700/)

    const fileApp = await fixture()
    const fileState = join(fileApp.root, 'state-file')
    await writeFile(fileState, 'file')
    await expect(OpenClawSupervisor.start(contextWith([]).ctx, {
      ...fileApp.config, stateDir: fileState,
    })).rejects.toThrow()

    const escaping = await fixture()
    await expect(OpenClawSupervisor.start(contextWith([]).ctx, {
      ...escaping.config, configPath: join(escaping.root, 'outside.json'),
    })).rejects.toThrow(/inside stateDir/)

    const linked = await fixture()
    const outside = join(linked.root, 'outside')
    await mkdir(outside)
    const link = join(linked.config.stateDir, 'link')
    await symlink(outside, link)
    await expect(OpenClawSupervisor.start(contextWith([]).ctx, {
      ...linked.config, configPath: join(link, 'config.json'),
    })).rejects.toThrow(/symbolic link/)
  })

  it('enforces the locked Node engine and ordinary OpenClaw entrypoint', async () => {
    const badNode = await fixture()
    await expect(OpenClawSupervisor.start(contextWith([handle('v20.0.0\n')]).ctx, badNode.config))
      .rejects.toThrow(/does not satisfy locked engine/)
    const malformedNode = await fixture()
    await expect(OpenClawSupervisor.start(contextWith([handle('not-semver\n')]).ctx, malformedNode.config))
      .rejects.toThrow(/does not satisfy locked engine/)

    const directoryEntry = await fixture()
    await rm(join(directoryEntry.config.hostRoot, 'openclaw.mjs'))
    await mkdir(join(directoryEntry.config.hostRoot, 'openclaw.mjs'))
    await expect(OpenClawSupervisor.start(contextWith([handle('v24.19.0\n')]).ctx, directoryEntry.config))
      .rejects.toThrow(/ordinary file/)

    const symlinkEntry = await fixture()
    await rm(join(symlinkEntry.config.hostRoot, 'openclaw.mjs'))
    await writeFile(join(symlinkEntry.root, 'entry.mjs'), 'export {}')
    await symlink(join(symlinkEntry.root, 'entry.mjs'), join(symlinkEntry.config.hostRoot, 'openclaw.mjs'))
    await expect(OpenClawSupervisor.start(contextWith([handle('v24.19.0\n')]).ctx, symlinkEntry.config))
      .rejects.toThrow(/ordinary file/)
  })

  it('rejects lossy, missing, failed, malformed, and contract-violating preflight output', async () => {
    const cases: Array<[string, FakeHandle[]]> = [
      ['missing diagnostics', [handle('v24.19.0\n', { includeStdout: false })]],
      ['lossy diagnostics', [handle('v24.19.0\n', { lossyStderr: true })]],
      ['failed process', [handle('v24.19.0\n', { exitCode: 1 })]],
      ['signalled process', [handle('v24.19.0\n', { signal: 'SIGTERM' })]],
      ['malformed validation JSON', [handle('v24.19.0\n'), handle('not-json')]],
      ['non-object validation JSON', [handle('v24.19.0\n'), handle('[]')]],
      ['wrong runtime inspection', [handle('v24.19.0\n'), handle('{}'), handle(inspection({ shape: 'wrong' }))]],
    ]
    for (const [label, handles] of cases) {
      const app = await fixture()
      await expect(OpenClawSupervisor.start(contextWith(handles).ctx, app.config), label).rejects.toThrow(/channel-openclaw/)
    }
  })

  it('aborts a host preflight at its configured deadline', async () => {
    const app = await fixture()
    const spawn = vi.fn((options: { signal?: AbortSignal }) => {
      const stdout = { readFrom: () => ({ text: 'v24.19.0\n', lossy: false }) }
      const stderr = { readFrom: () => ({ text: '', lossy: false }) }
      return {
        done: new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
          options.signal?.addEventListener('abort', () => { resolve({ exitCode: 0, signal: null }) }, { once: true })
        }),
        collected: { stdout, stderr },
        terminate: vi.fn(),
        waitForExit: vi.fn(async () => true),
      }
    })
    const ctx = { subprocess: { resolveExecutable: async () => '/opt/node', spawn } } as never
    await expect(OpenClawSupervisor.start(ctx, { ...app.config, startupTimeoutMs: 5 }))
      .rejects.toThrow(/host preflight timed out/)
  })

  it('propagates Provider creation failure without inventing a Gateway cleanup target', async () => {
    const app = await fixture()
    mocks.createProvider.mockRejectedValueOnce(new Error('provider create failed'))
    await expect(OpenClawSupervisor.start(contextWith(successfulHandles().slice(0, 3)).ctx, app.config))
      .rejects.toThrow(/provider create failed/)
  })

  it('fails when the Gateway exits or times out before authentication and always releases resources', async () => {
    const exited = await fixture()
    const exitedGateway = handle('', { exitCode: 3 })
    exited.provider.firstHandshake = new Promise(() => {})
    await expect(OpenClawSupervisor.start(contextWith(successfulHandles(exitedGateway)).ctx, exited.config))
      .rejects.toThrow(/exited before bridge handshake/)
    expect(exitedGateway.terminate).toHaveBeenCalledOnce()
    expect(exited.provider.dispose).toHaveBeenCalledOnce()

    const timed = await fixture()
    timed.provider.firstHandshake = new Promise(() => {})
    const timedGateway = handle('', { done: new Promise(() => {}) })
    await expect(OpenClawSupervisor.start(contextWith(successfulHandles(timedGateway)).ctx, {
      ...timed.config, startupTimeoutMs: 10,
    })).rejects.toThrow(/startup timed out/)
    expect(timed.provider.dispose).toHaveBeenCalledOnce()
  })

  it('waits past authentication for bridge recovery and fails closed if recovery degrades', async () => {
    const recovered = await fixture()
    recovered.provider.health
      .mockResolvedValueOnce({ status: 'starting' })
      .mockResolvedValueOnce({ status: 'ready' })
    const runningGateway = handle('', { done: new Promise(() => {}) })
    const supervisor = await OpenClawSupervisor.start(
      contextWith(successfulHandles(runningGateway)).ctx,
      recovered.config,
    )
    expect(recovered.provider.health).toHaveBeenCalledTimes(2)
    await supervisor.dispose()

    const failed = await fixture()
    failed.provider.health.mockResolvedValue({ status: 'degraded' })
    const failedGateway = handle('', { done: new Promise(() => {}) })
    await expect(OpenClawSupervisor.start(
      contextWith(successfulHandles(failedGateway)).ctx,
      failed.config,
    )).rejects.toThrow(/recovery did not reach ready/)
    expect(failedGateway.terminate).toHaveBeenCalledOnce()
    expect(failed.provider.dispose).toHaveBeenCalledOnce()
  })

  it('surfaces incomplete cleanup and combines independent cleanup failures', async () => {
    const app = await fixture()
    app.provider.firstHandshake = new Promise(() => {})
    app.provider.dispose.mockRejectedValueOnce(new Error('provider close failed'))
    const gateway = handle('', { exitCode: 2, exits: false })
    await expect(OpenClawSupervisor.start(contextWith(successfulHandles(gateway)).ctx, app.config))
      .rejects.toBeInstanceOf(AggregateError)

    const disposeApp = await fixture()
    const disposeGateway = handle('', { done: new Promise(() => {}), exits: false })
    const supervisor = await OpenClawSupervisor.start(contextWith(successfulHandles(disposeGateway)).ctx, disposeApp.config)
    const failedDispose = supervisor.dispose()
    expect(supervisor.dispose()).toBe(failedDispose)
    await expect(failedDispose).rejects.toThrow(/did not exit/)
    expect(disposeApp.provider.dispose).toHaveBeenCalledOnce()

    const providerOnly = await fixture()
    providerOnly.provider.firstHandshake = new Promise(() => {})
    providerOnly.provider.dispose.mockRejectedValueOnce(new Error('provider-only cleanup failure'))
    const exitedGateway = handle('', { exitCode: 2, exits: true })
    await expect(OpenClawSupervisor.start(contextWith(successfulHandles(exitedGateway)).ctx, providerOnly.config))
      .rejects.toBeInstanceOf(AggregateError)

    const nonError = await fixture()
    const cleanGateway = handle('', { done: new Promise(() => {}), exits: true })
    const nonErrorSupervisor = await OpenClawSupervisor.start(contextWith(successfulHandles(cleanGateway)).ctx, nonError.config)
    nonError.provider.dispose.mockRejectedValueOnce('string cleanup failure')
    await expect(nonErrorSupervisor.dispose()).rejects.toEqual(new Error('string cleanup failure'))
  })

  it('bounds a Provider drain that ignores shutdown cancellation', async () => {
    const app = await fixture()
    app.provider.dispose.mockReturnValueOnce(new Promise<never>(() => {}))
    const gateway = handle('', { done: new Promise(() => {}), exits: true })
    const supervisor = await OpenClawSupervisor.start(
      contextWith(successfulHandles(gateway)).ctx,
      { ...app.config, shutdownGraceMs: 10 },
    )

    await expect(supervisor.dispose()).rejects.toThrow(/Provider cleanup did not complete within shutdownGraceMs/)
  })
})
