/**
 * Contract tests for the memory row, keyless: the real fs local backend over a temp root,
 * the real SystemPrompt and ToolRuntime, and a deterministic stub embedding backend
 * (one unique dimension per token, so cosine similarity is exactly shared-token
 * overlap — no hash collisions, no API key). Memory writes and recall go
 * through `ctx.tools.execute`. Pinned: chunking, guarded root-owned appends,
 * ranked recall with source lines,
 * result bounds, fail-loud without an embeddings provider, incremental rebuild,
 * deletion, path whitelist/containment, the guidance section, and disposal.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { Embeddings } from '@clawdsh/dsh-embeddings'
import type { EmbeddingVector } from '@clawdsh/dsh-embeddings'
import * as Memory from '@clawdsh/dsh-memory'
import { MEMORY_RECALL_SECTION, RECALL_TEXT } from '@clawdsh/dsh-memory'
import { chunkMarkdown } from '../src/chunk.ts'
import { readLineSlice } from '../src/memory-files.ts'
import { MemoryIndex } from '../src/search.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class TestSettings extends SettingsProvider {
  constructor(ctx: Context, private readonly store: Record<string, unknown>) { super(ctx) }
  get writable(): boolean { return true }
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve(structuredClone(this.store)) }
  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.store[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

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
function call(name: string, args: unknown) {
  return ctx.tools.execute({
    signal: testSignal,
    callId: CallId(`memory-${++callCounter}`),
    name,
    arguments: args,
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

interface PromptActivityInput {
  readonly sessionId: string
  readonly producer: 'memory'
  readonly section: 'clawdsh:memory-recall'
  readonly mode: 'append'
  readonly characters: number
  readonly sha256: string
  readonly seq: number
}

function installActivity(write: (input: PromptActivityInput) => Promise<unknown>): void {
  ctx.provide('clawdshActivity', { promptContribution: write } as never)
}

function emitRequestHeader(scope: object, sessionId: string, system: string, seq: number): void {
  const session = { id: sessionId }
  const event = { type: 'request/header', seq, data: { header: { system }, reason: 'initial' } }
  const emit = ctx.emit.bind(ctx) as unknown as (
    target: object,
    name: 'session/event',
    subject: typeof session,
    entry: typeof event,
  ) => void
  emit(scopeTarget(session, scope), 'session/event', session, event)
}

async function writeMemoryFile(rel: string, content: string): Promise<void> {
  await ctx.fs.writeText(await ctx.fs.resolve(join(dir, rel)), content)
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-memory-'))
  mkdirSync(join(dir, 'memory'))
  ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalFileSystem)
  await ctx.plugin(TestSettings, {})
  await ctx.plugin(StubEmbeddings)
})

afterEach(async () => {
  // The memory row now watches the root by default; dispose the fiber so the
  // persistent Chokidar watcher closes before the temp root is removed.
  await ctx.fiber.dispose()
  rmSync(dir, { recursive: true, force: true })
})

describe('chunkMarkdown', () => {
  it('declares Settings as a required plugin dependency', () => {
    expect(Memory.inject).toEqual(['tools', 'systemPrompt', 'fs', 'settings'])
  })

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

describe('memory settings lifecycle', () => {
  it('uses the startup settings snapshot and registers nothing while disabled', async () => {
    await ctx.fiber.dispose()
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem)
    await ctx.plugin(TestSettings, { 'clawdsh-memory': { enabled: false } })
    await ctx.plugin(Memory, { root: dir, enabled: true })

    expect(ctx.tools.get('memory_search')).toBeUndefined()
    expect(ctx.tools.get('memory_get')).toBeUndefined()
    expect(ctx.tools.get('memory_write')).toBeUndefined()
    expect(ctx.tools.get('memory_update')).toBeUndefined()
    expect((await ctx.systemPrompt.assemble()).sections.find(section => section.name === MEMORY_RECALL_SECTION)).toBeUndefined()
    const descriptor = ctx.settings.describe().find(entry => entry.ns === Memory.MEMORY_SETTINGS_NAMESPACE)
    expect(descriptor).toMatchObject({ applies: 'restart', value: { enabled: false, root: dir } })

    await ctx.settings.update(Memory.MEMORY_SETTINGS_NAMESPACE, { enabled: true })
    expect(ctx.tools.get('memory_search')).toBeUndefined()
    expect((await ctx.systemPrompt.assemble()).sections.find(section => section.name === MEMORY_RECALL_SECTION)).toBeUndefined()
  })
})

describe('memory prompt Activity', () => {
  it('records the recall section only after the rendered header is committed', async () => {
    const records: PromptActivityInput[] = []
    installActivity(async (input) => { records.push(input) })
    await ctx.plugin(Memory, { root: dir })
    const agent = { id: 'memory-activity-session' } as unknown as Agent
    const assembly = await ctx.systemPrompt.assemble({
      scope: agent,
      signal: new AbortController().signal,
      agent,
    })
    emitRequestHeader(agent, String(agent.id), renderPrompt(assembly), 31)

    expect(records).toEqual([{
      sessionId: String(agent.id),
      producer: 'memory',
      section: 'clawdsh:memory-recall',
      mode: 'append',
      characters: RECALL_TEXT.length,
      sha256: createHash('sha256').update(RECALL_TEXT).digest('hex'),
      seq: 31,
    }])
    expect(JSON.stringify(records)).not.toContain(dir)
  })

  it('does not report a recall section suppressed by a complete prompt', async () => {
    const records: PromptActivityInput[] = []
    installActivity(async (input) => { records.push(input) })
    await ctx.plugin(Memory, { root: dir })
    ctx.systemPrompt.section({ name: 'test:complete', order: 1_000, text: 'complete override', complete: true })
    const agent = { id: 'memory-suppressed-session' } as unknown as Agent
    const assembly = await ctx.systemPrompt.assemble({
      scope: agent,
      signal: new AbortController().signal,
      agent,
    })
    expect(renderPrompt(assembly)).toBe('complete override')
    emitRequestHeader(agent, String(agent.id), renderPrompt(assembly), 33)

    expect(records).toEqual([])
  })

  it('contains a rejected Activity write without changing prompt assembly', async () => {
    const attempts: PromptActivityInput[] = []
    installActivity(async (input) => {
      attempts.push(input)
      throw new Error('activity-write-secret-canary')
    })
    await ctx.plugin(Memory, { root: dir })
    const agent = { id: 'memory-degraded-session' } as unknown as Agent
    const assembly = await ctx.systemPrompt.assemble({
      scope: agent,
      signal: new AbortController().signal,
      agent,
    })

    expect(() => { emitRequestHeader(agent, String(agent.id), renderPrompt(assembly), 35) }).not.toThrow()
    await Promise.resolve()
    expect(attempts).toHaveLength(1)
    expect(renderPrompt(assembly)).toContain(RECALL_TEXT)
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
  it('treats a missing root as an empty memory store', async () => {
    const missing = join(dir, 'not-created')
    await ctx.plugin(Memory, { root: missing })
    const embeddings = ctx.get('embeddings')
    if (embeddings === undefined) throw new Error('expected embeddings')
    const embed = vi.spyOn(embeddings, 'embed')

    const result = await call('memory_search', { query: 'who is the user' })

    expect(result.isError).toBe(false)
    expect(text(result)).toBe('No matching memories found.')
    expect(text(result)).not.toContain(missing)
    expect(existsSync(missing)).toBe(false)
    expect(embed).not.toHaveBeenCalled()
  })

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

  it('uses resolved config defaults while explicit search arguments still override them', async () => {
    const search = vi.spyOn(MemoryIndex.prototype, 'search').mockResolvedValue([])
    try {
      await ctx.plugin(Memory, { root: dir, maxResults: 1, minScore: 0.8 })

      await call('memory_search', { query: 'banana' })
      await call('memory_search', { query: 'banana', maxResults: 2, minScore: 0.5 })

      expect(search.mock.calls.map(searchCall => [searchCall[2], searchCall[3]])).toEqual([
        [1, 0.8],
        [2, 0.5],
      ])
    } finally {
      search.mockRestore()
    }
  })

  it('fails loudly when no embeddings provider is loaded', async () => {
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem)
    await ctx.plugin(TestSettings, {})
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

  it('does not follow root-file, daily-directory, or daily-file symbolic links', async () => {
    const root = join(dir, 'contained-root')
    const directoryLinkRoot = join(dir, 'directory-link-root')
    const outsideDirectory = join(dir, 'outside-daily')
    mkdirSync(join(root, 'memory'), { recursive: true })
    mkdirSync(directoryLinkRoot)
    mkdirSync(outsideDirectory)
    writeFileSync(join(dir, 'outside-root.md'), 'ROOT-SYMLINK-SECRET\n')
    writeFileSync(join(outsideDirectory, 'directory-secret.md'), 'DIRECTORY-SYMLINK-SECRET\n')
    writeFileSync(join(dir, 'outside-child.md'), 'CHILD-SYMLINK-SECRET\n')
    symlinkSync(join(dir, 'outside-root.md'), join(root, 'MEMORY.md'), 'file')
    symlinkSync(join(dir, 'outside-child.md'), join(root, 'memory', 'child.md'), 'file')
    symlinkSync(outsideDirectory, join(directoryLinkRoot, 'memory'), 'dir')
    const embeddings = ctx.get('embeddings')
    if (embeddings === undefined) throw new Error('expected embeddings')
    const containedIndex = new MemoryIndex(ctx.fs, await ctx.fs.resolve(root), 1600, 160)
    const directoryLinkIndex = new MemoryIndex(ctx.fs, await ctx.fs.resolve(directoryLinkRoot), 1600, 160)

    const hits = [
      ...await containedIndex.search('SYMLINK SECRET', embeddings, 6, 0.01, 700),
      ...await directoryLinkIndex.search('SYMLINK SECRET', embeddings, 6, 0.01, 700),
    ]

    expect(hits).toEqual([])
    expect(JSON.stringify(hits)).not.toMatch(/ROOT-SYMLINK|DIRECTORY-SYMLINK|CHILD-SYMLINK/)
  })
})

describe('memory_get', () => {
  it('returns an explicit empty state for a legal file that does not exist', async () => {
    const missing = join(dir, 'not-created')
    await ctx.plugin(Memory, { root: missing })

    const result = await call('memory_get', { path: 'MEMORY.md' })

    expect(result.isError).toBe(false)
    expect(text(result)).toBe('No stored memory found for MEMORY.md.')
    expect(text(result)).not.toContain(missing)
  })

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
      expect(text(result)).not.toContain(path)
    }
  })
})

describe('memory root confinement', () => {
  it('rejects a configured symbolic-link root for search, reads, writes, and updates', async () => {
    const outside = join(dir, 'outside-store')
    const linkedRoot = join(dir, 'linked-store')
    mkdirSync(outside)
    writeFileSync(join(outside, 'MEMORY.md'), 'ROOT-LINK-SECRET\n')
    symlinkSync(outside, linkedRoot, 'dir')
    await ctx.plugin(Memory, { root: linkedRoot })

    const results = await Promise.all([
      call('memory_search', { query: 'ROOT-LINK-SECRET', minScore: 0.01 }),
      call('memory_get', { path: 'MEMORY.md' }),
      call('memory_write', { scope: 'durable', content: 'must not escape' }),
      call('memory_update', { oldContent: 'ROOT-LINK-SECRET', newContent: 'must not replace' }),
    ])

    expect(results.every(result => result.isError)).toBe(true)
    for (const result of results) {
      expect(text(result)).not.toContain('ROOT-LINK-SECRET')
      expect(text(result)).not.toContain(linkedRoot)
      expect(text(result)).not.toContain(outside)
    }
    expect(readFileSync(join(outside, 'MEMORY.md'), 'utf8')).toBe('ROOT-LINK-SECRET\n')
  })
})

describe('memory_write', () => {
  it('creates a missing root and writes the first durable fact without exposing its absolute path', async () => {
    const missing = join(dir, 'not-created')
    await ctx.plugin(Memory, { root: missing })
    const empty = await call('memory_search', { query: 'Zijie' })
    const writeSpy = vi.spyOn(ctx.fs, 'writeText')

    const result = await call('memory_write', { scope: 'durable', content: 'The user is Zijie.' })
    const recalled = await call('memory_search', { query: 'Zijie', minScore: 0.01 })

    expect(text(empty)).toBe('No matching memories found.')
    expect(result.isError).toBe(false)
    expect(text(result)).toBe('Stored durable memory.')
    expect(text(result)).not.toContain(missing)
    expect(writeSpy.mock.calls[0]?.[4]).toEqual({ mode: 'workspace-write', workspaceRoot: missing })
    expect(readFileSync(join(missing, 'MEMORY.md'), 'utf8')).toBe('The user is Zijie.\n')
    expect(text(recalled)).toContain('The user is Zijie.')
  })

  it('appends durable facts and daily notes without replacing existing content', async () => {
    await ctx.plugin(Memory, { root: dir })
    await call('memory_write', { scope: 'durable', content: 'The user is Zijie.' })
    await call('memory_write', { scope: 'durable', content: 'The user researches embodied intelligence.' })
    const daily = await call('memory_write', { scope: 'daily', content: 'Discussed recent foundation-model papers.' })

    expect(readFileSync(join(dir, 'MEMORY.md'), 'utf8')).toBe(
      'The user is Zijie.\nThe user researches embodied intelligence.\n',
    )
    const files = readdirSync(join(dir, 'memory')).filter(file => /^\d{4}-\d{2}-\d{2}\.md$/.test(file))
    expect(files).toHaveLength(1)
    expect(readFileSync(join(dir, 'memory', files[0]!), 'utf8')).toBe('Discussed recent foundation-model papers.\n')
    expect(text(daily)).toBe('Stored daily memory.')
    expect(text(daily)).not.toContain(dir)
  })

  it('preserves every process-concurrent append while retaining external version guards', async () => {
    const missing = join(dir, 'concurrent')
    await ctx.plugin(Memory, { root: missing })
    const facts = Array.from({ length: 12 }, (_, index) => `fact ${index}`)

    const results = await Promise.all(facts.map(content => (
      call('memory_write', { scope: 'durable', content })
    )))

    expect(results.every(result => !result.isError)).toBe(true)
    const stored = readFileSync(join(missing, 'MEMORY.md'), 'utf8')
    for (const fact of facts) {
      expect(stored.split('\n').filter(line => line === fact)).toHaveLength(1)
    }
  })

  it('deduplicates durable facts across sequential and concurrent retries but always appends daily notes', async () => {
    await ctx.plugin(Memory, { root: dir })
    const first = await call('memory_write', { scope: 'durable', content: 'The user is Zijie.' })
    const retries = await Promise.all(Array.from({ length: 4 }, () => (
      call('memory_write', { scope: 'durable', content: 'The user is Zijie.' })
    )))
    await call('memory_write', { scope: 'daily', content: 'Repeated observation.' })
    await call('memory_write', { scope: 'daily', content: 'Repeated observation.' })

    expect(text(first)).toBe('Stored durable memory.')
    expect(retries.map(text)).toEqual(Array.from({ length: 4 }, () => 'Durable memory already stored.'))
    expect(readFileSync(join(dir, 'MEMORY.md'), 'utf8')).toBe('The user is Zijie.\n')
    const daily = readdirSync(join(dir, 'memory')).find(file => /^\d{4}-\d{2}-\d{2}\.md$/.test(file))
    if (daily === undefined) throw new Error('expected daily memory')
    expect(readFileSync(join(dir, 'memory', daily), 'utf8')).toBe('Repeated observation.\nRepeated observation.\n')
  })

  it('retries a stale guarded append without losing the concurrent writer', async () => {
    await ctx.plugin(Memory, { root: dir })
    await call('memory_write', { scope: 'durable', content: 'first fact' })
    const realWrite = ctx.fs.writeText.bind(ctx.fs)
    let injected = false
    vi.spyOn(ctx.fs, 'writeText').mockImplementation(async (target, content, expected, signal, sandboxPolicy) => {
      if (!injected && expected?.kind === 'replaceIfVersion') {
        injected = true
        await realWrite(target, 'first fact\nconcurrent fact\n', undefined, signal, sandboxPolicy)
      }
      return realWrite(target, content, expected, signal, sandboxPolicy)
    })

    const result = await call('memory_write', { scope: 'durable', content: 'second fact' })

    expect(result.isError).toBe(false)
    expect(injected).toBe(true)
    expect(readFileSync(join(dir, 'MEMORY.md'), 'utf8')).toBe('first fact\nconcurrent fact\nsecond fact\n')
  })

  it('exposes no path argument and rejects invalid scopes before any write', async () => {
    await ctx.plugin(Memory, { root: dir })
    const definition = ctx.tools.get('memory_write')
    const parameters = definition?.parameters as { properties?: Record<string, unknown> } | undefined
    expect(Object.keys(parameters?.properties ?? {})).toEqual(['scope', 'content'])

    const result = await call('memory_write', { scope: '../outside', content: 'escape attempt' })

    expect(result.isError).toBe(true)
    expect(existsSync(join(dir, 'outside'))).toBe(false)
    expect(text(result)).not.toContain(dir)
  })

  it('enforces the configured per-entry character limit at the exact boundary', async () => {
    await ctx.plugin(Memory, { root: dir, maxWriteChars: 4 })
    const exact = await call('memory_write', { scope: 'durable', content: '四个字符' })
    const oversized = await call('memory_write', { scope: 'durable', content: '12345' })

    expect(exact.isError).toBe(false)
    expect(oversized.isError).toBe(true)
    expect(text(oversized)).toContain('4-character limit')
    expect(readFileSync(join(dir, 'MEMORY.md'), 'utf8')).toBe('四个字符\n')
  })

  it('rejects multiline durable facts while allowing multiline daily notes', async () => {
    await ctx.plugin(Memory, { root: dir })

    const durable = await call('memory_write', { scope: 'durable', content: 'line one\nline two' })
    const daily = await call('memory_write', { scope: 'daily', content: 'line one\nline two' })

    expect(durable.isError).toBe(true)
    expect(text(durable)).toContain('must be one line')
    expect(daily.isError).toBe(false)
  })
})

describe('memory_update', () => {
  it('replaces and forgets an exact durable fact without retaining the old value', async () => {
    await ctx.plugin(Memory, { root: dir })
    await call('memory_write', { scope: 'durable', content: 'The user is Alice.' })

    const replaced = await call('memory_update', {
      oldContent: 'The user is Alice.',
      newContent: 'The user is Bob.',
    })
    const forgotten = await call('memory_update', {
      oldContent: 'The user is Bob.',
      newContent: '',
    })

    expect(text(replaced)).toBe('Updated durable memory.')
    expect(text(forgotten)).toBe('Forgot durable memory.')
    expect(readFileSync(join(dir, 'MEMORY.md'), 'utf8')).toBe('')
  })

  it('removes duplicate old entries and avoids duplicating an existing replacement', async () => {
    writeFileSync(join(dir, 'MEMORY.md'), 'old fact\nold fact\nnew fact\n')
    await ctx.plugin(Memory, { root: dir })

    const result = await call('memory_update', { oldContent: 'old fact', newContent: 'new fact' })

    expect(text(result)).toBe('Updated durable memory.')
    expect(readFileSync(join(dir, 'MEMORY.md'), 'utf8')).toBe('new fact\n')
  })

  it('returns recoverable no-match and already-current states without rewriting', async () => {
    writeFileSync(join(dir, 'MEMORY.md'), 'current fact\n')
    await ctx.plugin(Memory, { root: dir })
    const write = vi.spyOn(ctx.fs, 'writeText')

    const missing = await call('memory_update', { oldContent: 'missing fact', newContent: 'replacement' })
    const current = await call('memory_update', { oldContent: 'current fact', newContent: 'current fact' })

    expect(text(missing)).toContain('No exact durable memory entry matched')
    expect(text(current)).toBe('Durable memory is already current.')
    expect(write).not.toHaveBeenCalled()
  })

  it('serializes a correction with a concurrent append and retries an external stale version', async () => {
    writeFileSync(join(dir, 'MEMORY.md'), 'old identity\n')
    await ctx.plugin(Memory, { root: dir })
    const realWrite = ctx.fs.writeText.bind(ctx.fs)
    let injected = false
    vi.spyOn(ctx.fs, 'writeText').mockImplementation(async (target, content, expected, signal, sandboxPolicy) => {
      if (!injected && content.includes('new identity') && expected?.kind === 'replaceIfVersion') {
        injected = true
        const current = await ctx.fs.readText(target, signal)
        await realWrite(target, `${current}external fact\n`, undefined, signal, sandboxPolicy)
      }
      return realWrite(target, content, expected, signal, sandboxPolicy)
    })

    const [updated, appended] = await Promise.all([
      call('memory_update', { oldContent: 'old identity', newContent: 'new identity' }),
      call('memory_write', { scope: 'durable', content: 'concurrent fact' }),
    ])

    expect(updated.isError).toBe(false)
    expect(appended.isError).toBe(false)
    expect(injected).toBe(true)
    const stored = readFileSync(join(dir, 'MEMORY.md'), 'utf8').split('\n').filter(Boolean)
    expect(stored).toHaveLength(3)
    expect(new Set(stored)).toEqual(new Set(['new identity', 'external fact', 'concurrent fact']))
  })

  it('exposes no path argument and keeps invalid content and storage paths out of results', async () => {
    await ctx.plugin(Memory, { root: dir, maxWriteChars: 8 })
    const definition = ctx.tools.get('memory_update')
    const parameters = definition?.parameters as { properties?: Record<string, unknown> } | undefined
    expect(Object.keys(parameters?.properties ?? {})).toEqual(['oldContent', 'newContent'])

    const multiline = await call('memory_update', { oldContent: 'old\nline', newContent: 'new' })
    const oversized = await call('memory_update', { oldContent: '123456789', newContent: '' })

    expect(multiline.isError).toBe(true)
    expect(oversized.isError).toBe(true)
    expect(text(multiline)).not.toContain(dir)
    expect(text(oversized)).not.toContain(dir)
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
    expect(section?.text).toBe(
      'Use memory_search to recall facts about people, preferences, decisions, and prior work before answering questions about them; '
      + 'follow a strong hit with memory_get to read the needed lines. If semantic search is unavailable, read MEMORY.md directly with '
      + 'memory_get instead of giving up. Proactively call memory_write when the user states '
      + 'a stable identity, preference, decision, relationship, or long-lived project: use scope durable for lasting facts and scope daily '
      + 'for running notes. For a correction or forget request, read MEMORY.md first, then call memory_update with the exact old line; never '
      + 'append a contradiction. Never store credentials, authentication secrets, transient details, or anything the user asks you not to '
      + 'retain. Read and write personal memory only through memory_search, memory_get, memory_write, and memory_update; never use general '
      + 'filesystem tools for the memory store.',
    )
    const index = section === undefined ? -1 : assembly.sections.indexOf(section)
    expect(index).toBeGreaterThan(assembly.sections.findIndex(item => item.name === 'band:before'))
    expect(index).toBeLessThan(assembly.sections.findIndex(item => item.name === 'band:after'))
  })
})

describe('disposal', () => {
  it('rolls back the section and all four tools', async () => {
    const fiber = await ctx.plugin(Memory, { root: dir })
    await fiber.dispose()

    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.find(item => item.name === MEMORY_RECALL_SECTION)).toBeUndefined()

    const result = await call('memory_search', { query: 'anything' })
    expect(result.isError).toBe(true)
    expect(ctx.tools.get('memory_search')).toBeUndefined()
    expect(ctx.tools.get('memory_get')).toBeUndefined()
    expect(ctx.tools.get('memory_write')).toBeUndefined()
    expect(ctx.tools.get('memory_update')).toBeUndefined()
  })
})

describe('config validation', () => {
  it('rejects a non-positive watch stability threshold', async () => {
    await expect(ctx.plugin(Memory, { root: dir, watchStabilityThresholdMs: 0 })).rejects.toThrow()
  })

  it('rejects a non-boolean watch flag', async () => {
    await expect(ctx.plugin(Memory, { root: dir, watch: 'yes' as unknown as boolean })).rejects.toThrow()
  })

  it('rejects a non-positive memory_write content limit', async () => {
    await expect(ctx.plugin(Memory, { root: dir, maxWriteChars: 0 })).rejects.toThrow()
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
})
