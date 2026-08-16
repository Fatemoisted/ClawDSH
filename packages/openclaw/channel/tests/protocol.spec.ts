import { describe, expect, it } from 'vitest'
import {
  CHANNEL_BRIDGE_METHODS_V1,
  CHANNEL_BRIDGE_NOTIFICATIONS_V1,
  CHANNEL_PROTOCOL_VERSION,
  canonicalChannelJson,
  channelActionV1Schema,
  channelActionResultV1Schema,
  channelBridgeHandshakeV1Schema,
  channelDeliveryReceiptV1Schema,
  channelDeliveryReportV1Schema,
  channelHealthV1Schema,
  channelSessionCloseV1Schema,
  channelSessionResetResultV1Schema,
  channelSessionResetV1Schema,
  channelTurnCancelV1Schema,
  channelTurnEnvelopeV1Schema,
  channelTurnNotificationV1Schema,
  channelTurnResultV1Schema,
  deliveryReceiptAdvances,
  sameChannelRoute,
} from '../src/index.ts'
import {
  RAW_ACTION,
  RAW_HANDSHAKE,
  RAW_MEDIA,
  RAW_RECEIPT,
  RAW_REPORT,
  RAW_ROUTE,
  RAW_RESULT,
  RAW_TURN,
} from './fixtures.ts'

const FAILURE = { code: 'DELIVERY_FAILED', message: 'delivery failed', retryable: true } as const

function deliveryReceipt(
  status: 'accepted' | 'retrying' | 'confirmed' | 'ambiguous' | 'dead-letter',
  attempt = 1,
  platformMessageId?: string,
) {
  const failure = status === 'retrying' || status === 'ambiguous' || status === 'dead-letter'
    ? { error: { ...FAILURE, retryable: status === 'retrying' } }
    : {}
  return channelDeliveryReceiptV1Schema.parse({
    protocolVersion: 1,
    deliveryId: 'delivery-helper',
    subject: { kind: 'action', actionId: 'action-helper' },
    attempt,
    ...(platformMessageId === undefined ? {} : { platformMessageId }),
    status,
    ...(status === 'retrying' ? { nextAttemptAt: '2026-08-15T04:00:00Z' } : {}),
    ...failure,
  })
}

function turnWithMedia(media: Record<string, unknown>): Record<string, unknown> {
  return { ...RAW_TURN, media: [{ ...RAW_MEDIA, ...media }] }
}

describe('channel protocol valid payloads', () => {
  it('shares complete route identity, canonical JSON, and monotonic delivery semantics', () => {
    const route = channelSessionCloseV1Schema.parse({
      protocolVersion: 1,
      route: RAW_ROUTE,
      reason: 'shutdown',
    }).route
    expect(sameChannelRoute(route, { ...route })).toBe(true)
    const distinctRoutes = [
      { gatewayInstanceId: 'gateway-2' },
      { openclawSessionKey: 'session-2' },
      { generation: 2 },
      { channel: 'discord' },
      { account: 'account-2' },
      { conversation: 'conversation-2' },
      { thread: 'thread-2' },
      { kind: 'direct' },
    ].map(overrides => channelSessionCloseV1Schema.parse({
      protocolVersion: 1,
      route: { ...RAW_ROUTE, ...overrides },
      reason: 'shutdown',
    }).route)
    for (const candidate of distinctRoutes) expect(sameChannelRoute(route, candidate)).toBe(false)

    expect(canonicalChannelJson({ z: [true, null, 'x'], a: { d: 2, c: false } }))
      .toBe('{"a":{"c":false,"d":2},"z":[true,null,"x"]}')
    expect(canonicalChannelJson(Object.assign(Object.create(null), { b: 1, a: 0 }))).toBe('{"a":0,"b":1}')
    expect(() => canonicalChannelJson(Number.POSITIVE_INFINITY, 'channel-test')).toThrow(
      'channel-test: canonical identity value contains a non-finite number',
    )
    expect(() => canonicalChannelJson(new Date(), 'channel-test')).toThrow(
      'channel-test: canonical identity value is not plain JSON',
    )
    expect(() => canonicalChannelJson(undefined)).toThrow('channel: canonical identity value is not plain JSON')
    expect(canonicalChannelJson({
      replyTo: undefined,
      target: { thread: undefined },
    }, 'channel-openclaw', 'literal')).toBe('{"replyTo":undefined,"target":{"thread":undefined}}')
    expect(() => canonicalChannelJson(Symbol('invalid'), 'channel-openclaw', 'literal')).toThrow(
      'channel-openclaw: canonical identity value is not plain JSON',
    )

    const accepted = deliveryReceipt('accepted', 1)
    expect(deliveryReceiptAdvances(accepted, deliveryReceipt('retrying', 1))).toBe(true)
    expect(deliveryReceiptAdvances(deliveryReceipt('accepted', 2), accepted)).toBe(false)
    expect(deliveryReceiptAdvances(deliveryReceipt('retrying', 2), accepted)).toBe(false)
    expect(deliveryReceiptAdvances(deliveryReceipt('retrying', 2), deliveryReceipt('retrying', 2))).toBe(false)
    expect(deliveryReceiptAdvances(deliveryReceipt('retrying', 2), deliveryReceipt('retrying', 3))).toBe(true)
    expect(deliveryReceiptAdvances(deliveryReceipt('retrying', 2), deliveryReceipt('confirmed', 2))).toBe(true)
    expect(deliveryReceiptAdvances(
      deliveryReceipt('accepted', 1, 'message-1'),
      deliveryReceipt('confirmed', 1, 'message-2'),
    )).toBe(false)
    expect(deliveryReceiptAdvances(
      deliveryReceipt('accepted', 1, 'message-1'),
      deliveryReceipt('confirmed', 1, 'message-1'),
    )).toBe(true)
    for (const status of ['confirmed', 'ambiguous', 'dead-letter'] as const) {
      expect(deliveryReceiptAdvances(deliveryReceipt(status), accepted)).toBe(false)
    }
  })

  it('exports the fixed version and request method names', () => {
    expect(CHANNEL_PROTOCOL_VERSION).toBe(1)
    expect(CHANNEL_BRIDGE_METHODS_V1).toEqual({
      turnRun: 'turn.run',
      turnCancel: 'turn.cancel',
      sessionReset: 'session.reset',
      sessionClose: 'session.close',
      channelAction: 'channel.action',
      healthGet: 'health.get',
    })
    expect(CHANNEL_BRIDGE_NOTIFICATIONS_V1).toEqual({
      turnProgress: 'turn.progress',
      deliveryReport: 'delivery.report',
    })
  })

  it('validates and brands a complete handshake and inbound turn', () => {
    expect(channelBridgeHandshakeV1Schema.parse(RAW_HANDSHAKE)).toEqual(RAW_HANDSHAKE)
    expect(channelTurnEnvelopeV1Schema.parse(RAW_TURN)).toEqual(RAW_TURN)
    expect(channelTurnEnvelopeV1Schema.parse({
      ...RAW_TURN,
      route: { ...RAW_ROUTE, thread: undefined, kind: 'direct' },
      sender: { senderId: 'sender-1', trust: 'admitted' },
      wasMentioned: undefined,
      replyTo: undefined,
      media: [],
      trace: undefined,
    })).toMatchObject({ text: 'hello', media: [], sender: { trust: 'admitted' } })
  })

  it('accepts every terminal turn result', () => {
    const results = [
      RAW_RESULT,
      {
        ...RAW_RESULT,
        status: 'completed',
        text: '',
        media: [RAW_MEDIA],
        usage: undefined,
      },
      {
        protocolVersion: 1,
        turnId: 'turn-1',
        runId: 'run-1',
        replayId: 'replay-2',
        effects: RAW_RESULT.effects,
        status: 'silent',
        sessionId: 'channel-session-1',
      },
      {
        protocolVersion: 1,
        turnId: 'turn-1',
        runId: 'run-1',
        replayId: 'replay-3',
        effects: RAW_RESULT.effects,
        status: 'cancelled',
        reason: 'user stopped the run',
      },
      {
        protocolVersion: 1,
        turnId: 'turn-1',
        runId: 'run-1',
        replayId: 'replay-4',
        effects: RAW_RESULT.effects,
        status: 'failed',
        sessionId: 'channel-session-1',
        error: FAILURE,
      },
    ]
    for (const value of results) expect(channelTurnResultV1Schema.safeParse(value).success).toBe(true)
  })

  it('accepts cancel, reset, reset-result, and close payloads', () => {
    expect(channelTurnCancelV1Schema.parse({
      protocolVersion: 1,
      turnId: 'turn-1',
      runId: 'run-1',
      reason: 'timeout',
    })).toMatchObject({ reason: 'timeout' })
    expect(channelSessionResetV1Schema.parse({
      protocolVersion: 1,
      route: RAW_ROUTE,
      nextGeneration: 1,
      reason: 'new',
    })).toMatchObject({ nextGeneration: 1 })
    expect(channelSessionResetResultV1Schema.parse({
      protocolVersion: 1,
      route: { ...RAW_ROUTE, generation: 1 },
      previousSessionId: 'channel-session-1',
    })).toMatchObject({ previousSessionId: 'channel-session-1' })
    expect(channelSessionCloseV1Schema.parse({
      protocolVersion: 1,
      route: RAW_ROUTE,
      reason: 'shutdown',
    })).toMatchObject({ reason: 'shutdown' })
  })

  it('accepts all mutation, directory, and resolution action variants', () => {
    const base = {
      protocolVersion: 1,
      actionId: 'action-1',
      target: RAW_ACTION.target,
    }
    const actions = [
      RAW_ACTION,
      { ...base, kind: 'edit', messageId: 'message-1', text: '', media: [RAW_MEDIA] },
      { ...base, kind: 'delete', messageId: 'message-1' },
      { ...base, kind: 'react', messageId: 'message-1', reaction: '👀', operation: 'remove' },
      { ...base, kind: 'poll', question: 'Choose', options: ['A', 'B'], multiple: false },
      { ...base, kind: 'typing', active: true },
      { ...base, kind: 'directory.self' },
      { ...base, kind: 'directory.list-peers', query: 'alice', limit: 10, source: 'cached' },
      { ...base, kind: 'directory.list-groups', source: 'live' },
      { ...base, kind: 'directory.list-group-members', groupId: 'group-1', limit: 20 },
      { ...base, kind: 'resolve', resolveKind: 'user', inputs: ['@alice', 'user-2'] },
    ]
    for (const value of actions) expect(channelActionV1Schema.safeParse(value).success).toBe(true)
  })

  it('accepts every delivery state and the turn-only delivery extension', () => {
    const base = {
      protocolVersion: 1,
      deliveryId: 'delivery-1',
      subject: { kind: 'action', actionId: 'action-1' },
      attempt: 1,
    }
    const receipts = [
      { ...base, status: 'accepted' },
      RAW_RECEIPT,
      {
        ...base,
        status: 'retrying',
        nextAttemptAt: '2026-08-15T04:00:00Z',
        error: FAILURE,
      },
      { ...base, status: 'ambiguous', error: FAILURE },
      { ...base, status: 'dead-letter', error: { ...FAILURE, retryable: false } },
    ]
    for (const value of receipts) expect(channelDeliveryReceiptV1Schema.safeParse(value).success).toBe(true)
    expect(channelDeliveryReportV1Schema.parse(RAW_REPORT)).toEqual(RAW_REPORT)
  })

  it('accepts delivery, directory, and target-resolution action results', () => {
    const results = [
      RAW_RECEIPT,
      {
        protocolVersion: 1,
        actionId: 'action-1',
        kind: 'directory',
        entries: [{ kind: 'user', id: 'user-1', name: 'Alice', handle: '@alice', rank: 1 }],
      },
      {
        protocolVersion: 1,
        actionId: 'action-1',
        kind: 'resolve',
        results: [
          { input: '@alice', resolved: true, id: 'user-1', name: 'Alice' },
          { input: '@missing', resolved: false, note: 'not found' },
        ],
      },
    ]
    for (const value of results) expect(channelActionResultV1Schema.safeParse(value).success).toBe(true)
  })

  it('accepts every negotiated progress notification', () => {
    const base = { turnId: 'turn-1', runId: 'run-1', sequence: 0 }
    const notifications = [
      { ...base, kind: 'text.delta', text: 'hello' },
      { ...base, kind: 'reasoning.delta', text: 'checking' },
      { ...base, kind: 'tool', toolCallId: 'call-1', name: 'message', phase: 'started', summary: 'sending' },
      { ...base, kind: 'status', status: 'finalizing' },
    ]
    for (const value of notifications) expect(channelTurnNotificationV1Schema.safeParse(value).success).toBe(true)
  })

  it('accepts a complete sanitized health snapshot', () => {
    const value = {
      protocolVersion: 1,
      status: 'degraded',
      checkedAt: '2026-08-15T12:00:00+08:00',
      handshake: RAW_HANDSHAKE,
      accounts: [{
        channel: 'telegram',
        account: 'account-1',
        status: 'degraded',
        actions: ['send'],
        error: FAILURE,
      }],
      diagnostics: [{ code: 'RECONNECTING', message: 'account is reconnecting' }],
    }
    expect(channelHealthV1Schema.parse(value)).toEqual(value)
  })
})

describe('channel protocol rejection', () => {
  it('rejects unknown fields and unsupported protocol versions', () => {
    expect(channelBridgeHandshakeV1Schema.safeParse({ ...RAW_HANDSHAKE, unexpected: true }).success).toBe(false)
    expect(channelTurnEnvelopeV1Schema.safeParse({ ...RAW_TURN, protocolVersion: 2 }).success).toBe(false)
    expect(channelTurnCancelV1Schema.safeParse({
      protocolVersion: 1,
      turnId: 'turn-1',
      runId: 'run-1',
      reason: 'user',
      unexpected: true,
    }).success).toBe(false)
  })

  it('rejects malformed host identity, padded ids, and duplicate capabilities', () => {
    const cases = [
      { ...RAW_HANDSHAKE, gatewayInstanceId: ' gateway-1' },
      { ...RAW_HANDSHAKE, gatewayInstanceId: '' },
      { ...RAW_HANDSHAKE, openclaw: { ...RAW_HANDSHAKE.openclaw, tag: '   ' } },
      { ...RAW_HANDSHAKE, openclaw: { ...RAW_HANDSHAKE.openclaw, commitSha: 'A'.repeat(40) } },
      { ...RAW_HANDSHAKE, openclaw: { ...RAW_HANDSHAKE.openclaw, artifactSha512: 'b'.repeat(127) } },
      {
        ...RAW_HANDSHAKE,
        capabilities: { ...RAW_HANDSHAKE.capabilities, actions: ['send', 'send'] },
      },
      {
        ...RAW_HANDSHAKE,
        capabilities: { ...RAW_HANDSHAKE.capabilities, notifications: ['status', 'status'] },
      },
      {
        ...RAW_HANDSHAKE,
        capabilities: { ...RAW_HANDSHAKE.capabilities, extensions: ['delivery.report', 'delivery.report'] },
      },
    ]
    for (const value of cases) expect(channelBridgeHandshakeV1Schema.safeParse(value).success).toBe(false)
  })

  it('rejects NUL in opaque identities and presentation strings', () => {
    expect(channelTurnEnvelopeV1Schema.safeParse({
      ...RAW_TURN,
      sender: { ...RAW_TURN.sender, senderId: 'sender\0hidden' },
    }).success).toBe(false)
    expect(channelTurnEnvelopeV1Schema.safeParse({
      ...RAW_TURN,
      sender: { ...RAW_TURN.sender, displayName: 'Alice\0hidden' },
    }).success).toBe(false)
    expect(channelTurnEnvelopeV1Schema.safeParse({ ...RAW_TURN, text: 'hello\0hidden' }).success).toBe(false)
  })

  it('rejects route and principal trust inconsistencies', () => {
    expect(channelTurnEnvelopeV1Schema.safeParse({
      ...RAW_TURN,
      sender: { ...RAW_TURN.sender, trust: 'owner' },
    }).success).toBe(false)
    expect(channelTurnEnvelopeV1Schema.safeParse({
      ...RAW_TURN,
      route: { ...RAW_TURN.route, kind: 'direct' },
    }).success).toBe(false)
    expect(channelTurnEnvelopeV1Schema.safeParse({
      ...RAW_TURN,
      route: { ...RAW_TURN.route, kind: 'direct' },
      sender: { ...RAW_TURN.sender, trust: 'admitted' },
    }).success).toBe(true)
  })

  it('rejects unsafe staging paths and path-bearing display names', () => {
    const unsafePaths = ['/absolute.png', 'a\\b.png', 'a\0b.png', 'C:/drive.png', 'a//b.png', 'a/./b.png', 'a/../b.png']
    for (const relativePath of unsafePaths) {
      expect(channelTurnEnvelopeV1Schema.safeParse(turnWithMedia({ relativePath })).success).toBe(false)
    }
    const unsafeNames = ['.', '..', 'a/b.png', 'a\\b.png', 'a\0b.png']
    for (const name of unsafeNames) {
      expect(channelTurnEnvelopeV1Schema.safeParse(turnWithMedia({ name })).success).toBe(false)
    }
  })

  it('rejects invalid media metadata, discontinuous order, and duplicate media ids', () => {
    expect(channelTurnEnvelopeV1Schema.safeParse(turnWithMedia({ sha256: 'A'.repeat(64) })).success).toBe(false)
    expect(channelTurnEnvelopeV1Schema.safeParse(turnWithMedia({ bytes: 0 })).success).toBe(false)
    expect(channelTurnEnvelopeV1Schema.safeParse(turnWithMedia({ mediaType: 'not-a-media-type' })).success).toBe(false)
    expect(channelTurnEnvelopeV1Schema.safeParse(turnWithMedia({ ordinal: 1 })).success).toBe(false)
    expect(channelTurnEnvelopeV1Schema.safeParse({
      ...RAW_TURN,
      media: [RAW_MEDIA, { ...RAW_MEDIA, ordinal: 1, relativePath: 'gateway-1/media-copy.png' }],
    }).success).toBe(false)
  })

  it('requires text or media for messages and content-producing actions', () => {
    expect(channelTurnEnvelopeV1Schema.safeParse({ ...RAW_TURN, text: '', media: [RAW_MEDIA] }).success).toBe(true)
    expect(channelTurnEnvelopeV1Schema.safeParse({ ...RAW_TURN, text: '', media: [] }).success).toBe(false)
    expect(channelTurnResultV1Schema.safeParse({ ...RAW_RESULT, text: '', media: [] }).success).toBe(false)
    expect(channelActionV1Schema.safeParse({ ...RAW_ACTION, text: '', media: [] }).success).toBe(false)
    expect(channelActionV1Schema.safeParse({
      protocolVersion: 1,
      actionId: 'action-1',
      target: RAW_ACTION.target,
      kind: 'edit',
      messageId: 'message-1',
      text: '',
      media: [],
    }).success).toBe(false)
  })

  it('requires internally consistent durable turn side-effect evidence', () => {
    const legacy = { ...RAW_RESULT } as Record<string, unknown>
    delete legacy.effects
    expect(channelTurnResultV1Schema.safeParse(legacy).success).toBe(false)
    expect(channelTurnResultV1Schema.safeParse({ ...RAW_RESULT, effects: null }).success).toBe(false)
    expect(channelTurnResultV1Schema.safeParse({
      ...RAW_RESULT,
      effects: { ...RAW_RESULT.effects, replaySafe: false },
    }).success).toBe(false)
    expect(channelTurnResultV1Schema.safeParse({
      ...RAW_RESULT,
      effects: { ...RAW_RESULT.effects, didSendViaMessagingTool: true },
    }).success).toBe(false)
    expect(channelTurnResultV1Schema.safeParse({
      ...RAW_RESULT,
      effects: {
        ...RAW_RESULT.effects,
        hadPotentialSideEffects: true,
        replaySafe: false,
        didSendViaMessagingTool: true,
      },
    }).success).toBe(true)
    expect(channelTurnResultV1Schema.safeParse({
      ...RAW_RESULT,
      effects: {
        hadPotentialSideEffects: true,
        replaySafe: false,
        didSendViaMessagingTool: false,
        messagingToolSentTexts: ['sent'],
        messagingToolSentMediaUrls: [],
        messagingToolSentTargets: [{
          tool: 'message', provider: 'telegram', accountId: 'primary', to: 'chat-1', text: 'sent',
        }],
      },
    }).success).toBe(false)
    expect(channelTurnResultV1Schema.safeParse({
      ...RAW_RESULT,
      effects: {
        hadPotentialSideEffects: true,
        replaySafe: false,
        didSendViaMessagingTool: true,
        messagingToolSentTexts: ['different'],
        messagingToolSentMediaUrls: [],
        messagingToolSentTargets: [{
          tool: 'message', provider: 'telegram', accountId: 'primary', to: 'chat-1', text: 'sent',
        }],
      },
    }).success).toBe(false)
    expect(channelTurnResultV1Schema.safeParse({
      ...RAW_RESULT,
      effects: {
        hadPotentialSideEffects: true,
        replaySafe: false,
        didSendViaMessagingTool: true,
        messagingToolSentTexts: ['sent'],
        messagingToolSentMediaUrls: [],
        messagingToolSentTargets: [{
          tool: 'message', provider: 'telegram', accountId: 'primary', to: 'chat-1', text: 'sent',
        }],
      },
    }).success).toBe(true)
  })

  it('rejects stale reset generations and malformed controls', () => {
    expect(channelSessionResetV1Schema.safeParse({
      protocolVersion: 1,
      route: RAW_ROUTE,
      nextGeneration: 0,
      reason: 'reset',
    }).success).toBe(false)
    expect(channelSessionResetV1Schema.safeParse({
      protocolVersion: 1,
      route: RAW_ROUTE,
      nextGeneration: -1,
      reason: 'reset',
    }).success).toBe(false)
    expect(channelSessionResetV1Schema.safeParse({
      protocolVersion: 1,
      route: RAW_ROUTE,
      nextGeneration: Number.MAX_SAFE_INTEGER + 1,
      reason: 'reset',
    }).success).toBe(false)
    expect(channelSessionCloseV1Schema.safeParse({
      protocolVersion: 1,
      route: RAW_ROUTE,
      reason: 'unknown',
    }).success).toBe(false)
  })

  it('rejects incomplete actions and duplicate poll options', () => {
    const base = { protocolVersion: 1, actionId: 'action-1', target: RAW_ACTION.target }
    const invalid = [
      { ...base, kind: 'send', text: 'hello' },
      { ...base, kind: 'edit', messageId: 'message-1', text: 'hello' },
      { ...base, kind: 'delete' },
      { ...base, kind: 'react', messageId: 'message-1', reaction: ' ', operation: 'add' },
      { ...base, kind: 'poll', question: 'Choose', options: ['A', 'A'], multiple: false },
      { ...base, kind: 'poll', question: 'Choose', options: ['A'], multiple: false },
      { ...base, kind: 'typing' },
      { ...base, kind: 'directory.list-peers', source: 'automatic' },
      { ...base, kind: 'directory.list-groups', source: 'cached', limit: 0 },
      { ...base, kind: 'directory.list-group-members', groupId: '' },
      { ...base, kind: 'resolve', resolveKind: 'user', inputs: [] },
      { ...base, kind: 'unknown' },
    ]
    for (const value of invalid) expect(channelActionV1Schema.safeParse(value).success).toBe(false)
  })

  it('rejects mismatched and malformed action results', () => {
    const invalid = [
      RAW_REPORT.receipt,
      {
        protocolVersion: 1,
        actionId: 'action-1',
        kind: 'directory',
        entries: [{ kind: 'user', id: '' }],
      },
      {
        protocolVersion: 1,
        actionId: 'action-1',
        kind: 'resolve',
        results: [{ input: '@alice', resolved: true }],
      },
    ]
    for (const value of invalid) expect(channelActionResultV1Schema.safeParse(value).success).toBe(false)
  })

  it('rejects invalid delivery receipts and action-subject delivery reports', () => {
    expect(channelDeliveryReceiptV1Schema.safeParse({ ...RAW_RECEIPT, attempt: 0 }).success).toBe(false)
    expect(channelDeliveryReceiptV1Schema.safeParse({
      ...RAW_RECEIPT,
      status: 'retrying',
      nextAttemptAt: 'tomorrow',
      error: FAILURE,
    }).success).toBe(false)
    expect(channelDeliveryReportV1Schema.safeParse({
      protocolVersion: 1,
      extension: 'delivery.report',
      receipt: RAW_RECEIPT,
    }).success).toBe(false)
  })

  it('rejects malformed progress and health payloads', () => {
    expect(channelTurnNotificationV1Schema.safeParse({
      kind: 'text.delta',
      turnId: 'turn-1',
      runId: 'run-1',
      sequence: 0,
      text: ' ',
    }).success).toBe(false)
    expect(channelHealthV1Schema.safeParse({
      protocolVersion: 1,
      status: 'ready',
      checkedAt: 'today',
      accounts: [],
      diagnostics: [],
    }).success).toBe(false)
    expect(channelHealthV1Schema.safeParse({
      protocolVersion: 1,
      status: 'ready',
      checkedAt: '2026-08-15T04:00:00Z',
      accounts: [{ channel: 'telegram', account: 'account-1', status: 'ready', actions: ['send', 'send'] }],
      diagnostics: [],
    }).success).toBe(false)
  })
})
