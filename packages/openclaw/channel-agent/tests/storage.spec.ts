import { describe, expect, it } from 'vitest'
import {
  channelDeliveryReceiptV1Schema,
  channelSessionCloseV1Schema,
  channelSessionResetResultV1Schema,
  channelSessionResetV1Schema,
  type ChannelRouteV1,
} from '@clawdsh/dsh-channel'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  bindingKey,
  canonicalJson,
  channelGenerationRecordSchema,
  channelLedgerRecordSchema,
  channelSessionBindingRecordSchema,
  closeRequestDigest,
  digestJson,
  generationKey,
  ledgerKey,
  resetRequestDigest,
  sessionIdFor,
  UNKNOWN_TURN_EFFECTS,
} from '../src/storage.ts'
import { SAFE_TURN_EFFECTS, turn } from './fixtures.ts'

const NOW = 1_776_000_000_000

describe('channel-agent durable schemas', () => {
  it('rejects non-record ledger values without attempting legacy normalization', () => {
    for (const value of [null, 'ledger', []]) {
      expect(channelLedgerRecordSchema.safeParse(value).success).toBe(false)
    }
  })

  it('parses complete binding and generation records while restoring brands', () => {
    const route = turn({ route: { ...turn().route, thread: 'thread-1' } }).route
    const sessionId = sessionIdFor(route)
    expect(channelSessionBindingRecordSchema.parse({
      route,
      sessionId,
      preset: 'messaging-safe',
      state: 'active',
      createdAt: NOW,
      updatedAt: NOW + 1,
    })).toEqual({
      route,
      sessionId,
      preset: 'messaging-safe',
      state: 'active',
      createdAt: NOW,
      updatedAt: NOW + 1,
    })
    expect(channelGenerationRecordSchema.parse({
      gatewayInstanceId: route.gatewayInstanceId,
      openclawSessionKey: route.openclawSessionKey,
      generation: 2,
      closed: false,
      updatedAt: NOW,
    })).toMatchObject({ generation: 2, closed: false })
  })

  it('rejects malformed or temporally inconsistent stored rows', () => {
    const route = turn().route
    const binding = {
      route,
      sessionId: sessionIdFor(route),
      preset: 'safe',
      state: 'active',
      createdAt: NOW,
      updatedAt: NOW,
    }
    expect(() => channelSessionBindingRecordSchema.parse({ ...binding, extra: true })).toThrow()
    expect(() => channelSessionBindingRecordSchema.parse({ ...binding, sessionId: ' padded ' })).toThrow()
    expect(() => channelSessionBindingRecordSchema.parse({ ...binding, sessionId: 'channel:wrong' }))
      .toThrow(/deterministic route binding/)
    expect(() => channelSessionBindingRecordSchema.parse({ ...binding, updatedAt: NOW - 1 })).toThrow(/updatedAt/)
    expect(() => channelSessionBindingRecordSchema.parse({
      ...binding,
      route: { ...route, thread: undefined },
    })).not.toThrow()
    expect(() => channelGenerationRecordSchema.parse({
      gatewayInstanceId: '', openclawSessionKey: 'key', generation: -1, closed: false, updatedAt: NOW,
    })).toThrow()
  })

  it('validates durable reset and close replay records against their current generation', () => {
    const route = turn().route
    const resetRequest = channelSessionResetV1Schema.parse({
      protocolVersion: 1, route, nextGeneration: 1, reason: 'reset',
    })
    const resetResult = channelSessionResetResultV1Schema.parse({
      protocolVersion: 1,
      route: { ...route, generation: 1 },
      previousSessionId: sessionIdFor(route),
    })
    const resetControl = {
      kind: 'reset' as const,
      requestDigest: resetRequestDigest(resetRequest),
      request: resetRequest,
      result: resetResult,
      completedAt: NOW,
    }
    const resetGeneration = {
      gatewayInstanceId: route.gatewayInstanceId,
      openclawSessionKey: route.openclawSessionKey,
      generation: 1,
      closed: false,
      lastControl: resetControl,
      updatedAt: NOW,
    }
    expect(channelGenerationRecordSchema.parse(resetGeneration).lastControl).toEqual(resetControl)
    expect(() => channelGenerationRecordSchema.parse({
      ...resetGeneration, lastControl: { ...resetControl, completedAt: NOW + 1 },
    })).toThrow(/must not follow updatedAt/)
    expect(() => channelGenerationRecordSchema.parse({
      ...resetGeneration, gatewayInstanceId: 'different-gateway',
    })).toThrow(/stored lineage/)
    expect(() => channelGenerationRecordSchema.parse({
      ...resetGeneration, lastControl: { ...resetControl, requestDigest: '0'.repeat(64) },
    })).toThrow(/match the reset request/)
    expect(() => channelGenerationRecordSchema.parse({ ...resetGeneration, generation: 2 }))
      .toThrow(/current open reset generation/)
    expect(() => channelGenerationRecordSchema.parse({
      ...resetGeneration,
      lastControl: { ...resetControl, result: { ...resetResult, route } },
    })).toThrow(/acknowledge the reset successor/)
    expect(() => channelGenerationRecordSchema.parse({
      ...resetGeneration,
      lastControl: {
        ...resetControl,
        result: { ...resetResult, previousSessionId: SessionId('channel:different') },
      },
    })).toThrow(/retired route Session/)

    const closeRequest = channelSessionCloseV1Schema.parse({
      protocolVersion: 1, route, reason: 'shutdown',
    })
    const closeControl = {
      kind: 'close' as const,
      requestDigest: closeRequestDigest(closeRequest),
      request: closeRequest,
      completedAt: NOW,
    }
    const closeGeneration = {
      gatewayInstanceId: route.gatewayInstanceId,
      openclawSessionKey: route.openclawSessionKey,
      generation: 0,
      closed: true,
      lastControl: closeControl,
      updatedAt: NOW,
    }
    expect(channelGenerationRecordSchema.parse(closeGeneration).lastControl).toEqual(closeControl)
    expect(() => channelGenerationRecordSchema.parse({
      ...closeGeneration, lastControl: { ...closeControl, requestDigest: '0'.repeat(64) },
    })).toThrow(/match the close request/)
    expect(() => channelGenerationRecordSchema.parse({ ...closeGeneration, closed: false }))
      .toThrow(/current closed generation/)
  })

  it('enforces ledger state requirements and receipt ownership', () => {
    const envelope = turn()
    const accepted = {
      envelopeDigest: digestJson(envelope),
      envelope,
      phase: 'accepted',
      createdAt: NOW,
      updatedAt: NOW,
    }
    expect(channelLedgerRecordSchema.parse(accepted)).toEqual(accepted)
    expect(channelLedgerRecordSchema.parse({ ...accepted, cancelRequested: 'timeout' }).cancelRequested).toBe('timeout')
    expect(() => channelLedgerRecordSchema.parse({ ...accepted, cancelRequested: 'unknown' })).toThrow()
    expect(() => channelLedgerRecordSchema.parse({ ...accepted, updatedAt: NOW - 1 })).toThrow(/updatedAt/)
    expect(() => channelLedgerRecordSchema.parse({ ...accepted, envelopeDigest: '0'.repeat(64) }))
      .toThrow(/stored envelope/)
    expect(() => channelLedgerRecordSchema.parse({ ...accepted, phase: 'running' })).toThrow(/sessionId/)
    expect(() => channelLedgerRecordSchema.parse({ ...accepted, phase: 'needs-recovery' })).toThrow(/sessionId/)
    expect(() => channelLedgerRecordSchema.parse({
      ...accepted, phase: 'completed', sessionId: 'channel:one',
    })).toThrow(/result/)

    const result = {
      protocolVersion: 1,
      turnId: envelope.turnId,
      runId: envelope.runId,
      replayId: 'replay-1',
      effects: SAFE_TURN_EFFECTS,
      status: 'silent',
      sessionId: 'channel:one',
    }
    const legacyResult: Record<string, unknown> = { ...result }
    delete legacyResult.effects
    expect(channelLedgerRecordSchema.parse({
      ...accepted,
      phase: 'completed',
      sessionId: 'channel:one',
      result: legacyResult,
    }).result?.effects).toEqual(UNKNOWN_TURN_EFFECTS)
    expect(() => channelLedgerRecordSchema.parse({
      ...accepted,
      phase: 'completed',
      sessionId: 'channel:one',
      result: { ...result, effects: { hadPotentialSideEffects: true } },
    })).toThrow(/effects/)
    expect(() => channelLedgerRecordSchema.parse({ ...accepted, result })).toThrow(/forbidden/)
    expect(() => channelLedgerRecordSchema.parse({
      ...accepted,
      phase: 'completed',
      sessionId: 'channel:one',
      result: { ...result, turnId: 'other-turn' },
    })).toThrow(/stored turn and run/)
    expect(() => channelLedgerRecordSchema.parse({
      ...accepted,
      phase: 'completed',
      sessionId: 'channel:one',
      result: { ...result, sessionId: 'channel:other' },
    })).toThrow(/durable route Session/)
    expect(() => channelLedgerRecordSchema.parse({
      ...accepted, phase: 'delivered', result,
    })).toThrow(/sessionId|delivery/)
    const actionReceipt = channelDeliveryReceiptV1Schema.parse({
      protocolVersion: 1,
      deliveryId: 'delivery-action',
      subject: { kind: 'action', actionId: 'action-1' },
      attempt: 1,
      status: 'confirmed',
    })
    expect(() => channelLedgerRecordSchema.parse({
      ...accepted,
      phase: 'delivered',
      sessionId: 'channel:one',
      result,
      delivery: actionReceipt,
    })).toThrow(/final turn/)
    const turnReceipt = channelDeliveryReceiptV1Schema.parse({
      protocolVersion: 1,
      deliveryId: 'delivery-turn',
      subject: { kind: 'turn', turnId: envelope.turnId, runId: envelope.runId },
      attempt: 1,
      status: 'confirmed',
    })
    const legacyDelivered = channelLedgerRecordSchema.parse({
      ...accepted,
      phase: 'delivered',
      sessionId: 'channel:one',
      result: legacyResult,
      delivery: turnReceipt,
      updatedAt: NOW + 1,
    })
    expect(legacyDelivered.phase).toBe('delivered')
    expect(legacyDelivered.result?.effects).toEqual(UNKNOWN_TURN_EFFECTS)
    expect(() => channelLedgerRecordSchema.parse({
      ...accepted,
      phase: 'delivered',
      sessionId: 'channel:one',
      result,
      delivery: { ...turnReceipt, status: 'accepted' },
      updatedAt: NOW + 1,
    })).toThrow(/does not match ledger phase/)
    expect(() => channelLedgerRecordSchema.parse({
      ...accepted,
      phase: 'delivered',
      sessionId: 'channel:one',
      result,
      delivery: {
        ...turnReceipt,
        subject: { kind: 'turn', turnId: 'other-turn', runId: envelope.runId },
      },
      updatedAt: NOW + 1,
    })).toThrow(/stored turn and run/)

    const acceptedReceipt = { ...turnReceipt, status: 'accepted' as const }
    expect(channelLedgerRecordSchema.parse({
      ...accepted,
      phase: 'completed',
      sessionId: 'channel:one',
      result,
      delivery: acceptedReceipt,
    }).delivery?.status).toBe('accepted')
    const retryingReceipt = {
      ...turnReceipt,
      status: 'retrying' as const,
      nextAttemptAt: '2026-04-14T00:00:00Z',
      error: { code: 'RETRY', message: 'retry later', retryable: true },
    }
    expect(channelLedgerRecordSchema.parse({
      ...accepted,
      phase: 'completed',
      sessionId: 'channel:one',
      result,
      delivery: retryingReceipt,
    }).delivery?.status).toBe('retrying')
    const ambiguousReceipt = {
      ...turnReceipt,
      status: 'ambiguous' as const,
      error: { code: 'UNKNOWN', message: 'confirmation was lost', retryable: false },
    }
    expect(channelLedgerRecordSchema.parse({
      ...accepted,
      phase: 'ambiguous',
      sessionId: 'channel:one',
      result,
      delivery: ambiguousReceipt,
    }).delivery?.status).toBe('ambiguous')
    const deadLetterReceipt = {
      ...turnReceipt,
      status: 'dead-letter' as const,
      error: { code: 'REJECTED', message: 'delivery was rejected', retryable: false },
    }
    expect(channelLedgerRecordSchema.parse({
      ...accepted,
      phase: 'dead-letter',
      sessionId: 'channel:one',
      result,
      delivery: deadLetterReceipt,
    }).delivery?.status).toBe('dead-letter')
    expect(() => channelLedgerRecordSchema.parse({
      ...accepted,
      delivery: turnReceipt,
    })).toThrow(/does not match ledger phase/)
  })

  it('normalizes legacy effects across every terminal result and delivery phase', () => {
    const envelope = turn()
    const sessionId = 'channel:one'
    const resultBase = {
      protocolVersion: 1,
      turnId: envelope.turnId,
      runId: envelope.runId,
      sessionId,
    }
    const results = [
      { ...resultBase, replayId: 'legacy-completed', status: 'completed', text: 'done', media: [] },
      { ...resultBase, replayId: 'legacy-silent', status: 'silent' },
      { ...resultBase, replayId: 'legacy-cancelled', status: 'cancelled', reason: 'cancelled' },
      {
        ...resultBase,
        replayId: 'legacy-failed',
        status: 'failed',
        error: { code: 'LEGACY_FAILURE', message: 'legacy failure', retryable: false },
      },
    ]
    const receipt = (status: 'confirmed' | 'ambiguous' | 'dead-letter') => ({
      protocolVersion: 1,
      deliveryId: `delivery-${status}`,
      subject: { kind: 'turn', turnId: envelope.turnId, runId: envelope.runId },
      attempt: 1,
      status,
      ...(status === 'confirmed' ? {} : {
        error: { code: 'LEGACY_DELIVERY', message: 'legacy delivery outcome', retryable: false },
      }),
    })
    const phases = [
      { phase: 'completed' },
      { phase: 'delivered', delivery: receipt('confirmed') },
      { phase: 'ambiguous', delivery: receipt('ambiguous') },
      { phase: 'dead-letter', delivery: receipt('dead-letter') },
    ]
    for (const result of results) {
      for (const phase of phases) {
        const parsed = channelLedgerRecordSchema.parse({
          envelopeDigest: digestJson(envelope),
          envelope,
          ...phase,
          sessionId,
          result,
          createdAt: NOW,
          updatedAt: NOW,
        })
        expect(parsed.result?.effects).toEqual(UNKNOWN_TURN_EFFECTS)
      }
    }
  })
})

describe('channel-agent durable identities', () => {
  it('canonicalizes JSON recursively and rejects values that cannot be losslessly persisted', () => {
    expect(canonicalJson({ z: [true, null, 'x'], a: { d: 2, c: false } }))
      .toBe('{"a":{"c":false,"d":2},"z":[true,null,"x"]}')
    expect(canonicalJson(Object.assign(Object.create(null), { b: 1, a: 0 })))
      .toBe('{"a":0,"b":1}')
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(
      'channel-agent: canonical identity value contains a non-finite number',
    )
    expect(() => canonicalJson(new Date())).toThrow('channel-agent: canonical identity value is not plain JSON')
    expect(() => canonicalJson(undefined)).toThrow('channel-agent: canonical identity value is not plain JSON')
  })

  it('derives stable, scope-separated binding, generation, ledger, and Session identities', () => {
    const envelope = turn()
    const route = envelope.route
    const reordered: ChannelRouteV1 = {
      kind: route.kind,
      conversation: route.conversation,
      account: route.account,
      channel: route.channel,
      generation: route.generation,
      openclawSessionKey: route.openclawSessionKey,
      gatewayInstanceId: route.gatewayInstanceId,
    }
    expect(bindingKey(route)).toBe(bindingKey(reordered))
    expect(generationKey(route)).not.toBe(bindingKey(route))
    expect(ledgerKey(envelope)).not.toBe(bindingKey(route))
    expect(sessionIdFor(route)).toBe(SessionId(`channel:${bindingKey(route)}`))
    expect(digestJson({ a: 1, b: 2 })).toBe(digestJson({ b: 2, a: 1 }))
    expect(bindingKey({ ...route, generation: 1 })).not.toBe(bindingKey(route))
    const laterGeneration: ChannelRouteV1 = { ...route, generation: 99 }
    expect(generationKey(laterGeneration)).toBe(generationKey(route))
    expect(ledgerKey({ ...envelope, idempotencyKey: envelope.idempotencyKey })).toBe(ledgerKey(envelope))
    const reset = channelSessionResetV1Schema.parse({
      protocolVersion: 1, route, nextGeneration: 1, reason: 'new',
    })
    const close = channelSessionCloseV1Schema.parse({ protocolVersion: 1, route, reason: 'gateway' })
    expect(resetRequestDigest(reset)).toMatch(/^[a-f0-9]{64}$/)
    expect(resetRequestDigest(reset)).not.toBe(resetRequestDigest({ ...reset, reason: 'reset' }))
    expect(closeRequestDigest(close)).not.toBe(closeRequestDigest({ ...close, reason: 'shutdown' }))
  })
})
