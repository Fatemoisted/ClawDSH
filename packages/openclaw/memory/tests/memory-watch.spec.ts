/**
 * End-to-end watcher contract with the real Chokidar: host writes to a temp
 * memory root surface as `onMemoryFile` calls with memory-root-relative paths,
 * proving the watcher closes the freshness-token gap for same-size edits and
 * that a missing root never crashes startup.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { installMemoryWatch } from '../src/watch.ts'

const CONFIG = { enabled: true, stabilityThresholdMs: 20, pollIntervalMs: 10 } as const

let dir: string
let disposeWatch: (() => Promise<void>) | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-memory-watch-'))
  mkdirSync(join(dir, 'memory'))
  disposeWatch = undefined
})

afterEach(async () => {
  await disposeWatch?.()
  rmSync(dir, { recursive: true, force: true })
})

async function watch(seen: string[], root: string = dir): Promise<void> {
  const ctx = new Context()
  disposeWatch = await installMemoryWatch(ctx, root, CONFIG, rel => seen.push(rel))
}

describe('memory watcher (real chokidar)', () => {
  it('reports a same-size edit, a new file, and an unlink', async () => {
    const seen: string[] = []
    await watch(seen)

    // Same byte length, different content: the freshness token `(version, size)`
    // cannot tell these apart, so only the host watcher forces the re-read.
    const before = 'The user likes banana smoothies.\n'
    const after = 'The user moved to Shenzhen city.\n'
    expect(after.length).toBe(before.length)

    await writeFile(join(dir, 'MEMORY.md'), before)
    await vi.waitFor(() => { expect(seen).toContain('MEMORY.md') })

    await writeFile(join(dir, 'MEMORY.md'), after)
    await vi.waitFor(() => { expect(seen.filter(rel => rel === 'MEMORY.md').length).toBeGreaterThanOrEqual(2) })

    await writeFile(join(dir, 'memory', '2026-08-14.md'), 'Running notes.\n')
    await vi.waitFor(() => { expect(seen).toContain('memory/2026-08-14.md') })

    await rm(join(dir, 'memory', '2026-08-14.md'))
    await vi.waitFor(() => { expect(seen.filter(rel => rel === 'memory/2026-08-14.md').length).toBeGreaterThanOrEqual(2) })
  })

  it('does not miss writes made immediately after concurrent watchers become ready', async () => {
    const roots = Array.from({ length: 12 }, (_, index) => join(dir, 'parallel', String(index)))
    const disposers: Array<() => Promise<void>> = []
    const seen = new Set<number>()
    try {
      await Promise.all(roots.map(async (root, index) => {
        await mkdir(join(root, 'memory'), { recursive: true })
        const ctx = new Context()
        const dispose = await installMemoryWatch(ctx, root, CONFIG, (rel) => {
          if (rel === 'MEMORY.md') seen.add(index)
        })
        disposers.push(dispose)
        // This write intentionally has no delay after the ready barrier.
        await writeFile(join(root, 'MEMORY.md'), `Fact ${String(index)}.\n`)
      }))

      await vi.waitFor(() => { expect(seen.size).toBe(roots.length) }, { timeout: 5_000 })
    } finally {
      await Promise.all(disposers.map(dispose => dispose()))
    }
  }, 10_000)

  it('ignores non-memory files', async () => {
    const seen: string[] = []
    await watch(seen)

    await writeFile(join(dir, 'MEMORY.md'), 'A fact.\n')
    await vi.waitFor(() => { expect(seen).toContain('MEMORY.md') })

    await writeFile(join(dir, 'notes.txt'), 'Not a memory file.\n')
    await writeFile(join(dir, 'memory', 'notes.txt'), 'Wrong extension.\n')
    // Give Chokidar a beat to emit (and the filter to drop) both non-memory adds.
    await new Promise(resolve => setTimeout(resolve, 80))

    expect(seen).not.toContain('notes.txt')
    expect(seen).not.toContain('memory/notes.txt')
  })

  it('recovers when a missing first-run root is created later', async () => {
    const missing = join(dir, 'nested', 'memory')
    const seen: string[] = []
    await watch(seen, missing)

    // Mirrors memory_append's lazy parent creation: the ancestor watch follows
    // the newly-created path without an extra polling loop or a plugin restart.
    await mkdir(join(missing, 'memory'), { recursive: true })
    await writeFile(join(missing, 'MEMORY.md'), 'Created lazily.\n')
    await writeFile(join(missing, 'memory', '2026-08-14.md'), 'Running note.\n')

    await vi.waitFor(() => { expect(seen).toContain('MEMORY.md') })
    await vi.waitFor(() => { expect(seen).toContain('memory/2026-08-14.md') })
  })
})
