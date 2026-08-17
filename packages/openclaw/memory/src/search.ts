/**
 * Derived in-memory index over the Markdown memory files. The files are the
 * source of truth; the index is rebuilt incrementally — each sync lists the
 * memory root, compares `(version, size)` per file, re-chunks changed files,
 * and drops deleted ones. Chunks carry their embedding lazily: one `embed`
 * call per search covers the query plus every not-yet-embedded chunk, so a
 * cold start costs one batch request and incremental edits cost one call for
 * the changed file. Every discovered path is rechecked for root containment;
 * symbolic-link entries are never indexed.
 *
 * @module @clawdsh/dsh-memory/search
 */

import type { Embeddings, EmbeddingVector } from '@clawdsh/dsh-embeddings'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FileSystem, FsDirEntry, FsTarget, FsVersion } from '@deepseek-ai/dsh-fs'
import { chunkMarkdown } from './chunk.ts'
import type { MemoryChunk } from './chunk.ts'
import { assertSafeMemoryRoot, isMemoryPath, resolveMemoryTarget } from './memory-files.ts'

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
   * Drop one file's indexed entry (chunks and any cached vectors) so the next
   * sync re-reads it from disk. `add` needs no invalidation — the sync
   * seen-set picks new files up — but a `change`/`unlink` must force a re-read
   * because a same-size edit is invisible to the `(version, size)` freshness
   * check and a delete-then-recreate with an identical size would otherwise
   * keep stale chunks. Dropping a single file preserves every other file's
   * cached embedding (one embed request per text, so a full clear is costly).
   * @param rel - the memory-root-relative path to drop; unknown paths are a no-op.
   */
  invalidateFile(rel: string): void {
    this.files.delete(rel)
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
    let chunkCount = 0
    for (const file of this.files.values()) {
      for (const chunk of file.chunks) {
        chunkCount += 1
        if (chunk.vector === undefined) pending.push(chunk)
      }
    }
    if (chunkCount === 0) return []
    const vectors = await embeddings.embed([query, ...pending.map(chunk => chunk.text)], signal)
    const vectorIterator = vectors[Symbol.iterator]()
    const queryVector = vectorIterator.next().value as EmbeddingVector
    for (const chunk of pending) chunk.vector = vectorIterator.next().value as EmbeddingVector

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
    const rootPathInfo = await assertSafeMemoryRoot(this.fs, this.root, signal)
    if (rootPathInfo === undefined) {
      this.files.clear()
      return
    }
    const rootEntries = await listDirOrEmpty(this.fs, this.root, signal)
    for (const entry of rootEntries) {
      if (entry.name === 'MEMORY.md' && entry.type === 'file') {
        if (await this.refresh('MEMORY.md', entry, signal)) seen.add('MEMORY.md')
      } else if (entry.name === 'memory' && entry.type === 'directory') {
        const pathInfo = await this.fs.lstat(entry.target.displayPath, undefined, signal)
        if (pathInfo?.type !== 'directory' || !this.fs.contains(this.root, entry.target)) continue
        const children = await listDirOrEmpty(this.fs, entry.target, signal)
        for (const child of children) {
          const rel = `memory/${child.name}`
          if (child.type !== 'file' || !isMemoryPath(rel)) continue
          if (await this.refresh(rel, child, signal)) seen.add(rel)
        }
      }
    }
    for (const rel of [...this.files.keys()]) {
      if (!seen.has(rel)) this.files.delete(rel)
    }
  }

  private async refresh(rel: string, entry: FsDirEntry, signal?: AbortSignal): Promise<boolean> {
    try {
      const pathInfo = await this.fs.lstat(entry.target.displayPath, undefined, signal)
      if (pathInfo?.type !== 'file') return false
      const target = await resolveMemoryTarget(this.fs, this.root, rel)
      if (target === undefined) return false
      const info = await this.fs.stat(target, signal)
      if (info?.type !== 'file') return false
      const existing = this.files.get(rel)
      if (existing !== undefined && existing.version === info.version && existing.size === info.size) {
        return true
      }
      const text = await this.fs.readText(target, signal)
      const chunks = chunkMarkdown(text, this.chunkSizeChars, this.overlapChars)
      this.files.set(rel, {
        version: info.version,
        size: info.size ?? text.length,
        chunks: chunks.map(chunk => ({ ...chunk })),
      })
      return true
    } catch (error: unknown) {
      if (error instanceof FsError
        && (error.code === 'FS_NOT_FOUND' || error.code === 'FS_NOT_REGULAR_FILE')) return false
      throw error
    }
  }
}

/** A missing memory directory is the valid empty-store state. */
async function listDirOrEmpty(fs: FileSystem, target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]> {
  try {
    return await fs.listDir(target, signal)
  } catch (error: unknown) {
    if (error instanceof FsError && error.code === 'FS_NOT_FOUND') return []
    throw error
  }
}
