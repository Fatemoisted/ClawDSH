import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { validateStagedMedia } from './protocol-v1.js'

/** Verify staged media paths, bytes, and digests without exposing arbitrary local files. */
export class StagedMediaGuard {
  #stagingRoot
  #maxMediaBytes
  #rootPromise

  /**
   * @param {string} stagingRoot - OpenClaw/ClawDSH shared media root.
   * @param {number} maxMediaBytes - Per-object read limit.
   */
  constructor(stagingRoot, maxMediaBytes) {
    if (typeof stagingRoot !== 'string' || stagingRoot.length === 0) {
      throw new Error('CLAWDSH_CHANNEL_STAGING_ROOT is required')
    }
    if (!isAbsolute(stagingRoot)) throw new Error('channel staging root must be absolute')
    if (!Number.isSafeInteger(maxMediaBytes) || maxMediaBytes <= 0) {
      throw new Error('channel maxMediaBytes must be a positive safe integer')
    }
    this.#stagingRoot = resolve(stagingRoot)
    this.#maxMediaBytes = maxMediaBytes
  }

  /**
   * Convert OpenClaw V2 materialized media facts into protocol references.
   * @param {readonly object[]} facts - OpenClaw MediaFact values.
   * @returns {Promise<readonly object[]>} Ordered ChannelStagedMediaV1 references.
   */
  async importFacts(facts) {
    if (!Array.isArray(facts)) throw new Error('OpenClaw media facts must be an array')
    const references = []
    for (const [ordinal, fact] of facts.entries()) {
      if (!isObject(fact)) throw new Error(`OpenClaw media fact ${ordinal} is invalid`)
      if (typeof fact.url === 'string' && fact.url.length > 0) {
        throw new Error('remote inbound media is rejected until OpenClaw materializes it in the staging root')
      }
      if (typeof fact.path !== 'string' || fact.path.length === 0) {
        throw new Error(`OpenClaw media fact ${ordinal} has no staged path`)
      }
      const inspected = await this.#inspectPath(fact.path)
      if (fact.sizeBytes !== undefined && fact.sizeBytes !== inspected.bytes) {
        throw new Error(`OpenClaw media fact ${ordinal} byte count does not match staged bytes`)
      }
      const kind = mediaKind(fact.kind, fact.contentType)
      const mediaType = mediaTypeOf(fact.contentType)
      const mediaId = createHash('sha256')
        .update(`${ordinal}\0${inspected.relativePath}\0${inspected.sha256}`)
        .digest('hex')
      const name = safeDisplayName(fact.fileName ?? basename(inspected.absolutePath))
      const reference = {
        mediaId,
        ordinal,
        kind,
        mediaType,
        bytes: inspected.bytes,
        sha256: inspected.sha256,
        relativePath: inspected.relativePath,
        ...(name === undefined ? {} : { name }),
      }
      validateStagedMedia(reference, `media[${ordinal}]`)
      references.push(reference)
    }
    return references
  }

  /**
   * Verify protocol references immediately before use.
   * @param {readonly object[]} references - ChannelStagedMediaV1 values.
   * @returns {Promise<readonly {reference: object, absolutePath: string, bytes: Buffer}[]>} Verified media.
   */
  async verifyReferences(references) {
    if (!Array.isArray(references)) throw new Error('staged media references must be an array')
    const verified = []
    for (const [ordinal, candidate] of references.entries()) {
      const reference = validateStagedMedia(candidate, `media[${ordinal}]`)
      if (reference.ordinal !== ordinal) throw new Error(`media[${ordinal}] has a non-contiguous ordinal`)
      const inspected = await this.#inspectPath(reference.relativePath)
      if (inspected.bytes !== reference.bytes || inspected.sha256 !== reference.sha256) {
        throw new Error(`media[${ordinal}] no longer matches its staged reference`)
      }
      verified.push({ reference, absolutePath: inspected.absolutePath, bytes: inspected.buffer })
    }
    return verified
  }

  /** Return the canonical staging root after validating its type. */
  async root() {
    return (await this.#resolvedRoot()).canonicalRoot
  }

  async #inspectPath(candidate) {
    const { canonicalRoot, lexicalRoot, rootIdentity } = await this.#resolvedRoot()
    const currentRoot = await lstat(lexicalRoot)
    if (currentRoot.isSymbolicLink() || !sameIdentity(identity(currentRoot), rootIdentity)) {
      throw new Error('channel staging root changed after validation')
    }
    const candidatePath = isAbsolute(candidate) ? resolve(candidate) : join(lexicalRoot, ...candidate.split('/'))
    const lexicalRelative = relative(lexicalRoot, candidatePath)
    if (!inside(lexicalRelative)) throw new Error('staged media path escapes the configured root')
    const initialPath = await componentSnapshot(lexicalRoot, lexicalRelative)
    const canonical = await realpath(candidatePath)
    const canonicalRelative = relative(canonicalRoot, canonical)
    if (!inside(canonicalRelative)) throw new Error('staged media realpath escapes the configured root')
    const resolvedPath = await componentSnapshot(lexicalRoot, lexicalRelative)
    if (!sameComponents(initialPath.components, resolvedPath.components)) {
      throw new Error('staged media path changed while it was resolved')
    }
    const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW
    const handle = await open(canonical, constants.O_RDONLY | noFollow)
    try {
      const before = await handle.stat()
      if (!before.isFile()) throw new Error('staged media must be a regular file')
      if (before.size <= 0 || before.size > this.#maxMediaBytes) {
        throw new Error('staged media byte count is outside the configured limit')
      }
      const openedPath = await componentSnapshot(lexicalRoot, lexicalRelative)
      if (!sameIdentity(identity(before), openedPath.file)
        || !sameComponents(resolvedPath.components, openedPath.components)) {
        throw new Error('staged media path changed before it was read')
      }
      const buffer = await readExact(handle, before.size)
      const after = await handle.stat()
      const readPath = await componentSnapshot(lexicalRoot, lexicalRelative)
      if (!sameOpenFile(before, after)
        || !sameIdentity(identity(after), readPath.file)
        || !sameComponents(openedPath.components, readPath.components)) {
        throw new Error('staged media changed while it was read')
      }
      const sha256 = createHash('sha256').update(buffer).digest('hex')
      return {
        absolutePath: canonical,
        relativePath: canonicalRelative.split(sep).join('/'),
        bytes: buffer.byteLength,
        sha256,
        buffer,
      }
    } finally {
      await handle.close()
    }
  }

  #resolvedRoot() {
    this.#rootPromise ??= resolveRoot(this.#stagingRoot)
    return this.#rootPromise
  }
}

async function resolveRoot(stagingRoot) {
  const lexicalRoot = resolve(stagingRoot)
  const before = await lstat(lexicalRoot)
  if (before.isSymbolicLink()) throw new Error('channel staging root must not be a symbolic link')
  const canonicalRoot = await realpath(lexicalRoot)
  const info = await stat(canonicalRoot)
  if (!info.isDirectory()) throw new Error('channel staging root must be a directory')
  const after = await lstat(lexicalRoot)
  if (!sameIdentity(identity(before), identity(after))) {
    throw new Error('channel staging root changed while it was resolved')
  }
  return { lexicalRoot, canonicalRoot, rootIdentity: identity(after) }
}

function identity(info) {
  return { dev: info.dev, ino: info.ino }
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino
}

async function componentSnapshot(root, relativePath) {
  let current = root
  const components = []
  let file
  for (const segment of relativePath.split(sep)) {
    if (segment.length === 0) continue
    current = join(current, segment)
    const info = await lstat(current)
    if (info.isSymbolicLink()) throw new Error('staged media path contains a symbolic link')
    file = identity(info)
    components.push(file)
  }
  if (file === undefined) throw new Error('staged media path has no file component')
  return { components, file }
}

function sameComponents(left, right) {
  return left.length === right.length && left.every((item, index) => {
    const other = right[index]
    return other !== undefined && sameIdentity(item, other)
  })
}

function sameOpenFile(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
}

async function readExact(handle, size) {
  const buffer = Buffer.allocUnsafe(size)
  let offset = 0
  while (offset < size) {
    const { bytesRead } = await handle.read(buffer, offset, size - offset, offset)
    if (bytesRead === 0) throw new Error('staged media changed while it was read')
    offset += bytesRead
  }
  const extra = Buffer.allocUnsafe(1)
  if ((await handle.read(extra, 0, 1, size)).bytesRead !== 0) {
    throw new Error('staged media changed while it was read')
  }
  return buffer
}

function inside(relativePath) {
  return relativePath !== '' && relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath)
}

function mediaKind(kind, contentType) {
  if (kind === 'image' || kind === 'sticker') return 'image'
  if (kind === 'audio') return 'audio'
  if (kind === 'video') return 'video'
  if (typeof contentType === 'string') {
    if (contentType.startsWith('image/')) return 'image'
    if (contentType.startsWith('audio/')) return 'audio'
    if (contentType.startsWith('video/')) return 'video'
  }
  return 'file'
}

function mediaTypeOf(value) {
  if (typeof value !== 'string' || !/^[^\s/]+\/[^\s/]+$/.test(value)) return 'application/octet-stream'
  return value
}

function safeDisplayName(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) return undefined
  const name = basename(value).replace(/[\r\n]/g, ' ')
  return name.length === 0 ? undefined : name.slice(0, 255)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
