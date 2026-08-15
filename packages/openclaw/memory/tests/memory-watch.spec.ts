/**
 * End-to-end watcher contract with the real Chokidar: host writes to a temp
 * memory root surface as `onMemoryFile` calls with memory-root-relative paths,
 * proving the watcher closes the freshness-token gap for same-size edits and
 * that a missing root never crashes startup.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
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

  it('does not crash on a missing root', async () => {
    const missing = join(dir, 'nested', 'memory')
    const seen: string[] = []
    // Chokidar suppresses ENOENT, watches the nearest existing ancestor, and
    // still resolves `ready`, so startup neither throws nor hangs. Recovering a
    // root created after startup is out of scope for this simplified watcher.
    await watch(seen, missing)
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(seen).toEqual([])
  })
})
