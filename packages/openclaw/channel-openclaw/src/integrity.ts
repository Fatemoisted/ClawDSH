/** Offline verification of locked OpenClaw host artifacts and fail-closed config. @module @clawdsh/dsh-channel-openclaw/integrity */

import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateExtensionLocks, type OpenClawExtensionLock } from './extensions.ts'
import { installedProjectTreeDigest, ordinaryFileTreeDigest, sha512File } from './file-integrity.ts'
import type { OpenClawRuntimeLock } from './locks.ts'
import {
  installIdentity,
  installedPackageDirectories,
  isPackageLockPath,
  requireOrdinaryDirectory,
} from './npm-tree.ts'
import { supportsCurrentPlatform } from './npm-platform.ts'

export { sha512File } from './file-integrity.ts'

/**
 * Compute the lock's path-size-content tree digest.
 * @param root Extracted host package root.
 * @returns Ordinary-file count and deterministic SHA-512 tree digest.
 */
export async function hostTreeDigest(root: string): Promise<{ fileCount: number; sha512: string }> {
  return await ordinaryFileTreeDigest(root)
}

/**
 * Compute the complete installed npm project digest used by a platform runtime lock.
 * @param root Ordinary runtime project root including its complete node_modules tree.
 * @returns Ordinary-file count and deterministic SHA-512 assembly digest.
 */
export async function runtimeTreeDigest(root: string): Promise<{ fileCount: number; sha512: string }> {
  return await installedProjectTreeDigest(root)
}

/**
 * Verify the exact production tarball, package metadata, and extracted tree.
 * @param lock Immutable host identity and tree digest.
 * @param artifactPath Downloaded release artifact to hash.
 * @param hostRoot Extracted OpenClaw package root to inspect.
 */
export async function verifyManagedHost(
  lock: OpenClawRuntimeLock,
  artifactPath: string,
  hostRoot: string,
): Promise<void> {
  if (lock.tree === undefined) {
    throw new Error('channel-openclaw: this track has no locked runnable tree and cannot use managed mode')
  }
  if (!isAbsolute(artifactPath) || !isAbsolute(hostRoot)) {
    throw new Error('channel-openclaw: artifactPath and hostRoot must be absolute')
  }
  const artifactDigest = await sha512File(artifactPath)
  if (artifactDigest !== lock.artifactSha512) throw new Error('channel-openclaw: host artifact SHA-512 does not match the lock')
  const packageJson = JSON.parse(await readFile(resolve(hostRoot, 'package.json'), 'utf8')) as unknown
  if (!isRecord(packageJson) || packageJson.name !== 'openclaw' || packageJson.version !== lock.packageVersion) {
    throw new Error('channel-openclaw: host package name/version does not match the lock')
  }
  const engines = packageJson.engines
  if (!isRecord(engines) || engines.node !== lock.nodeEngine) {
    throw new Error('channel-openclaw: host Node engine does not match the lock')
  }
  const tree = await hostTreeDigest(hostRoot)
  if (tree.fileCount !== lock.tree.fileCount || tree.sha512 !== lock.tree.sha512) {
    throw new Error('channel-openclaw: extracted host tree does not match the locked file count and digest')
  }
}

/**
 * Verify the checked npm dependency lock and every installed package identity.
 * @param lock Immutable host identity carrying the runtime-lock digest.
 * @param runtimeRoot Checked npm project containing the installed host.
 * @param hostRoot Installed OpenClaw package root.
 */
export async function verifyRuntimeInstallation(
  lock: OpenClawRuntimeLock,
  runtimeRoot: string,
  hostRoot: string,
): Promise<void> {
  if (lock.runtimePackageLockSha512 === undefined) {
    throw new Error('channel-openclaw: this track has no locked runtime dependency assembly')
  }
  if (!isAbsolute(runtimeRoot) || !isAbsolute(hostRoot)) {
    throw new Error('channel-openclaw: runtimeRoot and hostRoot must be absolute')
  }
  await requireOrdinaryDirectory(runtimeRoot, 'runtime root')
  const expectedHostRoot = await realpath(resolve(runtimeRoot, 'node_modules', 'openclaw'))
  if (await realpath(hostRoot) !== expectedHostRoot) {
    throw new Error('channel-openclaw: hostRoot must be runtimeRoot/node_modules/openclaw')
  }

  const templateDirectory = fileURLToPath(new URL('../runtime/', import.meta.url))
  const expectedPackageJson = await readFile(resolve(templateDirectory, 'package.json'))
  const actualPackageJson = await readFile(resolve(runtimeRoot, 'package.json'))
  if (!actualPackageJson.equals(expectedPackageJson)) {
    throw new Error('channel-openclaw: runtime package.json differs from the checked assembly input')
  }
  const expectedLockBytes = await readFile(resolve(templateDirectory, 'package-lock.json'))
  const expectedLockDigest = createHash('sha512').update(expectedLockBytes).digest('hex')
  if (expectedLockDigest !== lock.runtimePackageLockSha512) {
    throw new Error('channel-openclaw: packaged runtime dependency lock does not match the host lock')
  }
  const actualLockBytes = await readFile(resolve(runtimeRoot, 'package-lock.json'))
  if (!actualLockBytes.equals(expectedLockBytes)) {
    throw new Error('channel-openclaw: deployed runtime dependency lock differs from the checked lock')
  }

  const expectedLock = parsePackageLock(expectedLockBytes, 'checked runtime dependency lock')
  const hiddenLockPath = resolve(runtimeRoot, 'node_modules', '.package-lock.json')
  const actualLock = parsePackageLock(await readFile(hiddenLockPath), 'installed runtime dependency lock')
  if (expectedLock.lockfileVersion !== 3 || actualLock.lockfileVersion !== 3
    || expectedLock.name !== 'clawdsh-openclaw-runtime' || actualLock.name !== expectedLock.name) {
    throw new Error('channel-openclaw: runtime dependency locks have an unexpected identity or format')
  }
  const expectedPackages = requireRecord(expectedLock.packages, 'checked runtime dependency lock packages')
  const actualPackages = requireRecord(actualLock.packages, 'installed runtime dependency lock packages')
  const discovered = await installedPackageDirectories({ root: runtimeRoot, kind: 'runtime' })
  for (const [path, candidate] of Object.entries(actualPackages)) {
    if (!isPackageLockPath(path) || !isRecord(candidate)) {
      throw new Error(`channel-openclaw: installed runtime lock contains invalid package path ${JSON.stringify(path)}`)
    }
    const expected = expectedPackages[path]
    if (!isRecord(expected) || installIdentity(expected) !== installIdentity(candidate)) {
      throw new Error(`channel-openclaw: installed package ${path} differs from the checked dependency lock`)
    }
    if (!discovered.delete(path)) {
      throw new Error(`channel-openclaw: installed package ${path} is absent or not an ordinary directory`)
    }
    await verifyInstalledPackage(runtimeRoot, path, candidate)
  }
  if (discovered.size > 0) {
    throw new Error(`channel-openclaw: runtime contains an untracked package directory ${[...discovered].sort()[0]}`)
  }
  for (const [path, candidate] of Object.entries(expectedPackages)) {
    if (path === '' || !isRecord(candidate) || candidate.optional === true || !supportsCurrentPlatform(candidate)) continue
    if (!Object.hasOwn(actualPackages, path)) {
      throw new Error(`channel-openclaw: required runtime package ${path} is missing`)
    }
  }
  const runtimeLocks = lock.runtimeTrees?.filter(candidate => (
    candidate.platform === process.platform && candidate.architecture === process.arch
  )) ?? []
  if (runtimeLocks.length !== 1) {
    throw new Error(`channel-openclaw: no unique locked runtime tree for ${process.platform}/${process.arch}`)
  }
  const runtimeLock = runtimeLocks[0]
  if (runtimeLock === undefined || !Number.isSafeInteger(runtimeLock.fileCount) || runtimeLock.fileCount <= 0
    || !/^[a-f0-9]{128}$/.test(runtimeLock.sha512)) {
    throw new Error(`channel-openclaw: locked runtime tree for ${process.platform}/${process.arch} is invalid`)
  }
  const runtimeTree = await runtimeTreeDigest(runtimeRoot)
  if (runtimeTree.fileCount !== runtimeLock.fileCount || runtimeTree.sha512 !== runtimeLock.sha512) {
    throw new Error(`channel-openclaw: runtime ordinary-file tree differs from the ${process.platform}/${process.arch} lock`)
  }
}

/** Parse one npm v3 lock as an untrusted object. */
function parsePackageLock(bytes: Buffer, label: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(bytes.toString('utf8')) as unknown
  } catch (cause) {
    throw new Error(`channel-openclaw: ${label} is not strict JSON`, { cause })
  }
  return requireRecord(value, label)
}

/** Verify the package's own immutable name and version facts. */
async function verifyInstalledPackage(
  runtimeRoot: string,
  path: string,
  lockEntry: Record<string, unknown>,
): Promise<void> {
  const packageJson = JSON.parse(await readFile(resolve(runtimeRoot, path, 'package.json'), 'utf8')) as unknown
  if (!isRecord(packageJson) || typeof packageJson.name !== 'string' || packageJson.version !== lockEntry.version) {
    throw new Error(`channel-openclaw: installed package metadata differs from the dependency lock at ${path}`)
  }
}

/**
 * Parse and validate the complete operator-owned OpenClaw JSON without selecting,
 * returning, or logging credential fields. Platform credential ownership remains
 * with the OpenClaw config and state files.
 * @param configPath Strict JSON configuration file.
 * @param bridgeRoot Verified ClawDSH bridge directory and sole explicit load path.
 * @param stateDir Isolated OpenClaw state directory owning the Agent workspace.
 * @param extensions Exact opt-in plugin locks allowed alongside the bridge.
 */
export async function verifyFailClosedConfig(
  configPath: string,
  bridgeRoot: string,
  stateDir = resolve(configPath, '..'),
  extensions: readonly OpenClawExtensionLock[] = [],
): Promise<void> {
  validateExtensionLocks(extensions)
  if (!isAbsolute(configPath) || !isAbsolute(bridgeRoot) || !isAbsolute(stateDir)) {
    throw new Error('channel-openclaw: configPath, bridgeRoot, and stateDir must be absolute')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(configPath, 'utf8')) as unknown
  } catch (cause) {
    throw new Error('channel-openclaw: managed OpenClaw config must be strict JSON', { cause })
  }
  if (!isRecord(parsed)) throw new Error('channel-openclaw: OpenClaw config must be an object')
  const models = requireRecord(parsed.models, 'models')
  const providers = requireRecord(models.providers, 'models.providers')
  if (models.mode !== 'replace' || Object.keys(providers).some(key => key !== 'clawdsh')) {
    throw new Error('channel-openclaw: models.mode must be replace and clawdsh must be the only provider')
  }
  const provider = requireRecord(providers.clawdsh, 'models.providers.clawdsh')
  const providerRuntime = requireRecord(provider.agentRuntime, 'models.providers.clawdsh.agentRuntime')
  if (providerRuntime.id !== 'clawdsh') throw new Error('channel-openclaw: clawdsh provider must select the clawdsh AgentHarness')
  const providerModels = provider.models
  if (!Array.isArray(providerModels) || providerModels.length !== 1 || !isRecord(providerModels[0])
    || providerModels[0].id !== 'local' || !isRecord(providerModels[0].agentRuntime)
    || providerModels[0].agentRuntime.id !== 'clawdsh') {
    throw new Error('channel-openclaw: clawdsh/local must be the sole provider model and select the clawdsh AgentHarness')
  }
  const agents = requireRecord(parsed.agents, 'agents')
  const defaults = requireRecord(agents.defaults, 'agents.defaults')
  if (defaults.workspace !== resolve(stateDir, 'workspace')) {
    throw new Error('channel-openclaw: agents.defaults.workspace must be the isolated stateDir/workspace path')
  }
  const model = requireRecord(defaults.model, 'agents.defaults.model')
  if (model.primary !== 'clawdsh/local' || !Array.isArray(model.fallbacks) || model.fallbacks.length !== 0) {
    throw new Error('channel-openclaw: default model must be clawdsh/local with an empty fallback list')
  }
  const allowedModels = requireRecord(defaults.models, 'agents.defaults.models')
  if (Object.keys(allowedModels).length !== 1 || !Object.hasOwn(allowedModels, 'clawdsh/local')) {
    throw new Error('channel-openclaw: the model allowlist must contain only clawdsh/local')
  }
  requireClawDshRuntime(allowedModels['clawdsh/local'], 'agents.defaults.models.clawdsh/local')
  const agentList = agents.list
  if (agentList !== undefined) {
    if (!Array.isArray(agentList)) throw new Error('channel-openclaw: agents.list must be an array')
    for (const [index, candidate] of agentList.entries()) verifyAgentRoute(candidate, `agents.list.${index}`)
  }
  const plugins = requireRecord(parsed.plugins, 'plugins')
  const load = requireRecord(plugins.load, 'plugins.load')
  if (!Array.isArray(load.paths)) throw new Error('channel-openclaw: plugins.load.paths must be an array')
  const canonicalBridge = await realpath(bridgeRoot)
  const loadedPaths = await Promise.all(load.paths.map(async (value) => {
    if (typeof value !== 'string' || !isAbsolute(value)) throw new Error('channel-openclaw: every plugin load path must be absolute')
    return await realpath(value)
  }))
  if (loadedPaths.length !== 1 || loadedPaths[0] !== canonicalBridge) {
    throw new Error('channel-openclaw: plugins.load.paths must contain only the verified ClawDSH bridge root')
  }
  const expectedPluginIds = ['clawdsh-bridge', ...extensions.map(extension => extension.pluginId)]
  if (!sameStringSet(plugins.allow, expectedPluginIds)) {
    throw new Error('channel-openclaw: plugins.allow must contain exactly clawdsh-bridge and the locked extensions')
  }
  if (plugins.installs !== undefined) {
    const installs = requireRecord(plugins.installs, 'plugins.installs')
    if (Object.keys(installs).length !== 0) {
      throw new Error('channel-openclaw: external plugin installs require a separately locked opt-in installer')
    }
  }
  const entries = requireRecord(plugins.entries, 'plugins.entries')
  if (!sameStringSet(Object.keys(entries), expectedPluginIds)) {
    throw new Error('channel-openclaw: plugins.entries must contain exactly clawdsh-bridge and the locked extensions')
  }
  for (const pluginId of expectedPluginIds) {
    const entry = requireRecord(entries[pluginId], `plugins.entries.${pluginId}`)
    if (entry.enabled !== true) throw new Error(`channel-openclaw: ${pluginId} must be explicitly enabled`)
  }
  const gateway = requireRecord(parsed.gateway, 'gateway')
  if (gateway.mode !== 'local' || gateway.bind !== 'loopback') {
    throw new Error('channel-openclaw: Gateway must use local mode and loopback binding')
  }
  verifyManagementPolicy(parsed)
  verifyChannelAdmissionPolicies(parsed.channels)
}

/** Keep OpenClaw's channel management surface while disabling model/tool escape paths. */
function verifyManagementPolicy(config: Record<string, unknown>): void {
  const commands = requireRecord(config.commands, 'commands')
  for (const key of ['bash', 'config', 'mcp', 'plugins', 'debug', 'restart', 'nativeSkills']) {
    if (commands[key] !== false) throw new Error(`channel-openclaw: commands.${key} must be explicitly disabled`)
  }
  if (commands.text !== true || commands.useAccessGroups !== true) {
    throw new Error('channel-openclaw: text management commands require access-group admission')
  }
  if (commands.allowFrom !== undefined) rejectWildcardLists(commands.allowFrom, 'commands.allowFrom')
  verifyElevatedDisabled(config.tools, 'tools')
  const agents = requireRecord(config.agents, 'agents')
  const defaults = requireRecord(agents.defaults, 'agents.defaults')
  if (defaults.elevatedDefault !== 'off') {
    throw new Error('channel-openclaw: agents.defaults.elevatedDefault must be off')
  }
  if (Array.isArray(agents.list)) {
    for (const [index, value] of agents.list.entries()) {
      const agent = requireRecord(value, `agents.list.${index}`)
      verifyElevatedDisabled(agent.tools, `agents.list.${index}.tools`)
    }
  }
}

/** Require one explicit elevated-tool denial at a managed Agent configuration level. */
function verifyElevatedDisabled(value: unknown, path: string): void {
  const tools = requireRecord(value, path)
  const elevated = requireRecord(tools.elevated, `${path}.elevated`)
  if (elevated.enabled !== false) throw new Error(`channel-openclaw: ${path}.elevated.enabled must be false`)
}

/** Reject channel config that weakens the managed deployment's admission defaults. */
function verifyChannelAdmissionPolicies(value: unknown): void {
  const channels = requireRecord(value, 'channels')
  for (const [channel, candidate] of Object.entries(channels)) {
    const channelConfig = requireRecord(candidate, `channels.${channel}`)
    verifyManagedChannelAdmission(channel, channelConfig, `channels.${channel}`)
    if (channelConfig.accounts !== undefined) {
      const accounts = requireRecord(channelConfig.accounts, `channels.${channel}.accounts`)
      for (const [account, accountCandidate] of Object.entries(accounts)) {
        const accountConfig = requireRecord(accountCandidate, `channels.${channel}.accounts.${account}`)
        verifyManagedChannelAdmission(channel, accountConfig, `channels.${channel}.accounts.${account}`)
      }
    }
  }
  const visit = (candidate: unknown, path: string): void => {
    if (Array.isArray(candidate)) return
    if (!isRecord(candidate)) return
    for (const [key, nested] of Object.entries(candidate)) {
      const field = `${path}.${key}`
      if (key === 'dmPolicy' && nested !== 'pairing' && nested !== 'allowlist' && nested !== 'disabled') {
        throw new Error(`channel-openclaw: ${field} must remain pairing, allowlist, or disabled`)
      }
      if (key === 'groupPolicy' && nested !== 'allowlist' && nested !== 'disabled') {
        throw new Error(`channel-openclaw: ${field} must remain allowlist or disabled`)
      }
      if (key === 'requireMention' && nested === false) {
        throw new Error(`channel-openclaw: ${field} may not disable group mention admission`)
      }
      if ((key === 'allowFrom' || key === 'groupAllowFrom' || key === 'allowedUserIds')
        && Array.isArray(nested) && nested.includes('*')) {
        throw new Error(`channel-openclaw: ${field} may not contain the public wildcard`)
      }
      if (key === 'useAccessGroups' && nested === false) {
        throw new Error(`channel-openclaw: ${field} may not bypass access-group admission`)
      }
      if (key === 'configWrites' && nested !== false) {
        throw new Error(`channel-openclaw: ${field} must be false`)
      }
      visit(nested, field)
    }
  }
  visit(channels, 'channels')
}

/** Admit only the two version-locked verticals; every other catalog entry remains explicitly disabled. */
function verifyManagedChannelAdmission(channel: string, value: Record<string, unknown>, path: string): void {
  if (value.enabled !== true && value.enabled !== false) {
    throw new Error(`channel-openclaw: ${path}.enabled must be explicit`)
  }
  if (!value.enabled) return
  if (channel !== 'telegram' && channel !== 'feishu') {
    throw new Error(`channel-openclaw: ${path} must remain disabled until its locked admission validator is implemented`)
  }
  if (value.configWrites !== false) throw new Error(`channel-openclaw: ${path}.configWrites must be false`)
  if (value.dmPolicy !== 'pairing' && value.dmPolicy !== 'allowlist' && value.dmPolicy !== 'disabled') {
    throw new Error(`channel-openclaw: ${path}.dmPolicy must explicitly be pairing, allowlist, or disabled`)
  }
  if (value.groupPolicy !== 'allowlist' && value.groupPolicy !== 'disabled') {
    throw new Error(`channel-openclaw: ${path}.groupPolicy must explicitly be allowlist or disabled`)
  }
  if (channel === 'feishu') {
    if (value.requireMention !== true) {
      throw new Error(`channel-openclaw: ${path}.requireMention must explicitly be true`)
    }
    return
  }
  if (value.groupPolicy === 'allowlist') {
    const groups = requireRecord(value.groups, `${path}.groups`)
    const wildcard = requireRecord(groups['*'], `${path}.groups.*`)
    if (wildcard.requireMention !== true) {
      throw new Error(`channel-openclaw: ${path}.groups.*.requireMention must explicitly be true`)
    }
  }
}

/** Reject wildcard membership in a nested command allowlist object. */
function rejectWildcardLists(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    if (value.includes('*')) throw new Error(`channel-openclaw: ${path} may not contain the public wildcard`)
    return
  }
  if (!isRecord(value)) throw new Error(`channel-openclaw: ${path} must be an object of allowlists`)
  for (const [key, nested] of Object.entries(value)) rejectWildcardLists(nested, `${path}.${key}`)
}

/** Compare an untrusted string array with one exact set. */
function sameStringSet(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) && value.every(candidate => typeof candidate === 'string')
    && new Set(value).size === value.length && value.length === expected.length
    && value.every(candidate => expected.includes(candidate))
}

/** Narrow an untrusted JSON object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Require one nested object with a path-specific failure. */
function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`channel-openclaw: ${path} must be an object`)
  return value
}

/** Require one exact model policy to select the ClawDSH harness. */
function requireClawDshRuntime(value: unknown, path: string): void {
  const policy = requireRecord(value, path)
  const runtime = requireRecord(policy.agentRuntime, `${path}.agentRuntime`)
  if (runtime.id !== 'clawdsh') throw new Error(`channel-openclaw: ${path} must select the clawdsh AgentHarness`)
}

/** Reject per-agent routes that could escape the sole provider/model pair. */
function verifyAgentRoute(value: unknown, path: string): void {
  const agent = requireRecord(value, path)
  if (agent.model !== undefined) {
    if (typeof agent.model === 'string') {
      if (agent.model !== 'clawdsh/local') throw new Error(`channel-openclaw: ${path}.model must be clawdsh/local`)
    } else {
      const model = requireRecord(agent.model, `${path}.model`)
      if (model.primary !== 'clawdsh/local' || !Array.isArray(model.fallbacks) || model.fallbacks.length !== 0) {
        throw new Error(`channel-openclaw: ${path}.model must select clawdsh/local without fallbacks`)
      }
    }
  }
  if (agent.models !== undefined) {
    const models = requireRecord(agent.models, `${path}.models`)
    if (Object.keys(models).length !== 1 || !Object.hasOwn(models, 'clawdsh/local')) {
      throw new Error(`channel-openclaw: ${path}.models must contain only clawdsh/local`)
    }
    requireClawDshRuntime(models['clawdsh/local'], `${path}.models.clawdsh/local`)
  }
  if (agent.agentRuntime !== undefined) requireClawDshRuntime({ agentRuntime: agent.agentRuntime }, path)
}
