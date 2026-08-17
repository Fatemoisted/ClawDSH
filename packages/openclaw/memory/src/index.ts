/**
 * ClawDSH memory row: OpenClaw-style long-term memory on dsh seams. The memory
 * files (`MEMORY.md` for durable facts, `memory/YYYY-MM-DD.md` for running
 * notes) are plain Markdown under a configured root and stay the source of
 * truth. `memory_write` appends to those two root-owned targets and
 * `memory_update` replaces or forgets one exact durable line, neither exposing
 * a model-controlled path; `memory_search` ranks chunks by embedding cosine
 * similarity and `memory_get` reads back lines. Nothing is auto-injected per
 * request, so every model-visible memory enters the transcript as a tool call
 * or result, satisfying "model-visible means logged" without a new session
 * event.
 *
 * @module @clawdsh/dsh-memory
 */

import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@clawdsh/dsh-embeddings'
import type {} from '@deepseek-ai/dsh-agent'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FileSystem, FsTarget, FsVersion } from '@deepseek-ai/dsh-fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { renderPrompt, type AssembleContext } from '@deepseek-ai/dsh-system-prompt'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { assertSafeMemoryRoot, readLineSlice, resolveMemoryTarget } from './memory-files.ts'
import { MemoryIndex } from './search.ts'
import type { SearchHit } from './search.ts'
import { MEMORY_RECALL_ORDER, MEMORY_RECALL_SECTION, RECALL_TEXT } from './recall-section.ts'
import { installMemoryFlush, resolveFlushConfig, FlushConfig } from './flush.ts'
import { installMemoryWatch, DEFAULT_WATCH_STABILITY_THRESHOLD_MS, DEFAULT_WATCH_POLL_INTERVAL_MS } from './watch.ts'
import type { MemoryWatchDisposer } from './watch.ts'

export { MEMORY_RECALL_ORDER, MEMORY_RECALL_SECTION, RECALL_TEXT } from './recall-section.ts'
export { FLUSH_PLUGIN_SOURCE, DEFAULT_FLUSH_PROMPT, DEFAULT_FLUSH_RESERVE_TOKENS_FLOOR, DEFAULT_FLUSH_SOFT_THRESHOLD_TOKENS } from './flush.ts'
export type { MemoryChunk } from './chunk.ts'
export { chunkMarkdown } from './chunk.ts'
export { cosineSimilarity } from './search.ts'
export type { SearchHit } from './search.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'memory'

/** User-settings namespace for the Memory capability. */
export const MEMORY_SETTINGS_NAMESPACE = settingsNamespace('clawdsh-memory')

/** Capability services the plugin mounts on; embeddings is read optionally via `ctx.get`. */
export const inject = ['tools', 'systemPrompt', 'fs', 'settings']

/** Default character budget per index chunk (mirrors OpenClaw's ~400-token chunks). */
export const DEFAULT_CHUNK_SIZE_CHARS = 1600
/** Default overlap carried from the previous chunk's tail, sentence-aligned. */
export const DEFAULT_CHUNK_OVERLAP_CHARS = 160
/** Default maximum hits returned by one memory_search call. */
export const DEFAULT_MAX_RESULTS = 6
/** Default minimum cosine similarity for a hit (OpenClaw's floor). */
export const DEFAULT_MIN_SCORE = 0.35
/** Default character cap per hit snippet. */
export const DEFAULT_SNIPPET_CHARS = 700
/** Default cooperative deadline for one search call. */
export const DEFAULT_TIMEOUT_MS = 30_000
/** Default maximum lines one memory_get call reads. */
export const DEFAULT_MAX_READ_LINES = 1000
/** Default maximum characters accepted by one memory_write call. */
export const DEFAULT_MAX_WRITE_CHARS = 4000

/** Plugin config; `root` is required — the memory directory a deployment owns. */
export interface Config {
  /** Whether Memory registers prompt guidance, tools, file watching, and flush hooks. */
  enabled?: boolean
  /** Memory root directory (absolute or resolved against `process.cwd()`). Required, fail-loud. */
  root: string
  /** Character budget per index chunk. Defaults to 1600. */
  chunkSizeChars?: number
  /** Sentence-aligned overlap from the previous chunk's tail. Defaults to 160. */
  chunkOverlapChars?: number
  /** Maximum hits returned by one memory_search call. Defaults to 6. */
  maxResults?: number
  /** Minimum cosine similarity for a hit. Defaults to 0.35. */
  minScore?: number
  /** Character cap per hit snippet. Defaults to 700. */
  snippetChars?: number
  /** Cooperative search deadline in milliseconds. Defaults to 30000. */
  timeoutMs?: number
  /** Maximum lines one memory_get call reads. Defaults to 1000. */
  maxReadLines?: number
  /** Maximum characters one memory_write call appends. Defaults to 4000. */
  maxWriteChars?: number
  /** Whether host changes to memory files are watched for proactive invalidation. Defaults to true. */
  watch?: boolean
  /** Milliseconds a changed memory file must remain stable before it is observed. Defaults to 200. */
  watchStabilityThresholdMs?: number
  /** Milliseconds between Chokidar stability probes. Defaults to 100. */
  watchPollIntervalMs?: number
  /** Pre-compaction memory flush turn; enabled by default, thresholds OpenClaw's 20000/4000. */
  flush?: FlushConfig
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  root: z.string(),
  chunkSizeChars: z.number().step(1).min(1).default(DEFAULT_CHUNK_SIZE_CHARS),
  chunkOverlapChars: z.number().step(1).min(0).default(DEFAULT_CHUNK_OVERLAP_CHARS),
  maxResults: z.number().step(1).min(1).default(DEFAULT_MAX_RESULTS),
  minScore: z.number().min(-1).max(1).default(DEFAULT_MIN_SCORE),
  snippetChars: z.number().step(1).min(1).default(DEFAULT_SNIPPET_CHARS),
  timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_TIMEOUT_MS),
  maxReadLines: z.number().step(1).min(1).default(DEFAULT_MAX_READ_LINES),
  maxWriteChars: z.number().step(1).min(1).default(DEFAULT_MAX_WRITE_CHARS),
  watch: z.boolean().default(true),
  watchStabilityThresholdMs: z.number().step(1).min(1).default(DEFAULT_WATCH_STABILITY_THRESHOLD_MS),
  watchPollIntervalMs: z.number().step(1).min(1).default(DEFAULT_WATCH_POLL_INTERVAL_MS),
  flush: FlushConfig,
})

interface ResolvedConfig {
  readonly enabled: boolean
  readonly root: string
  readonly chunkSizeChars: number
  readonly chunkOverlapChars: number
  readonly maxResults: number
  readonly minScore: number
  readonly snippetChars: number
  readonly timeoutMs: number
  readonly maxReadLines: number
  readonly maxWriteChars: number
  readonly watch: boolean
  readonly watchStabilityThresholdMs: number
  readonly watchPollIntervalMs: number
  readonly flush: ReturnType<typeof resolveFlushConfig>
}

type NormalizedConfig = Required<Omit<Config, 'flush'>> & Pick<Config, 'flush'>

interface PromptActivitySink {
  promptContribution(input: {
    readonly sessionId: string
    readonly producer: 'memory'
    readonly section: 'clawdsh:memory-recall'
    readonly mode: 'append'
    readonly characters: number
    readonly sha256: string
    readonly seq: number
  }): Promise<unknown>
}

interface PromptCandidate {
  readonly system: string
  readonly contribution: string
}

const TEXT_OUTPUT = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
}

const MEMORY_SEARCH_PARAMETERS = {
  query: { type: 'string', required: true, description: 'Semantic query over MEMORY.md and memory/*.md.' },
  maxResults: {
    type: 'integer',
    description: 'Maximum hits returned. Defaults to the configured memory limit (6 unless overridden).',
  },
  minScore: {
    type: 'number',
    description: 'Minimum cosine similarity (-1 to 1). Defaults to the configured threshold (0.35 unless overridden).',
  },
} as const

const MEMORY_GET_PARAMETERS = {
  path: { type: 'string', required: true, description: 'Memory-relative path: MEMORY.md or memory/<file>.md.' },
  from: { type: 'integer', description: 'First line to read (1-based). Defaults to 1.' },
  lines: { type: 'integer', description: 'Number of lines to read. Defaults to 1000.' },
} as const

const MEMORY_WRITE_PARAMETERS = {
  scope: {
    type: 'string',
    required: true,
    enum: ['durable', 'daily'],
    description: 'durable stores a lasting fact; daily appends a running note for today.',
  },
  content: {
    type: 'string',
    required: true,
    description: 'One self-contained fact or note to append. Do not include filesystem paths.',
  },
} as const

const MEMORY_UPDATE_PARAMETERS = {
  oldContent: {
    type: 'string',
    required: true,
    description: 'Exact current line in MEMORY.md to replace or forget. Read MEMORY.md first.',
  },
  newContent: {
    type: 'string',
    required: true,
    description: 'Replacement durable fact. Use an empty string to forget the old fact.',
  },
} as const

interface ParsedWriteArgs {
  readonly scope: 'durable' | 'daily'
  readonly content: string
}

interface ParsedUpdateArgs {
  readonly oldContent: string
  readonly newContent: string
}

type AppendOutcome = 'stored' | 'already-stored'
type UpdateOutcome = 'updated' | 'forgotten' | 'already-current' | 'not-found'

const targetWriteChains = new Map<string, Promise<void>>()

/** Register the memory guidance section, four tools, and the flush-turn hooks. */
export function apply(ctx: Context, config: Config): void {
  const runtimeConfig = ctx.settings.register(MEMORY_SETTINGS_NAMESPACE, Config, {
    base: config,
    applies: 'restart',
    validate: value => void resolveConfig(value),
  }).get()
  const resolved = resolveConfig(runtimeConfig)
  if (!resolved.enabled) return
  const disposeFlush = installMemoryFlush(ctx, resolved.flush)
  const rootPath = resolve(resolved.root)
  let rootPromise: Promise<FsTarget> | undefined
  const rootTarget = (): Promise<FsTarget> => (rootPromise ??= ctx.fs.resolve(rootPath))
  let indexPromise: Promise<MemoryIndex> | undefined
  const index = (): Promise<MemoryIndex> => (
    indexPromise ??= rootTarget().then(target => new MemoryIndex(ctx.fs, target, resolved.chunkSizeChars, resolved.chunkOverlapChars))
  )
  const onMemoryFile = (rel: string): void => {
    // The index may not exist yet (no search has run); the first sync reads the
    // full tree anyway, so a pre-index event is a no-op.
    void indexPromise?.then(
      (built) => { built.invalidateFile(rel) },
      /* v8 ignore next -- the watcher effect settles rootTarget before tools can create indexPromise. */
      () => {},
    )
  }
  let watchDisposer: MemoryWatchDisposer | undefined
  let recoverWatchAfterWrite = false
  let watchRecovery: Promise<void> | undefined
  ctx.effect(
    async () => {
      recoverWatchAfterWrite = await ctx.fs.stat(await rootTarget()) === undefined
      const installed = await installMemoryWatch(ctx, rootPath, {
        enabled: resolved.watch,
        stabilityThresholdMs: resolved.watchStabilityThresholdMs,
        pollIntervalMs: resolved.watchPollIntervalMs,
      }, onMemoryFile)
      watchDisposer = installed
      return async () => {
        /* v8 ignore next -- this single watcher effect is the only writer of its captured disposer. */
        if (watchDisposer === installed) watchDisposer = undefined
        await installed()
      }
    },
    'memory.watch()',
  )

  ctx.effect(() => {
    const disposeSection = ctx.systemPrompt.section({
      name: MEMORY_RECALL_SECTION,
      order: MEMORY_RECALL_ORDER,
      text: RECALL_TEXT,
    })
    const disposePromptActivity = installPromptActivity(ctx)
    const disposeSearch = ctx.tools.register(defineTool({
      name: 'memory_search',
      description: 'Semantically search MEMORY.md and memory/*.md and return ranked snippets with source lines.',
      parameters: MEMORY_SEARCH_PARAMETERS,
      output: TEXT_OUTPUT,
      timeoutMs: resolved.timeoutMs,
      execute: async (args, exec) => {
        const embeddings = ctx.get('embeddings')
        if (embeddings === undefined) {
          throw new Error(
            'memory_search requires a ctx.embeddings provider (load @clawdsh/dsh-embeddings-ark)',
          )
        }
        const parsed = parseSearchArgs(args, resolved)
        try {
          const hits = await (await index()).search(
            parsed.query, embeddings, parsed.maxResults, parsed.minScore, resolved.snippetChars, exec.signal,
          )
          return formatSearchHits(hits)
        } catch (error: unknown) {
          if (error instanceof FsError) throw sanitizeStorageError('memory_search', error)
          throw error
        }
      },
    }))
    const disposeGet = ctx.tools.register(defineTool({
      name: 'memory_get',
      description: 'Read lines from one memory file (MEMORY.md or memory/<file>.md) by 1-based line numbers.',
      parameters: MEMORY_GET_PARAMETERS,
      output: TEXT_OUTPUT,
      execute: async (args, exec) => {
        const parsed = parseGetArgs(args)
        try {
          const root = await rootTarget()
          await assertSafeMemoryRoot(ctx.fs, root, exec.signal)
          const target = await resolveMemoryTarget(ctx.fs, root, parsed.path)
          if (target === undefined) {
            throw new TypeError('memory_get: argument is not a memory path (expected MEMORY.md or memory/<file>.md)')
          }
          const text = await readMemoryText(ctx, target, parsed.path, exec.signal)
          if (text === undefined) return `No stored memory found for ${parsed.path}.`
          const read = readLineSlice(text, parsed.from, Math.min(parsed.lines, resolved.maxReadLines))
          const truncated = parsed.lines > resolved.maxReadLines
          return `# ${parsed.path} (lines ${read.startLine}-${read.endLine}${truncated ? `, capped at ${resolved.maxReadLines}` : ''})\n${read.text}`
        } catch (error: unknown) {
          if (error instanceof FsError) throw sanitizeStorageError('memory_get', error)
          throw error
        }
      },
    }))
    const recoverWatcherIfNeeded = async (): Promise<void> => {
      if (!recoverWatchAfterWrite || watchDisposer === undefined) return
      try {
        if (await ctx.fs.stat(await rootTarget()) === undefined) return
        watchRecovery ??= watchDisposer.recover().then(() => {
          recoverWatchAfterWrite = false
        }).finally(() => {
          watchRecovery = undefined
        })
        await watchRecovery
      } catch (_watchRecoveryFailed) {
        // Memory state is authoritative after a guarded operation; watcher
        // recovery affects only proactive cache invalidation.
        ctx.logger.warn('memory: failed to recover watcher after creating the memory root')
      }
    }
    const disposeWrite = ctx.tools.register(defineTool({
      name: 'memory_write',
      description: 'Append one lasting fact or daily note to the private personal-memory store.',
      parameters: MEMORY_WRITE_PARAMETERS,
      output: TEXT_OUTPUT,
      timeoutMs: resolved.timeoutMs,
      execute: async (args, exec) => {
        const parsed = parseWriteArgs(args, resolved.maxWriteChars)
        const rel = parsed.scope === 'durable' ? 'MEMORY.md' : `memory/${localDate()}.md`
        let outcome: AppendOutcome
        try {
          const root = await rootTarget()
          await assertSafeMemoryRoot(ctx.fs, root, exec.signal)
          const target = await resolveMemoryTarget(ctx.fs, root, rel)
          if (target === undefined) throw new Error('memory_write: invalid memory target')
          outcome = await appendMemoryText(
            ctx.fs,
            target,
            parsed.content,
            rootPath,
            parsed.scope === 'durable',
            exec.signal,
          )
          if (outcome === 'stored') onMemoryFile(rel)
          await recoverWatcherIfNeeded()
        } catch (error: unknown) {
          throw sanitizeMutationError('memory_write', error)
        }
        if (outcome === 'already-stored') return 'Durable memory already stored.'
        return parsed.scope === 'durable' ? 'Stored durable memory.' : 'Stored daily memory.'
      },
    }))
    const disposeUpdate = ctx.tools.register(defineTool({
      name: 'memory_update',
      description: 'Replace or forget one exact durable fact in the private personal-memory store.',
      parameters: MEMORY_UPDATE_PARAMETERS,
      output: TEXT_OUTPUT,
      timeoutMs: resolved.timeoutMs,
      execute: async (args, exec) => {
        const parsed = parseUpdateArgs(args, resolved.maxWriteChars)
        let outcome: UpdateOutcome
        try {
          const root = await rootTarget()
          await assertSafeMemoryRoot(ctx.fs, root, exec.signal)
          const target = await resolveMemoryTarget(ctx.fs, root, 'MEMORY.md')
          if (target === undefined) throw new Error('memory_update: invalid memory target')
          outcome = await updateMemoryText(ctx.fs, target, parsed, rootPath, exec.signal)
          if (outcome === 'updated' || outcome === 'forgotten') onMemoryFile('MEMORY.md')
          await recoverWatcherIfNeeded()
        } catch (error: unknown) {
          throw sanitizeMutationError('memory_update', error)
        }
        if (outcome === 'updated') return 'Updated durable memory.'
        if (outcome === 'forgotten') return 'Forgot durable memory.'
        if (outcome === 'already-current') return 'Durable memory is already current.'
        return 'No exact durable memory entry matched. Read MEMORY.md and retry with the exact line.'
      },
    }))
    return () => {
      disposeUpdate()
      disposeWrite()
      disposeGet()
      disposeSearch()
      disposeSection()
      disposePromptActivity()
      disposeFlush()
    }
  }, 'memory.section() + memory tools + flush hooks')
}

/** Track only a Memory section whose complete rendered assembly later becomes a committed request header. */
function installPromptActivity(ctx: Context): () => void {
  const candidates = new Map<string, PromptCandidate>()
  const disposeAssembly = ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const transformed = await next()
    const sessionId = assemblySessionId(context)
    if (sessionId === undefined || context.signal === undefined) return transformed
    const section = transformed.sections.find(candidate => candidate.name === MEMORY_RECALL_SECTION)
    if (section === undefined || section.text !== RECALL_TEXT) {
      candidates.delete(sessionId)
      return transformed
    }
    try {
      const contribution = renderPrompt({ ...transformed, sections: [section] })
      /* v8 ignore next -- the retained recall section has fixed non-empty text, so its rendered contribution is non-empty. */
      if (contribution === '') candidates.delete(sessionId)
      else candidates.set(sessionId, { system: renderPrompt(transformed), contribution })
    } catch (_promptRenderFailed) {
      // The Agent loop owns prompt-render failures; optional Activity records no candidate.
      candidates.delete(sessionId)
    }
    return transformed
  }, { prepend: true })
  const disposeSession = ctx.on('session/event', (session, event) => {
    if (event.type !== 'request/header') return
    const sessionId = String(session.id)
    const candidate = candidates.get(sessionId)
    candidates.delete(sessionId)
    if (candidate === undefined || event.data.header.system !== candidate.system) return
    recordPromptContribution(ctx, sessionId, event.seq, candidate.contribution)
  })
  return () => {
    disposeSession()
    disposeAssembly()
    candidates.clear()
  }
}

function assemblySessionId(context: AssembleContext): string | undefined {
  const id = context.agent?.id
  return id === undefined ? undefined : String(id)
}

function recordPromptContribution(ctx: Context, sessionId: string, seq: number, contribution: string): void {
  const activity = ctx.get('clawdshActivity') as PromptActivitySink | undefined
  if (activity === undefined) return
  try {
    void activity.promptContribution({
      sessionId,
      producer: 'memory',
      section: 'clawdsh:memory-recall',
      mode: 'append',
      characters: contribution.length,
      sha256: createHash('sha256').update(contribution).digest('hex'),
      seq,
    }).catch((_activityWriteFailed: unknown) => {
      // Activity is a best-effort projection and cannot own Memory execution.
    })
  } catch (_activityWriteFailed) {
    // Activity is a best-effort projection and cannot own Memory execution.
  }
}

function resolveConfig(config: Config): ResolvedConfig {
  const normalized = config as NormalizedConfig
  const root = normalized.root
  if (root.length === 0) {
    throw new TypeError('memory: config root is required (the memory file directory)')
  }
  const chunkSizeChars = normalized.chunkSizeChars
  const chunkOverlapChars = normalized.chunkOverlapChars
  const maxResults = normalized.maxResults
  const minScore = normalized.minScore
  const snippetChars = normalized.snippetChars
  const timeoutMs = normalized.timeoutMs
  const maxReadLines = normalized.maxReadLines
  const maxWriteChars = normalized.maxWriteChars
  const watch = normalized.watch
  const watchStabilityThresholdMs = normalized.watchStabilityThresholdMs
  const watchPollIntervalMs = normalized.watchPollIntervalMs
  if (!Number.isSafeInteger(chunkSizeChars)) {
    throw new TypeError('memory: chunkSizeChars must be a positive safe integer')
  }
  if (chunkOverlapChars >= chunkSizeChars) {
    throw new TypeError('memory: chunkOverlapChars must be a non-negative integer smaller than chunkSizeChars')
  }
  if (!Number.isSafeInteger(maxResults)) {
    throw new TypeError('memory: maxResults must be a positive safe integer')
  }
  if (!Number.isFinite(minScore)) {
    throw new TypeError('memory: minScore must be a finite number in [-1, 1]')
  }
  if (!Number.isSafeInteger(snippetChars)) {
    throw new TypeError('memory: snippetChars must be a positive safe integer')
  }
  if (!Number.isSafeInteger(maxReadLines)) {
    throw new TypeError('memory: maxReadLines must be a positive safe integer')
  }
  if (!Number.isSafeInteger(maxWriteChars)) {
    throw new TypeError('memory: maxWriteChars must be a positive safe integer')
  }
  if (!Number.isSafeInteger(watchStabilityThresholdMs)) {
    throw new TypeError('memory: watchStabilityThresholdMs must be a positive safe integer')
  }
  if (!Number.isSafeInteger(watchPollIntervalMs)) {
    throw new TypeError('memory: watchPollIntervalMs must be a positive safe integer')
  }
  const flush = resolveFlushConfig(normalized.flush)
  return {
    enabled: normalized.enabled,
    root,
    chunkSizeChars,
    chunkOverlapChars,
    maxResults,
    minScore,
    snippetChars,
    timeoutMs,
    maxReadLines,
    maxWriteChars,
    watch,
    watchStabilityThresholdMs,
    watchPollIntervalMs,
    flush,
  }
}

function parseWriteArgs(args: ParsedWriteArgs, maxWriteChars: number): ParsedWriteArgs {
  const { scope, content } = args
  if (content.trim().length === 0) {
    throw new TypeError('memory_write: content must be a non-empty string')
  }
  const normalized = content.trim()
  if (normalized.length > maxWriteChars) {
    throw new TypeError(`memory_write: content exceeds the ${maxWriteChars}-character limit`)
  }
  if (scope === 'durable' && /[\r\n]/.test(normalized)) {
    throw new TypeError('memory_write: durable content must be one line')
  }
  return { scope, content: normalized }
}

function parseUpdateArgs(args: ParsedUpdateArgs, maxWriteChars: number): ParsedUpdateArgs {
  const { oldContent, newContent } = args
  if (oldContent.trim().length === 0) {
    throw new TypeError('memory_update: oldContent must be a non-empty string')
  }
  const normalizedOld = oldContent.trim()
  const normalizedNew = newContent.trim()
  if (normalizedOld.length > maxWriteChars || normalizedNew.length > maxWriteChars) {
    throw new TypeError(`memory_update: content exceeds the ${maxWriteChars}-character limit`)
  }
  if (/[\r\n]/.test(normalizedOld) || /[\r\n]/.test(normalizedNew)) {
    throw new TypeError('memory_update: oldContent and newContent must each be one line')
  }
  return { oldContent: normalizedOld, newContent: normalizedNew }
}

function localDate(now: Date = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function readMemoryText(
  ctx: Context,
  target: FsTarget,
  relativePath: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  try {
    return await ctx.fs.readText(target, signal)
  } catch (error: unknown) {
    if (error instanceof FsError && error.code === 'FS_NOT_FOUND') return undefined
    if (error instanceof FsError) {
      throw new FsError(`memory_get: cannot read ${relativePath}`, error.code)
    }
    throw new Error(`memory_get: cannot read ${relativePath}`)
  }
}

async function appendMemoryText(
  fs: FileSystem,
  target: FsTarget,
  content: string,
  rootPath: string,
  deduplicateExactLine: boolean,
  signal: AbortSignal,
): Promise<AppendOutcome> {
  return withTargetWriteLock(target, async () => {
    const addition = `${content}\n`
    while (true) {
      if (signal.aborted) throw new FsError('memory_write: aborted', 'FS_ABORTED')
      const info = await fs.stat(target, signal)
      let before = ''
      let expected: { readonly kind: 'createIfAbsent' } | { readonly kind: 'replaceIfVersion'; readonly version: FsVersion }
      if (info === undefined) {
        expected = { kind: 'createIfAbsent' }
      } else {
        if (info.type !== 'file') throw new FsError('memory_write: target is not a regular file', 'FS_NOT_REGULAR_FILE')
        before = await fs.readText(target, signal)
        expected = { kind: 'replaceIfVersion', version: info.version }
        if (deduplicateExactLine && hasExactLine(before, content)) return 'already-stored'
      }
      const separator = before.length === 0 || before.endsWith('\n') ? '' : '\n'
      try {
        await fs.writeText(
          target,
          before + separator + addition,
          expected,
          signal,
          // The model cannot choose `target`; this capability-owned policy grants
          // only the configured memory root instead of escalating the Session.
          { mode: 'workspace-write', workspaceRoot: rootPath },
        )
        return 'stored'
      } catch (error: unknown) {
        if (error instanceof FsError
          && (error.code === 'FS_STALE_VERSION' || error.code === 'FS_NOT_OBSERVED')) continue
        throw error
      }
    }
  })
}

async function updateMemoryText(
  fs: FileSystem,
  target: FsTarget,
  update: ParsedUpdateArgs,
  rootPath: string,
  signal: AbortSignal,
): Promise<UpdateOutcome> {
  return withTargetWriteLock(target, async () => {
    while (true) {
      if (signal.aborted) throw new FsError('memory_update: aborted', 'FS_ABORTED')
      const info = await fs.stat(target, signal)
      if (info === undefined) return 'not-found'
      if (info.type !== 'file') throw new FsError('memory_update: target is not a regular file', 'FS_NOT_REGULAR_FILE')
      const before = await fs.readText(target, signal)
      const replacement = replaceExactDurableLine(before, update.oldContent, update.newContent)
      if (replacement.kind !== 'changed') return replacement.kind
      try {
        await fs.writeText(
          target,
          replacement.text,
          { kind: 'replaceIfVersion', version: info.version },
          signal,
          { mode: 'workspace-write', workspaceRoot: rootPath },
        )
        return update.newContent === '' ? 'forgotten' : 'updated'
      } catch (error: unknown) {
        if (error instanceof FsError && error.code === 'FS_STALE_VERSION') continue
        throw error
      }
    }
  })
}

function hasExactLine(text: string, content: string): boolean {
  return text.split(/\r?\n/).includes(content)
}

function replaceExactDurableLine(
  text: string,
  oldContent: string,
  newContent: string,
): { readonly kind: 'not-found' | 'already-current' } | { readonly kind: 'changed'; readonly text: string } {
  const trailingNewline = text.endsWith('\n')
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  if (trailingNewline) lines.pop()
  const matchCount = lines.filter(line => line === oldContent).length
  if (matchCount === 0) return { kind: 'not-found' }
  if (oldContent === newContent && matchCount === 1) return { kind: 'already-current' }

  const replacementAlreadyPresent = newContent !== ''
    && newContent !== oldContent
    && lines.includes(newContent)
  let inserted = replacementAlreadyPresent
  const next: string[] = []
  for (const line of lines) {
    if (line !== oldContent) {
      next.push(line)
      continue
    }
    if (newContent !== '' && !inserted) {
      next.push(newContent)
      inserted = true
    }
  }
  return {
    kind: 'changed',
    text: next.length === 0 ? '' : next.join(newline) + (trailingNewline ? newline : ''),
  }
}

async function withTargetWriteLock<T>(
  target: FsTarget,
  operation: () => Promise<T>,
): Promise<T> {
  const key = String(target.targetKey)
  const prior = targetWriteChains.get(key) ?? Promise.resolve()
  const run = prior.then(operation, operation)
  const tail = run.then(() => undefined, () => undefined)
  targetWriteChains.set(key, tail)
  try {
    return await run
  } finally {
    if (targetWriteChains.get(key) === tail) targetWriteChains.delete(key)
  }
}

function sanitizeMutationError(tool: 'memory_write' | 'memory_update', error: unknown): Error {
  if (error instanceof FsError) return new FsError(`${tool}: storage operation failed (${error.code})`, error.code)
  return new Error(`${tool}: storage operation failed`)
}

function sanitizeStorageError(tool: 'memory_search' | 'memory_get', error: FsError): FsError {
  return new FsError(`${tool}: storage operation failed (${error.code})`, error.code)
}

function parseSearchArgs(
  args: { readonly query: string; readonly maxResults?: number; readonly minScore?: number },
  defaults: Pick<ResolvedConfig, 'maxResults' | 'minScore'>,
): { query: string; maxResults: number; minScore: number } {
  const { query, maxResults, minScore } = args
  if (query.length === 0) throw new TypeError('memory_search: query must be a non-empty string')
  return {
    query,
    maxResults: maxResults === undefined ? defaults.maxResults : boundedInt(maxResults, 'maxResults'),
    minScore: minScore === undefined ? defaults.minScore : boundedNumber(minScore, 'minScore'),
  }
}

function parseGetArgs(args: { readonly path: string; readonly from?: number; readonly lines?: number }): {
  path: string
  from: number
  lines: number
} {
  const { path, from, lines } = args
  if (path.length === 0) throw new TypeError('memory_get: path must be a non-empty string')
  return {
    path,
    from: from === undefined ? 1 : boundedInt(from, 'from'),
    lines: lines === undefined ? DEFAULT_MAX_READ_LINES : boundedInt(lines, 'lines'),
  }
}

function boundedInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`memory: ${field} must be a positive safe integer`)
  }
  return value
}

function boundedNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -1 || value > 1) {
    throw new TypeError(`memory: ${field} must be a finite number in [-1, 1]`)
  }
  return value
}

function formatSearchHits(hits: SearchHit[]): string {
  if (hits.length === 0) return 'No matching memories found.'
  return hits.map(hit => `${hit.path}:${hit.startLine}-${hit.endLine} (score ${hit.score.toFixed(3)})\n${hit.snippet}`).join('\n\n')
}
