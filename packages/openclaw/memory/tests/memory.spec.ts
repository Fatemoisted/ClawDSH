/**
 * Contract tests for the memory row, keyless: the real fs local backend over a temp root,
 * the real SystemPrompt and ToolRuntime, and a deterministic stub embedding backend
 * (one unique dimension per token, so cosine similarity is exactly shared-token
 * overlap — no hash collisions, no API key). Memory files are written through
 * `ctx.fs.writeText`, simulating the model's fs-tool writes; recall goes through
 * `ctx.tools.execute`. Pinned: chunking, ranked recall with source lines,
 * result bounds, fail-loud without an embeddings provider, incremental rebuild,
 * deletion, path whitelist/containment, the guidance section, and disposal.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
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
  it('rolls back the section and both tools', async () => {
    const fiber = await ctx.plugin(Memory, { root: dir })
    await fiber.dispose()

    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.find(item => item.name === MEMORY_RECALL_SECTION)).toBeUndefined()

    const result = await call('memory_search', { query: 'anything' })
    expect(result.isError).toBe(true)
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
})
