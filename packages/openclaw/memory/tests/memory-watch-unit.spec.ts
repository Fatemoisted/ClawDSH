/**
 * Unit tests for the memory watcher with a mocked Chokidar. Pins the host
 * watcher's options, the memory-path event filter, disposal, and error
 * containment without any real filesystem watches.
 */

import { EventEmitter } from 'node:events'
import { join, resolve, sep } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'

interface FakeWatcher {
  emitter: EventEmitter
  closeCalls: number
  options: Record<string, unknown>
  path: string
}

const harness = vi.hoisted(() => ({
  watchers: [] as FakeWatcher[],
  closeErrors: 0,
  closeThrows: 0,
}))

vi.mock('chokidar', () => ({
  default: {
    watch(path: unknown, options: Record<string, unknown>) {
      const emitter = new EventEmitter() as EventEmitter & { close(): Promise<void> }
      const control: FakeWatcher = { emitter, closeCalls: 0, options, path: String(path) }
      emitter.close = () => {
        control.closeCalls += 1
        if (harness.closeThrows > 0) {
          harness.closeThrows -= 1
          throw new Error('synchronous close failed')
        }
        if (harness.closeErrors > 0) {
          harness.closeErrors -= 1
          return Promise.reject(new Error('close failed'))
        }
        return Promise.resolve()
      }
      harness.watchers.push(control)
      queueMicrotask(() => emitter.emit('ready'))
      return emitter
    },
  },
}))

const { installMemoryWatch } = await import('../src/watch.ts')

const CONFIG = { enabled: true, stabilityThresholdMs: 20, pollIntervalMs: 10 } as const
const WATCH_ROOT = resolve('memory-watch-root')

beforeEach(() => {
  harness.watchers.length = 0
  harness.closeErrors = 0
  harness.closeThrows = 0
})

describe('installMemoryWatch', () => {
  it('never opens a watcher when disabled', async () => {
    const ctx = new Context()
    const dispose = await installMemoryWatch(ctx, WATCH_ROOT, { ...CONFIG, enabled: false }, () => {})
    expect(harness.watchers).toHaveLength(0)
    dispose()
  })

  it('opens a watcher on the root with the memory-file options', async () => {
    const ctx = new Context()
    const dispose = await installMemoryWatch(ctx, WATCH_ROOT, CONFIG, () => {})
    expect(harness.watchers).toHaveLength(1)
    expect(harness.watchers[0]?.path).toBe(WATCH_ROOT)
    expect(harness.watchers[0]?.options).toMatchObject({
      persistent: true,
      ignoreInitial: true,
      depth: 1,
      followSymlinks: true,
      atomic: true,
      awaitWriteFinish: { stabilityThreshold: 20, pollInterval: 10 },
    })
    dispose()
  })

  it('reports memory files and ignores non-memory and out-of-root paths', async () => {
    const ctx = new Context()
    const seen: string[] = []
    const dispose = await installMemoryWatch(ctx, WATCH_ROOT, CONFIG, rel => seen.push(rel))
    const watcher = harness.watchers[0]
    if (watcher === undefined) throw new Error('expected a watcher')

    watcher.emitter.emit('change', join(WATCH_ROOT, 'MEMORY.md'))
    watcher.emitter.emit('change', join(WATCH_ROOT, 'memory', '2026-08-14.md'))
    watcher.emitter.emit('add', join(WATCH_ROOT, 'memory', 'new.md'))
    watcher.emitter.emit('unlink', join(WATCH_ROOT, 'memory', 'old.md'))
    // Non-memory paths: wrong name, wrong extension, too deep, out of root.
    watcher.emitter.emit('change', join(WATCH_ROOT, 'notes.txt'))
    watcher.emitter.emit('change', join(WATCH_ROOT, 'memory', 'notes.txt'))
    watcher.emitter.emit('change', join(WATCH_ROOT, 'memory', 'sub', 'deep.md'))
    watcher.emitter.emit('change', resolve(WATCH_ROOT, '..', 'elsewhere', 'MEMORY.md'))

    expect(seen).toEqual(['MEMORY.md', 'memory/2026-08-14.md', 'memory/new.md', 'memory/old.md'])
    dispose()
  })

  it.runIf(sep === '/')('preserves a literal backslash in a POSIX memory filename', async () => {
    const ctx = new Context()
    const seen: string[] = []
    const dispose = await installMemoryWatch(ctx, WATCH_ROOT, CONFIG, rel => seen.push(rel))
    const watcher = harness.watchers[0]
    if (watcher === undefined) throw new Error('expected a watcher')

    watcher.emitter.emit('change', join(WATCH_ROOT, 'memory', String.raw`literal\name.md`))

    expect(seen).toEqual([String.raw`memory/literal\name.md`])
    dispose()
  })

  it('closes the watcher on dispose and tolerates a failing close', async () => {
    const ctx = new Context()
    harness.closeErrors = 1
    const dispose = await installMemoryWatch(ctx, WATCH_ROOT, CONFIG, () => {})
    const watcher = harness.watchers[0]
    if (watcher === undefined) throw new Error('expected a watcher')

    dispose()
    expect(watcher.closeCalls).toBe(1)
    // The rejected close must be contained, not an unhandled rejection.
    await vi.waitFor(() => { expect(watcher.closeCalls).toBe(1) })
  })

  it('contains and reports a synchronous watcher-close failure', async () => {
    const ctx = new Context()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    harness.closeThrows = 1
    const dispose = await installMemoryWatch(ctx, WATCH_ROOT, CONFIG, () => {})

    expect(() => { dispose() }).not.toThrow()
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/failed to close watcher.*synchronous close failed/))
  })

  it('warns on a watcher error event and stays usable', async () => {
    const ctx = new Context()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const seen: string[] = []
    const dispose = await installMemoryWatch(ctx, WATCH_ROOT, CONFIG, rel => seen.push(rel))
    const watcher = harness.watchers[0]
    if (watcher === undefined) throw new Error('expected a watcher')

    watcher.emitter.emit('error', new Error('boom'))
    expect(warn).toHaveBeenCalled()
    // The watcher keeps serving events after a reported error.
    watcher.emitter.emit('change', join(WATCH_ROOT, 'MEMORY.md'))
    expect(seen).toEqual(['MEMORY.md'])
    dispose()
  })
})
