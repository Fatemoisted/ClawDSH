/** Locked OpenClaw Gateway preflight, startup, and teardown. @module @clawdsh/dsh-channel-openclaw/supervisor */

import { lstat, mkdir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { satisfies, valid } from 'semver'
import {
  validateExtensionLocks,
  verifyExtensionInstallations,
  verifyExtensionRuntimeInspection,
  type OpenClawExtensionLock,
} from './extensions.ts'
import { verifyFailClosedConfig, verifyManagedHost, verifyRuntimeInstallation } from './integrity.ts'
import { lockFor, type OpenClawRuntimeLock } from './locks.ts'
import { OpenClawChannelProvider, type ChannelIpcConfig } from './server.ts'

/** Fully explicit deployment inputs for one supervised Gateway. */
export interface OpenClawSupervisorConfig extends ChannelIpcConfig {
  /** Exact downloaded host archive used to verify the extracted runtime. */
  readonly artifactPath: string
  /** Root of the extracted OpenClaw npm package. */
  readonly hostRoot: string
  /** Root containing the checked package lock and node_modules/openclaw installation. */
  readonly runtimeRoot: string
  /** Explicit exact locks for separately installed Channel plugins; empty disables all such plugins. */
  readonly extensions: readonly OpenClawExtensionLock[]
  /** Dedicated Node executable satisfying the locked host engine. */
  readonly nodePath: string
  /** Strict JSON OpenClaw configuration kept in the isolated state directory. */
  readonly configPath: string
  /** Private per-track OpenClaw state directory. */
  readonly stateDir: string
  /** Private shared root for authenticated inbound media staging. */
  readonly stagingRoot: string
  /** Maximum staged media bytes accepted by the supervised bridge. */
  readonly maxMediaBytes: number
  /** Loopback Gateway port selected by the operator. */
  readonly gatewayPort: number
  /** Bound for host preflight and the first authenticated bridge handshake. */
  readonly startupTimeoutMs: number
  /** Process-tree TERM-to-KILL and teardown wait bound. */
  readonly shutdownGraceMs: number
  /** Bounded bytes retained for each host diagnostic stream. */
  readonly diagnosticBytes: number
}

/** Immutable result of a read-only managed deployment preflight. */
export interface OpenClawPreflightResult {
  /** Locked release selected by the managed production or canary track. */
  readonly lock: OpenClawRuntimeLock
  /** Resolved dedicated Node executable satisfying the locked host engine. */
  readonly nodePath: string
  /** Verified OpenClaw CLI and Gateway entrypoint. */
  readonly executable: string
}

interface VerifiedOpenClawInstallation {
  readonly lock: OpenClawRuntimeLock
  readonly executable: string
  readonly extensionRoots: ReadonlyMap<string, string>
}

/**
 * Validate deployment scalars and path relationships without reading or mutating the host.
 * @param config Fully explicit managed deployment inputs.
 */
export function validateOpenClawConfig(config: OpenClawSupervisorConfig): void {
  validateConfig(config)
}

/**
 * Verify managed files and fail-closed configuration without persistence, sockets, or subprocesses.
 * @param config Fully explicit managed deployment inputs.
 * @returns Completion after the complete read-only managed deployment validation passes.
 */
export async function validateOpenClawDeployment(config: OpenClawSupervisorConfig): Promise<void> {
  await validateManagedInstallation(config)
}

/**
 * Verify a managed deployment without binding IPC, creating directories, or starting the Gateway.
 * @param ctx Cordis context providing bounded subprocess inspection.
 * @param config Fully explicit managed deployment inputs.
 * @returns Verified immutable inputs reusable by Gateway startup.
 */
export async function preflightOpenClawDeployment(
  ctx: Context,
  config: OpenClawSupervisorConfig,
): Promise<OpenClawPreflightResult> {
  const { executable, extensionRoots, lock } = await validateManagedInstallation(config)
  const nodePath = await ctx.subprocess.resolveExecutable(config.nodePath)
  await verifyNodeEngine(ctx, nodePath, lock, config)
  const preflightEnvironment = bridgeEnvironment(config, lock, {
    token: 'preflight-token-not-valid-for-runtime',
    startupNonce: 'preflight-nonce-not-valid-for-runtime',
  })
  const validateOutput = await runChecked(
    ctx,
    [nodePath, executable, 'config', 'validate', '--json'],
    config.hostRoot,
    preflightEnvironment,
    config,
  )
  requireJsonObject(validateOutput, 'OpenClaw config validation')
  const inspectionOutput = await runChecked(
    ctx,
    [nodePath, executable, 'plugins', 'inspect', 'clawdsh-bridge', '--runtime', '--json'],
    config.hostRoot,
    preflightEnvironment,
    config,
  )
  verifyRuntimeInspection(inspectionOutput)
  for (const extension of config.extensions) {
    const extensionOutput = await runChecked(
      ctx,
      [nodePath, executable, 'plugins', 'inspect', extension.pluginId, '--runtime', '--json'],
      config.hostRoot,
      preflightEnvironment,
      config,
    )
    const expectedRoot = extensionRoots.get(extension.pluginId)
    if (expectedRoot === undefined) throw new Error(`channel-openclaw: extension ${extension.pluginId} lost its verified package root`)
    await verifyExtensionRuntimeInspection(extensionOutput, extension, expectedRoot)
  }
  return { lock, nodePath, executable }
}

/** Validate immutable managed installation state without invoking the installed runtime. */
async function validateManagedInstallation(
  config: OpenClawSupervisorConfig,
): Promise<VerifiedOpenClawInstallation> {
  validateConfig(config)
  const lock = lockFor(config.track)
  await requirePrivateDirectory(config.stateDir)
  await requirePrivateDirectory(config.stagingRoot)
  await requireContained(config.stateDir, config.configPath, 'configPath')
  await requireContained(config.stateDir, config.endpoint, 'endpoint')
  await requireContained(config.stateDir, config.stagingRoot, 'stagingRoot')
  await verifyRuntimeInstallation(lock, config.runtimeRoot, config.hostRoot)
  await verifyManagedHost(lock, config.artifactPath, config.hostRoot)
  const extensionRoots = await verifyExtensionInstallations(config.extensions, config.stateDir, config.hostRoot)
  await verifyFailClosedConfig(config.configPath, bridgeRootFor(lock), config.stateDir, config.extensions)
  const executable = resolve(config.hostRoot, 'openclaw.mjs')
  await requireOrdinaryFile(executable, 'OpenClaw entrypoint')
  return { lock, executable, extensionRoots }
}

/** One verified Gateway process and its authenticated Provider endpoint. */
export class OpenClawSupervisor {
  private disposePromise: Promise<void> | undefined
  private stopping = false

  /** Sanitized terminal state for the supervised process after startup succeeds. */
  readonly done: Promise<'stopped' | 'failed'>

  private constructor(
    readonly provider: OpenClawChannelProvider,
    private readonly gateway: SubprocessHandle,
    private readonly shutdownGraceMs: number,
  ) {
    const observeExit = (): 'stopped' | 'failed' => {
      if (this.stopping) return 'stopped'
      this.provider.beginShutdown()
      return 'failed'
    }
    this.done = gateway.done.then(observeExit, observeExit)
  }

  /**
   * Verify every immutable input, start the Gateway, and require its exact bridge handshake.
   * @param ctx Cordis context providing subprocess and Provider dependencies.
   * @param config Fully explicit locked deployment configuration.
   * @returns Running supervised Gateway and authenticated Provider endpoint.
   */
  static async start(ctx: Context, config: OpenClawSupervisorConfig): Promise<OpenClawSupervisor> {
    const { executable, lock, nodePath } = await preflightOpenClawDeployment(ctx, config)
    await preparePrivateDirectory(resolve(config.stateDir, 'workspace'))
    let provider: OpenClawChannelProvider | undefined
    let gateway: SubprocessHandle | undefined
    try {
      provider = await OpenClawChannelProvider.create(ctx, config)
      const environment = bridgeEnvironment(config, lock, provider.secrets)
      gateway = ctx.subprocess.spawn({
        argv: [nodePath, executable, 'gateway', 'run', '--port', String(config.gatewayPort)],
        cwd: config.hostRoot,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: config.diagnosticBytes },
          stderr: { maxBytes: config.diagnosticBytes },
        },
        graceMs: config.shutdownGraceMs,
        env: environment,
      })
      await awaitStartup(provider, gateway, config.startupTimeoutMs)
      return new OpenClawSupervisor(provider, gateway, config.shutdownGraceMs)
    } catch (error) {
      try {
        await shutdownGateway(provider, gateway, config.shutdownGraceMs)
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'channel-openclaw: Gateway startup failed and cleanup was incomplete')
      }
      throw error
    }
  }

  /** Stop the Gateway tree before closing the IPC Provider and its durable ledger. */
  dispose(): Promise<void> {
    this.stopping = true
    this.disposePromise ??= shutdownGateway(this.provider, this.gateway, this.shutdownGraceMs)
    return this.disposePromise
  }
}

/** Validate values whose relationships Schemastery cannot express. */
function validateConfig(config: OpenClawSupervisorConfig): void {
  validateExtensionLocks(config.extensions)
  const absolutePaths: Array<[string, string]> = [
    ['artifactPath', config.artifactPath],
    ['hostRoot', config.hostRoot],
    ['runtimeRoot', config.runtimeRoot],
    ['configPath', config.configPath],
    ['stateDir', config.stateDir],
    ['stagingRoot', config.stagingRoot],
    ['endpoint', config.endpoint],
  ]
  if (config.nodePath.includes('/') && !isAbsolute(config.nodePath)) {
    throw new Error('channel-openclaw: nodePath must be an absolute path or a bare executable name')
  }
  for (const [name, path] of absolutePaths) {
    if (!isAbsolute(path)) throw new Error(`channel-openclaw: ${name} must be absolute`)
  }
  for (const [name, value] of [
    ['maxFrameBytes', config.maxFrameBytes],
    ['maxInFlight', config.maxInFlight],
    ['requestTimeoutMs', config.requestTimeoutMs],
    ['maxMediaBytes', config.maxMediaBytes],
    ['handshakeTimeoutMs', config.handshakeTimeoutMs],
    ['startupTimeoutMs', config.startupTimeoutMs],
    ['shutdownGraceMs', config.shutdownGraceMs],
    ['diagnosticBytes', config.diagnosticBytes],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`channel-openclaw: ${name} must be a positive safe integer`)
    }
  }
  if (!Number.isSafeInteger(config.gatewayPort) || config.gatewayPort < 1 || config.gatewayPort > 65_535) {
    throw new Error('channel-openclaw: gatewayPort must be an integer from 1 through 65535')
  }
  if (config.gatewayInstanceId.trim() === '') throw new Error('channel-openclaw: gatewayInstanceId must be non-blank')
}

/** Create or validate a non-symlink directory inaccessible to other users. */
async function preparePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  await requirePrivateDirectory(path)
}

/** Require an existing non-symlink directory inaccessible to other users. */
async function requirePrivateDirectory(path: string): Promise<void> {
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
    throw new Error(`channel-openclaw: private directory is not an ordinary 0700 directory: ${path}`)
  }
}

/** Require a configured path to stay within its private state root. */
async function requireContained(root: string, path: string, label: string): Promise<void> {
  const lexicalRoot = resolve(root)
  const canonicalRoot = await realpath(root)
  const target = resolve(path)
  const rel = relative(lexicalRoot, target)
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`channel-openclaw: ${label} must be inside stateDir`)
  }
  const parent = await realpath(dirname(target))
  const parentRel = relative(canonicalRoot, parent)
  if (parentRel === '..' || parentRel.startsWith(`..${sep}`) || isAbsolute(parentRel)) {
    throw new Error(`channel-openclaw: ${label} parent escapes stateDir through a symbolic link`)
  }
}

/** Require an immutable host entry to be an ordinary non-symlink file. */
async function requireOrdinaryFile(path: string, label: string): Promise<void> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`channel-openclaw: ${label} must be an ordinary file`)
}

/** Choose the bridge adapter built for the lock's public SDK generation. */
function bridgeRootFor(lock: OpenClawRuntimeLock): string {
  const directory = lock.agentHarness === 'v1' ? 'stable-v1' : 'canary-v2'
  return fileURLToPath(new URL(`../bridge/${directory}/`, import.meta.url))
}

/** Run the dedicated Node executable and enforce its exact host engine range. */
async function verifyNodeEngine(
  ctx: Context,
  nodePath: string,
  lock: OpenClawRuntimeLock,
  config: OpenClawSupervisorConfig,
): Promise<void> {
  const output = (await runChecked(
    ctx,
    [nodePath, '--version'],
    config.hostRoot,
    nodeInjectionTombstones(),
    config,
  )).trim()
  const version = output.startsWith('v') ? output.slice(1) : output
  if (valid(version) === null || !satisfies(version, lock.nodeEngine)) {
    throw new Error(`channel-openclaw: Node ${JSON.stringify(output)} does not satisfy locked engine ${lock.nodeEngine}`)
  }
}

/** Run one bounded host preflight and return its complete stdout. */
async function runChecked(
  ctx: Context,
  argv: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  config: Pick<OpenClawSupervisorConfig, 'shutdownGraceMs' | 'startupTimeoutMs' | 'diagnosticBytes'>,
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort(new Error('channel-openclaw: host preflight timed out')) }, config.startupTimeoutMs)
  timer.unref()
  const handle = ctx.subprocess.spawn({
    argv,
    cwd,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: config.diagnosticBytes },
      stderr: { maxBytes: config.diagnosticBytes },
    },
    graceMs: config.shutdownGraceMs,
    signal: controller.signal,
    env,
  })
  try {
    const outcome = await handle.done
    if (controller.signal.aborted) throw asError(controller.signal.reason)
    const stdout = handle.collected.stdout?.readFrom(0)
    const stderr = handle.collected.stderr?.readFrom(0)
    if (stdout === undefined || stderr === undefined || stdout.lossy || stderr.lossy) {
      throw new Error('channel-openclaw: host preflight diagnostics exceeded diagnosticBytes')
    }
    if (outcome.exitCode !== 0 || outcome.signal !== null) {
      throw new Error(`channel-openclaw: host preflight failed with exit ${String(outcome.exitCode)} signal ${String(outcome.signal)}`)
    }
    return stdout.text
  } finally {
    clearTimeout(timer)
  }
}

/** Supply only the state and bridge facts intentionally exposed to OpenClaw. */
function bridgeEnvironment(
  config: OpenClawSupervisorConfig,
  lock: OpenClawRuntimeLock,
  secrets: { readonly token: string; readonly startupNonce: string },
): NodeJS.ProcessEnv {
  return {
    ...nodeInjectionTombstones(),
    NODE_ENV: 'production',
    OPENCLAW_CONFIG_PATH: config.configPath,
    OPENCLAW_NIX_MODE: '1',
    OPENCLAW_STATE_DIR: config.stateDir,
    CLAWDSH_CHANNEL_ENDPOINT: config.endpoint,
    CLAWDSH_CHANNEL_TOKEN: secrets.token,
    CLAWDSH_CHANNEL_STARTUP_NONCE: secrets.startupNonce,
    CLAWDSH_CHANNEL_GATEWAY_INSTANCE_ID: config.gatewayInstanceId,
    CLAWDSH_CHANNEL_STAGING_ROOT: config.stagingRoot,
    CLAWDSH_CHANNEL_MAX_MEDIA_BYTES: String(config.maxMediaBytes),
    CLAWDSH_CHANNEL_MAX_FRAME_BYTES: String(config.maxFrameBytes),
    CLAWDSH_CHANNEL_MAX_IN_FLIGHT: String(config.maxInFlight),
    CLAWDSH_CHANNEL_REQUEST_TIMEOUT_MS: String(config.requestTimeoutMs),
    CLAWDSH_OPENCLAW_TAG: lock.tag,
    CLAWDSH_OPENCLAW_COMMIT_SHA: lock.commitSha,
    CLAWDSH_OPENCLAW_ARTIFACT_SHA512: lock.artifactSha512,
    CLAWDSH_OPENCLAW_NODE_ENGINE: lock.nodeEngine,
    CLAWDSH_OPENCLAW_AGENT_HARNESS: lock.agentHarness,
  }
}

/** Remove inherited JavaScript, native-loader, TLS-trust, and TLS-secret injection controls. */
function nodeInjectionTombstones(): NodeJS.ProcessEnv {
  const exact = new Set([
    'NODE_OPTIONS',
    'NODE_PATH',
    'OPENSSL_CONF',
    'OPENSSL_MODULES',
    'SSL_CERT_DIR',
    'SSL_CERT_FILE',
    'SSLKEYLOGFILE',
  ])
  const inherited = Object.keys(process.env).filter((key) => {
    const normalized = key.toUpperCase()
    return normalized.startsWith('NODE_') || normalized.startsWith('LD_') || normalized.startsWith('DYLD_')
      || exact.has(normalized)
  })
  return Object.fromEntries([...exact, ...inherited].map(key => [key, undefined]))
}

/**
 * Fail if the runtime inspection did not import the exact hybrid bridge registrations.
 * @param text Strict JSON emitted by OpenClaw's runtime inspector.
 */
export function verifyRuntimeInspection(text: string): void {
  const value = requireJsonObject(text, 'OpenClaw plugin inspection')
  const plugin = objectField(value, 'plugin')
  if (plugin.id !== 'clawdsh-bridge' || plugin.status !== 'loaded' || plugin.imported !== true
    || (plugin.error !== undefined && plugin.error !== null)) {
    throw new Error('channel-openclaw: runtime inspection did not load the exact ClawDSH bridge')
  }
  if (value.shape !== 'hybrid-capability' || value.capabilityMode !== 'hybrid') {
    throw new Error('channel-openclaw: bridge must expose the hybrid provider and AgentHarness capability')
  }
  const capabilities = value.capabilities
  if (!Array.isArray(capabilities)) throw new Error('channel-openclaw: runtime inspection capabilities are missing')
  const normalized = capabilities.map((candidate) => {
    const entry = asObject(candidate, 'runtime inspection capability')
    if (typeof entry.kind !== 'string' || !Array.isArray(entry.ids)
      || !entry.ids.every((id: unknown): id is string => typeof id === 'string')) {
      throw new Error('channel-openclaw: runtime inspection contains an invalid capability')
    }
    return { kind: entry.kind, ids: [...entry.ids].sort() }
  }).sort((left, right) => left.kind.localeCompare(right.kind))
  if (JSON.stringify(normalized) !== JSON.stringify([
    { kind: 'agent-harness', ids: ['clawdsh'] },
    { kind: 'text-inference', ids: ['clawdsh'] },
  ])) {
    throw new Error('channel-openclaw: bridge runtime capabilities differ from the locked provider/harness pair')
  }
  assertNoFailureEntries(value.diagnostics, 'diagnostics', 'error')
  assertNoFailureEntries(value.compatibility, 'compatibility', 'error')
}

/** Parse one CLI JSON object without accepting leading diagnostic text. */
function requireJsonObject(text: string, label: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch (cause) {
    throw new Error(`channel-openclaw: ${label} did not return strict JSON`, { cause })
  }
  return asObject(value, label)
}

/** Narrow an untrusted JSON value to an object. */
function asObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`channel-openclaw: ${label} must be an object`)
  }
  return value as Record<string, unknown>
}

/** Read one required nested object. */
function objectField(value: Record<string, unknown>, key: string): Record<string, unknown> {
  return asObject(value[key], `runtime inspection ${key}`)
}

/** Reject error-level entries in one runtime inspection list. */
function assertNoFailureEntries(value: unknown, label: string, severity: string): void {
  if (!Array.isArray(value)) throw new Error(`channel-openclaw: runtime inspection ${label} are missing`)
  for (const candidate of value) {
    const entry = asObject(candidate, `runtime inspection ${label} entry`)
    if (entry.level === severity || entry.severity === severity) {
      throw new Error(`channel-openclaw: runtime inspection reported ${label} failure`)
    }
  }
}

/** Require the process to remain alive until authentication and bridge recovery are complete. */
async function awaitStartup(
  provider: OpenClawChannelProvider,
  gateway: SubprocessHandle,
  timeoutMs: number,
): Promise<void> {
  const timeoutState = Promise.withResolvers<never>()
  const timer = setTimeout(() => {
    timeoutState.reject(new Error('channel-openclaw: Gateway bridge startup timed out'))
  }, timeoutMs)
  timer.unref()
  const exited = gateway.done.then((outcome) => {
    throw new Error(`channel-openclaw: Gateway exited before bridge handshake or recovery completed (exit ${String(outcome.exitCode)}, signal ${String(outcome.signal)})`)
  })
  const ready = (async () => {
    await provider.firstHandshake
    while (true) {
      const health = await provider.health()
      if (health.status === 'ready') return
      if (health.status === 'degraded' || health.status === 'failed'
        || health.status === 'stopping' || health.status === 'stopped') {
        throw new Error('channel-openclaw: Gateway bridge recovery did not reach ready state')
      }
      await delay(10, undefined, { ref: false })
    }
  })()
  try {
    await Promise.race([ready, exited, timeoutState.promise])
  } finally {
    clearTimeout(timer)
  }
}

/** Bound process-tree quiescence without claiming success when cleanup is incomplete. */
async function boundedExit(handle: SubprocessHandle, timeoutMs: number): Promise<void> {
  const exited = await handle.waitForExit(AbortSignal.timeout(timeoutMs))
  if (!exited) throw new Error('channel-openclaw: Gateway process tree did not exit within shutdownGraceMs')
}

/** Stop new IPC peers, quiesce the Gateway tree, and always release Provider resources. */
async function shutdownGateway(
  provider: OpenClawChannelProvider | undefined,
  gateway: SubprocessHandle | undefined,
  timeoutMs: number,
): Promise<void> {
  provider?.beginShutdown()
  gateway?.terminate()
  let gatewayError: unknown
  try {
    if (gateway !== undefined) await boundedExit(gateway, timeoutMs)
  } catch (error) {
    gatewayError = error
  }
  try {
    if (provider !== undefined) await boundedProviderDispose(provider, timeoutMs)
  } catch (providerError) {
    if (gatewayError !== undefined) {
      throw new AggregateError([gatewayError, providerError], 'channel-openclaw: Gateway and Provider cleanup both failed')
    }
    throw asError(providerError)
  }
  if (gatewayError !== undefined) throw asError(gatewayError)
}

/** Bound Provider handler drain and storage release without hiding incomplete cleanup. */
async function boundedProviderDispose(provider: OpenClawChannelProvider, timeoutMs: number): Promise<void> {
  const timeoutState = Promise.withResolvers<never>()
  const timer = setTimeout(() => {
    timeoutState.reject(new Error('channel-openclaw: Provider cleanup did not complete within shutdownGraceMs'))
  }, timeoutMs)
  timer.unref()
  try {
    await Promise.race([provider.dispose(), timeoutState.promise])
  } finally {
    clearTimeout(timer)
  }
}

/** Normalize a thrown process or cleanup value. */
function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}
