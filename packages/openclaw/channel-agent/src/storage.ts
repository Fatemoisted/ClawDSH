/** Durable route mapping and idempotency ledger. @module @clawdsh/dsh-channel-agent/storage */

import { z, type RefinementCtx } from 'zod'
import {
  ChannelAccountId,
  ChannelConversationId,
  ChannelId,
  ChannelThreadId,
  GatewayInstanceId,
  OpenClawSessionKey,
  canonicalJson,
  channelDeliveryReceiptV1Schema,
  channelSessionCloseV1Schema,
  channelSessionResetResultV1Schema,
  channelSessionResetV1Schema,
  channelTurnEnvelopeV1Schema,
  channelTurnResultV1Schema,
  digestJson,
  type ChannelRouteV1,
  type ChannelSessionCloseV1,
  type ChannelSessionResetV1,
  type ChannelTurnEnvelopeV1,
} from '@clawdsh/dsh-channel'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

const safeTimestampSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/)
const timestampRecordShape = {
  createdAt: safeTimestampSchema,
  updatedAt: safeTimestampSchema,
}

/** Reject a record whose last-update time predates its creation. */
function validateTimestampOrder(
  record: { readonly createdAt: number; readonly updatedAt: number },
  ctx: RefinementCtx,
): void {
  if (record.updatedAt < record.createdAt) {
    ctx.addIssue({ code: 'custom', path: ['updatedAt'], message: 'must not precede createdAt' })
  }
}

export { canonicalJson, digestJson }

/** Reject blank or padded opaque ids before restoring their brands. */
function opaqueId<T extends string>(factory: (value: string) => T): z.ZodType<T> {
  return z.string().min(1)
    .refine(value => value.trim() === value, 'must not have surrounding whitespace')
    .transform(factory)
}

const routeSchema = z.object({
  gatewayInstanceId: opaqueId(GatewayInstanceId),
  openclawSessionKey: opaqueId(OpenClawSessionKey),
  generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  channel: opaqueId(ChannelId),
  account: opaqueId(ChannelAccountId),
  conversation: opaqueId(ChannelConversationId),
  thread: opaqueId(ChannelThreadId).optional(),
  kind: z.enum(['direct', 'group']),
}).strict().transform((route): ChannelRouteV1 => ({
  gatewayInstanceId: route.gatewayInstanceId,
  openclawSessionKey: route.openclawSessionKey,
  generation: route.generation,
  channel: route.channel,
  account: route.account,
  conversation: route.conversation,
  ...(route.thread === undefined ? {} : { thread: route.thread }),
  kind: route.kind,
})) satisfies z.ZodType<ChannelRouteV1>

/** Durable schema for one route-to-Session binding. */
export const channelSessionBindingRecordSchema = z.object({
  route: routeSchema,
  sessionId: opaqueId(SessionId),
  preset: z.string().min(1),
  state: z.enum(['active', 'closed']),
  ...timestampRecordShape,
}).strict().superRefine((record, ctx) => {
  validateTimestampOrder(record, ctx)
  if (record.sessionId !== sessionIdFor(record.route)) {
    ctx.addIssue({ code: 'custom', path: ['sessionId'], message: 'must match the deterministic route binding' })
  }
})

/** One durable route-to-Session binding. */
export type ChannelSessionBindingRecord = z.infer<typeof channelSessionBindingRecordSchema>

const resetControlRecordSchema = z.object({
  kind: z.literal('reset'),
  requestDigest: digestSchema,
  request: channelSessionResetV1Schema,
  result: channelSessionResetResultV1Schema,
  completedAt: safeTimestampSchema,
}).strict()

const closeControlRecordSchema = z.object({
  kind: z.literal('close'),
  requestDigest: digestSchema,
  request: channelSessionCloseV1Schema,
  completedAt: safeTimestampSchema,
}).strict()

const controlRecordSchema = z.discriminatedUnion('kind', [resetControlRecordSchema, closeControlRecordSchema])

/** Durable schema for the accepted generation and latest control of one Gateway/OpenClaw session lineage. */
export const channelGenerationRecordSchema = z.object({
  gatewayInstanceId: opaqueId(GatewayInstanceId),
  openclawSessionKey: opaqueId(OpenClawSessionKey),
  generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  closed: z.boolean(),
  lastControl: controlRecordSchema.optional(),
  updatedAt: safeTimestampSchema,
}).strict().superRefine((record, ctx) => {
  const control = record.lastControl
  if (control === undefined) return
  if (control.completedAt > record.updatedAt) {
    ctx.addIssue({ code: 'custom', path: ['lastControl', 'completedAt'], message: 'must not follow updatedAt' })
  }
  if (control.request.route.gatewayInstanceId !== record.gatewayInstanceId
    || control.request.route.openclawSessionKey !== record.openclawSessionKey) {
    ctx.addIssue({ code: 'custom', path: ['lastControl', 'request', 'route'], message: 'must identify the stored lineage' })
  }
  if (control.kind === 'reset') {
    if (control.requestDigest !== resetRequestDigest(control.request)) {
      ctx.addIssue({ code: 'custom', path: ['lastControl', 'requestDigest'], message: 'must match the reset request' })
    }
    if (record.generation !== control.request.nextGeneration || record.closed) {
      ctx.addIssue({ code: 'custom', path: ['lastControl'], message: 'must describe the current open reset generation' })
    }
    const expectedRoute = { ...control.request.route, generation: control.request.nextGeneration }
    if (digestJson(routeIdentity(control.result.route)) !== digestJson(routeIdentity(expectedRoute))) {
      ctx.addIssue({ code: 'custom', path: ['lastControl', 'result', 'route'], message: 'must acknowledge the reset successor' })
    }
    if (control.result.previousSessionId !== undefined
      && control.result.previousSessionId !== sessionIdFor(control.request.route)) {
      ctx.addIssue({ code: 'custom', path: ['lastControl', 'result', 'previousSessionId'], message: 'must identify the retired route Session' })
    }
  } else {
    if (control.requestDigest !== closeRequestDigest(control.request)) {
      ctx.addIssue({ code: 'custom', path: ['lastControl', 'requestDigest'], message: 'must match the close request' })
    }
    if (record.generation !== control.request.route.generation || !record.closed) {
      ctx.addIssue({ code: 'custom', path: ['lastControl'], message: 'must describe the current closed generation' })
    }
  }
})

/** Current generation accepted for one Gateway/OpenClaw session lineage. */
export type ChannelGenerationRecord = z.infer<typeof channelGenerationRecordSchema>

const ledgerPhaseSchema = z.enum([
  'accepted',
  'running',
  'completed',
  'delivered',
  'ambiguous',
  'dead-letter',
  'needs-recovery',
])

/** Durable schema for one idempotent inbound turn and its delivery state. */
export const channelLedgerRecordSchema = z.object({
  envelopeDigest: digestSchema,
  envelope: channelTurnEnvelopeV1Schema,
  phase: ledgerPhaseSchema,
  cancelRequested: z.enum(['user', 'timeout', 'gateway-shutdown']).optional(),
  sessionId: opaqueId(SessionId).optional(),
  result: channelTurnResultV1Schema.optional(),
  delivery: channelDeliveryReceiptV1Schema.optional(),
  ...timestampRecordShape,
}).strict().superRefine((record, ctx) => {
  validateTimestampOrder(record, ctx)
  if (digestJson(record.envelope) !== record.envelopeDigest) {
    ctx.addIssue({ code: 'custom', path: ['envelopeDigest'], message: 'must match the stored envelope' })
  }
  if (record.phase !== 'accepted' && record.sessionId === undefined) {
    ctx.addIssue({ code: 'custom', path: ['sessionId'], message: `is required in phase ${record.phase}` })
  }
  const terminalResult = ['completed', 'delivered', 'ambiguous', 'dead-letter'].includes(record.phase)
  if (terminalResult && record.result === undefined) {
    ctx.addIssue({ code: 'custom', path: ['result'], message: `is required in phase ${record.phase}` })
  }
  if (!terminalResult && record.result !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['result'], message: `is forbidden in phase ${record.phase}` })
  }
  if (record.result !== undefined) {
    if (record.result.turnId !== record.envelope.turnId || record.result.runId !== record.envelope.runId) {
      ctx.addIssue({ code: 'custom', path: ['result'], message: 'must identify the stored turn and run' })
    }
    if (record.result.sessionId === undefined || record.result.sessionId !== record.sessionId) {
      ctx.addIssue({ code: 'custom', path: ['result', 'sessionId'], message: 'must match the durable route Session' })
    }
  }
  const terminalDelivery = record.phase === 'delivered' || record.phase === 'ambiguous' || record.phase === 'dead-letter'
  if (terminalDelivery && record.delivery === undefined) {
    ctx.addIssue({ code: 'custom', path: ['delivery'], message: `is required in phase ${record.phase}` })
  }
  if (record.delivery !== undefined) {
    if (record.delivery.subject.kind !== 'turn') {
      ctx.addIssue({ code: 'custom', path: ['delivery', 'subject'], message: 'must identify a final turn' })
    } else if (record.delivery.subject.turnId !== record.envelope.turnId
      || record.delivery.subject.runId !== record.envelope.runId) {
      ctx.addIssue({ code: 'custom', path: ['delivery', 'subject'], message: 'must identify the stored turn and run' })
    }
    const statusMatchesPhase = record.phase === 'completed'
      ? record.delivery.status === 'accepted' || record.delivery.status === 'retrying'
      : record.phase === 'delivered'
        ? record.delivery.status === 'confirmed'
        : record.phase === 'ambiguous'
          ? record.delivery.status === 'ambiguous'
          : record.phase === 'dead-letter' && record.delivery.status === 'dead-letter'
    if (!statusMatchesPhase) {
      ctx.addIssue({ code: 'custom', path: ['delivery', 'status'], message: `does not match ledger phase ${record.phase}` })
    }
  }
})

/** Durable execution/delivery state for one idempotent inbound turn. */
export type ChannelLedgerRecord = z.infer<typeof channelLedgerRecordSchema>

/** Channel-agent domain declaration. Schema version changes reject old incompatible state. */
export const channelAgentDomainSpec = defineDomain({
  name: 'clawdsh_channel_agent',
  version: 2,
  tables: {
    bindings: domainTable<string, ChannelSessionBindingRecord>(channelSessionBindingRecordSchema),
    generations: domainTable<string, ChannelGenerationRecord>(channelGenerationRecordSchema),
    ledger: domainTable<string, ChannelLedgerRecord>(channelLedgerRecordSchema),
  },
})

/**
 * Derive the durable key for one route generation.
 * @param route - Gateway/session lineage and exact generation.
 * @returns Scope-separated binding-table key.
 */
export function bindingKey(route: Pick<ChannelRouteV1, 'gatewayInstanceId' | 'openclawSessionKey' | 'generation'>): string {
  return digestJson([route.gatewayInstanceId, route.openclawSessionKey, route.generation])
}

/**
 * Derive the durable key for the current generation of one OpenClaw session lineage.
 * @param route - Gateway and OpenClaw session lineage.
 * @returns Scope-separated generation-table key.
 */
export function generationKey(route: Pick<ChannelRouteV1, 'gatewayInstanceId' | 'openclawSessionKey'>): string {
  return digestJson([route.gatewayInstanceId, route.openclawSessionKey])
}

/**
 * Derive the durable key for one Gateway-scoped idempotency key.
 * @param turn - Gateway identity and inbound idempotency identity.
 * @returns Scope-separated ledger-table key.
 */
export function ledgerKey(turn: Pick<ChannelTurnEnvelopeV1, 'idempotencyKey' | 'route'>): string {
  return digestJson([turn.route.gatewayInstanceId, turn.idempotencyKey])
}

/**
 * Derive the exact durable identity of one reset request without optional-undefined ambiguity.
 * @param request - Reset request received from the authenticated bridge.
 * @returns Lowercase hexadecimal SHA-256 digest.
 */
export function resetRequestDigest(request: ChannelSessionResetV1): string {
  return digestJson(['session.reset', routeIdentity(request.route), request.nextGeneration, request.reason])
}

/**
 * Derive the exact durable identity of one close request without optional-undefined ambiguity.
 * @param request - Close request received from the authenticated bridge.
 * @returns Lowercase hexadecimal SHA-256 digest.
 */
export function closeRequestDigest(request: ChannelSessionCloseV1): string {
  return digestJson(['session.close', routeIdentity(request.route), request.reason])
}

/**
 * Derive the deterministic DSH Session identity for one route generation.
 * @param route - Gateway/session lineage and exact generation.
 * @returns Branded Session identity derived from the binding key.
 */
export function sessionIdFor(route: Pick<ChannelRouteV1, 'gatewayInstanceId' | 'openclawSessionKey' | 'generation'>): SessionId {
  return SessionId(`channel:${bindingKey(route)}`)
}

/** Complete route identity encoded without optional object fields. */
function routeIdentity(route: ChannelRouteV1): readonly unknown[] {
  return [
    route.gatewayInstanceId,
    route.openclawSessionKey,
    route.generation,
    route.channel,
    route.account,
    route.conversation,
    route.thread ?? null,
    route.kind,
  ]
}
