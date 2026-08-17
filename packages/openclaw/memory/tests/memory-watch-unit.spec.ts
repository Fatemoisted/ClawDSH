/**
 * Unit tests for the memory watcher with a mocked Chokidar. Pins the host
 * watcher's options, the memory-path event filter, disposal, and error
 * containment without any real filesystem watches.
 */

import { EventEmitter } from 'node:events'
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
  closeGate: undefined as Promise<void> | undefined,
  openErrors: 0,
  readyHook: undefined as ((watcher: FakeWatcher) => void) | undefined,
}))

vi.mock('chokidar', () => ({
  default: {
    watch(path: unknown, options: Record<string, unknown>) {
      if (harness.openErrors > 0) {
        harness.openErrors -= 1
        throw new Error('open failed')
      }
      const emitter = new EventEmitter() as EventEmitter & { close(): Promise<void> }
      const control: FakeWatcher = { emitter, closeCalls: 0, options, path: String(path) }
      emitter.close = async () => {
        control.closeCalls += 1
        await harness.closeGate
        if (harness.closeErrors > 0) {
          harness.closeErrors -= 1
          throw new Error('close failed')
        }
      }
      harness.watchers.push(control)
      queueMicrotask(() => {
        emitter.emit('ready')
        harness.readyHook?.(control)
      })
      return emitter
    },
  },
}))

const { installMemoryWatch } = await import('../src/watch.ts')

const CONFIG = { enabled: true, stabilityThresholdMs: 20, pollIntervalMs: 10 } as const

beforeEach(() => {
  harness.watchers.length = 0
  harness.closeErrors = 0
  harness.closeGate = undefined
  harness.openErrors = 0
  harness.readyHook = undefined
})

describe('installMemoryWatch', () => {
  it('never opens a watcher when disabled', async () => {
    const ctx = new Context()
    const dispose = await installMemoryWatch(ctx, '/root', { ...CONFIG, enabled: false }, () => {})
    expect(harness.watchers).toHaveLength(0)
    await dispose.recover()
    await dispose()
  })

  it('opens a watcher on the root with the memory-file options', async () => {
    const ctx = new Context()
    const dispose = await installMemoryWatch(ctx, '/root', CONFIG, () => {})
    expect(harness.watchers).toHaveLength(1)
    expect(harness.watchers[0]?.path).toBe('/root')
    expect(harness.watchers[0]?.options).toMatchObject({
      persistent: true,
      ignoreInitial: true,
      depth: 1,
      followSymlinks: false,
      usePolling: true,
      interval: 10,
      atomic: true,
      awaitWriteFinish: { stabilityThreshold: 20, pollInterval: 10 },
    })
    await dispose()
  })

  it('reopens a watcher after an initially missing root is created', async () => {
    const ctx = new Context()
    const seen: string[] = []
    const dispose = await installMemoryWatch(ctx, '/root', CONFIG, rel => seen.push(rel))
    const first = harness.watchers[0]
    if (first === undefined) throw new Error('expected the initial watcher')

    await dispose.recover()

    expect(first.closeCalls).toBe(1)
    expect(harness.watchers).toHaveLength(2)
    const recovered = harness.watchers[1]
    if (recovered === undefined) throw new Error('expected the recovered watcher')
    recovered.emitter.emit('add', '/root/MEMORY.md')
    expect(seen).toEqual(['MEMORY.md'])
    await dispose()
  })

  it('reports memory files and ignores non-memory and out-of-root paths', async () => {
    const ctx = new Context()
    const seen: string[] = []
    const dispose = await installMemoryWatch(ctx, '/root', CONFIG, rel => seen.push(rel))
    const watcher = harness.watchers[0]
    if (watcher === undefined) throw new Error('expected a watcher')

    watcher.emitter.emit('change', '/root/MEMORY.md')
    watcher.emitter.emit('change', '/root/memory/2026-08-14.md')
    watcher.emitter.emit('add', '/root/memory/new.md')
    watcher.emitter.emit('unlink', '/root/memory/old.md')
    // Non-memory paths: wrong name, wrong extension, too deep, out of root.
    watcher.emitter.emit('change', '/root/notes.txt')
    watcher.emitter.emit('change', '/root/memory/notes.txt')
    watcher.emitter.emit('change', '/root/memory/sub/deep.md')
    watcher.emitter.emit('change', '/elsewhere/MEMORY.md')

    expect(seen).toEqual(['MEMORY.md', 'memory/2026-08-14.md', 'memory/new.md', 'memory/old.md'])
    await dispose()
  })

  it('closes the watcher on dispose and tolerates a failing close', async () => {
    const ctx = new Context()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    harness.closeErrors = 1
    const dispose = await installMemoryWatch(ctx, '/root', CONFIG, () => {})
    const watcher = harness.watchers[0]
    if (watcher === undefined) throw new Error('expected a watcher')

    await dispose()
    expect(watcher.closeCalls).toBe(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('failed to close watcher'))
    await expect(dispose()).resolves.toBeUndefined()
    await expect(dispose.recover()).resolves.toBeUndefined()
  })

  it('warns on a watcher error event and stays usable', async () => {
    const ctx = new Context()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const seen: string[] = []
    const dispose = await installMemoryWatch(ctx, '/root', CONFIG, rel => seen.push(rel))
    const watcher = harness.watchers[0]
    if (watcher === undefined) throw new Error('expected a watcher')

    watcher.emitter.emit('error', new Error('boom'))
    expect(warn).toHaveBeenCalled()
    // The watcher keeps serving events after a reported error.
    watcher.emitter.emit('change', '/root/MEMORY.md')
    expect(seen).toEqual(['MEMORY.md'])
    await dispose()
  })

  it('waits for watcher close and an in-flight recovery before disposal settles', async () => {
    const ctx = new Context()
    let releaseClose!: () => void
    harness.closeGate = new Promise<void>((resolve) => { releaseClose = resolve })
    const dispose = await installMemoryWatch(ctx, '/root', CONFIG, () => {})
    const watcher = harness.watchers[0]
    if (watcher === undefined) throw new Error('expected a watcher')

    const recovering = dispose.recover()
    await vi.waitFor(() => { expect(watcher.closeCalls).toBe(1) })
    const closing = dispose()
    let settled = false
    void closing.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    releaseClose()
    await Promise.all([recovering, closing])
    expect(settled).toBe(true)
    expect(harness.watchers).toHaveLength(1)
  })

  it('closes a recovered watcher when disposal wins immediately after ready', async () => {
    const ctx = new Context()
    const dispose = await installMemoryWatch(ctx, '/root', CONFIG, () => {})
    harness.readyHook = () => { void dispose() }

    await dispose.recover()

    expect(harness.watchers).toHaveLength(2)
    expect(harness.watchers[1]?.closeCalls).toBe(1)
    await dispose()
  })

  it('keeps its transition chain disposable after reopening fails', async () => {
    const ctx = new Context()
    const dispose = await installMemoryWatch(ctx, '/root', CONFIG, () => {})
    harness.openErrors = 1

    await expect(dispose.recover()).rejects.toThrow(/open failed/)
    await expect(dispose.recover()).resolves.toBeUndefined()
    await expect(dispose()).resolves.toBeUndefined()
  })
})
