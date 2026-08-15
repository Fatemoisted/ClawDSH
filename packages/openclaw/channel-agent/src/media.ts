/** Safe import of Gateway-staged image media. @module @clawdsh/dsh-channel-agent/media */

import { constants, type Stats } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import type { ChannelStagedMediaV1 } from '@clawdsh/dsh-channel'
import type { AttachmentStore, ImageAttachmentRef, ImageMediaType, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'

const IMAGE_TYPES: readonly ImageMediaType[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

interface PathIdentity {
  readonly dev: number
  readonly ino: number
}

interface ComponentSnapshot {
  readonly components: readonly PathIdentity[]
  readonly file: PathIdentity
}

interface PathInspection extends ComponentSnapshot {
  readonly target: string
}

/** Copy the filesystem identity needed to compare a path with an open handle. */
function identity(info: Stats): PathIdentity {
  return { dev: info.dev, ino: info.ino }
}

/** Whether two observations name the same filesystem object. */
function sameIdentity(left: PathIdentity, right: PathIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

/** Capture every component identity while rejecting symbolic links. */
async function componentSnapshot(root: string, relativePath: string): Promise<ComponentSnapshot> {
  let cursor = root
  const components: PathIdentity[] = []
  let file: PathIdentity | undefined
  for (const part of relativePath.split('/')) {
    cursor = resolve(cursor, part)
    const info = await lstat(cursor)
    if (info.isSymbolicLink()) throw new Error(`channel-agent: staged media path contains a symbolic link: ${relativePath}`)
    file = identity(info)
    components.push(file)
  }
  /* v8 ignore next -- validated relative paths contain at least one non-empty component. */
  if (file === undefined) throw new Error('channel-agent: staged media path has no file component')
  return { components, file }
}

/** Require every path component to retain its filesystem identity. */
function sameComponents(left: readonly PathIdentity[], right: readonly PathIdentity[]): boolean {
  return left.length === right.length && left.every((item, index) => {
    const other = right[index]
    return other !== undefined && sameIdentity(item, other)
  })
}

/** Test that a canonical target remains strictly inside a canonical root. */
function inside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/** Resolve one stable, symlink-free path snapshot contained by the staging root. */
async function inspectPath(root: string, relativePath: string): Promise<PathInspection> {
  const before = await componentSnapshot(root, relativePath)
  const target = await realpath(resolve(root, relativePath))
  if (!inside(root, target)) throw new Error('channel-agent: staged media escaped the configured root')
  const after = await componentSnapshot(root, relativePath)
  /* v8 ignore next -- requires a component replacement during this inspection; outer checks cover replacements around open/read. */
  if (!sameComponents(before.components, after.components)) {
    throw new Error('channel-agent: staged media path changed while it was resolved')
  }
  return { target, components: after.components, file: after.file }
}

/** Whether two complete path observations stayed on the same contained objects. */
function sameInspection(left: PathInspection, right: PathInspection): boolean {
  return left.target === right.target && sameComponents(left.components, right.components)
}

/** Whether an open file remained stable while its bytes were read. */
function sameOpenFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
}

/**
 * Read and authenticate every staged image before committing any attachment.
 * @param attachments - Durable attachment service and its active image policy.
 * @param stagingRoot - Absolute root shared with the authenticated local Gateway.
 * @param media - Ordered Gateway-staged media descriptors.
 * @param maxMediaBytes - Deployment cap applied to each staged object.
 * @returns Durable image references in the Gateway-declared order.
 */
export async function importStagedImages(
  attachments: AttachmentStore,
  stagingRoot: string,
  media: readonly ChannelStagedMediaV1[],
  maxMediaBytes: number,
): Promise<ImageAttachmentRef[]> {
  if (media.length > attachments.imageLimits.maxImagesPerMessage) {
    throw new Error(`channel-agent: ${media.length} images exceed the attachment count limit`)
  }
  const canonicalRoot = await realpath(stagingRoot)
  const inputs: SaveImageAttachment[] = []
  let messageBytes = 0
  for (let index = 0; index < media.length; index += 1) {
    const item = media[index]
    if (item === undefined || item.ordinal !== index) {
      throw new Error('channel-agent: staged media ordinals must be contiguous from zero')
    }
    if (item.kind !== 'image') {
      throw new Error(`channel-agent: media kind "${item.kind}" is unsupported until DSH has a durable non-image attachment seam`)
    }
    if (!IMAGE_TYPES.includes(item.mediaType as ImageMediaType)
      || !attachments.imageLimits.mediaTypes.includes(item.mediaType as ImageMediaType)) {
      throw new Error(`channel-agent: staged media type "${item.mediaType}" is not enabled`)
    }
    if (item.relativePath === '' || isAbsolute(item.relativePath)
      || item.relativePath.includes('\\')
      || item.relativePath.split('/').some(part => part === '' || part === '.' || part === '..')) {
      throw new Error(`channel-agent: invalid staged media path ${JSON.stringify(item.relativePath)}`)
    }
    if (!Number.isSafeInteger(item.bytes) || item.bytes <= 0 || item.bytes > maxMediaBytes) {
      throw new Error('channel-agent: staged media byte count is outside the configured limit')
    }
    messageBytes += item.bytes
    if (messageBytes > attachments.imageLimits.maxMessageImageBytes) {
      throw new Error('channel-agent: staged media exceed the attachment message byte limit')
    }
    const initialPath = await inspectPath(canonicalRoot, item.relativePath)
    /* v8 ignore next -- native Windows coverage exercises the no-flag arm; POSIX exercises O_NOFOLLOW. */
    const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW
    const handle = await open(initialPath.target, constants.O_RDONLY | noFollow)
    try {
      const before = await handle.stat()
      if (!before.isFile() || before.size !== item.bytes) throw new Error('channel-agent: staged media size changed or is not a file')
      const openedPath = await inspectPath(canonicalRoot, item.relativePath)
      if (!sameIdentity(openedPath.file, identity(before)) || !sameInspection(initialPath, openedPath)) {
        throw new Error('channel-agent: staged media path changed before it was read')
      }
      const data = await handle.readFile()
      const after = await handle.stat()
      const readPath = await inspectPath(canonicalRoot, item.relativePath)
      if (!sameOpenFile(before, after)
        || !sameIdentity(readPath.file, identity(after))
        || !sameInspection(openedPath, readPath)) {
        throw new Error('channel-agent: staged media changed while it was read')
      }
      const digest = createHash('sha256').update(data).digest('hex')
      if (digest !== item.sha256) throw new Error('channel-agent: staged media digest mismatch')
      inputs.push({
        data,
        mediaType: item.mediaType as ImageMediaType,
        ...(item.name === undefined ? {} : { name: item.name }),
      })
    } finally {
      await handle.close()
    }
  }
  await Promise.all(inputs.map(input => attachments.validateImage(input)))
  const refs: ImageAttachmentRef[] = []
  for (const input of inputs) refs.push(await attachments.saveImage(input))
  return refs
}
