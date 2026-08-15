/** Owner-private bounded JSONL storage for semantic Activity records. */

import { createHash } from 'node:crypto'
import { chmod, mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { TextDecoder } from 'node:util'
import { decodeActivityRecord } from './records.ts'
import type {
  ClawdshActivityProducer,
  ClawdshActivityReadResult,
  ClawdshActivityRecord,
  ClawdshActivityWriteResult,
} from './types.ts'

/** Maximum encoded bytes, including the JSONL newline, for one Activity record. */
export const MAX_ACTIVITY_RECORD_BYTES = 8 * 1024
/** Maximum bytes retained in one active or rotated producer file. */
export const MAX_ACTIVITY_FILE_BYTES = 1024 * 1024
/** Fixed sidecar file names, without rotation suffixes. */
export const ACTIVITY_PRODUCERS = Object.freeze([
  'soul',
  'memory',
  'channels',
  'skills',
  'automation',
] as const satisfies readonly ClawdshActivityProducer[])

interface ActivityFileStat {
  readonly size: number
  isFile(): boolean
}

interface ActivityFileHandle {
  chmod(mode: number): Promise<void>
  close(): Promise<void>
  read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesRead: number }>
  stat(): Promise<ActivityFileStat>
  writeFile(data: string): Promise<void>
}

/** Injectable file primitives used only by focused failure and quiescence tests. */
export interface ActivityFileOps {
  mkdir(path: string): Promise<void>
  chmod(path: string, mode: number): Promise<void>
  open(path: string, flags: 'a' | 'r', mode?: number): Promise<ActivityFileHandle>
  rename(source: string, target: string): Promise<void>
  remove(path: string): Promise<void>
  stat(path: string): Promise<ActivityFileStat>
}

/** Internal construction options for deterministic storage tests. */
export interface ActivitySidecarStoreOptions {
  readonly fileOps?: ActivityFileOps
  readonly maxFileBytes?: number
  readonly maxRecordBytes?: number
}

interface ReadFileResult {
  readonly found: boolean
  readonly degraded: boolean
  readonly records: readonly ClawdshActivityRecord[]
}

const utf8 = new TextDecoder('utf-8', { fatal: true })

const nodeFileOps: ActivityFileOps = {
  async mkdir(path) { await mkdir(path, { recursive: true, mode: 0o700 }) },
  async chmod(path, mode) { await chmod(path, mode) },
  async open(path, flags, mode) { return open(path, flags, mode) },
  async rename(source, target) { await rename(source, target) },
  async remove(path) { await rm(path, { force: true }) },
  async stat(path) { return stat(path) },
}

/**
 * Per-Session, per-producer queue and bounded sidecar reader. This class is an implementation
 * detail; product plugins use the typed {@link ClawdshActivity} service exported at package root.
 */
export class ActivitySidecarStore {
  private readonly fileOps: ActivityFileOps
  private readonly maxFileBytes: number
  private readonly maxRecordBytes: number
  private readonly queues = new Map<string, Promise<void>>()
  private readonly degradedSessions = new Set<string>()
  private accepting = true
  private disposePromise: Promise<void> | undefined

  /**
   * @param root - Absolute `$DSH_HOME/clawdsh/activity/v1` root.
   * @param options - Focused-test overrides; production uses fixed limits and Node filesystem calls.
   */
  constructor(private readonly root: string, options: ActivitySidecarStoreOptions = {}) {
    this.fileOps = options.fileOps ?? nodeFileOps
    this.maxFileBytes = options.maxFileBytes ?? MAX_ACTIVITY_FILE_BYTES
    this.maxRecordBytes = options.maxRecordBytes ?? MAX_ACTIVITY_RECORD_BYTES
    if (!Number.isSafeInteger(this.maxFileBytes) || this.maxFileBytes < MAX_ACTIVITY_RECORD_BYTES) {
      throw new TypeError(`activity: maxFileBytes must be a safe integer at least ${MAX_ACTIVITY_RECORD_BYTES}`)
    }
    if (!Number.isSafeInteger(this.maxRecordBytes)
      || this.maxRecordBytes < 1
      || this.maxRecordBytes > this.maxFileBytes) {
      throw new TypeError('activity: maxRecordBytes must be a positive safe integer no larger than maxFileBytes')
    }
  }

  /**
   * Queue one canonical record without exposing filesystem failures to the producer.
   * @param producer - Fixed sidecar file selected by the typed service method.
   * @param record - Package-generated record; durable-boundary validation runs before encoding.
   * @returns a sanitized success/degradation result.
   */
  append(
    producer: ClawdshActivityProducer,
    record: ClawdshActivityRecord,
  ): Promise<ClawdshActivityWriteResult> {
    const digest = sessionDigest(record.sessionId)
    if (!this.accepting) return Promise.resolve(this.degrade(digest))
    const key = `${digest}:${producer}`
    const previous = this.queues.get(key) ?? Promise.resolve()
    const operation = previous.then(() => this.appendNow(digest, producer, record))
    const tail = operation.then(() => undefined)
    this.queues.set(key, tail)
    void tail.finally(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key)
    })
    return operation
  }

  /**
   * Read fixed producer files after writes already accepted by this instance settle.
   * @param sessionId - Session selected by the caller; it is hashed for path selection and checked on every line.
   * @param producers - Optional fixed-file subset; omitted reads every producer.
   * @returns canonical records plus sanitized availability and degradation state.
   */
  async read(
    sessionId: string,
    producers: readonly ClawdshActivityProducer[] = ACTIVITY_PRODUCERS,
  ): Promise<ClawdshActivityReadResult> {
    const digest = sessionDigest(sessionId)
    const selected = [...new Set(producers)]
    await Promise.all(selected.map(producer => this.queues.get(`${digest}:${producer}`) ?? Promise.resolve()))
    const results = await Promise.all(selected.map(producer => this.readProducer(digest, sessionId, producer)))
    const records = results.flatMap(result => result.records).sort(compareRecords)
    const found = results.some(result => result.found)
    const degraded = this.degradedSessions.has(digest) || results.some(result => result.degraded)
    const availability = found ? 'available' : degraded ? 'unavailable' : 'missing'
    return Object.freeze({
      records: Object.freeze(records),
      availability,
      degraded,
      ...(degraded ? { warning: 'activity-data-incomplete' as const } : {}),
    })
  }

  /**
   * Stop accepting appends and wait for every previously accepted queue entry.
   * @returns completion only after all entered writes have settled.
   */
  dispose(): Promise<void> {
    this.accepting = false
    return this.disposePromise ??= Promise.allSettled([...this.queues.values()]).then(() => undefined)
  }

  private async appendNow(
    digest: string,
    producer: ClawdshActivityProducer,
    candidate: ClawdshActivityRecord,
  ): Promise<ClawdshActivityWriteResult> {
    try {
      const record = decodeActivityRecord(candidate, candidate.sessionId, producer)
      if (record === undefined) return this.degrade(digest)
      const line = `${JSON.stringify(record)}\n`
      const bytes = Buffer.byteLength(line, 'utf8')
      if (bytes > this.maxRecordBytes) return this.degrade(digest)
      const directory = join(this.root, digest)
      await this.ensurePrivateStorageRoot()
      await this.ensurePrivateDirectory(directory)
      const active = join(directory, `${producer}.jsonl`)
      const currentBytes = await this.fileSize(active)
      if (currentBytes > this.maxFileBytes || currentBytes + bytes > this.maxFileBytes) {
        await this.rotate(active)
      }
      const handle = await this.fileOps.open(active, 'a', 0o600)
      let writeFailure: unknown
      try {
        await handle.chmod(0o600)
        await handle.writeFile(line)
      } catch (error) {
        writeFailure = error
      }
      try {
        await handle.close()
      } catch (error) {
        writeFailure ??= error
      }
      if (writeFailure !== undefined) return this.degrade(digest)
      return Object.freeze({ written: true, degraded: this.degradedSessions.has(digest) })
    } catch {
      return this.degrade(digest)
    }
  }

  private async ensurePrivateDirectory(path: string): Promise<void> {
    await this.fileOps.mkdir(path)
    await this.fileOps.chmod(path, 0o700)
  }

  private async ensurePrivateStorageRoot(): Promise<void> {
    const activity = dirname(this.root)
    const clawdsh = dirname(activity)
    await this.ensurePrivateDirectory(clawdsh)
    await this.ensurePrivateDirectory(activity)
    await this.ensurePrivateDirectory(this.root)
  }

  private async fileSize(path: string): Promise<number> {
    try {
      const info = await this.fileOps.stat(path)
      if (!info.isFile()) throw new Error('activity sidecar is not a regular file')
      return info.size
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) return 0
      throw error
    }
  }

  private async rotate(active: string): Promise<void> {
    const first = `${active}.1`
    const second = `${active}.2`
    await this.fileOps.remove(second)
    await this.renameIfPresent(first, second)
    await this.renameIfPresent(active, first)
    await this.chmodIfPresent(first, 0o600)
    await this.chmodIfPresent(second, 0o600)
  }

  private async renameIfPresent(source: string, target: string): Promise<void> {
    try {
      await this.fileOps.rename(source, target)
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) throw error
    }
  }

  private async chmodIfPresent(path: string, mode: number): Promise<void> {
    try {
      await this.fileOps.chmod(path, mode)
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) throw error
    }
  }

  private async readProducer(
    digest: string,
    sessionId: string,
    producer: ClawdshActivityProducer,
  ): Promise<ReadFileResult> {
    const active = join(this.root, digest, `${producer}.jsonl`)
    const files = [`${active}.2`, `${active}.1`, active]
    let found = false
    let degraded = false
    const records: ClawdshActivityRecord[] = []
    for (const path of files) {
      const result = await this.readFile(path, sessionId, producer)
      found ||= result.found
      degraded ||= result.degraded
      records.push(...result.records)
    }
    return { found, degraded, records }
  }

  private async readFile(
    path: string,
    sessionId: string,
    producer: ClawdshActivityProducer,
  ): Promise<ReadFileResult> {
    let handle: ActivityFileHandle
    try {
      handle = await this.fileOps.open(path, 'r')
    } catch (error) {
      return { found: false, degraded: !hasErrorCode(error, 'ENOENT'), records: [] }
    }
    let degraded = false
    let records: ClawdshActivityRecord[] = []
    try {
      const info = await handle.stat()
      if (!info.isFile() || !Number.isSafeInteger(info.size) || info.size < 0 || info.size > this.maxFileBytes) {
        return { found: true, degraded: true, records }
      }
      const bytes = Buffer.alloc(info.size)
      let offset = 0
      while (offset < bytes.byteLength) {
        const result = await handle.read(bytes, offset, bytes.byteLength - offset, offset)
        if (result.bytesRead === 0) break
        offset += result.bytesRead
      }
      if (offset !== bytes.byteLength) degraded = true
      const parsed = this.parseLines(bytes.subarray(0, offset), sessionId, producer)
      degraded ||= parsed.degraded
      records = parsed.records
    } catch {
      degraded = true
    } finally {
      try {
        await handle.close()
      } catch {
        degraded = true
      }
    }
    return { found: true, degraded, records }
  }

  private parseLines(
    bytes: Uint8Array,
    sessionId: string,
    producer: ClawdshActivityProducer,
  ): { readonly degraded: boolean; readonly records: ClawdshActivityRecord[] } {
    let text: string
    try {
      text = utf8.decode(bytes)
    } catch {
      return { degraded: true, records: [] }
    }
    let degraded = false
    if (text.length > 0 && !text.endsWith('\n')) {
      degraded = true
      const finalNewline = text.lastIndexOf('\n')
      text = finalNewline < 0 ? '' : text.slice(0, finalNewline + 1)
    }
    const records: ClawdshActivityRecord[] = []
    for (const line of text.split('\n').slice(0, -1)) {
      if (line.length === 0 || Buffer.byteLength(`${line}\n`, 'utf8') > this.maxRecordBytes) {
        degraded = true
        continue
      }
      let decoded: unknown
      try {
        decoded = JSON.parse(line)
      } catch {
        degraded = true
        continue
      }
      const record = decodeActivityRecord(decoded, sessionId, producer)
      if (record === undefined) {
        degraded = true
        continue
      }
      records.push(record)
    }
    return { degraded, records }
  }

  private degrade(digest: string): ClawdshActivityWriteResult {
    this.degradedSessions.add(digest)
    return Object.freeze({ written: false, degraded: true })
  }
}

/**
 * Hash a Session id so it never becomes a path component.
 * @param sessionId - Opaque Session identity.
 * @returns lowercase SHA-256 used as the sole Session directory name.
 */
export function sessionDigest(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex')
}

function compareRecords(left: ClawdshActivityRecord, right: ClawdshActivityRecord): number {
  const timestamp = left.timestamp.localeCompare(right.timestamp)
  return timestamp === 0 ? left.id.localeCompare(right.id) : timestamp
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
