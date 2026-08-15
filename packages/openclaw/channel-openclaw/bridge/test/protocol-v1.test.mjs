import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  ProtocolValidationError,
  validateAction,
  validateActionResult,
  validateHandshake,
  validateTurnEnvelope,
} from '../shared/protocol-v1.js'

const fixture = JSON.parse(await readFile(new URL('../fixtures/protocol-v1.json', import.meta.url), 'utf8'))

test('accepts the locked handshake and complete inbound turn', () => {
  assert.equal(validateHandshake(fixture.handshake), fixture.handshake)
  assert.equal(validateTurnEnvelope(fixture.turn), fixture.turn)
})

test('accepts directory and resolve wire variants without advertising them', () => {
  assert.equal(validateAction(fixture.directoryAction), fixture.directoryAction)
  assert.equal(validateActionResult(fixture.resolveResult), fixture.resolveResult)
})

test('requires exact objects and canonical staged media hashes', () => {
  assert.throws(
    () => validateHandshake({ ...fixture.handshake, token: 'must-not-be-inside-handshake' }),
    ProtocolValidationError,
  )
  assert.throws(
    () => validateAction({
      ...fixture.sendAction,
      text: '',
      media: [{
        mediaId: 'media',
        ordinal: 0,
        kind: 'file',
        mediaType: 'application/octet-stream',
        bytes: 1,
        sha256: 'A'.repeat(64),
        relativePath: 'safe.bin',
      }],
    }),
    /canonical lowercase SHA-256/,
  )
})

test('rejects NUL text and route/principal trust inconsistencies', () => {
  assert.throws(() => validateTurnEnvelope({ ...fixture.turn, text: 'before\0after' }), /must not contain NUL/)
  assert.throws(() => validateTurnEnvelope({
    ...fixture.turn,
    route: { ...fixture.turn.route, kind: 'group' },
  }), /group routes require group-allowlisted trust/)
  assert.throws(() => validateTurnEnvelope({
    ...fixture.turn,
    sender: { ...fixture.turn.sender, trust: 'group-allowlisted' },
  }), /direct routes forbid group-allowlisted trust/)
})

test('requires positive directory limits and ordered non-empty resolve inputs', () => {
  assert.throws(() => validateAction({ ...fixture.directoryAction, limit: 0 }), /greater than or equal to 1/)
  const { query: _query, limit: _limit, source: _source, ...base } = fixture.directoryAction
  assert.throws(() => validateAction({
    ...base,
    kind: 'resolve',
    resolveKind: 'user',
    inputs: [],
  }), /expected at least one input/)
})
