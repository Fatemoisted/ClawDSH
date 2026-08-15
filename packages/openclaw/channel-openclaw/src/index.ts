/** OpenClaw communication-plane Provider plugin. @module @clawdsh/dsh-channel-openclaw */

import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@clawdsh/dsh-channel'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-subprocess'
import { deepEqualJson, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { OpenClawExtensionLock } from './extensions.ts'
import {
  OpenClawSupervisor,
  preflightOpenClawDeployment,
  validateOpenClawConfig,
  type OpenClawSupervisorConfig,
} from './supervisor.ts'

export { CANARY_OPENCLAW_LOCK, PRODUCTION_OPENCLAW_LOCK, lockFor } from './locks.ts'
export { validateExtensionLocks, verifyExtensionInstallations, verifyExtensionRuntimeInspection } from './extensions.ts'
export { verifyFailClosedConfig, verifyManagedHost } from './integrity.ts'
export { OpenClawChannelProvider } from './server.ts'
export {
  OpenClawSupervisor,
  preflightOpenClawDeployment,
  validateOpenClawDeployment,
  validateOpenClawConfig,
  verifyRuntimeInspection,
} from './supervisor.ts'
export type { OpenClawRuntimeLock, OpenClawRuntimeTreeLock, OpenClawTrack } from './locks.ts'
export type { OpenClawExtensionLock } from './extensions.ts'
export type { ChannelIpcConfig, ChannelIpcSecrets } from './server.ts'
export type { OpenClawSupervisorConfig } from './supervisor.ts'

/** Cordis plugin name. */
export const name = 'channel-openclaw'

/** User-settings namespace for managed Gateway enablement and runtime limits. */
export const CHANNEL_OPENCLAW_SETTINGS_NAMESPACE = settingsNamespace('clawdsh-channel-openclaw')

/** Harness credential/environment reference controlling the temporary legacy channel plane. */
const LEGACY_CHANNELS_ENABLED_REF = credentialRef('CLAWDSH_LEGACY_CHANNELS_ENABLED')

/** Complete capability-seam dependencies for managed Gateway supervision. */
export const inject = ['channels', 'storageDomain', 'subprocess', 'settings']

declare module '@deepseek-ai/cordis' {
  interface Context {
    clawdshOpenClawControl: ClawdshOpenClawControl
  }
}

/** Fully explicit managed-Gateway configuration. */
export interface Config extends Omit<OpenClawSupervisorConfig, 'extensions'> {
  /** Whether the managed Gateway may preflight, bind IPC, or start a process. */
  readonly enabled: boolean
  /** Mutable schema output consumed as immutable extension locks by the Supervisor. */
  readonly extensions: OpenClawExtensionLock[]
}

/** Sanitized managed Gateway lifecycle state exposed to the local control plane. */
export interface OpenClawControlStatus {
  /** Whether the applied configuration requested a managed Gateway. */
  readonly enabled: boolean
  /** Current plugin-owned lifecycle state without platform account inference. */
  readonly state: 'disabled' | 'starting' | 'active' | 'failed'
}

/** Always-mounted validation and status seam for the local ClawDSH control plane. */
export class ClawdshOpenClawControl extends Service {
  private state: OpenClawControlStatus['state']

  /**
   * Publish control-plane state for the configuration captured at plugin startup.
   * @param ctx Plugin context that owns the service registration.
   * @param applied Restart-scoped Settings snapshot used by this runtime instance.
   */
  constructor(ctx: Context, private readonly applied: Config) {
    super(ctx, 'clawdshOpenClawControl')
    this.state = applied.enabled ? 'starting' : 'disabled'
  }

  /**
   * Return applied enablement and lifecycle state without platform account or credential data.
   * @returns Sanitized runtime state.
   */
  snapshot(): OpenClawControlStatus {
    return { enabled: this.applied.enabled, state: this.state }
  }

  /**
   * Validate desired user-owned settings while preserving managed deployment identities.
   * @param desired Complete desired plugin configuration produced by the settings resolver.
   * @returns Completion after every managed file and fail-closed configuration check passes.
   */
  async validateDesired(desired: Config): Promise<void> {
    const resolved = Config(desired)
    assertManagedConfig(resolved, this.applied)
    if (!resolved.enabled) return
    await assertLegacyChannelPlaneDisabled(this.ctx)
    await preflightOpenClawDeployment(this.ctx, resolved)
  }

  /** Record successful Gateway and Provider startup. */
  markActive(): void {
    this.state = 'active'
  }

  /** Record an unexpected post-handshake Gateway exit without exposing process diagnostics. */
  markFailed(): void {
    this.state = 'failed'
  }
}

/** Runtime schema whose disabled defaults require no installed Gateway artifacts. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false),
  track: z.union([z.const('production'), z.const('canary')]).default('production'),
  gatewayInstanceId: z.string().default(''),
  artifactPath: z.string().default(''),
  hostRoot: z.string().default(''),
  runtimeRoot: z.string().default(''),
  extensions: z.array(z.object({
    pluginId: z.string().min(1).required(),
    channelIds: z.array(z.string().min(1)).min(1).required(),
    packageName: z.string().min(1).required(),
    version: z.string().min(1).required(),
    integrity: z.string().min(1).required(),
    projectTree: z.object({
      fileCount: z.number().step(1).min(1).required(),
      sha512: z.string().min(128).max(128).required(),
    }).required(),
  })).default([]),
  nodePath: z.string().default('node'),
  configPath: z.string().default(''),
  stateDir: z.string().default(''),
  stagingRoot: z.string().default(''),
  maxMediaBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(5 * 1024 * 1024),
  endpoint: z.string().default(''),
  gatewayPort: z.number().step(1).min(1).max(65_535).default(18_789),
  maxFrameBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(1024 * 1024),
  maxInFlight: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(16),
  requestTimeoutMs: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(30_000),
  handshakeTimeoutMs: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(10_000),
  startupTimeoutMs: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(30_000),
  shutdownGraceMs: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(10_000),
  diagnosticBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(64 * 1024),
})

/** Verify, start, register, and lifecycle-bind one OpenClaw Gateway. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const settings = ctx.get('settings')
  const runtimeConfig = settings?.register(CHANNEL_OPENCLAW_SETTINGS_NAMESPACE, Config, {
    base: config,
    applies: 'restart',
    validate: (value) => {
      assertManagedConfig(value, config)
      if (value.enabled) validateOpenClawConfig(value)
    },
  }).get() ?? config
  assertManagedConfig(runtimeConfig, config)
  if (runtimeConfig.enabled) await assertLegacyChannelPlaneDisabled(ctx)
  const control = new ClawdshOpenClawControl(ctx, runtimeConfig)
  if (!runtimeConfig.enabled) return
  const supervisor = await OpenClawSupervisor.start(ctx, runtimeConfig)
  let unregister: () => void
  try {
    unregister = ctx.channels.registerProvider(supervisor.provider)
  } catch (error) {
    await supervisor.dispose()
    throw error
  }
  try {
    ctx.effect(function* () {
      yield () => supervisor.dispose()
      yield unregister
    }, 'channel-openclaw.supervisor()')
  } catch (error) {
    unregister()
    await supervisor.dispose()
    throw error
  }
  control.markActive()
  void supervisor.done.then(
    (outcome) => { if (outcome === 'failed') control.markFailed() },
    () => { control.markFailed() },
  )
}

/**
 * Refuse a managed Gateway while the temporary in-process channel adapters are enabled.
 * @param ctx Plugin context carrying the Harness credential and launch-environment seams.
 * @returns Completion once the legacy-plane flag has been resolved and found disabled.
 */
async function assertLegacyChannelPlaneDisabled(ctx: Context): Promise<void> {
  const credentials = ctx.get('credentials')
  const raw = credentials === undefined
    ? launchEnvironmentOf(ctx).get(String(LEGACY_CHANNELS_ENABLED_REF))?.value
    : (await credentials.resolve(LEGACY_CHANNELS_ENABLED_REF))?.value
  if (!parseEnabledFlag(raw)) return
  throw new Error(
    'channel-openclaw: managed Gateway cannot be enabled while ' +
    'CLAWDSH_LEGACY_CHANNELS_ENABLED enables the legacy channel plane',
  )
}

/**
 * Parse an environment-backed enabled flag using the repository's boolean vocabulary.
 * @param value Raw credential or launch-environment value.
 * @returns Whether the flag enables its feature.
 */
function parseEnabledFlag(value: string | undefined): boolean {
  if (value === undefined || value === '') return false
  switch (value.toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true
    case '0':
    case 'false':
    case 'no':
    case 'off':
      return false
    default:
      throw new TypeError(
        'channel-openclaw: CLAWDSH_LEGACY_CHANNELS_ENABLED must be ' +
        '1/true/yes/on or 0/false/no/off when set',
      )
  }
}

/** Refuse user-layer replacement of installer-owned Gateway deployment identities. */
function assertManagedConfig(config: Config, base: Config): void {
  const changed = [
    config.track === base.track ? undefined : 'track',
    config.gatewayInstanceId === base.gatewayInstanceId ? undefined : 'gatewayInstanceId',
    config.artifactPath === base.artifactPath ? undefined : 'artifactPath',
    config.runtimeRoot === base.runtimeRoot ? undefined : 'runtimeRoot',
    config.hostRoot === base.hostRoot ? undefined : 'hostRoot',
    config.nodePath === base.nodePath ? undefined : 'nodePath',
    config.configPath === base.configPath ? undefined : 'configPath',
    config.stateDir === base.stateDir ? undefined : 'stateDir',
    config.stagingRoot === base.stagingRoot ? undefined : 'stagingRoot',
    config.endpoint === base.endpoint ? undefined : 'endpoint',
    deepEqualJson(config.extensions, base.extensions) ? undefined : 'extensions',
    config.maxMediaBytes === base.maxMediaBytes ? undefined : 'maxMediaBytes',
  ].filter((field): field is string => field !== undefined)
  if (changed.length !== 0) {
    throw new Error(`channel-openclaw: ${changed.join(', ')} ${changed.length === 1 ? 'is' : 'are'} installer-managed and cannot be overridden by user settings`)
  }
}
