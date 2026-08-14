/**
 * Path policy and read helpers for the Markdown memory files. The whitelist is
 * the trust boundary for model-supplied paths (`memory_get`): only `MEMORY.md`
 * and flat `memory/<file>.md` entries are memory paths — nothing absolute,
 * nothing with `..` segments, no deep or hidden structure. Containment is then
 * re-enforced by the fs seam (`FileSystem.contains`) at the operation that
 * resolves the target.
 *
 * @module @clawdsh/dsh-memory/memory-files
 */

import { join } from 'node:path'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'

const MEMORY_FILE_PATTERN = /^(?:MEMORY\.md|memory\/[^/]+\.md)$/

/**
 * Whether a memory-root-relative path is a legal memory file.
 * @param rel - the model-supplied or discovered relative path.
 * @returns `true` only for `MEMORY.md` and flat `memory/<file>.md` entries.
 */
export function isMemoryPath(rel: string): boolean {
  if (rel.includes('..')) return false
  return MEMORY_FILE_PATTERN.test(rel)
}

/**
 * Resolve a memory-root-relative path and enforce containment.
 * @param fs - the filesystem service.
 * @param root - the resolved memory root target.
 * @param rel - the memory-root-relative path.
 * @returns the resolved target, or `undefined` when the path is not a memory path or escapes the root.
 */
export async function resolveMemoryTarget(fs: FileSystem, root: FsTarget, rel: string): Promise<FsTarget | undefined> {
  if (!isMemoryPath(rel)) return undefined
  const target = await fs.resolve(join(root.displayPath, rel))
  return fs.contains(root, target) ? target : undefined
}

/** One line-bounded read of a memory file. */
export interface MemoryRead {
  /** The slice's text, newline-joined. */
  text: string
  /** 1-based line of the slice's first line. */
  startLine: number
  /** 1-based line of the slice's last line, or `startLine - 1` when the file has fewer lines than `from`. */
  endLine: number
}

/**
 * Slice a file's text by 1-based line numbers.
 * @param text - the file's full text.
 * @param from - first line to include (1-based, clamped to 1).
 * @param lines - maximum number of lines; the slice reports the lines actually present.
 * @returns the slice with its true line bounds.
 */
export function readLineSlice(text: string, from: number, lines: number): MemoryRead {
  const all = text.split('\n')
  const start = Math.max(1, from)
  if (start > all.length) return { text: '', startLine: start, endLine: start - 1 }
  const end = Math.min(all.length, start + lines - 1)
  return { text: all.slice(start - 1, end).join('\n'), startLine: start, endLine: end }
}
