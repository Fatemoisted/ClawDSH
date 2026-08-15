import { describe, expect, it } from 'vitest'
import { splitTextByUtf16Limit } from '@clawdsh/dsh-channel-core'

describe('splitTextByUtf16Limit', () => {
  it('preserves text and keeps every chunk under the UTF-16 limit', () => {
    const text = `${'a'.repeat(7)}😀${'b'.repeat(7)}`
    const chunks = splitTextByUtf16Limit(text, 8)

    expect(chunks.join('')).toBe(text)
    expect(chunks.every(chunk => chunk.length <= 8)).toBe(true)
    expect(chunks).toHaveLength(3)
  })

  it('never cuts an astral scalar at a chunk boundary', () => {
    const chunks = splitTextByUtf16Limit(`${'a'.repeat(7)}😀tail`, 8)

    expect(chunks[0]).toBe('a'.repeat(7))
    expect(chunks[1]?.startsWith('😀')).toBe(true)
    expect(chunks.join('')).toBe(`${'a'.repeat(7)}😀tail`)
  })

  it('rejects a limit too small to preserve surrogate pairs', () => {
    expect(() => splitTextByUtf16Limit('text', 1)).toThrow(/at least 2/)
  })
})
