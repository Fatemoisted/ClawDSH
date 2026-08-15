/** OpenClaw communication-plane Provider plugin. @module @clawdsh/dsh-channel-openclaw */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@clawdsh/dsh-channel'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { OpenClawExtensionLock } from './extensions.ts'
import { OpenClawSupervisor, type OpenClawSupervisorConfig } from './supervisor.ts'

export { CANARY_OPENCLAW_LOCK, PRODUCTION_OPENCLAW_LOCK, lockFor } from './locks.ts'
export { validateExtensionLocks, verifyExtensionInstallations, verifyExtensionRuntimeInspection } from './extensions.ts'
export { verifyFailClosedConfig, verifyManagedHost } from './integrity.ts'
export { OpenClawChannelProvider } from './server.ts'
export { OpenClawSupervisor, verifyRuntimeInspection } from './supervisor.ts'
export type { OpenClawRuntimeLock, OpenClawRuntimeTreeLock, OpenClawTrack } from './locks.ts'
export type { OpenClawExtensionLock } from './extensions.ts'
export type { ChannelIpcConfig, ChannelIpcSecrets } from './server.ts'
export type { OpenClawSupervisorConfig } from './supervisor.ts'

/** Cordis plugin name. */
export const name = 'channel-openclaw'

/** Complete capability-seam dependencies for managed Gateway supervision. */
export const inject = ['channels', 'storageDomain', 'subprocess']

/** Fully explicit managed-Gateway configuration. */
export interface Config extends Omit<OpenClawSupervisorConfig, 'extensions'> {
  /** Mutable schema output consumed as immutable extension locks by the Supervisor. */
  readonly extensions: OpenClawExtensionLock[]
}

/** Runtime schema; every deployment-varying limit and path is operator-owned. */
export const Config: z<Config> = z.object({
  track: z.union([z.const('production'), z.const('canary')]).required(),
  gatewayInstanceId: z.string().min(1).required(),
  artifactPath: z.string().min(1).required(),
  hostRoot: z.string().min(1).required(),
  runtimeRoot: z.string().min(1).required(),
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
  nodePath: z.string().min(1).required(),
  configPath: z.string().min(1).required(),
  stateDir: z.string().min(1).required(),
  stagingRoot: z.string().min(1).required(),
  maxMediaBytes: z.number().step(1).min(1).required(),
  endpoint: z.string().min(1).required(),
  gatewayPort: z.number().step(1).min(1).required(),
  maxFrameBytes: z.number().step(1).min(1).required(),
  maxInFlight: z.number().step(1).min(1).required(),
  requestTimeoutMs: z.number().step(1).min(1).required(),
  handshakeTimeoutMs: z.number().step(1).min(1).required(),
  startupTimeoutMs: z.number().step(1).min(1).required(),
  shutdownGraceMs: z.number().step(1).min(1).required(),
  diagnosticBytes: z.number().step(1).min(1).required(),
})

/** Verify, start, register, and lifecycle-bind one OpenClaw Gateway. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const supervisor = await OpenClawSupervisor.start(ctx, config)
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
}
