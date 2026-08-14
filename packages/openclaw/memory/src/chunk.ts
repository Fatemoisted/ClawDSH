/**
 * Pure Markdown chunker for the memory index: splits one memory file's text into
 * budget-bounded chunks for embedding, keeping 1-based start/end line numbers so
 * `memory_get` can pull the exact source lines of a hit. Paragraph boundaries
 * are preferred cut points; a paragraph longer than the budget is split on
 * sentence boundaries; a single sentence longer than the budget is hard-split.
 * Consecutive chunks overlap by up to `overlapChars` characters of the previous
 * chunk's tail, trimmed forward to a sentence boundary so the overlap starts clean.
 *
 * @module @clawdsh/dsh-memory/chunk
 */

/** One indexed slice of a memory file. */
export interface MemoryChunk {
  /** The verbatim source text of this chunk. */
  text: string
  /** 1-based line of the chunk's first character. */
  startLine: number
  /** 1-based line of the chunk's last character. */
  endLine: number
}

/** A verbatim slice of the source text with its offsets. */
interface Slice {
  text: string
  start: number
  end: number
}

const PARAGRAPH_SPLIT = /\n[ \t]*\n+/g
const SENTENCE_SPLIT = /[^。！？.!?\n]+[。！？.!?]?/g

/**
 * Split one memory file into embedding-ready chunks.
 * @param text - the file's full text.
 * @param chunkSizeChars - the target character budget per chunk.
 * @param overlapChars - how many characters of the previous chunk's tail to carry into the next.
 * @returns the chunks in source order; empty text yields no chunks.
 */
export function chunkMarkdown(text: string, chunkSizeChars: number, overlapChars: number): MemoryChunk[] {
  if (text.length === 0) return []
  const units = unitize(text, chunkSizeChars)
  const newlines = countNewlines(text)
  const chunks: MemoryChunk[] = []
  let current: Slice | undefined
  for (const unit of units) {
    if (current === undefined) {
      current = unit
      continue
    }
    if (unit.end - current.start <= chunkSizeChars) {
      // Re-slice from the source so the chunk stays verbatim text (original
      // paragraph separators included) — overlap offsets and line numbers stay exact.
      current = { text: text.slice(current.start, unit.end), start: current.start, end: unit.end }
      continue
    }
    chunks.push(toChunk(current, newlines))
    const overlap = overlapPrefix(current.text, overlapChars)
    const start = overlap.length > 0 ? current.end - overlap.length : unit.start
    current = { text: text.slice(start, unit.end), start, end: unit.end }
  }
  if (current !== undefined) chunks.push(toChunk(current, newlines))
  return chunks
}

/** Split into paragraph units, sentence-splitting and hard-splitting over-budget text. */
function unitize(text: string, budget: number): Slice[] {
  const units: Slice[] = []
  for (const paragraph of splitWithOffsets(text, PARAGRAPH_SPLIT)) {
    if (paragraph.text.trim().length === 0) continue
    if (paragraph.text.length <= budget) {
      units.push(paragraph)
      continue
    }
    for (const unit of sentenceUnits(paragraph, budget)) {
      if (unit.text.length <= budget) {
        units.push(unit)
        continue
      }
      for (let offset = 0; offset < unit.text.length; offset += budget) {
        units.push({
          text: unit.text.slice(offset, offset + budget),
          start: unit.start + offset,
          end: unit.start + Math.min(offset + budget, unit.text.length),
        })
      }
    }
  }
  return units
}

/** Sentence-split one over-budget paragraph into budget-bounded runs. */
function sentenceUnits(paragraph: Slice, budget: number): Slice[] {
  const units: Slice[] = []
  let current: Slice | undefined
  for (const match of paragraph.text.matchAll(SENTENCE_SPLIT)) {
    const sentence: Slice = {
      text: match[0],
      start: paragraph.start + match.index,
      end: paragraph.start + match.index + match[0].length,
    }
    if (current === undefined) {
      current = sentence
      continue
    }
    if (current.text.length + sentence.text.length <= budget) {
      current = { text: current.text + sentence.text, start: current.start, end: sentence.end }
      continue
    }
    units.push(current)
    current = sentence
  }
  if (current !== undefined) units.push(current)
  return units
}

/** Tail of `text` up to `overlapChars`, trimmed forward to a sentence boundary. */
function overlapPrefix(text: string, overlapChars: number): string {
  if (overlapChars <= 0) return ''
  const tail = text.slice(-overlapChars)
  const boundary = /[。！？.!?][ \t]*\n?/.exec(tail)
  if (boundary === null || boundary.index + boundary[0].length >= tail.length) return tail
  return tail.slice(boundary.index + boundary[0].length)
}

function toChunk(slice: Slice, newlines: number[]): MemoryChunk {
  return {
    text: slice.text,
    startLine: lineOf(newlines, slice.start),
    endLine: lineOf(newlines, slice.end - 1),
  }
}

/** Cumulative newline counts: `newlines[i]` is the newline count in `text[0..i]` (inclusive). */
function countNewlines(text: string): number[] {
  const counts = new Array<number>(text.length)
  let running = 0
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 10) running += 1
    counts[index] = running
  }
  return counts
}

/** 1-based line number of the character at `offset`. */
function lineOf(newlines: number[], offset: number): number {
  return offset <= 0 ? 1 : (newlines[offset - 1] ?? 0) + 1
}

/** Split text on a separator while retaining each segment's original offsets. */
function splitWithOffsets(text: string, separator: RegExp): Slice[] {
  const parts: Slice[] = []
  let last = 0
  let match: RegExpExecArray | null
  separator.lastIndex = 0
  while ((match = separator.exec(text)) !== null) {
    parts.push({ text: text.slice(last, match.index), start: last, end: match.index })
    last = match.index + match[0].length
  }
  parts.push({ text: text.slice(last), start: last, end: text.length })
  return parts
}
