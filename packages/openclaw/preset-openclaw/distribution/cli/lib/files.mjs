/** Filesystem primitives for managed assets. All tree operations reject links and special files. */

import { createHash, randomBytes } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
  closeSync,
} from 'node:fs'
import { createReadStream } from 'node:fs'
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'

/** Parsed JSON is narrowed by each owning manifest parser before a field affects I/O. @typedef {any} ParsedJson */
/** @typedef {'file' | 'directory'} ManagedKind */

/** Return true only when `candidate` is lexically inside `root`. */
/** @param {string} root @param {string} candidate @returns {boolean} */
export function isInside(root, candidate) {
  const relation = relative(resolve(root), resolve(candidate))
  return relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation)
}

/** Return whether a filesystem directory entry exists without following a dangling link. */
/** @param {string} path @returns {boolean} */
export function entryExists(path) {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

/**
 * Require every existing parent below an ordinary root to be an ordinary directory.
 * Missing suffixes are allowed so the caller can create them and validate again.
 */
/** @param {string} root @param {string} relativePath @param {string} [label] @returns {void} */
export function requireOrdinaryParents(root, relativePath, label = 'managed path') {
  const logical = safeRelative(relativePath, label)
  const rootMetadata = lstatSync(root)
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error(`${label} root must be an ordinary directory`)
  }
  const physicalRoot = realpathSync(root)
  const parts = logical.split('/')
  let current = resolve(root)
  for (const part of parts.slice(0, -1)) {
    current = join(current, part)
    if (!entryExists(current)) return
    const metadata = lstatSync(current)
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error(`${label} parent must be an ordinary directory: ${current}`)
    }
    if (!isInside(physicalRoot, realpathSync(current))) {
      throw new Error(`${label} parent resolves outside its managed root: ${current}`)
    }
  }
}

/** Validate a normalized, non-empty relative POSIX path. */
/** @param {string} value @param {string} [label] @returns {string} */
export function safeRelative(value, label = 'path') {
  if (typeof value !== 'string' || value === '' || value.includes('\\') || value.includes('\0')
    || isAbsolute(value) || value.endsWith('/')) {
    throw new TypeError(`${label} must be a normalized relative path`)
  }
  const normalized = posix.normalize(value)
  if (normalized !== value || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new TypeError(`${label} escapes its root`)
  }
  return value
}

/** Create or validate one owner-only ordinary directory. */
/** @param {string} path @returns {void} */
export function privateDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  const metadata = lstatSync(path)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`managed directory must be an ordinary directory: ${path}`)
  }
  chmodSync(path, 0o700)
}

/** Create a missing Harness home privately, or preserve an existing ordinary directory's mode. */
/** @param {string} path @returns {void} */
export function homeDirectory(path) {
  if (!entryExists(path)) mkdirSync(path, { recursive: true, mode: 0o700 })
  const metadata = lstatSync(path)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`Harness home must be an ordinary directory: ${path}`)
  }
}

/** Read and parse strict JSON from an ordinary file. */
/** @param {string} path @param {string} [label] @returns {ParsedJson} */
export function readJson(path, label = path) {
  const metadata = lstatSync(path)
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new TypeError(`${label} must be an ordinary file`)
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (cause) {
    throw new TypeError(`${label} must contain strict JSON`, { cause })
  }
}

/** Write JSON through an exclusive private temporary file and atomic rename. */
/** @param {string} path @param {unknown} value @param {number} [mode] @returns {void} */
export function writeJsonAtomic(path, value, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`
  let descriptor
  try {
    descriptor = openSync(temporary, 'wx', mode)
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`)
    closeSync(descriptor)
    descriptor = undefined
    renameSync(temporary, path)
    chmodSync(path, mode)
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor)
    if (entryExists(temporary)) unlinkSync(temporary)
    throw error
  }
}

/** Recursively copy an ordinary source tree without following links. */
/** @param {string} source @param {string} destination @returns {void} */
export function copyOrdinaryTree(source, destination) {
  const root = resolve(source)
  /** @param {string} from @param {string} to */
  const visit = (from, to) => {
    const metadata = lstatSync(from)
    if (metadata.isSymbolicLink()) throw new TypeError(`managed source contains symbolic link: ${relative(root, from)}`)
    if (metadata.isDirectory()) {
      mkdirSync(to, { recursive: true, mode: 0o700 })
      for (const name of readdirSync(from).sort()) visit(join(from, name), join(to, name))
      return
    }
    if (!metadata.isFile()) throw new TypeError(`managed source contains a special file: ${relative(root, from)}`)
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(from, to)
    chmodSync(to, metadata.mode & 0o111 ? 0o700 : 0o600)
  }
  visit(root, resolve(destination))
}

/** Remove one known managed entry without following a link-shaped target. */
/** @param {string} path @returns {void} */
export function removeManagedEntry(path) {
  if (!entryExists(path)) return
  const metadata = lstatSync(path)
  if (metadata.isSymbolicLink()) {
    unlinkSync(path)
    return
  }
  if (metadata.isDirectory()) {
    for (const name of readdirSync(path)) removeManagedEntry(join(path, name))
    rmdirSync(path)
    return
  }
  if (metadata.isFile()) {
    unlinkSync(path)
    return
  }
  throw new Error(`refusing to remove special managed entry: ${path}`)
}

/** Return an SRI SHA-512 digest for bytes. */
/** @param {import('node:crypto').BinaryLike} bytes @returns {string} */
export function bytesIntegrity(bytes) {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`
}

/** Hash one ordinary file without loading it into memory. */
/** @param {string} path @returns {Promise<string>} */
export async function fileIntegrity(path) {
  const metadata = lstatSync(path)
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new TypeError(`managed asset must be an ordinary file: ${path}`)
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return `sha512-${hash.digest('base64')}`
}

/** Compute the canonical path-size-content digest of one ordinary tree. */
/** @param {string} root @returns {{fileCount: number, integrity: string}} */
export function ordinaryTreeDigest(root) {
  const absoluteRoot = resolve(root)
  /** @type {string[]} */
  const files = []
  /** @param {string} directory */
  const visit = (directory) => {
    const metadata = lstatSync(directory)
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new TypeError(`managed tree must contain ordinary directories: ${directory}`)
    }
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name)
      const entry = lstatSync(path)
      if (entry.isSymbolicLink()) throw new TypeError(`managed tree contains symbolic link: ${relative(absoluteRoot, path)}`)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) files.push(path)
      else throw new TypeError(`managed tree contains special file: ${relative(absoluteRoot, path)}`)
    }
  }
  visit(absoluteRoot)
  files.sort((left, right) => {
    const a = relative(absoluteRoot, left).split(sep).join('/')
    const b = relative(absoluteRoot, right).split(sep).join('/')
    return a < b ? -1 : a > b ? 1 : 0
  })
  const aggregate = createHash('sha512')
  for (const path of files) {
    const logical = relative(absoluteRoot, path).split(sep).join('/')
    const bytes = readFileSync(path)
    aggregate.update(logical)
    aggregate.update('\0')
    aggregate.update(String(bytes.byteLength))
    aggregate.update('\0')
    aggregate.update(createHash('sha512').update(bytes).digest())
  }
  return {
    fileCount: files.length,
    integrity: `sha512-${aggregate.digest('base64')}`,
  }
}

/** Return a stable digest for a JSON-compatible value. */
/** @param {unknown} value @returns {string} */
export function jsonIntegrity(value) {
  return bytesIntegrity(Buffer.from(`${JSON.stringify(value)}\n`))
}

/** Require an existing managed target to be an ordinary file or directory of the requested kind. */
/** @param {string} path @param {ManagedKind} kind @returns {void} */
export function requireKind(path, kind) {
  const metadata = lstatSync(path)
  const matches = kind === 'file' ? metadata.isFile() : metadata.isDirectory()
  if (metadata.isSymbolicLink() || !matches) throw new Error(`managed ${kind} has an unsafe filesystem type: ${path}`)
}

/** Return an RFC3339 timestamp safe for a filename. */
/** @param {Date} [date] @returns {string} */
export function filenameTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

/** Return an ordinary file's byte size. */
/** @param {string} path @returns {number} */
export function ordinaryFileSize(path) {
  requireKind(path, 'file')
  return statSync(path).size
}
