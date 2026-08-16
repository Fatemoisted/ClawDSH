import { createHash } from 'node:crypto'
import { link, mkdtemp, mkdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ChannelMediaId,
  ChannelMediaSha256,
  type ChannelStagedMediaV1,
} from '@clawdsh/dsh-channel'
import {
  AttachmentId,
  type AttachmentStore,
  type ImageAttachmentRef,
  type SaveImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import { importStagedImages } from '../src/media.ts'

const raceHooks = vi.hoisted((): {
  beforeRealpath: ((path: string) => Promise<void>) | undefined
  beforeOpen: (() => Promise<void>) | undefined
  afterRead: (() => Promise<void>) | undefined
  changedLstatIdentityPath: string | undefined
} => ({
  beforeRealpath: undefined,
  beforeOpen: undefined,
  afterRead: undefined,
  changedLstatIdentityPath: undefined,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      const info = await actual.lstat(...args)
      const path = args[0]
      if (typeof path !== 'string' || path !== raceHooks.changedLstatIdentityPath) return info
      return new Proxy(info, {
        get(target, property, receiver) {
          if (property === 'ino') return Number.MAX_SAFE_INTEGER
          return Reflect.get(target, property, receiver) as unknown
        },
      })
    },
    realpath: async (...args: Parameters<typeof actual.realpath>) => {
      const path = args[0]
      if (typeof path === 'string' && raceHooks.beforeRealpath !== undefined) {
        await raceHooks.beforeRealpath(path)
      }
      return await actual.realpath(...args)
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      const beforeOpen = raceHooks.beforeOpen
      raceHooks.beforeOpen = undefined
      if (beforeOpen !== undefined) await beforeOpen()
      const handle = await actual.open(...args)
      return new Proxy(handle, {
        get(target, property) {
          if (property === 'readFile') {
            return async () => {
              const data = await target.readFile()
              const afterRead = raceHooks.afterRead
              raceHooks.afterRead = undefined
              if (afterRead !== undefined) await afterRead()
              return data
            }
          }
          if (property === 'stat') return () => target.stat()
          if (property === 'close') return () => target.close()
          return Reflect.get(target, property, target) as unknown
        },
      })
    },
  }
})

const roots: string[] = []

afterEach(async () => {
  raceHooks.beforeRealpath = undefined
  raceHooks.beforeOpen = undefined
  raceHooks.afterRead = undefined
  raceHooks.changedLstatIdentityPath = undefined
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'dsh-channel-media-'))
  roots.push(value)
  return value
}

function staged(
  relativePath: string,
  data: Uint8Array,
  overrides: Partial<ChannelStagedMediaV1> = {},
): ChannelStagedMediaV1 {
  return {
    mediaId: ChannelMediaId(`media-${relativePath}`),
    ordinal: 0,
    kind: 'image',
    mediaType: 'image/png',
    bytes: data.byteLength,
    sha256: ChannelMediaSha256(createHash('sha256').update(data).digest('hex')),
    relativePath,
    ...overrides,
  }
}

function store(options: {
  maxImages?: number
  maxMessageBytes?: number
  mediaTypes?: readonly ('image/png' | 'image/jpeg' | 'image/webp' | 'image/gif')[]
  rejectValidation?: boolean
} = {}): { service: AttachmentStore; calls: string[]; saved: SaveImageAttachment[] } {
  const calls: string[] = []
  const saved: SaveImageAttachment[] = []
  const service = {
    imageLimits: {
      maxImageBytes: 1_024,
      maxImagesPerMessage: options.maxImages ?? 4,
      maxMessageImageBytes: options.maxMessageBytes ?? 2_048,
      maxImagePixels: 1_000,
      mediaTypes: options.mediaTypes ?? ['image/png'],
    },
    async validateImage(input: SaveImageAttachment): Promise<void> {
      calls.push(`validate:${Buffer.from(input.data).toString('hex')}`)
      if (options.rejectValidation === true) throw new Error('decoder rejected image')
    },
    async saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
      calls.push(`save:${Buffer.from(input.data).toString('hex')}`)
      saved.push(input)
      return {
        attachmentId: AttachmentId(createHash('sha256').update(input.data).digest('hex')),
        mediaType: input.mediaType,
        bytes: input.data.byteLength,
        width: 1,
        height: 1,
        ...(input.name === undefined ? {} : { name: input.name }),
      }
    },
  } as unknown as AttachmentStore
  return { service, calls, saved }
}

describe('staged channel media intake', () => {
  it('authenticates every image before saving any and preserves order and display names', async () => {
    const staging = await root()
    await mkdir(join(staging, 'nested'))
    const first = Buffer.from('first-image')
    const second = Buffer.from('second-image')
    await writeFile(join(staging, 'first.png'), first)
    await writeFile(join(staging, 'nested/second.png'), second)
    const attachments = store()

    const refs = await importStagedImages(attachments.service, staging, [
      staged('first.png', first, { name: 'first.png' }),
      staged('nested/second.png', second, { ordinal: 1, mediaId: ChannelMediaId('media-2') }),
    ], 100)

    expect(attachments.calls).toEqual([
      `validate:${first.toString('hex')}`,
      `validate:${second.toString('hex')}`,
      `save:${first.toString('hex')}`,
      `save:${second.toString('hex')}`,
    ])
    expect(refs.map(ref => ref.name)).toEqual(['first.png', undefined])
    expect(attachments.saved).toHaveLength(2)
  })

  it('rejects count, ordering, kind, type, byte, and aggregate policy violations', async () => {
    const staging = await root()
    const data = Buffer.from('image')
    await writeFile(join(staging, 'image.png'), data)
    const base = staged('image.png', data)
    await expect(importStagedImages(store({ maxImages: 0 }).service, staging, [base], 100))
      .rejects.toThrow(/count limit/)
    await expect(importStagedImages(store().service, staging, [{ ...base, ordinal: 1 }], 100))
      .rejects.toThrow(/ordinals/)
    await expect(importStagedImages(store().service, staging, [{ ...base, kind: 'file' }], 100))
      .rejects.toThrow(/unsupported/)
    await expect(importStagedImages(store({ mediaTypes: ['image/jpeg'] }).service, staging, [base], 100))
      .rejects.toThrow(/not enabled/)
    await expect(importStagedImages(store().service, staging, [{ ...base, bytes: 0 }], 100))
      .rejects.toThrow(/byte count/)
    await expect(importStagedImages(store().service, staging, [{ ...base, bytes: 1.5 }], 100))
      .rejects.toThrow(/byte count/)
    await expect(importStagedImages(store().service, staging, [base], data.byteLength - 1))
      .rejects.toThrow(/byte count/)
    const aggregate = store({ maxMessageBytes: data.byteLength })
    await expect(importStagedImages(aggregate.service, staging, [
      base,
      { ...base, ordinal: 1, mediaId: ChannelMediaId('media-2') },
    ], 100)).rejects.toThrow(/message byte limit/)
  })

  it('rejects absolute, dotted, empty-component, backslash, symlink, and non-file paths', async () => {
    const staging = await root()
    const data = Buffer.from('image')
    await writeFile(join(staging, 'image.png'), data)
    for (const relativePath of ['', '/image.png', '../image.png', './image.png', 'a//image.png', 'a\\image.png']) {
      await expect(importStagedImages(store().service, staging, [staged(relativePath, data)], 100))
        .rejects.toThrow(/invalid staged media path/)
    }
    await symlink('image.png', join(staging, 'linked.png'))
    await expect(importStagedImages(store().service, staging, [staged('linked.png', data)], 100))
      .rejects.toThrow(/symbolic link/)
    await mkdir(join(staging, 'directory'))
    await expect(importStagedImages(store().service, staging, [
      staged('directory', data, { bytes: data.byteLength }),
    ], 100)).rejects.toThrow(/not a file/)
  })

  it('rejects size and digest changes and commits nothing after batch validation failure', async () => {
    const staging = await root()
    const data = Buffer.from('image')
    await writeFile(join(staging, 'image.png'), data)
    await expect(importStagedImages(store().service, staging, [
      staged('image.png', data, { bytes: data.byteLength + 1 }),
    ], 100)).rejects.toThrow(/size changed/)
    await expect(importStagedImages(store().service, staging, [
      staged('image.png', data, { sha256: ChannelMediaSha256('a'.repeat(64)) }),
    ], 100)).rejects.toThrow(/digest mismatch/)

    const rejecting = store({ rejectValidation: true })
    await expect(importStagedImages(rejecting.service, staging, [staged('image.png', data)], 100))
      .rejects.toThrow(/decoder rejected/)
    expect(rejecting.calls).toEqual([`validate:${data.toString('hex')}`])
    expect(rejecting.saved).toEqual([])
  })

  it('rejects a parent directory replaced by a symlink between inspection and open', async () => {
    const staging = await root()
    const data = Buffer.from('same-authenticated-image')
    await mkdir(join(staging, 'nested'))
    await mkdir(join(staging, 'outside'))
    await writeFile(join(staging, 'nested/image.png'), data)
    await writeFile(join(staging, 'outside/image.png'), data)
    raceHooks.beforeOpen = async () => {
      await rename(join(staging, 'nested'), join(staging, 'original'))
      await symlink('outside', join(staging, 'nested'), 'dir')
    }

    await expect(importStagedImages(store().service, staging, [staged('nested/image.png', data)], 100))
      .rejects.toThrow(/symbolic link/)
  })

  it('rejects a path that escapes while its canonical target is resolved', async () => {
    const staging = await root()
    const data = Buffer.from('escaping-image')
    const outside = await root()
    await mkdir(join(staging, 'nested'))
    await writeFile(join(staging, 'nested/image.png'), data)
    await writeFile(join(outside, 'image.png'), data)
    const inspectedImage = join(await realpath(staging), 'nested', 'image.png')
    raceHooks.beforeRealpath = async (path) => {
      if (path !== inspectedImage) return
      raceHooks.beforeRealpath = undefined
      await rename(join(staging, 'nested'), join(staging, 'original'))
      await symlink(outside, join(staging, 'nested'), 'dir')
    }

    await expect(importStagedImages(store().service, staging, [staged('nested/image.png', data)], 100))
      .rejects.toThrow(/escaped the configured root/)
  })

  it('rejects a parent identity change between inspection and open even when the file inode is preserved', async () => {
    const staging = await root()
    const data = Buffer.from('stable-file-changing-parent-before-open')
    await mkdir(join(staging, 'nested'))
    await writeFile(join(staging, 'nested/image.png'), data)
    raceHooks.beforeOpen = async () => {
      await rename(join(staging, 'nested'), join(staging, 'original'))
      await mkdir(join(staging, 'nested'))
      await link(join(staging, 'original/image.png'), join(staging, 'nested/image.png'))
    }

    await expect(importStagedImages(store().service, staging, [staged('nested/image.png', data)], 100))
      .rejects.toThrow(/path changed before it was read/)
  })

  it('rejects a parent identity change after reading even when the file inode is preserved', async () => {
    const staging = await root()
    const data = Buffer.from('stable-file-changing-parent')
    await mkdir(join(staging, 'nested'))
    await writeFile(join(staging, 'nested/image.png'), data)
    const inspectedParent = join(await realpath(staging), 'nested')
    raceHooks.afterRead = async () => {
      raceHooks.changedLstatIdentityPath = inspectedParent
    }

    await expect(importStagedImages(store().service, staging, [staged('nested/image.png', data)], 100))
      .rejects.toThrow(/changed while it was read/)
  })
})
