import type { FileSystem, FsDirEntry, FsTarget } from '@deepseek-ai/dsh-fs'
import { FsError } from '@deepseek-ai/dsh-fs'
import { describe, expect, it, vi } from 'vitest'
import { chunkMarkdown } from '../src/chunk.ts'
import { assertSafeMemoryRoot, isMemoryPath, readLineSlice, resolveMemoryTarget } from '../src/memory-files.ts'
import { cosineSimilarity, MemoryIndex } from '../src/search.ts'

const root = { displayPath: '/memory-root', targetKey: 'root' } as FsTarget
const memory = { displayPath: '/memory-root/MEMORY.md', targetKey: 'memory' } as FsTarget
const memoryEntry = { name: 'MEMORY.md', type: 'file', target: memory } as FsDirEntry

function indexFs(overrides: Partial<{
  contains: boolean
  entryLstatError: unknown
  info: { type: string; version?: string; size: number | undefined } | undefined
  listError: unknown
  text: string
}> = {}): FileSystem {
  const options = {
    contains: true,
    info: { type: 'file', version: 'v1', size: 4 },
    text: 'fact',
    ...overrides,
  }
  return {
    async lstat(path: string) {
      if (path === root.displayPath) return { type: 'directory' }
      if (options.entryLstatError !== undefined) throw options.entryLstatError
      return { type: 'file' }
    },
    async listDir() {
      if (options.listError !== undefined) throw options.listError
      return [memoryEntry]
    },
    async resolve() { return memory },
    contains() { return options.contains },
    async stat() { return options.info },
    async readText() { return options.text },
  } as unknown as FileSystem
}

describe('memory chunk boundaries', () => {
  it('returns no chunks for empty, whitespace-only, and punctuation-only inputs', () => {
    expect(chunkMarkdown('', 4, 0)).toEqual([])
    expect(chunkMarkdown(' \n\n\t', 4, 0)).toEqual([])
    expect(chunkMarkdown('.....', 2, 0)).toEqual([])
  })

  it('hard-splits an over-budget sentence and combines adjacent short sentences', () => {
    expect(chunkMarkdown('abcdefghij', 3, 0).map(chunk => chunk.text)).toEqual(['abc', 'def', 'ghi', 'j'])
    expect(chunkMarkdown('A. B. CCCCC.', 6, 0).map(chunk => chunk.text)).toEqual(['A. B.', ' CCCCC', '.'])
  })

  it('trims overlap forward after an internal sentence boundary', () => {
    const chunks = chunkMarkdown('abc. def\n\nsecond block', 15, 8)
    expect(chunks).toHaveLength(2)
    expect(chunks[1]?.text.startsWith('def')).toBe(true)
    expect(chunks[1]).toMatchObject({ startLine: 1, endLine: 3 })

    const untrimmed = chunkMarkdown('abcdefgh\n\nsecond block', 15, 4)
    expect(untrimmed[1]?.text.startsWith('efgh')).toBe(true)
  })

})

describe('memory path and vector boundaries', () => {
  it('covers path whitelist, containment, root type, and read clamping outcomes', async () => {
    expect(isMemoryPath('MEMORY.md')).toBe(true)
    expect(isMemoryPath('memory/day.md')).toBe(true)
    expect(isMemoryPath('memory/../MEMORY.md')).toBe(false)
    expect(isMemoryPath('memory/deep/day.md')).toBe(false)

    const escaped = indexFs({ contains: false })
    expect(await resolveMemoryTarget(escaped, root, 'MEMORY.md')).toBeUndefined()
    expect(await resolveMemoryTarget(escaped, root, 'notes.txt')).toBeUndefined()
    await expect(assertSafeMemoryRoot(indexFs(), root)).resolves.toBeDefined()
    await expect(assertSafeMemoryRoot({ lstat: async () => undefined } as unknown as FileSystem, root))
      .resolves.toBeUndefined()
    const unsafe = {
      lstat: async () => ({ type: 'symbolic-link' }),
    } as unknown as FileSystem
    await expect(assertSafeMemoryRoot(unsafe, root)).rejects.toMatchObject({ code: 'FS_NOT_DIRECTORY' })

    expect(readLineSlice('a\nb', 0, 1)).toEqual({ text: 'a', startLine: 1, endLine: 1 })
  })

  it('handles sparse, zero, mismatched, and opposing vectors', () => {
    const sparseLeft = new Array<number>(2)
    const sparseRight = new Array<number>(2)
    sparseLeft[0] = 1
    sparseRight[1] = 1
    expect(cosineSimilarity(sparseLeft, sparseRight)).toBe(0)
    expect(cosineSimilarity([0], [0])).toBe(0)
    expect(cosineSimilarity([1], [-1])).toBe(-1)
    expect(cosineSimilarity([], [])).toBe(0)
    expect(cosineSimilarity([1], [1, 2])).toBe(0)
  })
})

describe('MemoryIndex edge behavior', () => {
  it('ranks multiple real chunks, truncates snippets, and filters scores', async () => {
    const fs = indexFs({ text: 'highest score and long snippet.\n\nlower score.', info: { type: 'file', version: 'v1', size: 45 } })
    const index = new MemoryIndex(fs, root, 32, 0)
    const embed = vi.fn(async (texts: readonly string[]) => texts.map((text) => {
      if (text === 'query' || text.startsWith('highest')) return [1, 0]
      return [0.5, 0.5]
    }))

    const hits = await index.search('query', { embed } as never, 3, 0.6, 8)

    expect(hits.map(hit => hit.startLine)).toEqual([1, 3])
    expect(hits[0]?.snippet).toBe('highest ')
    expect(embed).toHaveBeenCalled()
  })

  it('skips a concurrently refreshed chunk until its own search embeds it', async () => {
    let version = 'v1'
    let storedText = 'first version'
    const fs = indexFs()
    vi.spyOn(fs, 'stat').mockImplementation(async () => ({
      type: 'file',
      version,
      size: storedText.length,
    }) as never)
    vi.spyOn(fs, 'readText').mockImplementation(async () => storedText)
    const index = new MemoryIndex(fs, root, 100, 0)
    let enterFirst!: () => void
    let enterSecond!: () => void
    let releaseFirst!: () => void
    let releaseSecond!: () => void
    const firstEntered = new Promise<void>((resolve) => { enterFirst = resolve })
    const secondEntered = new Promise<void>((resolve) => { enterSecond = resolve })
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve })
    const embeddings = {
      async embed(texts: readonly string[]): Promise<number[][]> {
        if (texts[0] === 'first query') {
          enterFirst()
          await firstGate
        } else {
          enterSecond()
          await secondGate
        }
        return texts.map(() => [1])
      },
    }

    const first = index.search('first query', embeddings as never, 3, 0, 100)
    await firstEntered
    version = 'v2'
    storedText = 'second version'
    const second = index.search('second query', embeddings as never, 3, 0, 100)
    await secondEntered

    releaseFirst()
    await expect(first).resolves.toEqual([])
    releaseSecond()
    await expect(second).resolves.toMatchObject([{ path: 'MEMORY.md', snippet: 'second version' }])
  })

  it('re-reads metadata without a size and drops unseen files from public search results', async () => {
    let entries: FsDirEntry[] = [memoryEntry]
    const fs = indexFs({ info: { type: 'file', version: 'v1', size: undefined }, text: 'four' })
    vi.spyOn(fs, 'listDir').mockImplementation(async () => entries)
    const read = vi.spyOn(fs, 'readText')
    const index = new MemoryIndex(fs, root, 100, 0)
    const embeddings = { embed: async (texts: readonly string[]) => texts.map(() => [1]) }

    await expect(index.search('query', embeddings as never, 1, -1, 100))
      .resolves.toMatchObject([{ path: 'MEMORY.md', snippet: 'four' }])
    await index.sync()
    expect(read).toHaveBeenCalledTimes(2)

    entries = []
    await expect(index.search('query', embeddings as never, 1, -1, 100)).resolves.toEqual([])
  })

  it('ignores entries that become unsafe or non-files during refresh', async () => {
    for (const fs of [
      indexFs({ contains: false }),
      indexFs({ info: { type: 'directory', version: 'v1', size: 0 } }),
      indexFs({ entryLstatError: new FsError('gone', 'FS_NOT_FOUND') }),
      indexFs({ entryLstatError: new FsError('not file', 'FS_NOT_REGULAR_FILE') }),
    ]) {
      const index = new MemoryIndex(fs, root, 100, 0)
      await expect(index.sync()).resolves.toBeUndefined()
    }

    const wrongType = indexFs()
    vi.spyOn(wrongType, 'lstat').mockImplementation(async path => (
      path === root.displayPath ? { type: 'directory' } : { type: 'symbolic-link' }
    ) as never)
    await expect(new MemoryIndex(wrongType, root, 100, 0).sync()).resolves.toBeUndefined()
  })

  it('contains missing-directory list races but propagates other storage failures and recovers its sync chain', async () => {
    const missing = new MemoryIndex(indexFs({ listError: new FsError('gone', 'FS_NOT_FOUND') }), root, 100, 0)
    await expect(missing.sync()).resolves.toBeUndefined()

    const failingFs = indexFs({ listError: new FsError('denied', 'FS_PERMISSION_DENIED') })
    const failing = new MemoryIndex(failingFs, root, 100, 0)
    await expect(failing.sync()).rejects.toMatchObject({ code: 'FS_PERMISSION_DENIED' })
    vi.spyOn(failingFs, 'listDir').mockResolvedValue([])
    await expect(failing.sync()).resolves.toBeUndefined()

    const unexpected = new MemoryIndex(indexFs({ entryLstatError: new Error('backend failed') }), root, 100, 0)
    await expect(unexpected.sync()).rejects.toThrow(/backend failed/)
  })
})
