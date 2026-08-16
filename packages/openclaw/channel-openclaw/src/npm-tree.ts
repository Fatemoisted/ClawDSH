/** Shared fail-closed npm installation tree validation. @module @clawdsh/dsh-channel-openclaw/npm-tree */

import { lstat, readdir } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'

/** Policy differences between the isolated extension tree and the managed runtime tree. */
export type InstalledPackageTreeOptions = {
  /** Treat one already-verified OpenClaw peer symlink as metadata rather than an installed package. */
  readonly kind: 'extension'
  /** Ordinary npm project root used to derive package-lock keys. */
  readonly projectRoot: string
  /** Exact peer path verified against the managed OpenClaw host, when installed. */
  readonly openClawPeer: string | undefined
} | {
  /** Reject every package indirection in the managed runtime. */
  readonly kind: 'runtime'
  /** Ordinary npm project root used to derive package-lock keys. */
  readonly projectRoot: string
}

/**
 * Enumerate actual npm package directories while rejecting unverified indirections.
 * @param options - Project root and extension/runtime link policy.
 * @returns Canonical package-lock paths for every installed package.
 */
export async function installedPackageDirectories(options: InstalledPackageTreeOptions): Promise<Set<string>> {
  const packages = new Set<string>()
  const visit = async (nodeModules: string): Promise<void> => {
    for (const entry of await readdir(nodeModules, { withFileTypes: true })) {
      if (entry.name === '.bin' || entry.name === '.package-lock.json') continue
      const entryPath = resolve(nodeModules, entry.name)
      if (entry.isSymbolicLink()) {
        if (options.kind === 'extension' && options.openClawPeer === entryPath) continue
        if (options.kind === 'extension') {
          throw new Error(`channel-openclaw: extension node_modules contains an unverified package link ${entryPath}`)
        }
        throw new Error(`channel-openclaw: runtime node_modules contains a non-directory entry ${entryPath}`)
      }
      if (!entry.isDirectory()) {
        throw new Error(`channel-openclaw: ${options.kind} node_modules contains a non-directory entry ${entryPath}`)
      }
      if (entry.name.startsWith('@')) {
        for (const child of await readdir(entryPath, { withFileTypes: true })) {
          const childPath = resolve(entryPath, child.name)
          if (child.isSymbolicLink() || !child.isDirectory()) {
            throw new Error(`channel-openclaw: ${options.kind} package scope contains a non-directory entry ${childPath}`)
          }
          await addPackage(childPath)
        }
      } else {
        await addPackage(entryPath)
      }
    }
  }
  const addPackage = async (packagePath: string): Promise<void> => {
    const key = relative(options.projectRoot, packagePath).split(sep).join('/')
    packages.add(key)
    const nested = resolve(packagePath, 'node_modules')
    try {
      await requireOrdinaryDirectory(nested, `nested node_modules for ${key}`)
      await visit(nested)
    } catch (error) {
      if (!isMissing(error)) throw error
    }
  }
  const rootNodeModules = resolve(options.projectRoot, 'node_modules')
  if (options.kind === 'extension') {
    await requireOrdinaryDirectory(rootNodeModules, 'extension project node_modules')
  }
  await visit(rootNodeModules)
  return packages
}

/**
 * Require one canonical node_modules-relative package-lock key.
 * @param path - Candidate key from a checked or hidden npm lock.
 * @returns Whether every segment names a complete nested npm package.
 */
export function isPackageLockPath(path: string): boolean {
  if (!path.startsWith('node_modules/')) return false
  const parts = path.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..')) return false
  for (let index = 0; index < parts.length;) {
    if (parts[index] !== 'node_modules') return false
    index += 1
    const packageHead = parts[index]
    if (packageHead === undefined) return false
    index += packageHead.startsWith('@') ? 2 : 1
    if (index > parts.length) return false
  }
  return true
}

/**
 * Compare registry identity fields that npm carries into its hidden lock.
 * @param value - Parsed package-lock entry.
 * @returns Stable JSON projection of immutable install identity fields.
 */
export function installIdentity(value: Record<string, unknown>): string {
  return JSON.stringify({
    version: value.version,
    resolved: value.resolved,
    integrity: value.integrity,
    link: value.link,
    os: value.os,
    cpu: value.cpu,
  })
}

/**
 * Require an ordinary directory rather than a mutable filesystem indirection.
 * @param path - Exact filesystem path to inspect without following a final symlink.
 * @param label - Stable diagnostic label for the caller-owned directory.
 */
export async function requireOrdinaryDirectory(path: string, label: string): Promise<void> {
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`channel-openclaw: ${label} must be an ordinary directory`)
  }
}

/**
 * Test whether a filesystem operation found no path.
 * @param error - Unknown caught filesystem failure.
 * @returns Whether Node classified the failure as ENOENT.
 */
export function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
