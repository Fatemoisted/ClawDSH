import {
  channelDeliveryReportV1Schema,
  channelTurnEnvelopeV1Schema,
  type ChannelDeliveryReportV1,
  type ChannelTurnEnvelopeV1,
} from '@clawdsh/dsh-channel'

/** Produce one strict, admitted text turn with deterministic identities. */
export function turn(overrides: Record<string, unknown> = {}): ChannelTurnEnvelopeV1 {
  const base = {
    protocolVersion: 1,
    idempotencyKey: 'inbound-1',
    turnId: 'turn-1',
    runId: 'run-1',
    route: {
      gatewayInstanceId: 'gateway-1',
      openclawSessionKey: 'openclaw-session-1',
      generation: 0,
      channel: 'telegram',
      account: 'account-1',
      conversation: 'conversation-1',
      kind: 'direct',
    },
    sender: { senderId: 'sender-1', displayName: 'Alice', trust: 'owner' },
    messageId: 'message-1',
    text: 'hello',
    media: [],
  }
  return channelTurnEnvelopeV1Schema.parse({ ...base, ...overrides })
}

/** Produce one final-turn delivery report for the default turn identity. */
export function report(overrides: Record<string, unknown> = {}): ChannelDeliveryReportV1 {
  return channelDeliveryReportV1Schema.parse({
    protocolVersion: 1,
    extension: 'delivery.report',
    receipt: {
      protocolVersion: 1,
      deliveryId: 'delivery-1',
      subject: { kind: 'turn', turnId: 'turn-1', runId: 'run-1' },
      attempt: 1,
      platformMessageId: 'platform-message-1',
      status: 'confirmed',
      ...overrides,
    },
  })
}
