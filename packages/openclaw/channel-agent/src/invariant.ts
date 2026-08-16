/** Package-owned relational invariants for channel-sourced user messages. @module @clawdsh/dsh-channel-agent/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { sameChannelRoute, type ChannelRouteV1 } from '@clawdsh/dsh-channel'
import type { ChannelMessageSource } from './events.ts'

const PACKAGE_NAME = '@clawdsh/dsh-channel-agent'
const TRUST_CLASSES = new Set(['owner', 'paired', 'allowlisted', 'admitted', 'group-allowlisted'])

/** Cordis companion plugin name. */
export const name = 'channel-agent-invariant'
/** Services used to seed cold and already-live logs. */
export const inject = ['invariants']

interface ChannelTrace {
  route?: ChannelRouteV1
  readonly turnIds: Set<string>
  readonly runIds: Set<string>
  readonly idempotencyKeys: Set<string>
  readonly messageIds: Set<string>
}

/** Detached state for validate-before-publish dispatch. */
function cloneTrace(trace: ChannelTrace): ChannelTrace {
  return {
    ...(trace.route === undefined ? {} : { route: trace.route }),
    turnIds: new Set(trace.turnIds),
    runIds: new Set(trace.runIds),
    idempotencyKeys: new Set(trace.idempotencyKeys),
    messageIds: new Set(trace.messageIds),
  }
}

/** Project the message provenance fields that form one authenticated route identity. */
function routeFromSource(source: ChannelMessageSource): ChannelRouteV1 {
  return {
    gatewayInstanceId: source.gatewayInstanceId,
    openclawSessionKey: source.openclawSessionKey,
    generation: source.generation,
    channel: source.channel,
    account: source.account,
    conversation: source.conversation,
    ...(source.thread === undefined ? {} : { thread: source.thread }),
    kind: source.isGroup ? 'group' : 'direct',
  }
}

/** Add one identity to a per-Session uniqueness set or report the duplicated value. */
function addUnique(values: Set<string>, value: string, label: string, fail: InvariantFailure): void {
  if (values.has(value)) fail(`${label} ${value} appeared more than once in one Session`)
  values.add(value)
}

/** Apply one channel-owned relationship transition. */
function applyEvent(trace: ChannelTrace, event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'user/message' || event.data.source.kind !== 'channel') return
  const source = event.data.source
  if (!Number.isSafeInteger(source.generation) || source.generation < 0) {
    fail(`turn ${source.turnId} carries an invalid route generation`)
  }
  if (!TRUST_CLASSES.has(source.trust)) {
    fail(`turn ${source.turnId} carries an unknown admission class`)
  }
  if (source.isGroup !== (source.trust === 'group-allowlisted')) {
    fail(`turn ${source.turnId} carries an admission class inconsistent with its conversation kind`)
  }
  const route = routeFromSource(source)
  if (trace.route === undefined) trace.route = route
  else if (!sameChannelRoute(trace.route, route)) {
    fail(`turn ${source.turnId} crossed the Session's channel route`)
  }
  addUnique(trace.turnIds, source.turnId, 'turn', fail)
  addUnique(trace.runIds, source.runId, 'run', fail)
  addUnique(trace.idempotencyKeys, source.idempotencyKey, 'idempotency key', fail)
  addUnique(trace.messageIds, source.messageId, 'platform message', fail)
}

// Invariant companions stay independently installable and must each own their validate-before-publish
// transaction. Sharing this package lifecycle would couple failure attribution and disposal semantics.
/* jscpd:ignore-start */
/** Install a validate-before-publication fold over all live and restored Sessions. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const traces = new WeakMap<Session, ChannelTrace>()
  const staged = new WeakMap<SessionEvent, { session: Session; trace: ChannelTrace }>()
  const seed = (session: Session): ChannelTrace => {
    const trace: ChannelTrace = {
      turnIds: new Set(), runIds: new Set(), idempotencyKeys: new Set(), messageIds: new Set(),
    }
    for (const event of session.events) applyEvent(trace, event, fail)
    traces.set(session, trace)
    return trace
  }
  /* v8 ignore next -- every Session is seeded by list() or session/created before it can publish an event. */
  const traceFor = (session: Session): ChannelTrace => traces.get(session) ?? seed(session)
  for (const session of ctx.sessions.list()) seed(session)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    const trace = cloneTrace(traceFor(session))
    applyEvent(trace, event, fail)
    staged.set(event, { session, trace })
  }, { global: true })
  ctx.on('session/event', (session, event) => {
    const candidate = staged.get(event)
    /* v8 ignore next 3 -- internal/dispatch stages the exact session/event callback arguments before publication. */
    if (candidate === undefined || candidate.session !== session) {
      return fail('session/event reached publication without matching channel validation')
    }
    staged.delete(event)
    traces.set(session, candidate.trace)
  }, { global: true })
}, { inject: ['sessions'] })

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
