/**
 * Contract tests for channel identity presentation, keyless pure-function
 * cases ported from OpenClaw's resolution semantics: ack emoji fallback
 * chain, `'auto'` → `[name]` prefixes, and mention-pattern derivation.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ACK_REACTION,
  deriveMentionPatterns,
  resolveAckReaction,
  resolveMessagePrefix,
  resolveResponsePrefix,
  stripMentions,
} from '../src/presentation.ts'

describe('channel identity presentation', () => {
  it('resolves the ack reaction through explicit → identity.emoji → default', () => {
    expect(resolveAckReaction({})).toBe(DEFAULT_ACK_REACTION)
    expect(resolveAckReaction({ identity: { emoji: '🐚' } })).toBe('🐚')
    expect(resolveAckReaction({ identity: { emoji: '🐚' }, ackReaction: '✨' })).toBe('✨')
    // An empty explicit value falls through, like OpenClaw's empty-string handling.
    expect(resolveAckReaction({ ackReaction: '', identity: { emoji: '🐚' } })).toBe('🐚')
  })

  it("renders the response prefix as [name] on 'auto', literal otherwise, and empty without a name", () => {
    expect(resolveResponsePrefix({})).toBe('')
    expect(resolveResponsePrefix({ identity: { name: 'Clawd' } })).toBe('[Clawd]')
    expect(resolveResponsePrefix({ identity: { name: 'Clawd' }, responsePrefix: '>> ' })).toBe('>> ')
    expect(resolveResponsePrefix({ responsePrefix: 'literal' })).toBe('literal')
  })

  it('renders the message prefix from the name only', () => {
    expect(resolveMessagePrefix({})).toBe('')
    expect(resolveMessagePrefix({ identity: { name: 'Clawd' } })).toBe('[Clawd]')
  })

  it('derives mention patterns from a multi-word name and the emoji literal', () => {
    const patterns = deriveMentionPatterns('Clawd Helper', '🐚')
    expect(patterns).toHaveLength(2)
    expect(patterns[0]).toBeInstanceOf(RegExp)
    expect(patterns[0]?.test('@Clawd Helper please')).toBe(true)
    expect(patterns[0]?.test('clawd helper please')).toBe(true)
    expect(patterns[0]?.test('CLAWD   HELPER')).toBe(true)
    expect(patterns[0]?.test('SuperClawd Helper')).toBe(false)
    expect(patterns[1]?.test('see 🐚 here')).toBe(true)
    expect(patterns[1]?.test('no emoji')).toBe(false)
  })

  it('escapes regex metacharacters in the name', () => {
    const [pattern] = deriveMentionPatterns('a.b', undefined)
    expect(pattern?.test('a.b')).toBe(true)
    expect(pattern?.test('axb')).toBe(false)
  })

  it('derives nothing from an absent name and emoji', () => {
    expect(deriveMentionPatterns(undefined, undefined)).toEqual([])
    expect(deriveMentionPatterns('   ', undefined)).toEqual([])
  })

  it('strips mention matches from message text', () => {
    const patterns = deriveMentionPatterns('Clawd', undefined)
    // OpenClaw-faithful: the pattern's `\b` binds after the optional `@`, so the
    // stripped span starts at the name, leaving a bare `@` behind.
    expect(stripMentions('hey @Clawd, do the thing', patterns)).toBe('hey @, do the thing')
    expect(stripMentions('nothing here', patterns)).toBe('nothing here')
  })
})
