import { randomUUID } from 'node:crypto'
import { chmod, mkdir, mkdtemp, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createActivityRecord } from '../src/records.ts'
import {
  ActivitySidecarStore,
  MAX_ACTIVITY_RECORD_BYTES,
  sessionDigest,
  type ActivityFileOps,
} from '../src/storage.ts'
import type { ClawdshActivityRecord } from '../src/types.ts'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

async function tempRoot(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'clawdsh-activity-store-'))
  cleanups.push(() => rm(home, { recursive: true, force: true }))
  return join(home, 'clawdsh', 'activity', 'v1')
}

function channelRecord(sessionId: string, seq = 1): ClawdshActivityRecord {
  return createActivityRecord(
    { id: randomUUID(), timestamp: new Date(1_800_000_000_000 + seq).toISOString(), sessionId },
    'channel.received',
    { adapter: 'feishu', conversation: 'group', mention: true, seq },
  )
}

function producerPath(root: string, sessionId: string, producer = 'channels'): string {
  return join(root, sessionDigest(sessionId), `${producer}.jsonl`)
}

function nodeOps(overrides: Partial<ActivityFileOps> = {}): ActivityFileOps {
  return {
    async mkdir(path) { await mkdir(path, { recursive: true, mode: 0o700 }) },
    async chmod(path, mode) { await chmod(path, mode) },
    async open(path, flags, mode) { return open(path, flags, mode) },
    async rename(source, target) { await rename(source, target) },
    async remove(path) { await rm(path, { force: true }) },
    async stat(path) { return stat(path) },
    ...overrides,
  }
}

describe('ActivitySidecarStore writes', () => {
  it.skipIf(process.platform === 'win32')('uses hashed Session directories with 0700/0600 permissions', async () => {
    const root = await tempRoot()
    const store = new ActivitySidecarStore(root)
    const sessionId = 'private-session-id'
    const path = producerPath(root, sessionId)

    await expect(store.append('channels', channelRecord(sessionId))).resolves.toEqual({
      written: true,
      degraded: false,
    })
    expect((await stat(join(root, '..', '..'))).mode & 0o777).toBe(0o700)
    expect((await stat(join(root, '..'))).mode & 0o777).toBe(0o700)
    expect((await stat(root)).mode & 0o777).toBe(0o700)
    expect((await stat(join(root, sessionDigest(sessionId)))).mode & 0o777).toBe(0o700)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(await readdir(root)).toEqual([sessionDigest(sessionId)])

    await chmod(path, 0o644)
    await store.append('channels', channelRecord(sessionId, 2))
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it('accepts an exact 8 KiB JSONL record and degrades a one-byte oversize record', async () => {
    const root = await tempRoot()
    const store = new ActivitySidecarStore(root)
    const empty = channelRecord('')
    const overhead = Buffer.byteLength(`${JSON.stringify(empty)}\n`, 'utf8')
    const exactSession = 's'.repeat(MAX_ACTIVITY_RECORD_BYTES - overhead)
    const oversizedSession = `${exactSession}s`

    const exact = await store.append('channels', { ...empty, sessionId: exactSession })
    const oversized = await store.append('channels', { ...channelRecord(oversizedSession), sessionId: oversizedSession })

    expect(exact).toEqual({ written: true, degraded: false })
    expect((await stat(producerPath(root, exactSession))).size).toBe(MAX_ACTIVITY_RECORD_BYTES)
    expect(oversized).toEqual({ written: false, degraded: true })
    await expect(stat(producerPath(root, oversizedSession))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('serializes appends for the same Session and producer', async () => {
    const root = await tempRoot()
    let active = 0
    let maximum = 0
    const base = nodeOps()
    const store = new ActivitySidecarStore(root, {
      fileOps: nodeOps({
        async open(path, flags, mode) {
          const handle = await base.open(path, flags, mode)
          return {
            chmod: value => handle.chmod(value),
            close: () => handle.close(),
            read: (buffer, offset, length, position) => handle.read(buffer, offset, length, position),
            stat: () => handle.stat(),
            async writeFile(data) {
              active += 1
              maximum = Math.max(maximum, active)
              await new Promise(resolve => setTimeout(resolve, 2))
              await handle.writeFile(data)
              active -= 1
            },
          }
        },
      }),
    })
    const sessionId = 'serialized-session'

    const outcomes = await Promise.all(Array.from({ length: 12 }, (_, index) =>
      store.append('channels', channelRecord(sessionId, index))))

    expect(outcomes.every(outcome => outcome.written)).toBe(true)
    expect(maximum).toBe(1)
    expect((await store.read(sessionId, ['channels'])).records).toHaveLength(12)
  })

  it('rotates at the active-file bound and retains only .1 and .2', async () => {
    const root = await tempRoot()
    const store = new ActivitySidecarStore(root, { maxFileBytes: 8192, maxRecordBytes: 8192 })
    const sessionId = 'r'.repeat(900)
    for (let seq = 0; seq < 30; seq += 1) {
      expect((await store.append('channels', channelRecord(sessionId, seq))).written).toBe(true)
    }
    const active = producerPath(root, sessionId)
    const names = (await readdir(join(root, sessionDigest(sessionId)))).sort()

    expect(names).toEqual(['channels.jsonl', 'channels.jsonl.1', 'channels.jsonl.2'])
    for (const path of [active, `${active}.1`, `${active}.2`]) {
      expect((await stat(path)).size).toBeLessThanOrEqual(8192)
      if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
    }
    const read = await store.read(sessionId, ['channels'])
    expect(read.degraded).toBe(false)
    expect(read.records.length).toBeGreaterThan(0)
    expect(read.records.length).toBeLessThan(30)
  })

  it('turns chmod and rotation failures into degradation without rejecting', async () => {
    const root = await tempRoot()
    const base = nodeOps()
    const chmodFailure = new ActivitySidecarStore(root, {
      fileOps: nodeOps({ async chmod() { throw Object.assign(new Error('private mode failed'), { code: 'EACCES' }) } }),
    })
    await expect(chmodFailure.append('channels', channelRecord('chmod-failure'))).resolves.toEqual({
      written: false,
      degraded: true,
    })

    const rotationRoot = await tempRoot()
    const rotationFailure = new ActivitySidecarStore(rotationRoot, {
      maxFileBytes: 8192,
      maxRecordBytes: 8192,
      fileOps: nodeOps({
        async rename(source, target) {
          if (source.endsWith('channels.jsonl')) {
            throw Object.assign(new Error('rotation failed'), { code: 'EACCES' })
          }
          await base.rename(source, target)
        },
      }),
    })
    const sessionId = 'x'.repeat(4000)
    expect((await rotationFailure.append('channels', channelRecord(sessionId, 1))).written).toBe(true)
    await expect(rotationFailure.append('channels', channelRecord(sessionId, 2))).resolves.toEqual({
      written: false,
      degraded: true,
    })
    expect((await stat(producerPath(rotationRoot, sessionId))).size).toBeLessThanOrEqual(8192)
  })

  it('waits for entered appends during dispose and refuses later writes', async () => {
    const root = await tempRoot()
    let release!: () => void
    let started!: () => void
    const entered = new Promise<void>((resolve) => { started = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    const base = nodeOps()
    const store = new ActivitySidecarStore(root, {
      fileOps: nodeOps({
        async open(path, flags, mode) {
          const handle = await base.open(path, flags, mode)
          return {
            chmod: value => handle.chmod(value),
            close: () => handle.close(),
            read: (buffer, offset, length, position) => handle.read(buffer, offset, length, position),
            stat: () => handle.stat(),
            async writeFile(data) {
              started()
              await gate
              await handle.writeFile(data)
            },
          }
        },
      }),
    })
    const sessionId = 'dispose-session'
    const append = store.append('channels', channelRecord(sessionId))
    await entered
    let disposed = false
    const disposal = store.dispose().then(() => { disposed = true })
    await Promise.resolve()

    expect(disposed).toBe(false)
    await expect(store.append('channels', channelRecord(sessionId, 2))).resolves.toEqual({
      written: false,
      degraded: true,
    })
    release()
    await expect(append).resolves.toMatchObject({ written: true })
    await disposal
    expect(disposed).toBe(true)
  })
})

describe('ActivitySidecarStore reads', () => {
  it('keeps legacy Memory records that predate outcome metadata', async () => {
    const root = await tempRoot()
    const store = new ActivitySidecarStore(root)
    const sessionId = 'legacy-memory-session'
    const legacy = createActivityRecord(
      { id: randomUUID(), timestamp: '2026-08-16T00:00:00.000Z', sessionId },
      'memory.update',
      { action: 'updated', seq: 4 },
      'succeeded',
    )

    await store.append('memory', legacy)

    await expect(store.read(sessionId, ['memory'])).resolves.toMatchObject({
      degraded: false,
      records: [{ metadata: { action: 'updated', seq: 4 } }],
    })
  })

  it('skips bad lines and an incomplete tail without modifying the source file', async () => {
    const root = await tempRoot()
    const store = new ActivitySidecarStore(root)
    const sessionId = 'corrupt-session'
    const path = producerPath(root, sessionId)
    await store.append('channels', channelRecord(sessionId))
    const valid = await readFile(path, 'utf8')
    const corrupt = `${valid}{"not":"an activity record"}\n{"version":1`
    await writeFile(path, corrupt, { mode: 0o600 })

    const read = await store.read(sessionId, ['channels'])

    expect(read).toMatchObject({
      availability: 'available',
      degraded: true,
      warning: 'activity-data-incomplete',
    })
    expect(read.records).toHaveLength(1)
    expect(await readFile(path, 'utf8')).toBe(corrupt)
  })

  it('skips records copied into another Session or producer file', async () => {
    const root = await tempRoot()
    const store = new ActivitySidecarStore(root)
    const requested = 'requested-session'
    const directory = join(root, sessionDigest(requested))
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const copied = channelRecord('different-session')
    await writeFile(join(directory, 'channels.jsonl'), `${JSON.stringify(copied)}\n`, { mode: 0o600 })

    const read = await store.read(requested, ['channels'])

    expect(read.records).toEqual([])
    expect(read).toMatchObject({ availability: 'available', degraded: true })
    expect(JSON.stringify(read)).not.toContain(root)
  })

  it('sanitizes a read failure without returning its path or error', async () => {
    const root = await tempRoot()
    const base = nodeOps()
    const store = new ActivitySidecarStore(root, {
      fileOps: nodeOps({
        async open(path, flags, mode) {
          if (flags === 'r') throw Object.assign(new Error(`cannot read ${path}`), { code: 'EACCES' })
          return base.open(path, flags, mode)
        },
      }),
    })
    const sessionId = 'unreadable-session'
    await store.append('channels', channelRecord(sessionId))

    const read = await store.read(sessionId, ['channels'])

    expect(read).toEqual({
      records: [],
      availability: 'unavailable',
      degraded: true,
      warning: 'activity-data-incomplete',
    })
    expect(JSON.stringify(read)).not.toContain(root)
    expect(JSON.stringify(read)).not.toContain('cannot read')
  })
})
