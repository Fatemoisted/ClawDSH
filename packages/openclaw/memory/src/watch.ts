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

/**
 * Watch the memory root and report every changed memory file. Resolves once the
 * watcher is ready, so the caller never races the initial scan (a file written
 * immediately after startup is reported, not swallowed by `ignoreInitial`). A
 * missing root is not an error: Chokidar suppresses `ENOENT` and watches the
 * nearest existing ancestor, and `ready` still resolves. Recovering a root that
 * is created after startup is out of scope — this simplified watcher has no
 * rewatch logic. The disposer closes the watcher and tolerates a failing close.
 * @param ctx - Cordis context, for warning logs.
 * @param rootPath - absolute host path of the memory root.
 * @param config - watch tuning (enabled plus stability and poll intervals).
 * @param onMemoryFile - receives each changed memory-root-relative path.
 * @returns a disposer that closes the watcher; a no-op when disabled.
 */
export async function installMemoryWatch(
  ctx: Context,
  rootPath: string,
  config: MemoryWatchConfig,
  onMemoryFile: (rel: string) => void,
): Promise<() => void> {
  if (!config.enabled) return () => {}
  const watcher = chokidar.watch(rootPath, {
    persistent: true,
    ignoreInitial: true,
    depth: 1,
    followSymlinks: true,
    atomic: true,
    awaitWriteFinish: {
      stabilityThreshold: config.stabilityThresholdMs,
      pollInterval: config.pollIntervalMs,
    },
  })
  const warn = (label: string) => (error: unknown): void => {
    ctx.logger.warn(`memory: ${label}: ${String(error)}`)
  }
  watcher.on('error', warn('watcher failed'))
  const onEvent = (path: string): void => {
    // Filesystem inputs use the host separator; memory protocol paths always
    // use `/` so the same invalidation key is produced on Windows and POSIX.
    const rel = relative(rootPath, path).split(sep).join('/')
    // Only whitelisted memory files invalidate; `add` events for a not-yet-
    // indexed path reach `invalidateFile` as a no-op, so one filter serves all.
    if (!isMemoryPath(rel)) return
    onMemoryFile(rel)
  }
  watcher.on('add', onEvent)
  watcher.on('change', onEvent)
  watcher.on('unlink', onEvent)
  // Chokidar always resolves `ready` after the initial scan, including for a
  // missing root (it watches the nearest existing ancestor), so this cannot hang.
  await new Promise<void>((resolve) => { watcher.once('ready', () => { resolve() }) })
  return () => {
    try {
      void watcher.close().catch(warn('failed to close watcher'))
    } catch (error) {
      warn('failed to close watcher')(error)
    }
  }
}
