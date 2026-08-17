/**
 * Host-filesystem watcher over the memory root. When a memory file changes on
 * disk, the watcher reports its memory-root-relative path so the caller can
 * invalidate that one index entry — closing the gap the `(version, size)`
 * freshness check leaves for same-size edits and delete-then-recreate races,
 * without re-embedding every other file. The watcher watches the resolved host
 * root directly (memory files are plain Markdown on the host filesystem), not
 * the fs-seam target abstraction.
 *
 * @module @clawdsh/dsh-memory/watch
 */

import type { Context } from '@deepseek-ai/cordis'
import chokidar from 'chokidar'
import { relative, sep } from 'node:path'
import { isMemoryPath } from './memory-files.ts'

/** Default milliseconds a changed memory file must stay stable before it is observed. */
export const DEFAULT_WATCH_STABILITY_THRESHOLD_MS = 200
/** Default milliseconds between Chokidar stability probes. */
export const DEFAULT_WATCH_POLL_INTERVAL_MS = 100

/** Watch tuning for the memory root, resolved from the plugin config. */
export interface MemoryWatchConfig {
  /** Whether the host watcher is installed; `false` returns a no-op disposer. */
  enabled: boolean
  /** Milliseconds a changed file must stay stable before Chokidar reports it. */
  stabilityThresholdMs: number
  /** Milliseconds between Chokidar stability probes. */
  pollIntervalMs: number
}

/** Async watcher disposer with one explicit missing-root recovery operation. */
export interface MemoryWatchDisposer {
  /** Stop recovery work, close the active watcher, and settle after both are quiescent. */
  (): Promise<void>
  /** Reopen after the missing root is created and report its existing memory files before resolving. */
  recover(): Promise<void>
}

/**
 * Watch the memory root and report every changed memory file. A missing root is
 * not an error: Chokidar suppresses `ENOENT` and `ready` still resolves. The
 * returned `recover()` operation closes the incomplete ancestor observation and
 * reopens after `memory_write` creates the root. Recovery includes the created
 * root's initial memory files before it resolves, so correctness does not depend
 * on a later polling notification for files written while the root was absent.
 * The disposer closes the watcher and tolerates a failing close.
 * @param ctx - Cordis context, for warning logs.
 * @param rootPath - absolute host path of the memory root.
 * @param config - watch tuning (enabled plus stability and poll intervals).
 * @param onMemoryFile - receives each changed memory-root-relative path.
 * @returns a disposer/controller that closes or explicitly recovers the watcher.
 */
export async function installMemoryWatch(
  ctx: Context,
  rootPath: string,
  config: MemoryWatchConfig,
  onMemoryFile: (rel: string) => void,
): Promise<MemoryWatchDisposer> {
  if (!config.enabled) {
    const disabled = (() => Promise.resolve()) as MemoryWatchDisposer
    disabled.recover = () => Promise.resolve()
    return disabled
  }
  const warn = (label: string) => (error: unknown): void => {
    ctx.logger.warn(`memory: ${label}: ${String(error)}`)
  }
  const onEvent = (path: string): void => {
    // Filesystem inputs use the host separator; memory protocol paths always
    // use `/` so the same invalidation key is produced on Windows and POSIX.
    const rel = relative(rootPath, path).split(sep).join('/')
    // Only whitelisted memory files invalidate; `add` events for a not-yet-
    // indexed path reach `invalidateFile` as a no-op, so one filter serves all.
    if (!isMemoryPath(rel)) return
    onMemoryFile(rel)
  }
  const open = async (reportInitial: boolean): Promise<ReturnType<typeof chokidar.watch>> => {
    const next = chokidar.watch(rootPath, {
      persistent: true,
      ignoreInitial: !reportInitial,
      depth: 1,
      followSymlinks: false,
      usePolling: true,
      interval: config.pollIntervalMs,
      atomic: true,
      awaitWriteFinish: {
        stabilityThreshold: config.stabilityThresholdMs,
        pollInterval: config.pollIntervalMs,
      },
    })
    next.on('error', warn('watcher failed'))
    next.on('add', onEvent)
    next.on('change', onEvent)
    next.on('unlink', onEvent)
    // Chokidar resolves `ready` after its initial scan even when the root is
    // absent. When reportInitial is true, every initial add is emitted before
    // ready, making recovery's filesystem reconciliation part of this promise.
    await new Promise<void>((resolve) => {
      next.once('ready', () => { resolve() })
    })
    return next
  }
  let watcher: ReturnType<typeof chokidar.watch> | undefined = await open(false)
  let transition: Promise<void> = Promise.resolve()
  let disposed = false
  const isDisposed = (): boolean => disposed
  let disposal: Promise<void> | undefined
  const close = async (target: ReturnType<typeof chokidar.watch>): Promise<void> => {
    try {
      await target.close()
    } catch (error) {
      warn('failed to close watcher')(error)
    }
  }
  const dispose = (() => {
    if (disposal !== undefined) return disposal
    disposed = true
    disposal = transition.then(async () => {
      const current = watcher
      watcher = undefined
      if (current !== undefined) await close(current)
    })
    return disposal
  }) as MemoryWatchDisposer
  dispose.recover = () => {
    const run = transition.then(async () => {
      if (isDisposed()) return
      const previous = watcher
      watcher = undefined
      if (previous !== undefined) await close(previous)
      if (isDisposed()) return
      const next = await open(true)
      if (isDisposed()) {
        await close(next)
        return
      }
      watcher = next
    })
    transition = run.catch(() => {})
    return run
  }
  return dispose
}
