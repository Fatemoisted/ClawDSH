/**
 * Shared npm installation-tree validation for the locked host and extensions.
 * @module @clawdsh/dsh-channel-openclaw/npm-tree
 */

import { lstat, readdir } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'

/** Which installation owns a package tree and therefore its diagnostics. */
type InstallationKind = 'extension' | 'runtime'

/** Options that distinguish the host runtime from an isolated extension project. */
interface PackageTreeOptions {
  /** Root whose `node_modules` tree is traversed. */
  root: string
  /** Diagnostic namespace for rejected entries. */
  kind: InstallationKind
  /** One verified OpenClaw peer symlink an extension is allowed to carry. */
  allowedPackageLink?: string
  /** Optional label that also requires the top-level `node_modules` to be an ordinary directory. */
  rootLabel?: string
}

/** Require an ordinary directory rather than a mutable filesystem indirection. */
export async function requireOrdinaryDirectory(path: string, label: string): Promise<void> {
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`channel-openclaw: ${label} must be an ordinary directory`)
  }
}

/** Collect every installed npm package directory and reject unapproved indirections. */
export async function installedPackageDirectories(options: PackageTreeOptions): Promise<Set<string>> {
  const { root, kind, allowedPackageLink, rootLabel } = options
  const packages = new Set<string>()
  const visit = async (nodeModules: string): Promise<void> => {
    for (const entry of await readdir(nodeModules, { withFileTypes: true })) {
      if (entry.name === '.bin' || entry.name === '.package-lock.json') continue
      const entryPath = resolve(nodeModules, entry.name)
      if (entry.isSymbolicLink()) {
        if (allowedPackageLink === entryPath) continue
        if (kind === 'extension') {
          throw new Error(`channel-openclaw: extension node_modules contains an unverified package link ${entryPath}`)
        }
      }
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new Error(`channel-openclaw: ${kind} node_modules contains a non-directory entry ${entryPath}`)
      }
      if (entry.name.startsWith('@')) {
        for (const child of await readdir(entryPath, { withFileTypes: true })) {
          const childPath = resolve(entryPath, child.name)
          if (child.isSymbolicLink() || !child.isDirectory()) {
            throw new Error(`channel-openclaw: ${kind} package scope contains a non-directory entry ${childPath}`)
          }
          await addPackage(childPath)
        }
      } else {
        await addPackage(entryPath)
      }
    }
  }
  const addPackage = async (packagePath: string): Promise<void> => {
    const key = relative(root, packagePath).split(sep).join('/')
    packages.add(key)
    const nested = resolve(packagePath, 'node_modules')
    try {
      await requireOrdinaryDirectory(nested, `nested node_modules for ${key}`)
      await visit(nested)
    } catch (error) {
      if (!isMissing(error)) throw error
    }
  }
  const nodeModules = resolve(root, 'node_modules')
  if (rootLabel !== undefined) await requireOrdinaryDirectory(nodeModules, rootLabel)
  await visit(nodeModules)
  return packages
}

/** Require one canonical `node_modules`-relative package-lock key. */
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

/** Compare registry identity fields npm carries into the installed hidden lock. */
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

/** Test whether a filesystem failure is an absent path. */
function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
