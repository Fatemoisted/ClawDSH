/** Ordinary-file content verification for locked host and plugin trees. @module @clawdsh/dsh-channel-openclaw/file-integrity */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readlink, readdir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

/** File-count and SHA-512 identity of one verified ordinary-file assembly. */
export interface OrdinaryFileTreeLock {
  /** Number of ordinary files in the assembly; symbolic-link aliases are not files. */
  readonly fileCount: number
  /** Lowercase SHA-512 over every logical path, file size, file bytes, and verified link target. */
  readonly sha512: string
}

interface FileIntegrityInfo {
  readonly size: number
  isDirectory(): boolean
  isFile(): boolean
}

interface FileIntegrityEntry {
  readonly name: string
  isSymbolicLink(): boolean
  isDirectory(): boolean
  isFile(): boolean
}

/** Trusted internal filesystem adapter; public verification paths always use the Node implementation. */
interface FileIntegrityOps {
  lstat(path: string): Promise<FileIntegrityInfo>
  readlink(path: string): Promise<string>
  readdir(path: string): Promise<readonly FileIntegrityEntry[]>
  realpath(path: string): Promise<string>
  sha512File(path: string): Promise<string>
}

/**
 * Hash one file without buffering it in memory.
 * @param path Absolute path of the file to hash.
 * @returns Lowercase hexadecimal SHA-512 digest.
 */
export async function sha512File(path: string): Promise<string> {
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) hash.update(chunk)
  return hash.digest('hex')
}

const nodeFileOps: FileIntegrityOps = {
  lstat,
  readlink,
  readdir: async path => readdir(path, { withFileTypes: true }),
  realpath,
  sha512File,
}

/**
 * Compute a path-size-content digest for ordinary package files.
 * @param root Package root whose top-level `node_modules` is excluded.
 * @param fileOps Filesystem operations used to inspect and hash the package tree.
 * @returns Ordinary-file count and deterministic lowercase SHA-512 digest.
 */
export async function ordinaryFileTreeDigest(
  root: string,
  fileOps: FileIntegrityOps = nodeFileOps,
): Promise<OrdinaryFileTreeLock> {
  const canonicalRoot = await fileOps.realpath(root)
  const files = (await ordinaryFiles(canonicalRoot, canonicalRoot, fileOps)).sort()
  const tree = createHash('sha512')
  for (const path of files) {
    const info = await fileOps.lstat(path)
    const relativePath = relative(canonicalRoot, path).split(sep).join('/')
    const contentDigest = await fileOps.sha512File(path)
    tree.update(relativePath)
    tree.update('\0')
    tree.update(String(info.size))
    tree.update('\0')
    tree.update(Buffer.from(contentDigest, 'hex'))
  }
  return { fileCount: files.length, sha512: tree.digest('hex') }
}

/**
 * Compute an aggregate over every ordinary file in an installed npm project.
 *
 * Internal file symlinks are locked by logical path, canonical target, and target
 * bytes. An explicitly excluded external symlink is represented in the digest but
 * its target bytes must be verified independently by the caller.
 * @param root Ordinary project root whose complete contents are covered.
 * @param excludedExternalSymlinks Exact symlink paths already bound to separately verified roots.
 * @param fileOps Filesystem operations used to inspect and hash the installed project.
 * @returns Ordinary-file count and deterministic lowercase SHA-512 digest.
 */
export async function installedProjectTreeDigest(
  root: string,
  excludedExternalSymlinks: readonly string[] = [],
  fileOps: FileIntegrityOps = nodeFileOps,
): Promise<OrdinaryFileTreeLock> {
  if (!isAbsolute(root)) throw new Error('channel-openclaw: installed project tree root must be absolute')
  const rootInfo = await fileOps.lstat(root)
  if (!rootInfo.isDirectory()) {
    throw new Error('channel-openclaw: installed project tree root must be an ordinary directory')
  }
  const canonicalRoot = await fileOps.realpath(root)
  const excluded = new Set(excludedExternalSymlinks.map((path) => {
    if (!isAbsolute(path) || !isContained(root, path)) {
      throw new Error('channel-openclaw: excluded project symlink must be an absolute path inside the project root')
    }
    return resolve(canonicalRoot, relative(resolve(root), resolve(path)))
  }))
  const entries = await installedEntries(canonicalRoot, canonicalRoot, excluded, fileOps)
  entries.sort((left, right) => left.logicalPath.localeCompare(right.logicalPath))
  const tree = createHash('sha512')
  let fileCount = 0
  for (const entry of entries) {
    tree.update(entry.kind)
    tree.update('\0')
    tree.update(entry.logicalPath)
    tree.update('\0')
    if (entry.kind === 'file') {
      fileCount += 1
      tree.update(String(entry.size))
      tree.update('\0')
      tree.update(Buffer.from(entry.sha512, 'hex'))
    } else if (entry.kind === 'link') {
      tree.update(entry.targetPath)
      tree.update('\0')
      tree.update(String(entry.size))
      tree.update('\0')
      tree.update(Buffer.from(entry.sha512, 'hex'))
    }
  }
  return { fileCount, sha512: tree.digest('hex') }
}

type InstalledEntry = InstalledFile | InstalledLink | InstalledExternalLink

interface InstalledFile {
  readonly kind: 'file'
  readonly logicalPath: string
  readonly size: number
  readonly sha512: string
}

interface InstalledLink {
  readonly kind: 'link'
  readonly logicalPath: string
  readonly targetPath: string
  readonly size: number
  readonly sha512: string
}

interface InstalledExternalLink {
  readonly kind: 'external-link'
  readonly logicalPath: string
}

/** Collect an installed project while rejecting every unverified filesystem indirection. */
async function installedEntries(
  root: string,
  directory: string,
  excludedExternalSymlinks: ReadonlySet<string>,
  fileOps: FileIntegrityOps,
): Promise<InstalledEntry[]> {
  const entries: InstalledEntry[] = []
  for (const entry of await fileOps.readdir(directory)) {
    const path = resolve(directory, entry.name)
    const logicalPath = relative(root, path).split(sep).join('/')
    if (entry.isSymbolicLink()) {
      if (excludedExternalSymlinks.has(path)) {
        entries.push({ kind: 'external-link', logicalPath })
        continue
      }
      const target = resolve(dirname(path), await fileOps.readlink(path))
      if (!isContained(root, target)) {
        throw new Error(`channel-openclaw: installed project tree link escapes its root at ${logicalPath}`)
      }
      const targetInfo = await fileOps.lstat(target)
      if (!targetInfo.isFile()) {
        throw new Error(`channel-openclaw: installed project tree link does not target an ordinary file at ${logicalPath}`)
      }
      entries.push({
        kind: 'link',
        logicalPath,
        targetPath: relative(root, await fileOps.realpath(target)).split(sep).join('/'),
        size: targetInfo.size,
        sha512: await fileOps.sha512File(target),
      })
    } else if (entry.isDirectory()) {
      entries.push(...await installedEntries(root, path, excludedExternalSymlinks, fileOps))
    } else if (entry.isFile()) {
      const info = await fileOps.lstat(path)
      entries.push({ kind: 'file', logicalPath, size: info.size, sha512: await fileOps.sha512File(path) })
    } else {
      throw new Error(`channel-openclaw: installed project tree contains a non-file entry ${logicalPath}`)
    }
  }
  return entries
}

/** Test whether a resolved path is equal to or below an ordinary root. */
function isContained(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path))
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/** Recursively collect ordinary package files while rejecting indirections. */
async function ordinaryFiles(root: string, directory: string, fileOps: FileIntegrityOps): Promise<string[]> {
  const files: string[] = []
  for (const entry of await fileOps.readdir(directory)) {
    if (directory === root && entry.name === 'node_modules') continue
    const path = resolve(directory, entry.name)
    if (entry.isSymbolicLink()) {
      throw new Error(`channel-openclaw: package tree contains symbolic link ${relative(root, path)}`)
    }
    if (entry.isDirectory()) files.push(...await ordinaryFiles(root, path, fileOps))
    else if (entry.isFile()) files.push(path)
    else throw new Error(`channel-openclaw: package tree contains a non-file entry ${relative(root, path)}`)
  }
  return files
}
