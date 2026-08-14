/**
 * Small provider-neutral text helpers shared by channel adapters.
 * @module @clawdsh/dsh-channel-core/text
 */

/** Whether one UTF-16 code unit starts a surrogate pair. */
function isHighSurrogate(code: number): boolean {
  return code >= 0xD800 && code <= 0xDBFF
}

/** Whether one UTF-16 code unit completes a surrogate pair. */
function isLowSurrogate(code: number): boolean {
  return code >= 0xDC00 && code <= 0xDFFF
}

/**
 * Split text under a provider's UTF-16 size ceiling without cutting a Unicode
 * scalar value in half. The platform adapters keep delivery semantics (topic,
 * reply, retry) around each returned chunk.
 * @param text - text to split; an empty string remains one empty chunk.
 * @param maxUnits - maximum JavaScript/UTF-16 length of each chunk (at least 2).
 * @returns ordered chunks whose concatenation is exactly `text`.
 */
export function splitTextByUtf16Limit(text: string, maxUnits: number): string[] {
  if (!Number.isSafeInteger(maxUnits) || maxUnits < 2) {
    throw new TypeError('channel text chunk limit must be a safe integer of at least 2')
  }
  if (text.length <= maxUnits) return [text]
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(start + maxUnits, text.length)
    if (end < text.length
      && isHighSurrogate(text.charCodeAt(end - 1))
      && isLowSurrogate(text.charCodeAt(end))) {
      end -= 1
    }
    chunks.push(text.slice(start, end))
    start = end
  }
  return chunks
}
