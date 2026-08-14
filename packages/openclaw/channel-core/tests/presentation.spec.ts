/**
 * Contract tests for channel identity presentation, keyless pure-function
 * cases ported from OpenClaw's resolution semantics: ack emoji fallback
 * chain, `'auto'` → `[name]` prefixes, and mention-pattern derivation.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ACK_REACTION,
  DEFAULT_ACK_REACTION_SCOPE,
  deriveMentionPatterns,
  resolveAckReaction,
  resolveMessagePrefix,
  resolveResponsePrefix,
  shouldAckReaction,
  stripMentions,
  stripZeroWidth,
} from '../src/presentation.ts'

describe('channel identity presentation', () => {
  it('resolves the ack reaction through explicit → identity.emoji → default', () => {
    expect(resolveAckReaction({})).toBe(DEFAULT_ACK_REACTION)
    expect(resolveAckReaction({ identity: { emoji: '🐚' } })).toBe('🐚')
    expect(resolveAckReaction({ identity: { emoji: '🐚' }, ackReaction: '✨' })).toBe('✨')
    // An explicit empty string disables acks (OpenClaw semantics): it no longer
    // falls through to the emoji fallback.
    expect(resolveAckReaction({ ackReaction: '', identity: { emoji: '🐚' } })).toBe('')
  })

  it('defaults the ack scope to group-mentions', () => {
    expect(DEFAULT_ACK_REACTION_SCOPE).toBe('group-mentions')
  })

  it('strips zero-width and bidi characters', () => {
    expect(stripZeroWidth('a​b')).toBe('ab')
    expect(stripZeroWidth('plain')).toBe('plain')
  })

  it('gates the ack reaction across every scope', () => {
    // scope, isGroup, requireMention, canDetectMention, wasMentioned → expected
    const cases: Array<[Parameters<typeof shouldAckReaction>, boolean]> = [
      // all acks everything, regardless of group or mention.
      [['all', false, true, true, false], true],
      [['all', true, true, true, false], true],
      // direct acks non-group chats only.
      [['direct', false, true, true, false], true],
      [['direct', true, true, true, true], false],
      // group-all acks groups unconditionally.
      [['group-all', true, true, true, false], true],
      [['group-all', false, true, true, true], false],
      // group-mentions acks groups only when a mention was detected.
      [['group-mentions', true, true, true, true], true],
      [['group-mentions', true, true, true, false], false],
      [['group-mentions', false, true, true, true], false],
      // requireMention off does not turn group-mentions into group-all.
      [['group-mentions', true, false, true, false], false],
      // undetectable mentions fail open: no ack, never a blocked message.
      [['group-mentions', true, true, false, false], false],
    ]
    for (const [args, expected] of cases) {
      expect(shouldAckReaction(...args)).toBe(expected)
    }
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
