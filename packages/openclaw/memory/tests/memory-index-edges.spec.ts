import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Memory from '../src/index.ts'

class TestSettings extends SettingsProvider {
  get writable(): boolean { return true }
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

const contexts: Context[] = []
const roots: string[] = []
const testSignal = new AbortController().signal

async function bareContext(): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalFileSystem)
  await ctx.plugin(TestSettings)
  return ctx
}

async function setup(
  config: Partial<Memory.Config> = {},
  options: {
    readonly embeddings?: { embed(texts: readonly string[]): Promise<number[][]> }
    readonly missingRoot?: boolean
  } = {},
): Promise<{ ctx: Context; root: string }> {
  const base = mkdtempSync(join(tmpdir(), 'dsh-memory-index-edge-'))
  roots.push(base)
  const root = options.missingRoot === true ? join(base, 'memory-root') : base
  const ctx = await bareContext()
  ctx.provide('embeddings', options.embeddings ?? {
    embed: async (texts: readonly string[]) => texts.map(() => [1]),
  } as never)
  await ctx.plugin(Memory, { root, watch: false, flush: { enabled: false }, ...config })
  return { ctx, root }
}

async function rawExecute(ctx: Context, name: string, args: unknown, signal: AbortSignal = testSignal): Promise<unknown> {
  const definition = ctx.tools.get(name)
  if (definition === undefined) throw new Error(`missing tool: ${name}`)
  return await definition.execute(args, { signal } as never)
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('memory tool argument semantics', () => {
  it('rejects blank write and update content after schema validation', async () => {
    const { ctx } = await setup({ maxWriteChars: 4 })

    await expect(rawExecute(ctx, 'memory_write', { scope: 'durable', content: '   ' }))
      .rejects.toThrow(/non-empty/)
    await expect(rawExecute(ctx, 'memory_update', { oldContent: ' ', newContent: 'new' }))
      .rejects.toThrow(/non-empty/)
  })

  it('rejects empty search/get strings and values beyond tool-specific numeric bounds', async () => {
    const { ctx } = await setup()

    await expect(rawExecute(ctx, 'memory_search', { query: '' })).rejects.toThrow(/query/)
    await expect(rawExecute(ctx, 'memory_get', { path: '' })).rejects.toThrow(/path/)
    for (const value of [0, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(rawExecute(ctx, 'memory_search', { query: 'q', maxResults: value })).rejects.toThrow(/maxResults/)
      await expect(rawExecute(ctx, 'memory_get', { path: 'MEMORY.md', from: value })).rejects.toThrow(/from/)
    }
    for (const value of [-2, 2]) {
      await expect(rawExecute(ctx, 'memory_search', { query: 'q', minScore: value })).rejects.toThrow(/minScore/)
    }
  })
})

describe('memory storage failures and file-format boundaries', () => {
  it('sanitizes search and get storage failures while preserving ordinary search errors', async () => {
    const { ctx } = await setup()
    vi.spyOn(ctx.fs, 'lstat').mockRejectedValueOnce(new FsError('private path', 'FS_PERMISSION_DENIED'))
    await expect(rawExecute(ctx, 'memory_search', { query: 'q' })).rejects.toMatchObject({ code: 'FS_PERMISSION_DENIED' })

    const failedEmbedding = await setup({}, {
      embeddings: { embed: async () => { throw new Error('embedding backend failed') } },
    })
    writeFileSync(join(failedEmbedding.root, 'MEMORY.md'), 'fact\n')
    await expect(rawExecute(failedEmbedding.ctx, 'memory_search', { query: 'q' }))
      .rejects.toThrow(/embedding backend failed/)
  })

  it('wraps filesystem and non-filesystem read failures without exposing their messages', async () => {
    const { ctx, root } = await setup()
    writeFileSync(join(root, 'MEMORY.md'), 'fact\n')
    vi.spyOn(ctx.fs, 'readText').mockRejectedValueOnce(new FsError('private path', 'FS_PERMISSION_DENIED'))
    await expect(rawExecute(ctx, 'memory_get', { path: 'MEMORY.md' })).rejects.toMatchObject({ code: 'FS_PERMISSION_DENIED' })

    vi.spyOn(ctx.fs, 'readText').mockRejectedValueOnce(new Error('private backend detail'))
    await expect(rawExecute(ctx, 'memory_get', { path: 'MEMORY.md' })).rejects.toThrow('memory_get: cannot read MEMORY.md')
  })

  it('rejects escaped targets, aborted mutations, and non-file targets', async () => {
    const escaped = await setup()
    vi.spyOn(escaped.ctx.fs, 'contains').mockReturnValue(false)
    await expect(rawExecute(escaped.ctx, 'memory_write', { scope: 'durable', content: 'fact' }))
      .rejects.toThrow(/storage operation failed/)
    await expect(rawExecute(escaped.ctx, 'memory_update', { oldContent: 'old', newContent: 'new' }))
      .rejects.toThrow(/storage operation failed/)

    const aborted = await setup()
    const controller = new AbortController()
    controller.abort()
    await expect(rawExecute(aborted.ctx, 'memory_write', { scope: 'durable', content: 'fact' }, controller.signal))
      .rejects.toMatchObject({ code: 'FS_ABORTED' })
    await expect(rawExecute(aborted.ctx, 'memory_update', { oldContent: 'old', newContent: 'new' }, controller.signal))
      .rejects.toMatchObject({ code: 'FS_ABORTED' })

    const nonFileWrite = await setup()
    mkdirSync(join(nonFileWrite.root, 'MEMORY.md'))
    await expect(rawExecute(nonFileWrite.ctx, 'memory_write', { scope: 'durable', content: 'fact' }))
      .rejects.toMatchObject({ code: 'FS_NOT_REGULAR_FILE' })
    await expect(rawExecute(nonFileWrite.ctx, 'memory_update', { oldContent: 'old', newContent: 'new' }))
      .rejects.toMatchObject({ code: 'FS_NOT_REGULAR_FILE' })

    const missing = await setup()
    expect(await rawExecute(missing.ctx, 'memory_update', { oldContent: 'old', newContent: 'new' }))
      .toContain('No exact durable memory entry matched')
  })

  it('observes cancellation after target resolution but before either mutation enters storage', async () => {
    const write = await setup()
    const writeController = new AbortController()
    const writeContains = write.ctx.fs.contains.bind(write.ctx.fs)
    vi.spyOn(write.ctx.fs, 'contains').mockImplementation((root, target) => {
      const contained = writeContains(root, target)
      writeController.abort()
      return contained
    })
    await expect(rawExecute(
      write.ctx,
      'memory_write',
      { scope: 'durable', content: 'fact' },
      writeController.signal,
    )).rejects.toMatchObject({ code: 'FS_ABORTED' })

    const update = await setup()
    writeFileSync(join(update.root, 'MEMORY.md'), 'old\n')
    const updateController = new AbortController()
    const updateContains = update.ctx.fs.contains.bind(update.ctx.fs)
    vi.spyOn(update.ctx.fs, 'contains').mockImplementation((root, target) => {
      const contained = updateContains(root, target)
      updateController.abort()
      return contained
    })
    await expect(rawExecute(
      update.ctx,
      'memory_update',
      { oldContent: 'old', newContent: 'new' },
      updateController.signal,
    )).rejects.toMatchObject({ code: 'FS_ABORTED' })
  })

  it('retries an unobserved append and propagates non-retryable mutation failures', async () => {
    const retry = await setup()
    const realWrite = retry.ctx.fs.writeText.bind(retry.ctx.fs)
    const write = vi.spyOn(retry.ctx.fs, 'writeText')
    write.mockRejectedValueOnce(new FsError('race', 'FS_NOT_OBSERVED')).mockImplementation(realWrite)
    await expect(rawExecute(retry.ctx, 'memory_write', { scope: 'durable', content: 'fact' }))
      .resolves.toBe('Stored durable memory.')

    const fsFailure = await setup()
    vi.spyOn(fsFailure.ctx.fs, 'writeText').mockRejectedValueOnce(new FsError('denied', 'FS_PERMISSION_DENIED'))
    await expect(rawExecute(fsFailure.ctx, 'memory_write', { scope: 'durable', content: 'fact' }))
      .rejects.toMatchObject({ code: 'FS_PERMISSION_DENIED' })

    const ordinaryFailure = await setup()
    vi.spyOn(ordinaryFailure.ctx.fs, 'writeText').mockRejectedValueOnce(new Error('backend detail'))
    await expect(rawExecute(ordinaryFailure.ctx, 'memory_write', { scope: 'durable', content: 'fact' }))
      .rejects.toThrow('memory_write: storage operation failed')

    const updateFailure = await setup()
    writeFileSync(join(updateFailure.root, 'MEMORY.md'), 'old\n')
    vi.spyOn(updateFailure.ctx.fs, 'writeText').mockRejectedValueOnce(new FsError('denied', 'FS_PERMISSION_DENIED'))
    await expect(rawExecute(updateFailure.ctx, 'memory_update', { oldContent: 'old', newContent: 'new' }))
      .rejects.toMatchObject({ code: 'FS_PERMISSION_DENIED' })
  })

  it('preserves CRLF and missing trailing-newline styles across updates', async () => {
    const crlf = await setup()
    writeFileSync(join(crlf.root, 'MEMORY.md'), 'first\r\nold\r\nlast\r\n')
    await rawExecute(crlf.ctx, 'memory_update', { oldContent: 'old', newContent: 'new' })
    expect(await crlf.ctx.fs.readText(await crlf.ctx.fs.resolve(join(crlf.root, 'MEMORY.md')))).toBe('first\r\nnew\r\nlast\r\n')

    const noTrailing = await setup()
    writeFileSync(join(noTrailing.root, 'MEMORY.md'), 'old\nlast')
    await rawExecute(noTrailing.ctx, 'memory_update', { oldContent: 'old', newContent: '' })
    expect(await noTrailing.ctx.fs.readText(await noTrailing.ctx.fs.resolve(join(noTrailing.root, 'MEMORY.md')))).toBe('last')

    const append = await setup()
    writeFileSync(join(append.root, 'MEMORY.md'), 'existing')
    await rawExecute(append.ctx, 'memory_write', { scope: 'durable', content: 'new\n' })
    expect(await append.ctx.fs.readText(await append.ctx.fs.resolve(join(append.root, 'MEMORY.md')))).toBe('existing\nnew\n')
  })

  it('keeps a missing root absent after a no-op update and delays watcher recovery', async () => {
    const missing = await setup({ watch: true }, { missingRoot: true })

    await expect(rawExecute(missing.ctx, 'memory_update', { oldContent: 'old', newContent: 'new' }))
      .resolves.toContain('No exact durable memory entry matched')
    expect(existsSync(missing.root)).toBe(false)
  })

  it('contains watcher recovery failure after a write creates the missing root', async () => {
    const watch = await import('../src/watch.ts')
    const recover = vi.fn(async () => { throw new Error('reopen failed') })
    const dispose = Object.assign(vi.fn(() => Promise.resolve()), { recover })
    vi.spyOn(watch, 'installMemoryWatch').mockResolvedValueOnce(dispose)
    const missing = await setup({ watch: true }, { missingRoot: true })
    const warn = vi.spyOn(missing.ctx.logger, 'warn').mockImplementation(() => {})

    await expect(rawExecute(missing.ctx, 'memory_write', { scope: 'durable', content: 'fact' }))
      .resolves.toBe('Stored durable memory.')
    expect(recover).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith('memory: failed to recover watcher after creating the memory root')
  })
})

describe('memory config validation', () => {
  it('rejects semantic and safe-integer violations admitted by the field schema', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-memory-config-edge-'))
    roots.push(root)
    const unsafe = Number.MAX_SAFE_INTEGER + 1
    const cases: Array<readonly [Partial<Memory.Config>, RegExp]> = [
      [{ root: '' }, /config root is required/],
      [{ chunkSizeChars: unsafe }, /chunkSizeChars.*safe integer/],
      [{ chunkSizeChars: 10, chunkOverlapChars: 10 }, /chunkOverlapChars.*smaller/],
      [{ maxResults: unsafe }, /maxResults.*safe integer/],
      [{ minScore: Number.NaN }, /minScore.*finite/],
      [{ snippetChars: unsafe }, /snippetChars.*safe integer/],
      [{ maxReadLines: unsafe }, /maxReadLines.*safe integer/],
      [{ maxWriteChars: unsafe }, /maxWriteChars.*safe integer/],
      [{ watchStabilityThresholdMs: unsafe }, /watchStabilityThresholdMs.*safe integer/],
      [{ watchPollIntervalMs: unsafe }, /watchPollIntervalMs.*safe integer/],
    ]

    for (const [config, error] of cases) {
      const ctx = await bareContext()
      await expect(ctx.plugin(Memory, {
        root,
        watch: false,
        flush: { enabled: false },
        ...config,
      })).rejects.toThrow(error)
    }
  })
})

describe('memory prompt and read presentation edges', () => {
  it('marks a capped read and contains stale or mismatched prompt candidates', async () => {
    const { ctx, root } = await setup({ maxReadLines: 1 })
    writeFileSync(join(root, 'MEMORY.md'), 'one\ntwo\n')
    expect(await rawExecute(ctx, 'memory_get', { path: 'MEMORY.md', lines: 2 }))
      .toContain('capped at 1')

    const records: unknown[] = []
    ctx.provide('clawdshActivity', { promptContribution: async (input: unknown) => { records.push(input) } } as never)
    const agent = { id: 'memory-edge-activity' }
    const emit = ctx.emit.bind(ctx) as unknown as (
      target: object,
      name: 'session/event',
      session: { id: string },
      event: { type: string; seq?: number; data?: unknown },
    ) => void
    emit(scopeTarget({ id: agent.id }, agent), 'session/event', { id: agent.id }, { type: 'turn/start' })

    let assembly = await ctx.systemPrompt.assemble({ scope: agent, signal: testSignal, agent } as never)
    emit(scopeTarget({ id: agent.id }, agent), 'session/event', { id: agent.id }, {
      type: 'request/header',
      seq: 1,
      data: { header: { system: 'mismatch' } },
    })
    expect(records).toEqual([])

    const disposeMalformed = ctx.systemPrompt.section({
      name: 'memory-edge-malformed-variable',
      order: 0,
      text: '{{missing}}',
    })
    await expect(ctx.systemPrompt.assemble({ scope: agent, signal: testSignal, agent } as never))
      .resolves.toBeDefined()
    disposeMalformed()

    ctx.on('system-prompt/assemble', async (nextAssembly, _context, next) => {
      const transformed = await next()
      const section = nextAssembly.sections.find(item => item.name === Memory.MEMORY_RECALL_SECTION)
      if (section !== undefined) section.text = 'changed downstream'
      return transformed
    })
    assembly = await ctx.systemPrompt.assemble({ scope: agent, signal: testSignal, agent } as never)
    emit(scopeTarget({ id: agent.id }, agent), 'session/event', { id: agent.id }, {
      type: 'request/header',
      seq: 2,
      data: { header: { system: renderPrompt(assembly) } },
    })
    expect(records).toEqual([])
  })

})
