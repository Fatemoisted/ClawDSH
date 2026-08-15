import {
  channelActionV1Schema,
  channelActionDeliveryReceiptV1Schema,
  channelDeliveryReportV1Schema,
  channelHealthV1Schema,
  channelSessionCloseV1Schema,
  channelSessionResetV1Schema,
  channelTurnCancelV1Schema,
  channelTurnEnvelopeV1Schema,
  channelTurnResultV1Schema,
  type ChannelActionV1,
  type ChannelActionDeliveryReceiptV1,
  type ChannelDeliveryReportV1,
  type ChannelHealthV1,
  type ChannelSessionCloseV1,
  type ChannelSessionResetV1,
  type ChannelTurnCancelV1,
  type ChannelTurnEnvelopeV1,
  type ChannelTurnResultV1,
} from '../src/index.ts'

export const RAW_ROUTE = {
  gatewayInstanceId: 'gateway-1',
  openclawSessionKey: 'openclaw-session-1',
  generation: 0,
  channel: 'telegram',
  account: 'account-1',
  conversation: 'conversation-1',
  thread: 'thread-1',
  kind: 'group',
} as const

export const RAW_MEDIA = {
  mediaId: 'media-1',
  ordinal: 0,
  kind: 'image',
  mediaType: 'image/png',
  bytes: 68,
  sha256: 'a'.repeat(64),
  relativePath: 'gateway-1/media-1.png',
  name: 'photo.png',
} as const

export const RAW_HANDSHAKE = {
  protocolVersion: 1,
  gatewayInstanceId: 'gateway-1',
  openclaw: {
    tag: 'v2026.7.1-2',
    commitSha: 'a'.repeat(40),
    artifactSha512: 'b'.repeat(128),
    nodeEngine: '^22.19 || >=24',
  },
  agentHarness: 'v1',
  capabilities: {
    actions: ['send', 'react'],
    notifications: ['text.delta', 'status'],
    extensions: ['delivery.report'],
  },
  startupNonce: 'startup-nonce-1',
} as const

export const RAW_TURN = {
  protocolVersion: 1,
  idempotencyKey: 'inbound-1',
  turnId: 'turn-1',
  runId: 'run-1',
  route: RAW_ROUTE,
  sender: {
    senderId: 'sender-1',
    displayName: 'Alice',
    trust: 'group-allowlisted',
  },
  wasMentioned: true,
  messageId: 'message-1',
  replyTo: { messageId: 'message-0', senderId: 'sender-0' },
  text: 'hello',
  media: [RAW_MEDIA],
  trace: { traceId: 'trace-1', parentTraceId: 'trace-0' },
} as const

export const RAW_RESULT = {
  protocolVersion: 1,
  turnId: 'turn-1',
  runId: 'run-1',
  replayId: 'replay-1',
  status: 'completed',
  sessionId: 'channel-session-1',
  text: 'reply',
  media: [],
  usage: { inputTokens: 4, outputTokens: 2, cacheReadTokens: 1, cacheWriteTokens: 0, reasoningTokens: 1 },
} as const

export const RAW_ACTION = {
  protocolVersion: 1,
  actionId: 'action-1',
  target: {
    gatewayInstanceId: 'gateway-1',
    channel: 'telegram',
    account: 'account-1',
    conversation: 'conversation-1',
    thread: 'thread-1',
  },
  kind: 'send',
  text: 'reply',
  media: [],
  replyTo: 'message-1',
} as const

export const RAW_RECEIPT = {
  protocolVersion: 1,
  deliveryId: 'delivery-1',
  subject: { kind: 'action', actionId: 'action-1' },
  attempt: 1,
  platformMessageId: 'message-2',
  status: 'confirmed',
} as const

export const RAW_REPORT = {
  protocolVersion: 1,
  extension: 'delivery.report',
  receipt: {
    ...RAW_RECEIPT,
    subject: { kind: 'turn', turnId: 'turn-1', runId: 'run-1' },
  },
} as const

export function turn(): ChannelTurnEnvelopeV1 {
  return channelTurnEnvelopeV1Schema.parse(RAW_TURN)
}

export function result(): ChannelTurnResultV1 {
  return channelTurnResultV1Schema.parse(RAW_RESULT)
}

export function action(): ChannelActionV1 {
  return channelActionV1Schema.parse(RAW_ACTION)
}

export function receipt(): ChannelActionDeliveryReceiptV1 {
  return channelActionDeliveryReceiptV1Schema.parse(RAW_RECEIPT)
}

export function report(): ChannelDeliveryReportV1 {
  return channelDeliveryReportV1Schema.parse(RAW_REPORT)
}

export function health(): ChannelHealthV1 {
  return channelHealthV1Schema.parse({
    protocolVersion: 1,
    status: 'ready',
    checkedAt: '2026-08-15T12:00:00+08:00',
    handshake: RAW_HANDSHAKE,
    accounts: [{
      channel: 'telegram',
      account: 'account-1',
      status: 'ready',
      actions: ['send', 'react'],
    }],
    diagnostics: [],
  })
}

export function cancelRequest(): ChannelTurnCancelV1 {
  return channelTurnCancelV1Schema.parse({
    protocolVersion: 1,
    turnId: 'turn-1',
    runId: 'run-1',
    reason: 'user',
  })
}

export function resetRequest(): ChannelSessionResetV1 {
  return channelSessionResetV1Schema.parse({
    protocolVersion: 1,
    route: RAW_ROUTE,
    nextGeneration: 1,
    reason: 'reset',
  })
}

export function closeRequest(): ChannelSessionCloseV1 {
  return channelSessionCloseV1Schema.parse({
    protocolVersion: 1,
    route: RAW_ROUTE,
    reason: 'gateway',
  })
}
