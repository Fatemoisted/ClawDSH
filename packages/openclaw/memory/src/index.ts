/**
 * ClawDSH memory row: OpenClaw-style long-term memory on dsh seams. The memory
 * files (`MEMORY.md` for durable facts, `memory/YYYY-MM-DD.md` for running
 * notes) are plain Markdown under a configured root and stay the source of
 * truth — the plugin never writes them; the model writes through the fs tools
 * under the recall-section convention. Recall is on-demand: `memory_search`
 * ranks chunks by embedding cosine similarity and `memory_get` reads back
 * lines. Nothing is auto-injected per request, so every model-visible memory
 * enters the transcript as a tool result, satisfying "model-visible means
 * logged" without a new session event.
 *
 * @module @clawdsh/dsh-memory
 */

import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@clawdsh/dsh-embeddings'
import type {} from '@deepseek-ai/dsh-fs'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { readLineSlice, resolveMemoryTarget } from './memory-files.ts'
import { MemoryIndex } from './search.ts'
import type { SearchHit } from './search.ts'
import { MEMORY_RECALL_ORDER, MEMORY_RECALL_SECTION, RECALL_TEXT } from './recall-section.ts'
import { installMemoryFlush, resolveFlushConfig, FlushConfig } from './flush.ts'
import { installMemoryWatch, DEFAULT_WATCH_STABILITY_THRESHOLD_MS, DEFAULT_WATCH_POLL_INTERVAL_MS } from './watch.ts'

export { MEMORY_RECALL_ORDER, MEMORY_RECALL_SECTION, RECALL_TEXT } from './recall-section.ts'
export { FLUSH_PLUGIN_SOURCE, DEFAULT_FLUSH_PROMPT, DEFAULT_FLUSH_RESERVE_TOKENS_FLOOR, DEFAULT_FLUSH_SOFT_THRESHOLD_TOKENS } from './flush.ts'
export type { MemoryChunk } from './chunk.ts'
export { chunkMarkdown } from './chunk.ts'
export { cosineSimilarity } from './search.ts'
export type { SearchHit } from './search.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'memory'

/** Capability services the plugin mounts on; embeddings is read optionally via `ctx.get`. */
export const inject = ['tools', 'systemPrompt', 'fs']

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

/** Plugin config; `root` is required — the memory directory a deployment owns. */
export interface Config {
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
  root: z.string(),
  chunkSizeChars: z.number().step(1).min(1).default(DEFAULT_CHUNK_SIZE_CHARS),
  chunkOverlapChars: z.number().step(1).min(0).default(DEFAULT_CHUNK_OVERLAP_CHARS),
  maxResults: z.number().step(1).min(1).default(DEFAULT_MAX_RESULTS),
  minScore: z.number().min(-1).max(1).default(DEFAULT_MIN_SCORE),
  snippetChars: z.number().step(1).min(1).default(DEFAULT_SNIPPET_CHARS),
  timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_TIMEOUT_MS),
  maxReadLines: z.number().step(1).min(1).default(DEFAULT_MAX_READ_LINES),
  watch: z.boolean().default(true),
  watchStabilityThresholdMs: z.number().step(1).min(1).default(DEFAULT_WATCH_STABILITY_THRESHOLD_MS),
  watchPollIntervalMs: z.number().step(1).min(1).default(DEFAULT_WATCH_POLL_INTERVAL_MS),
  flush: FlushConfig,
})

interface ResolvedConfig {
  readonly root: string
  readonly chunkSizeChars: number
  readonly chunkOverlapChars: number
  readonly maxResults: number
  readonly minScore: number
  readonly snippetChars: number
  readonly timeoutMs: number
  readonly maxReadLines: number
  readonly watch: boolean
  readonly watchStabilityThresholdMs: number
  readonly watchPollIntervalMs: number
  readonly flush: ReturnType<typeof resolveFlushConfig>
}

const TEXT_OUTPUT = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
}

const MEMORY_SEARCH_PARAMETERS = {
  query: { type: 'string', required: true, description: 'Semantic query over MEMORY.md and memory/*.md.' },
  maxResults: { type: 'integer', description: 'Maximum hits returned. Defaults to 6.' },
  minScore: { type: 'number', description: 'Minimum cosine similarity (0-1). Defaults to 0.35.' },
} as const

const MEMORY_GET_PARAMETERS = {
  path: { type: 'string', required: true, description: 'Memory-relative path: MEMORY.md or memory/<file>.md.' },
  from: { type: 'integer', description: 'First line to read (1-based). Defaults to 1.' },
  lines: { type: 'integer', description: 'Number of lines to read. Defaults to 1000.' },
} as const

/** Register the memory guidance section, both tools, and the flush-turn hooks. */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
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
    void indexPromise?.then((built) => { built.invalidateFile(rel) }, () => {})
  }
  ctx.effect(
    () => installMemoryWatch(ctx, rootPath, {
      enabled: resolved.watch,
      stabilityThresholdMs: resolved.watchStabilityThresholdMs,
      pollIntervalMs: resolved.watchPollIntervalMs,
    }, onMemoryFile),
    'memory.watch()',
  )

  ctx.effect(() => {
    const disposeSection = ctx.systemPrompt.section({
      name: MEMORY_RECALL_SECTION,
      order: MEMORY_RECALL_ORDER,
      text: RECALL_TEXT,
    })
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
        const parsed = parseSearchArgs(args)
        const hits = await (await index()).search(
          parsed.query, embeddings, parsed.maxResults, parsed.minScore, resolved.snippetChars, exec.signal,
        )
        return formatSearchHits(hits)
      },
    }))
    const disposeGet = ctx.tools.register(defineTool({
      name: 'memory_get',
      description: 'Read lines from one memory file (MEMORY.md or memory/<file>.md) by 1-based line numbers.',
      parameters: MEMORY_GET_PARAMETERS,
      output: TEXT_OUTPUT,
      execute: async (args, exec) => {
        const parsed = parseGetArgs(args)
        const target = await resolveMemoryTarget(ctx.fs, await rootTarget(), parsed.path)
        if (target === undefined) {
          throw new Error(`memory_get: "${parsed.path}" is not a memory path (MEMORY.md or memory/<file>.md)`)
        }
        const text = await ctx.fs.readText(target, exec.signal)
        const read = readLineSlice(text, parsed.from, Math.min(parsed.lines, resolved.maxReadLines))
        const truncated = parsed.lines > resolved.maxReadLines
        return `# ${parsed.path} (lines ${read.startLine}-${read.endLine}${truncated ? `, capped at ${resolved.maxReadLines}` : ''})\n${read.text}`
      },
    }))
    return () => {
      disposeGet()
      disposeSearch()
      disposeSection()
      disposeFlush()
    }
  }, 'memory.section() + memory tools + flush hooks')
}

function resolveConfig(config: Config): ResolvedConfig {
  if (config.root === undefined || config.root.length === 0) {
    throw new TypeError('memory: config root is required (the memory file directory)')
  }
  const chunkSizeChars = config.chunkSizeChars ?? DEFAULT_CHUNK_SIZE_CHARS
  const chunkOverlapChars = config.chunkOverlapChars ?? DEFAULT_CHUNK_OVERLAP_CHARS
  const maxResults = config.maxResults ?? DEFAULT_MAX_RESULTS
  const minScore = config.minScore ?? DEFAULT_MIN_SCORE
  const snippetChars = config.snippetChars ?? DEFAULT_SNIPPET_CHARS
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxReadLines = config.maxReadLines ?? DEFAULT_MAX_READ_LINES
  const watch = config.watch ?? true
  const watchStabilityThresholdMs = config.watchStabilityThresholdMs ?? DEFAULT_WATCH_STABILITY_THRESHOLD_MS
  const watchPollIntervalMs = config.watchPollIntervalMs ?? DEFAULT_WATCH_POLL_INTERVAL_MS
  if (!Number.isSafeInteger(chunkSizeChars) || chunkSizeChars < 1) {
    throw new TypeError('memory: chunkSizeChars must be a positive safe integer')
  }
  if (!Number.isSafeInteger(chunkOverlapChars) || chunkOverlapChars < 0 || chunkOverlapChars >= chunkSizeChars) {
    throw new TypeError('memory: chunkOverlapChars must be a non-negative integer smaller than chunkSizeChars')
  }
  if (!Number.isSafeInteger(maxResults) || maxResults < 1) {
    throw new TypeError('memory: maxResults must be a positive safe integer')
  }
  if (typeof minScore !== 'number' || !Number.isFinite(minScore) || minScore < -1 || minScore > 1) {
    throw new TypeError('memory: minScore must be a finite number in [-1, 1]')
  }
  if (!Number.isSafeInteger(snippetChars) || snippetChars < 1) {
    throw new TypeError('memory: snippetChars must be a positive safe integer')
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMER_DELAY_MS) {
    throw new TypeError(`memory: timeoutMs must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  if (!Number.isSafeInteger(maxReadLines) || maxReadLines < 1) {
    throw new TypeError('memory: maxReadLines must be a positive safe integer')
  }
  if (config.watch !== undefined && typeof config.watch !== 'boolean') {
    throw new TypeError('memory: watch must be a boolean')
  }
  if (!Number.isSafeInteger(watchStabilityThresholdMs) || watchStabilityThresholdMs < 1) {
    throw new TypeError('memory: watchStabilityThresholdMs must be a positive safe integer')
  }
  if (!Number.isSafeInteger(watchPollIntervalMs) || watchPollIntervalMs < 1) {
    throw new TypeError('memory: watchPollIntervalMs must be a positive safe integer')
  }
  const flush = resolveFlushConfig(config.flush)
  return {
    root: config.root,
    chunkSizeChars,
    chunkOverlapChars,
    maxResults,
    minScore,
    snippetChars,
    timeoutMs,
    maxReadLines,
    watch,
    watchStabilityThresholdMs,
    watchPollIntervalMs,
    flush,
  }
}

function parseSearchArgs(args: unknown): { query: string; maxResults: number; minScore: number } {
  if (typeof args !== 'object' || args === null) throw new TypeError('memory_search: invalid arguments')
  const record = args as Record<string, unknown>
  const query = record.query
  const maxResults = record.maxResults
  const minScore = record.minScore
  if (typeof query !== 'string' || query.length === 0) throw new TypeError('memory_search: query must be a non-empty string')
  return {
    query,
    maxResults: maxResults === undefined ? DEFAULT_MAX_RESULTS : boundedInt(maxResults, 'maxResults'),
    minScore: minScore === undefined ? DEFAULT_MIN_SCORE : boundedNumber(minScore, 'minScore'),
  }
}

function parseGetArgs(args: unknown): { path: string; from: number; lines: number } {
  if (typeof args !== 'object' || args === null) throw new TypeError('memory_get: invalid arguments')
  const record = args as Record<string, unknown>
  const path = record.path
  const from = record.from
  const lines = record.lines
  if (typeof path !== 'string' || path.length === 0) throw new TypeError('memory_get: path must be a non-empty string')
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
