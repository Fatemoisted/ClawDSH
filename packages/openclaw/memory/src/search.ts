/**
 * Derived in-memory index over the Markdown memory files. The files are the
 * source of truth; the index is rebuilt incrementally — each sync lists the
 * memory root, compares `(version, size)` per file, re-chunks changed files,
 * and drops deleted ones. Chunks carry their embedding lazily: one `embed`
 * call per search covers the query plus every not-yet-embedded chunk, so a
 * cold start costs one batch request and incremental edits cost one call for
 * the changed file.
 *
 * @module @clawdsh/dsh-memory/search
 */

import type { Embeddings, EmbeddingVector } from '@clawdsh/dsh-embeddings'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FileSystem, FsDirEntry, FsTarget, FsVersion } from '@deepseek-ai/dsh-fs'
import { chunkMarkdown } from './chunk.ts'
import type { MemoryChunk } from './chunk.ts'
import { isMemoryPath } from './memory-files.ts'

/** One indexed memory file. */
interface IndexedFile {
  /** Freshness token; `undefined` when the backend's listing omits one, which forces re-reads. */
  version: FsVersion | undefined
  size: number
  chunks: IndexedChunk[]
}

/** A chunk plus its lazily-computed embedding. */
interface IndexedChunk extends MemoryChunk {
  vector?: EmbeddingVector
}

/** One ranked recall hit. */
export interface SearchHit {
  /** Memory-root-relative source path (`MEMORY.md` or `memory/<file>.md`). */
  path: string
  startLine: number
  endLine: number
  score: number
  snippet: string
}

/**
 * Cosine similarity between two same-dimension vectors; `0` for mismatched,
 * empty, or zero-norm inputs.
 * @param a - the first vector.
 * @param b - the second vector.
 * @returns the cosine similarity in `[-1, 1]`.
 */
export function cosineSimilarity(a: EmbeddingVector, b: EmbeddingVector): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let index = 0; index < a.length; index++) {
    // Equal lengths make both elements defined for dense vectors; a sparse
    // slot counts as 0 rather than poisoning the score.
    const left = a[index] ?? 0
    const right = b[index] ?? 0
    dot += left * right
    normA += left ** 2
    normB += right ** 2
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  return denominator === 0 ? 0 : dot / denominator
}

/** Flatten and cap one chunk's text into a search-result snippet. */
function snippetOf(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= limit ? flat : flat.slice(0, limit)
}

/** In-memory index over one memory root; per-context, owned by the plugin closure. */
export class MemoryIndex {
  private readonly files = new Map<string, IndexedFile>()
  private syncChain: Promise<void> = Promise.resolve()

  constructor(
    private readonly fs: FileSystem,
    private readonly root: FsTarget,
    private readonly chunkSizeChars: number,
    private readonly overlapChars: number,
  ) {}

  /**
   * Incrementally rebuild the index from the memory files. Calls serialize on a
   * chain so concurrent searches share one pending sync; a failed sync rejects
   * only its own callers and leaves the chain usable for the next.
   * @param signal - cancellation for listing and reads.
   */
  sync(signal?: AbortSignal): Promise<void> {
    const run = this.syncChain.then(() => this.doSync(signal))
    this.syncChain = run.catch(() => {})
    return run
  }

  /**
   * Rank memory chunks against one query: syncs first, embeds the query plus
   * any un-embedded chunks in one batch, ranks by cosine similarity, and keeps
   * the strongest hits above the score floor.
   * @param query - the semantic query.
   * @param embeddings - the embedding backend; the caller fails loudly before this point when absent.
   * @param maxResults - maximum hits returned.
   * @param minScore - minimum cosine similarity for a hit.
   * @param snippetChars - character cap per hit snippet.
   * @param signal - cancellation for sync and the embedding request.
   * @returns hits ordered by descending score.
   */
  async search(
    query: string,
    embeddings: Embeddings,
    maxResults: number,
    minScore: number,
    snippetChars: number,
    signal?: AbortSignal,
  ): Promise<SearchHit[]> {
    await this.sync(signal)
    const pending: IndexedChunk[] = []
    for (const file of this.files.values()) {
      for (const chunk of file.chunks) {
        if (chunk.vector === undefined) pending.push(chunk)
      }
    }
    const vectors = await embeddings.embed([query, ...pending.map(chunk => chunk.text)], signal)
    const queryVector = vectors[0]
    if (queryVector === undefined) {
      throw new Error('memory: embedding backend returned no query vector')
    }
    for (let index = 0; index < pending.length; index++) {
      const chunk = pending[index]
      const vector = vectors[index + 1]
      if (chunk === undefined || vector === undefined) {
        throw new Error('memory: embedding backend returned fewer vectors than requested')
      }
      chunk.vector = vector
    }

    const hits: SearchHit[] = []
    for (const [path, file] of this.files) {
      for (const chunk of file.chunks) {
        const vector = chunk.vector
        if (vector === undefined) continue
        const score = cosineSimilarity(queryVector, vector)
        if (score < minScore) continue
        hits.push({
          path,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          score,
          snippet: snippetOf(chunk.text, snippetChars),
        })
      }
    }
    hits.sort((a, b) => b.score - a.score)
    return hits.slice(0, maxResults)
  }

  private async doSync(signal?: AbortSignal): Promise<void> {
    const seen = new Set<string>()
    let rootEntries: FsDirEntry[]
    try {
      rootEntries = await this.fs.listDir(this.root, signal)
    } catch (error) {
      if (!(error instanceof FsError) || error.code !== 'FS_NOT_FOUND') throw error
      // A first-run profile has no memory root yet. Treat it as an empty
      // source of truth; `memory_append` will create parent directories using
      // the filesystem's guarded atomic-write primitive.
      this.files.clear()
      return
    }
    for (const entry of rootEntries) {
      if (entry.name === 'MEMORY.md' && entry.type === 'file') {
        seen.add('MEMORY.md')
        await this.refresh('MEMORY.md', entry, signal)
      } else if (entry.name === 'memory' && entry.type === 'directory') {
        const children = await this.fs.listDir(entry.target, signal)
        for (const child of children) {
          const rel = `memory/${child.name}`
          if (child.type !== 'file' || !isMemoryPath(rel)) continue
          seen.add(rel)
          await this.refresh(rel, child, signal)
        }
      }
    }
    for (const rel of [...this.files.keys()]) {
      if (!seen.has(rel)) this.files.delete(rel)
    }
  }

  private async refresh(rel: string, entry: FsDirEntry, signal?: AbortSignal): Promise<void> {
    const existing = this.files.get(rel)
    if (entry.version !== undefined && existing !== undefined
      && existing.version === entry.version && existing.size === entry.size) {
      return
    }
    const text = await this.fs.readText(entry.target, signal)
    const chunks = chunkMarkdown(text, this.chunkSizeChars, this.overlapChars)
    this.files.set(rel, {
      version: entry.version,
      size: entry.size ?? text.length,
      chunks: chunks.map(chunk => ({ ...chunk })),
    })
  }
}
