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
import { stat } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { isMemoryPath } from './memory-files.ts'

/** Default milliseconds a changed memory file must stay stable before it is observed. */
export const DEFAULT_WATCH_STABILITY_THRESHOLD_MS = 200
/** Default milliseconds between Chokidar host-change and write-stability probes. */
export const DEFAULT_WATCH_POLL_INTERVAL_MS = 100

/** Watch tuning for the memory root, resolved from the plugin config. */
export interface MemoryWatchConfig {
  /** Whether the host watcher is installed; `false` returns a no-op disposer. */
  enabled: boolean
  /** Milliseconds a changed file must stay stable before Chokidar reports it. */
  stabilityThresholdMs: number
  /** Milliseconds between Chokidar host-change and write-stability probes. */
  pollIntervalMs: number
}

interface WatchScope {
  /** Nearest existing directory Chokidar can attach to. */
  anchor: string
  /** Traversal depth from the anchor through the memory root and its flat subdirectory. */
  depth: number
}

function missingPath(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false
  const code = (error as { code?: unknown }).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/** Find an existing host directory while retaining enough depth to observe a lazily-created root. */
async function resolveWatchScope(rootPath: string): Promise<WatchScope> {
  let anchor = rootPath
  let missingLevels = 0
  while (true) {
    try {
      const info = await stat(anchor)
      if (info.isDirectory()) return { anchor, depth: missingLevels + 1 }
    } catch (error) {
      if (!missingPath(error)) throw error
    }
    const parent = dirname(anchor)
    if (parent === anchor) return { anchor, depth: missingLevels + 1 }
    anchor = parent
    missingLevels += 1
  }
}

function containedBy(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

/** Keep only the target root, its ancestors, and its descendants during an ancestor watch. */
function relevantToRoot(rootPath: string, candidatePath: string): boolean {
  const candidate = resolve(candidatePath)
  return containedBy(candidate, rootPath) || containedBy(rootPath, candidate)
}

/** Normalize a platform-relative event path and admit only memory files. */
export function normalizeMemoryWatchRelativePath(rel: string): string | undefined {
  const normalized = rel.replaceAll('\\', '/')
  return isMemoryPath(normalized) ? normalized : undefined
}

/**
 * Watch the memory root and report every changed memory file. Resolves once the
 * watcher is ready, so the caller never races the initial scan (a file written
 * immediately after startup is reported, not swallowed by `ignoreInitial`). A
 * missing root is not an error: the nearest existing directory is watched with
 * irrelevant sibling trees pruned, so a root created later by `memory_append`
 * becomes observable without an unmanaged timer or watcher restart. The disposer
 * closes the watcher and tolerates a failing close.
 * @param ctx - Cordis context, for warning logs.
 * @param rootPath - absolute host path of the memory root.
 * @param config - watch tuning (enabled plus stability and poll intervals).
 * @param onMemoryFile - receives each changed memory-root-relative path.
 * @returns an async disposer that closes the watcher; a no-op when disabled.
 */
export async function installMemoryWatch(
  ctx: Context,
  rootPath: string,
  config: MemoryWatchConfig,
  onMemoryFile: (rel: string) => void,
): Promise<() => Promise<void>> {
  if (!config.enabled) return () => Promise.resolve()
  const absoluteRoot = resolve(rootPath)
  const scope = await resolveWatchScope(absoluteRoot)
  const watcher = chokidar.watch(scope.anchor, {
    persistent: true,
    ignoreInitial: true,
    depth: scope.depth,
    followSymlinks: true,
    atomic: true,
    // Chokidar's native macOS backend can emit `ready` before a concurrently
    // opened watcher has started delivering events. Polling makes the public
    // ready barrier truthful: a write immediately after install resolves is
    // observed on every supported host, including under parallel startup.
    usePolling: true,
    interval: config.pollIntervalMs,
    binaryInterval: config.pollIntervalMs,
    ignored: path => !relevantToRoot(absoluteRoot, path),
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
    const rel = normalizeMemoryWatchRelativePath(relative(absoluteRoot, path))
    // Only whitelisted memory files invalidate; `add` events for a not-yet-
    // indexed path reach `invalidateFile` as a no-op, so one filter serves all.
    if (rel === undefined) return
    onMemoryFile(rel)
  }
  watcher.on('add', onEvent)
  watcher.on('change', onEvent)
  watcher.on('unlink', onEvent)
  // The anchor exists, so Chokidar resolves `ready` after the pruned initial scan.
  await new Promise<void>((resolve) => {
    watcher.once('ready', () => { resolve() })
  })
  return async () => {
    try {
      await watcher.close()
    } catch (error) {
      warn('failed to close watcher')(error)
    }
  }
}
