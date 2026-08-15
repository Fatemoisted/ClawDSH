/** Verification for explicitly installed OpenClaw Channel plugins. @module @clawdsh/dsh-channel-openclaw/extensions */

import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { valid } from 'semver'
import { installedProjectTreeDigest } from './file-integrity.ts'
import {
  installIdentity,
  installedPackageDirectories,
  isPackageLockPath,
  requireOrdinaryDirectory,
} from './npm-tree.ts'
import { supportsCurrentPlatform } from './npm-platform.ts'

/** Immutable identity of one opt-in OpenClaw Channel plugin installation. */
export interface OpenClawExtensionLock {
  /** OpenClaw plugin id used by plugins.allow and plugins.entries. */
  readonly pluginId: string
  /** Channel ids the plugin must register and no others. */
  readonly channelIds: string[]
  /** Exact npm package name recorded by OpenClaw's installer. */
  readonly packageName: string
  /** Exact npm version, never a range or dist-tag. */
  readonly version: string
  /** Exact sha512 SRI recorded by npm and OpenClaw. */
  readonly integrity: string
  /** Exact installed npm project, including the primary package and every transitive dependency. */
  readonly projectTree: {
    /** Number of ordinary files included in the complete project digest. */
    readonly fileCount: number
    /** Lowercase SHA-512 digest of project paths, file bytes, and verified link targets. */
    readonly sha512: string
  }
}

/**
 * Validate extension locks before any OpenClaw state or process is touched.
 * @param locks Exact operator-approved plugin identities.
 */
export function validateExtensionLocks(locks: readonly OpenClawExtensionLock[]): void {
  const pluginIds = new Set<string>()
  const packageNames = new Set<string>()
  for (const [index, lock] of locks.entries()) {
    const label = `extensions.${index}`
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(lock.pluginId) || lock.pluginId === 'clawdsh-bridge') {
      throw new Error(`channel-openclaw: ${label}.pluginId is invalid or reserved`)
    }
    if (pluginIds.has(lock.pluginId)) throw new Error(`channel-openclaw: duplicate extension plugin id ${lock.pluginId}`)
    pluginIds.add(lock.pluginId)
    if (!isPackageName(lock.packageName)) throw new Error(`channel-openclaw: ${label}.packageName is not an exact npm package name`)
    if (packageNames.has(lock.packageName)) throw new Error(`channel-openclaw: duplicate extension package ${lock.packageName}`)
    packageNames.add(lock.packageName)
    if (valid(lock.version) === null) throw new Error(`channel-openclaw: ${label}.version must be an exact semantic version`)
    if (!isSha512Sri(lock.integrity)) throw new Error(`channel-openclaw: ${label}.integrity must be a sha512 SRI`)
    if (!isRecord(lock.projectTree) || !Number.isSafeInteger(lock.projectTree.fileCount) || lock.projectTree.fileCount <= 0
      || typeof lock.projectTree.sha512 !== 'string' || !/^[a-f0-9]{128}$/.test(lock.projectTree.sha512)) {
      throw new Error(`channel-openclaw: ${label}.projectTree must be a positive file count and lowercase SHA-512`)
    }
    if (lock.channelIds.length === 0 || new Set(lock.channelIds).size !== lock.channelIds.length
      || lock.channelIds.some(id => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(id))) {
      throw new Error(`channel-openclaw: ${label}.channelIds must be a non-empty unique list`)
    }
  }
}

/**
 * Verify every installed npm project before OpenClaw imports any opt-in plugin.
 * @param locks Exact operator-approved plugin identities.
 * @param stateDir Isolated OpenClaw state directory containing npm projects.
 * @param hostRoot Verified OpenClaw package root allowed as an optional peer link.
 * @returns Canonical package root keyed by verified plugin id.
 */
export async function verifyExtensionInstallations(
  locks: readonly OpenClawExtensionLock[],
  stateDir: string,
  hostRoot: string,
): Promise<ReadonlyMap<string, string>> {
  validateExtensionLocks(locks)
  if (!isAbsolute(stateDir) || !isAbsolute(hostRoot)) {
    throw new Error('channel-openclaw: extension stateDir and hostRoot must be absolute')
  }
  const projectParents = resolve(stateDir, 'npm', 'projects')
  let entries
  try {
    await requireOrdinaryDirectory(projectParents, 'extension projects root')
    const canonicalState = await realpath(stateDir)
    const canonicalProjects = await realpath(projectParents)
    if (relative(canonicalState, canonicalProjects).split(sep).join('/') !== 'npm/projects') {
      throw new Error('channel-openclaw: extension projects root escapes stateDir')
    }
    entries = await readdir(projectParents, { withFileTypes: true })
  } catch (error) {
    if (isMissing(error) && locks.length === 0) return new Map()
    throw error
  }
  const byPackage = new Map(locks.map(lock => [lock.packageName, lock]))
  const roots = new Map<string, string>()
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !isSafeSegment(entry.name)) {
      throw new Error('channel-openclaw: extension project root contains a non-directory entry')
    }
    const projectRoot = resolve(projectParents, entry.name)
    const project = parseObject(await readFile(resolve(projectRoot, 'package.json'), 'utf8'), 'extension project package.json')
    const dependencies = recordField(project.dependencies, 'extension project dependencies')
    const names = Object.keys(dependencies)
    if (names.length !== 1 || typeof dependencies[names[0] as string] !== 'string') {
      throw new Error('channel-openclaw: extension project must request exactly one package')
    }
    const packageName = names[0] as string
    const lock = byPackage.get(packageName)
    if (lock === undefined || dependencies[packageName] !== lock.version || roots.has(lock.pluginId)) {
      throw new Error(`channel-openclaw: untracked or duplicate extension project for ${packageName}`)
    }
    const rootDir = resolve(projectRoot, 'node_modules', ...packageName.split('/'))
    await requireOrdinaryDirectory(rootDir, `extension ${lock.pluginId} package root`)
    const openClawPeer = await verifyOpenClawPeer(rootDir, hostRoot, lock.pluginId)
    await verifyExtensionProject(projectRoot, lock, openClawPeer)
    roots.set(lock.pluginId, await realpath(rootDir))
  }
  for (const lock of locks) {
    if (!roots.has(lock.pluginId)) throw new Error(`channel-openclaw: locked extension ${lock.pluginId} is not installed`)
  }
  return roots
}

/**
 * Verify one post-import runtime inspection against its preverified package root.
 * @param text Strict JSON emitted by OpenClaw's runtime inspector.
 * @param lock Expected plugin, package, version, integrity, and Channel ids.
 * @param expectedRootDir Canonical package root verified before host startup.
 */
export async function verifyExtensionRuntimeInspection(
  text: string,
  lock: OpenClawExtensionLock,
  expectedRootDir: string,
): Promise<void> {
  validateExtensionLocks([lock])
  const value = parseObject(text, `extension ${lock.pluginId} inspection`)
  const plugin = objectField(value, 'plugin', lock.pluginId)
  const install = objectField(value, 'install', lock.pluginId)
  if (plugin.id !== lock.pluginId || plugin.packageName !== lock.packageName || plugin.version !== lock.version
    || plugin.status !== 'loaded' || plugin.imported !== true || plugin.enabled !== true
    || plugin.explicitlyEnabled !== true || plugin.activated !== true || plugin.origin !== 'global'
    || plugin.trustedOfficialInstall !== true || plugin.configSchema !== true
    || (plugin.error !== undefined && plugin.error !== null)) {
    throw new Error(`channel-openclaw: extension ${lock.pluginId} runtime identity is not the locked enabled install`)
  }
  if (!sameStrings(plugin.channelIds, lock.channelIds)) {
    throw new Error(`channel-openclaw: extension ${lock.pluginId} registered unexpected Channel ids`)
  }
  verifyChannelCapability(value.capabilities, lock)
  rejectFailures(value.diagnostics, `extension ${lock.pluginId} diagnostics`)
  rejectFailures(value.compatibility, `extension ${lock.pluginId} compatibility`)
  const exactSpec = `${lock.packageName}@${lock.version}`
  if (install.source !== 'npm' || install.spec !== exactSpec || install.resolvedSpec !== exactSpec
    || install.resolvedName !== lock.packageName || install.version !== lock.version
    || install.resolvedVersion !== lock.version || install.integrity !== lock.integrity) {
    throw new Error(`channel-openclaw: extension ${lock.pluginId} install record differs from its lock`)
  }

  const rootDir = stringField(plugin.rootDir, `extension ${lock.pluginId} rootDir`)
  const installPath = stringField(install.installPath, `extension ${lock.pluginId} installPath`)
  if (await realpath(rootDir) !== expectedRootDir || await realpath(installPath) !== expectedRootDir) {
    throw new Error(`channel-openclaw: extension ${lock.pluginId} inspection paths disagree`)
  }
}

/** Verify the project input, npm locks, package metadata, and all installed bytes. */
async function verifyExtensionProject(
  projectRoot: string,
  lock: OpenClawExtensionLock,
  openClawPeer: string | undefined,
): Promise<void> {
  const project = parseObject(await readFile(resolve(projectRoot, 'package.json'), 'utf8'), 'extension project package.json')
  const dependencies = recordField(project.dependencies, 'extension project dependencies')
  if (project.private !== true || Object.keys(dependencies).length !== 1 || dependencies[lock.packageName] !== lock.version) {
    throw new Error(`channel-openclaw: extension ${lock.pluginId} project does not pin only its exact package`)
  }
  const checked = parseObject(await readFile(resolve(projectRoot, 'package-lock.json'), 'utf8'), 'extension project package-lock.json')
  const hidden = parseObject(
    await readFile(resolve(projectRoot, 'node_modules', '.package-lock.json'), 'utf8'),
    'extension installed package lock',
  )
  if (checked.lockfileVersion !== 3 || hidden.lockfileVersion !== 3 || checked.name !== hidden.name
    || typeof checked.name !== 'string' || checked.name.length === 0) {
    throw new Error(`channel-openclaw: extension ${lock.pluginId} npm locks have an unexpected identity or format`)
  }
  const checkedPackages = recordField(checked.packages, 'extension checked lock packages')
  const hiddenPackages = recordField(hidden.packages, 'extension installed lock packages')
  const root = recordField(checkedPackages[''], 'extension checked lock root')
  const rootDependencies = recordField(root.dependencies, 'extension checked lock root dependencies')
  if (Object.keys(rootDependencies).length !== 1 || rootDependencies[lock.packageName] !== lock.version) {
    throw new Error(`channel-openclaw: extension ${lock.pluginId} checked lock does not pin the requested package`)
  }
  const primaryKey = `node_modules/${lock.packageName}`
  verifyLockedPackage(checkedPackages[primaryKey], lock, 'checked')
  verifyLockedPackage(hiddenPackages[primaryKey], lock, 'installed')
  const discovered = await installedPackageDirectories({
    root: projectRoot,
    kind: 'extension',
    ...(openClawPeer === undefined ? {} : { allowedPackageLink: openClawPeer }),
    rootLabel: 'extension project node_modules',
  })
  for (const [path, installed] of Object.entries(hiddenPackages)) {
    if (!isPackageLockPath(path) || !isRecord(installed) || !isRecord(checkedPackages[path])
      || installIdentity(installed) !== installIdentity(checkedPackages[path])) {
      throw new Error(`channel-openclaw: extension ${lock.pluginId} installed dependency ${path} differs from its checked lock`)
    }
    if (!discovered.delete(path)) {
      throw new Error(`channel-openclaw: extension ${lock.pluginId} installed dependency ${path} is absent from node_modules`)
    }
    await verifyInstalledPackage(projectRoot, path, installed, lock.pluginId)
  }
  if (discovered.size > 0) {
    throw new Error(`channel-openclaw: extension ${lock.pluginId} has an untracked package ${[...discovered].sort()[0]}`)
  }
  for (const [path, candidate] of Object.entries(checkedPackages)) {
    if (path === '' || !isRecord(candidate) || candidate.optional === true || !supportsCurrentPlatform(candidate)) continue
    if (!Object.hasOwn(hiddenPackages, path)) {
      throw new Error(`channel-openclaw: extension ${lock.pluginId} required dependency ${path} is not installed`)
    }
  }
  const projectTree = await installedProjectTreeDigest(projectRoot, openClawPeer === undefined ? [] : [openClawPeer])
  if (projectTree.fileCount !== lock.projectTree.fileCount || projectTree.sha512 !== lock.projectTree.sha512) {
    throw new Error(`channel-openclaw: extension ${lock.pluginId} isolated npm project tree differs from its lock`)
  }
}

/** Require an optional npm peer link to resolve only to the verified OpenClaw host. */
async function verifyOpenClawPeer(rootDir: string, hostRoot: string, pluginId: string): Promise<string | undefined> {
  const peerPath = resolve(rootDir, 'node_modules', 'openclaw')
  try {
    const info = await lstat(peerPath)
    if (!info.isSymbolicLink() || await realpath(peerPath) !== await realpath(hostRoot)) {
      throw new Error(`channel-openclaw: extension ${pluginId} OpenClaw peer does not target the verified host`)
    }
    return peerPath
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
}

/** Verify one package directory's immutable name and version facts. */
async function verifyInstalledPackage(
  projectRoot: string,
  path: string,
  lockEntry: Record<string, unknown>,
  pluginId: string,
): Promise<void> {
  const packageJson = parseObject(await readFile(resolve(projectRoot, path, 'package.json'), 'utf8'), 'extension dependency metadata')
  if (packageJson.name !== packageNameFromLockPath(path) || packageJson.version !== lockEntry.version) {
    throw new Error(`channel-openclaw: extension ${pluginId} dependency metadata differs from its lock at ${path}`)
  }
}

/** Derive an npm package name from the final package segment of a nested lock path. */
function packageNameFromLockPath(path: string): string {
  const parts = path.split('/')
  const nodeModules = parts.lastIndexOf('node_modules')
  const head = parts[nodeModules + 1] as string
  return head.startsWith('@') ? `${head}/${parts[nodeModules + 2] as string}` : head
}

/** Require the exact SRI on a primary package-lock entry. */
function verifyLockedPackage(value: unknown, lock: OpenClawExtensionLock, source: string): void {
  if (!isRecord(value) || value.version !== lock.version || value.integrity !== lock.integrity
    || typeof value.resolved !== 'string' || !value.resolved.startsWith('https://registry.npmjs.org/')) {
    throw new Error(`channel-openclaw: extension ${lock.pluginId} ${source} primary package differs from its lock`)
  }
}

/** Require exactly one Channel capability with the locked ids. */
function verifyChannelCapability(value: unknown, lock: OpenClawExtensionLock): void {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])
    || value[0].kind !== 'channel' || !sameStrings(value[0].ids, lock.channelIds)) {
    throw new Error(`channel-openclaw: extension ${lock.pluginId} exposes capabilities outside its Channel lock`)
  }
}

/** Reject error-level runtime diagnostics and malformed lists. */
function rejectFailures(value: unknown, label: string): void {
  if (!Array.isArray(value)) throw new Error(`channel-openclaw: ${label} are missing`)
  for (const candidate of value) {
    if (!isRecord(candidate)) throw new Error(`channel-openclaw: ${label} contain an invalid entry`)
    if (candidate.level === 'error' || candidate.severity === 'error') {
      throw new Error(`channel-openclaw: ${label} report an error`)
    }
  }
}

/** Compare string lists as sets while rejecting duplicates and non-strings. */
function sameStrings(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
    && new Set(value).size === value.length
    && [...value].sort().join('\0') === [...expected].sort().join('\0')
}

/** Parse strict JSON text or a previously parsed value as an object. */
function parseObject(value: string, label: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch (cause) {
    throw new Error(`channel-openclaw: ${label} is not strict JSON`, { cause })
  }
  return recordField(parsed, label)
}

/** Require an object field. */
function objectField(value: Record<string, unknown>, key: string, pluginId: string): Record<string, unknown> {
  return recordField(value[key], `extension ${pluginId} inspection ${key}`)
}

/** Require a record. */
function recordField(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`channel-openclaw: ${label} must be an object`)
  return value
}

/** Require a non-empty string field. */
function stringField(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`channel-openclaw: ${label} must be a non-empty string`)
  return value
}

/** Narrow an unknown JSON object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Accept npm's unscoped or exactly one-level scoped package names. */
function isPackageName(value: string): boolean {
  return /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/.test(value)
}

/** Verify a decoded 64-byte sha512 SRI. */
function isSha512Sri(value: string): boolean {
  if (!value.startsWith('sha512-')) return false
  const encoded = value.slice('sha512-'.length)
  return /^[A-Za-z0-9+/]+={0,2}$/.test(encoded) && Buffer.from(encoded, 'base64').length === 64
}

/** Restrict one generated project directory component. */
function isSafeSegment(value: string | undefined): value is string {
  return value !== undefined && value !== '' && value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\')
}

/** Test whether a filesystem operation found no peer link. */
function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
