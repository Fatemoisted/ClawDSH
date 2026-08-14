/**
 * Contract tests for the memory row, keyless: the real fs local backend over a temp root,
 * the real SystemPrompt and ToolRuntime, and a deterministic stub embedding backend
 * (one unique dimension per token, so cosine similarity is exactly shared-token
 * overlap — no hash collisions, no API key). Fixtures use `ctx.fs.writeText`;
 * the model-facing append and recall paths go through `ctx.tools.execute`.
 * Pinned: chunking, ranked recall with source lines, result bounds, fail-loud
 * without an embeddings provider, incremental rebuild, append concurrency,
 * narrow sandbox-root policy, path containment, guidance, and disposal.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FileSystem, FsTarget, FsWriteIntent, FsWriteOutcome } from '@deepseek-ai/dsh-fs'
import { CallId } from '@deepseek-ai/dsh-llm'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { Embeddings } from '@clawdsh/dsh-embeddings'
import type { EmbeddingVector } from '@clawdsh/dsh-embeddings'
import * as Memory from '@clawdsh/dsh-memory'
import { MEMORY_APPEND_TOOL, MEMORY_RECALL_SECTION, RECALL_TEXT } from '@clawdsh/dsh-memory'
import { chunkMarkdown } from '../src/chunk.ts'
import { readLineSlice } from '../src/memory-files.ts'
import { MemoryIndex } from '../src/search.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Deterministic token-overlap embedding backend: one dimension per distinct token. */
class StubEmbeddings extends Embeddings {
  private readonly tokenDimensions = new Map<string, number>()

  override async embed(texts: readonly string[], _signal?: AbortSignal): Promise<EmbeddingVector[]> {
    const vectors: number[][] = []
    let maxDimension = -1
    for (const text of texts) {
      const vector: number[] = []
      for (const match of text.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
        const dimension = this.dimensionOf(match[0])
        vector[dimension] = (vector[dimension] ?? 0) + 1
        maxDimension = Math.max(maxDimension, dimension)
      }
      vectors.push(vector)
    }
    return vectors.map((vector) => {
      // Index loop with an explicit hole guard: the transform pipeline
      // downlevels for..of over sparse arrays into hole reads (undefined),
      // which would overwrite the zero fill.
      const padded = new Array<number>(maxDimension + 1).fill(0)
      for (let index = 0; index < vector.length; index++) {
        const value = vector[index]
        if (value !== undefined) padded[index] = value
      }
      return padded
    })
  }

  private dimensionOf(token: string): number {
    const existing = this.tokenDimensions.get(token)
    if (existing !== undefined) return existing
    const dimension = this.tokenDimensions.size
    this.tokenDimensions.set(token, dimension)
    return dimension
  }
}

const testSignal = new AbortController().signal

let dir: string
let ctx: Context

let callCounter = 0
function call(name: string, args: unknown, agent?: Agent) {
  return ctx.tools.execute({
    signal: testSignal,
    callId: CallId(`memory-${++callCounter}`),
    name,
    arguments: args,
    ...(agent === undefined ? {} : { agent }),
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

async function writeMemoryFile(rel: string, content: string): Promise<void> {
  await ctx.fs.writeText(await ctx.fs.resolve(join(dir, rel)), content)
}

type SandboxExecutionPolicy = NonNullable<Parameters<FileSystem['writeText']>[4]>

/** Small policy owner proving memory preserves mode while replacing only this call's root. */
class StubSandboxPolicy extends Service {
  constructor(ctx: Context, private readonly mode: SandboxExecutionPolicy['mode']) {
    super(ctx, 'sandboxPolicy')
  }

  resolve(request: { session?: Session } = {}): SandboxExecutionPolicy {
    const session = request.session
    return {
      mode: this.mode,
      workspaceRoot: session?.header.cwd ?? process.cwd(),
      ...(session === undefined ? {} : { sessionId: session.id }),
    }
  }
}

/** Test double for fs-sandbox's policy fence; records every stamped mutation. */
class ConfiningFileSystem extends LocalFileSystem {
  readonly stamped: Array<SandboxExecutionPolicy | undefined> = []

  override get sandboxMode() {
    return 'workspace-write' as const
  }

  override async writeText(
    target: FsTarget,
    content: string,
    expected?: FsWriteIntent,
    signal?: AbortSignal,
    sandboxPolicy?: SandboxExecutionPolicy,
  ): Promise<FsWriteOutcome> {
    this.stamped.push(sandboxPolicy)
    if (sandboxPolicy === undefined) {
      throw new FsError('test filesystem requires a sandbox policy', 'FS_SANDBOX_DENIED')
    }
    if (sandboxPolicy.mode === 'read-only') {
      throw new FsError('test filesystem denied a read-only write', 'FS_SANDBOX_DENIED')
    }
    let checked = target
    if (sandboxPolicy.mode === 'workspace-write') {
      const resolveOptions = signal === undefined ? undefined : { signal }
      const root = await this.resolve(sandboxPolicy.workspaceRoot, resolveOptions)
      checked = await this.resolve(target.displayPath, resolveOptions)
      if (!this.contains(root, checked)) {
        throw new FsError('test filesystem denied an out-of-root write', 'FS_SANDBOX_DENIED')
      }
    }
    return super.writeText(checked, content, expected, signal)
  }
}

function fakeAgent(cwd: string): Agent {
  const id = SessionId(`memory-agent-${++callCounter}`)
  const session = Session.create(id, undefined, { version: 0, id, createdAt: Date.now(), cwd })
  return { id, session } as Agent
}

async function sandboxHarness(mode: SandboxExecutionPolicy['mode'], workspace: string): Promise<ConfiningFileSystem> {
  ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(StubSandboxPolicy, mode)
  await ctx.plugin(ConfiningFileSystem, { cwd: workspace })
  await ctx.plugin(StubEmbeddings)
  await ctx.plugin(Memory, { root: dir })
  return ctx.fs as ConfiningFileSystem
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-memory-'))
  mkdirSync(join(dir, 'memory'))
  ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalFileSystem)
  await ctx.plugin(StubEmbeddings)
})

afterEach(async () => {
  // The memory row now watches the root by default; dispose the fiber so the
  // persistent Chokidar watcher closes before the temp root is removed.
  await ctx.fiber.dispose()
  rmSync(dir, { recursive: true, force: true })
})

describe('chunkMarkdown', () => {
  it('aggregates paragraphs within the budget and reports true line numbers', () => {
    // Five source lines: the blank line between paragraphs is line 3.
    const chunks = chunkMarkdown('line one\nline two\n\nline three\nline four', 100, 0)
    expect(chunks.map(chunk => chunk.text)).toEqual(['line one\nline two\n\nline three\nline four'])
    expect(chunks[0]).toMatchObject({ startLine: 1, endLine: 5 })
  })

  it('sentence-splits a paragraph longer than the budget', () => {
    const chunks = chunkMarkdown('First sentence here. Second sentence here. Third sentence here.', 26, 0)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]?.text.length).toBeLessThanOrEqual(26)
    expect(chunks[0]?.startLine).toBe(1)
    expect(chunks.at(-1)?.endLine).toBe(1)
  })

  it('carries a sentence-aligned overlap into the next chunk', () => {
    const chunks = chunkMarkdown(
      'AAAA BBBB. CCCC DDDD.\n\nEEEE FFFF. GGGG HHHH.',
      30, 12,
    )
    expect(chunks.length).toBeGreaterThan(1)
    const second = chunks[1]?.text ?? ''
    // The overlap starts at a sentence boundary: either "CCCC DDDD." or the
    // whole first paragraph carries over, never a mid-sentence fragment.
    expect(/^(CCCC DDDD\.|AAAA BBBB\.)/.test(second.trim())).toBe(true)
  })
})

describe('readLineSlice', () => {
  it('slices by 1-based lines and reports the lines actually present', () => {
    expect(readLineSlice('a\nb\nc\nd', 2, 2)).toEqual({ text: 'b\nc', startLine: 2, endLine: 3 })
    expect(readLineSlice('a\nb', 3, 2)).toEqual({ text: '', startLine: 3, endLine: 2 })
    expect(readLineSlice('a\nb', 2, 5)).toEqual({ text: 'b', startLine: 2, endLine: 2 })
  })
})

describe('memory_search', () => {
  it('recalls related facts with source lines and scores', async () => {
    await writeMemoryFile('MEMORY.md', 'The user prefers banana smoothies for breakfast.\n')
    await writeMemoryFile('memory/2026-08-14.md', 'Discussed the tax deadline today. It moved to September.\n')
    await ctx.plugin(Memory, { root: dir })

    const result = await call('memory_search', { query: 'what does the user like for breakfast' })
    expect(result.isError).toBe(false)
    const output = text(result)
    expect(output).toContain('MEMORY.md:1-1')
    expect(output).toContain('smoothies')
    expect(output).not.toContain('tax')
  })

  it('honors maxResults and minScore', async () => {
    await writeMemoryFile('MEMORY.md', 'The user prefers banana smoothies for breakfast.\n')
    await writeMemoryFile('memory/2026-08-14.md', 'The user likes bananas as a snack.\n')
    await ctx.plugin(Memory, { root: dir })

    const limited = await call('memory_search', { query: 'banana smoothie breakfast', maxResults: 1 })
    expect(text(limited).split('\n\n')).toHaveLength(1)

    const filtered = await call('memory_search', { query: 'tax deadline', minScore: 0.5 })
    expect(text(filtered)).toBe('No matching memories found.')
  })

  it('uses configured search defaults when tool arguments omit them', async () => {
    await writeMemoryFile('MEMORY.md', 'banana smoothie breakfast\n')
    await writeMemoryFile('memory/2026-08-14.md', 'banana smoothie breakfast\n')
    await ctx.plugin(Memory, { root: dir, maxResults: 1, minScore: 0.9 })

    const limited = await call('memory_search', { query: 'banana smoothie breakfast' })
    expect(text(limited).split('\n\n')).toHaveLength(1)

    const filtered = await call('memory_search', { query: 'banana' })
    expect(text(filtered)).toBe('No matching memories found.')
  })

  it('treats a missing first-run memory root as an empty index', async () => {
    const freshRoot = join(dir, 'fresh-memory-root')
    await ctx.plugin(Memory, { root: freshRoot })

    const empty = await call('memory_search', { query: 'anything' })
    expect(empty.isError).toBe(false)
    expect(text(empty)).toBe('No matching memories found.')

    const appended = await call(MEMORY_APPEND_TOOL, { path: 'memory/2026-08-14.md', content: 'created lazily' })
    expect(appended.isError).toBe(false)
  })

  it('fails loudly when no embeddings provider is loaded', async () => {
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem)
    await ctx.plugin(Memory, { root: dir })

    const result = await call('memory_search', { query: 'anything' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('@clawdsh/dsh-embeddings-ark')
  })

  it('re-indexes changed files and drops deleted ones', async () => {
    await writeMemoryFile('MEMORY.md', 'The user likes banana smoothies.\n')
    await writeMemoryFile('memory/2026-08-14.md', 'The user hates celery.\n')
    await ctx.plugin(Memory, { root: dir })

    await writeMemoryFile('MEMORY.md', 'The user moved to Shenzhen.\n')
    const changed = await call('memory_search', { query: 'Shenzhen', minScore: 0.01 })
    expect(text(changed)).toContain('Shenzhen')

    await ctx.fs.writeText(await ctx.fs.resolve(join(dir, 'memory', '2026-08-14.md')), '')
    const deleted = await call('memory_search', { query: 'celery', minScore: 0.01 })
    expect(text(deleted)).not.toContain('celery')
  })

  it('never indexes non-whitelisted files', async () => {
    await writeMemoryFile('notes.txt', 'This is not a memory file.\n')
    await writeMemoryFile('memory/notes.txt', 'Also not a memory file (wrong extension).\n')
    await ctx.plugin(Memory, { root: dir })

    const result = await call('memory_search', { query: 'not a memory file', minScore: 0.01 })
    expect(text(result)).toBe('No matching memories found.')
  })
})

describe('memory_get', () => {
  it('reads the requested lines from a memory file', async () => {
    await writeMemoryFile('MEMORY.md', 'one\ntwo\nthree\n')
    await ctx.plugin(Memory, { root: dir })

    const result = await call('memory_get', { path: 'MEMORY.md', from: 2, lines: 1 })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('# MEMORY.md (lines 2-2)')
    expect(text(result)).toContain('two')
  })

  it('rejects paths outside the whitelist or the root', async () => {
    await ctx.plugin(Memory, { root: dir })

    for (const path of ['../etc/passwd', '/etc/passwd', 'memory/../MEMORY.md', 'notes.txt']) {
      const result = await call('memory_get', { path })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('not a memory path')
    }
  })
})

describe('memory_append', () => {
  it('creates and appends line-terminated notes without replacing prior content', async () => {
    await ctx.plugin(Memory, { root: dir })

    const first = await call(MEMORY_APPEND_TOOL, { path: 'MEMORY.md', content: 'first fact' })
    const second = await call(MEMORY_APPEND_TOOL, { path: 'MEMORY.md', content: 'second fact\n' })

    expect(first.isError).toBe(false)
    expect(second.isError).toBe(false)
    expect(await ctx.fs.readText(await ctx.fs.resolve(join(dir, 'MEMORY.md'))))
      .toBe('first fact\nsecond fact\n')
  })

  it('rejects empty content and every path outside the memory allowlist', async () => {
    await ctx.plugin(Memory, { root: dir })

    const empty = await call(MEMORY_APPEND_TOOL, { path: 'MEMORY.md', content: '' })
    expect(empty.isError).toBe(true)
    expect(text(empty)).toContain('content must be a non-empty string')

    for (const path of ['../etc/passwd', '/etc/passwd', 'memory/../MEMORY.md', 'notes.txt', 'memory/deep/note.md']) {
      const result = await call(MEMORY_APPEND_TOOL, { path, content: 'blocked' })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('not a memory path')
    }
  })

  it('serializes concurrent appends so no note is lost', async () => {
    await ctx.plugin(Memory, { root: dir })
    const notes = Array.from({ length: 12 }, (_, index) => `note-${index}`)

    const results = await Promise.all(notes.map(content =>
      call(MEMORY_APPEND_TOOL, { path: 'memory/2026-08-14.md', content })))

    expect(results.every(result => !result.isError)).toBe(true)
    const stored = await ctx.fs.readText(await ctx.fs.resolve(join(dir, 'memory', '2026-08-14.md')))
    const storedNotes = stored.trimEnd().split('\n')
    expect(storedNotes).toHaveLength(notes.length)
    expect(storedNotes.toSorted()).toEqual(notes.toSorted())
  })

  it('makes appended content immediately available to semantic recall', async () => {
    await ctx.plugin(Memory, { root: dir })
    await call(MEMORY_APPEND_TOOL, {
      path: 'MEMORY.md',
      content: 'The user prefers cardamom tea in the morning.',
    })

    const recalled = await call('memory_search', { query: 'cardamom morning tea', minScore: 0.01 })
    expect(recalled.isError).toBe(false)
    expect(text(recalled)).toContain('cardamom tea')
  })

  it('writes outside the session cwd through only the memory-root policy', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'dsh-memory-workspace-'))
    try {
      const fs = await sandboxHarness('workspace-write', workspace)
      const agent = fakeAgent(workspace)

      const result = await call(MEMORY_APPEND_TOOL, {
        path: 'memory/2026-08-14.md',
        content: 'stored outside the session workspace',
      }, agent)

      expect(result.isError).toBe(false)
      expect(await ctx.fs.readText(await ctx.fs.resolve(join(dir, 'memory', '2026-08-14.md'))))
        .toBe('stored outside the session workspace\n')
      const canonicalMemoryRoot = ctx.fs.processPath(await ctx.fs.resolve(dir))
      expect(fs.stamped.at(-1)).toMatchObject({ mode: 'workspace-write', workspaceRoot: canonicalMemoryRoot })

      const ordinaryPolicy = (ctx.get('sandboxPolicy') as StubSandboxPolicy).resolve({ session: agent.session })
      await expect(ctx.fs.writeText(
        await ctx.fs.resolve(join(dir, 'ordinary-write.md')),
        'denied',
        undefined,
        undefined,
        ordinaryPolicy,
      )).rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' })
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('preserves read-only mode and refuses to mutate the memory root', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'dsh-memory-readonly-'))
    try {
      await sandboxHarness('read-only', workspace)

      const result = await call(MEMORY_APPEND_TOOL, {
        path: 'MEMORY.md',
        content: 'must not land',
      }, fakeAgent(workspace))

      expect(result.isError).toBe(true)
      expect(result.error).toMatchObject({ info: { code: 'FS_SANDBOX_DENIED' } })
      expect(await ctx.fs.stat(await ctx.fs.resolve(join(dir, 'MEMORY.md')))).toBeUndefined()
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('fails load when a confining filesystem has no shared policy resolver', async () => {
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(ConfiningFileSystem, { cwd: dir })
    await ctx.plugin(StubEmbeddings)

    await expect(ctx.plugin(Memory, { root: dir }))
      .rejects.toThrow('mounted filesystem confines but ctx.sandboxPolicy is missing')
  })
})

describe('the recall section', () => {
  it('lands in the tool-guidance band with the stable guidance text', async () => {
    // Assembled sections carry name/text only, so pin the band positionally
    // with marker sections at the band edges.
    ctx.systemPrompt.section({ name: 'band:before', order: 100, text: 'before' })
    ctx.systemPrompt.section({ name: 'band:after', order: 200, text: 'after' })
    await ctx.plugin(Memory, { root: dir })
    const assembly = await ctx.systemPrompt.assemble()
    const section = assembly.sections.find(item => item.name === MEMORY_RECALL_SECTION)
    expect(section).toBeDefined()
    expect(section?.text).toBe(RECALL_TEXT)
    const index = section === undefined ? -1 : assembly.sections.indexOf(section)
    expect(index).toBeGreaterThan(assembly.sections.findIndex(item => item.name === 'band:before'))
    expect(index).toBeLessThan(assembly.sections.findIndex(item => item.name === 'band:after'))
  })
})

describe('disposal', () => {
  it('rolls back the section and all three tools', async () => {
    const fiber = await ctx.plugin(Memory, { root: dir })
    await fiber.dispose()

    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.find(item => item.name === MEMORY_RECALL_SECTION)).toBeUndefined()

    const result = await call('memory_search', { query: 'anything' })
    expect(result.isError).toBe(true)
    const append = await call(MEMORY_APPEND_TOOL, { path: 'MEMORY.md', content: 'anything' })
    expect(append.isError).toBe(true)
  })
})

describe('config validation', () => {
  it('rejects a non-positive watch stability threshold', async () => {
    await expect(ctx.plugin(Memory, { root: dir, watchStabilityThresholdMs: 0 })).rejects.toThrow()
  })

  it('rejects a non-boolean watch flag', async () => {
    await expect(ctx.plugin(Memory, { root: dir, watch: 'yes' as unknown as boolean })).rejects.toThrow()
  })
})

describe('MemoryIndex.invalidateFile', () => {
  it('re-reads only the invalidated file and preserves other cached embeddings', async () => {
    await writeMemoryFile('MEMORY.md', 'The user likes banana smoothies.\n')
    await writeMemoryFile('memory/2026-08-14.md', 'The user hates celery.\n')

    // Observe the embed batches on the registered stub backend.
    const embeddings = ctx.get('embeddings')
    if (embeddings === undefined) throw new Error('expected embeddings')
    const batches: string[][] = []
    const realEmbed = embeddings.embed.bind(embeddings)
    vi.spyOn(embeddings, 'embed').mockImplementation((texts, signal) => {
      batches.push([...texts])
      return realEmbed(texts, signal)
    })
    const index = new MemoryIndex(ctx.fs, await ctx.fs.resolve(dir), 1600, 160)

    // First search embeds the query plus both chunks in one batch.
    await index.search('banana', embeddings, 6, 0.01, 700)
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(3)

    // Invalidate MEMORY.md after an edit; celery's chunk keeps its cached vector.
    await writeMemoryFile('MEMORY.md', 'The user moved to Shenzhen city.\n')
    index.invalidateFile('MEMORY.md')
    batches.length = 0

    const hits = await index.search('Shenzhen', embeddings, 6, 0.01, 700)
    // Only the query plus the one re-read chunk re-embed, not celery's cached chunk.
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(2)
    expect(hits.map(hit => hit.path)).toContain('MEMORY.md')
    expect(hits.some(hit => hit.snippet.includes('Shenzhen'))).toBe(true)
  })

  it('keeps an invalidation that arrives during an in-flight file read', async () => {
    const before = 'old-memory-token\n'
    const after = 'new-memory-token\n'
    expect(after).toHaveLength(before.length)
    await writeMemoryFile('MEMORY.md', before)

    const root = await ctx.fs.resolve(dir)
    const realListDir = ctx.fs.listDir.bind(ctx.fs)
    const initial = await realListDir(root)
    const stableVersion = initial.find(entry => entry.name === 'MEMORY.md')?.version
    if (stableVersion === undefined) throw new Error('expected a stable local-fs version')
    vi.spyOn(ctx.fs, 'listDir').mockImplementation(async (target, signal) => {
      const entries = await realListDir(target, signal)
      return entries.map(entry => entry.name === 'MEMORY.md'
        ? { ...entry, version: stableVersion }
        : entry)
    })

    const embeddings = ctx.get('embeddings')
    if (embeddings === undefined) throw new Error('expected embeddings')
    const index = new MemoryIndex(ctx.fs, root, 1600, 160)
    await index.search('old-memory-token', embeddings, 6, 0.01, 700)

    const realReadText = ctx.fs.readText.bind(ctx.fs)
    let releaseRead: (() => void) | undefined
    let markReadStarted: (() => void) | undefined
    const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve })
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve })
    let pauseNextMemoryRead = true
    vi.spyOn(ctx.fs, 'readText').mockImplementation(async (target, signal) => {
      const value = await realReadText(target, signal)
      if (pauseNextMemoryRead && target.displayPath.endsWith('/MEMORY.md')) {
        pauseNextMemoryRead = false
        markReadStarted?.()
        await readGate
      }
      return value
    })

    // Force a read of the old contents, then deliver the watch invalidation
    // while that read is paused. A direct Map.delete here can be overwritten
    // when the old read resumes; serialization on the sync chain cannot.
    index.invalidateFile('MEMORY.md')
    const racingSearch = index.search('old-memory-token', embeddings, 6, 0.01, 700)
    await readStarted
    await writeMemoryFile('MEMORY.md', after)
    index.invalidateFile('MEMORY.md')
    releaseRead?.()
    await racingSearch

    const fresh = await index.search('new-memory-token', embeddings, 6, 0.01, 700)
    expect(fresh.some(hit => hit.snippet.includes('new-memory-token'))).toBe(true)
    expect(fresh.some(hit => hit.snippet.includes('old-memory-token'))).toBe(false)
  })
})
