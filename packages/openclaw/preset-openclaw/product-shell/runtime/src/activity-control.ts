/** Loopback-only adapter from product Activity RPC to live or persisted Session history. */

import type { Context } from '@deepseek-ai/cordis'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import {
  CLAWDSH_PROTOCOL_VERSION,
  parseClawdshActivityListRequest,
  parseClawdshActivityListResponse,
  type ClawdshActivityListRequest,
  type ClawdshActivityListResponse,
} from '../../shared/src/protocol.ts'

interface SessionView {
  readonly events: readonly unknown[]
  /** Constructor-seed boundary; nonzero means this process resumed or forked stored history. */
  readonly firstLiveSeq?: number
}

interface SessionStoreView {
  readonly get: (sessionId: string) => SessionView | undefined
}

interface SessionInspectionView {
  readonly events: readonly unknown[]
}

interface SessionPersistenceView {
  readonly inspect: (sessionId: string, signal?: AbortSignal) => Promise<SessionInspectionView>
}

interface ActivityHistorySources {
  readonly live?: readonly unknown[]
  readonly inspect?: readonly unknown[]
}

type ActivityPageRequest = Omit<ClawdshActivityListRequest, 'version'>

interface ActivityServiceView {
  readonly page: (
    request: ActivityPageRequest,
    history: ActivityHistorySources,
  ) => unknown | Promise<unknown>
}

interface ActivityHistorySelection {
  readonly sources: ActivityHistorySources
  readonly availability: ClawdshActivityListResponse['availability']['history']
}

type ActivityControlResult = RpcResult<ClawdshActivityListResponse>

const DEFAULT_PAGE_LIMIT = 50

function badRequest(message: string): RpcResult<never> {
  return {
    ok: false,
    error: { code: 'bad-request', message, details: { issues: [] } },
  }
}

function cancelled(): RpcResult<never> {
  return {
    ok: false,
    error: {
      code: 'cancelled',
      message: 'ClawDSH Activity request was cancelled',
      details: {},
    },
  }
}

function activityPageRequest(request: ClawdshActivityListRequest): ActivityPageRequest {
  return {
    sessionId: request.sessionId,
    ...(request.categories === undefined ? {} : { categories: request.categories }),
    ...(request.order === undefined ? {} : { order: request.order }),
    ...(request.limit === undefined ? {} : { limit: request.limit }),
    ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
  }
}

function fallbackResponse(
  history: ClawdshActivityListResponse['availability']['history'],
): ClawdshActivityListResponse {
  return parseClawdshActivityListResponse({
    version: CLAWDSH_PROTOCOL_VERSION,
    records: [],
    availability: { history, sidecar: 'unavailable' },
    degraded: true,
    warnings: [
      ...(history === 'unavailable' ? ['activity-history-unavailable' as const] : []),
      'activity-data-incomplete' as const,
    ],
  })
}

function responseBoundary(
  page: unknown,
  request: ClawdshActivityListRequest,
  history: ActivityHistorySelection,
): ClawdshActivityListResponse {
  if (typeof page !== 'object' || page === null || Array.isArray(page)) {
    throw new TypeError('Activity page must be an object')
  }
  const encoded = JSON.stringify({
    ...page as Record<string, unknown>,
    version: CLAWDSH_PROTOCOL_VERSION,
  })
  if (encoded === undefined) throw new TypeError('Activity page is not JSON serializable')
  const response = parseClawdshActivityListResponse(JSON.parse(encoded) as unknown)
  if (response.availability.history !== history.availability) {
    throw new TypeError('Activity page selected an inconsistent history source')
  }
  if (response.records.length > (request.limit ?? DEFAULT_PAGE_LIMIT)
    || response.records.some(record => record.sessionId !== request.sessionId)) {
    throw new TypeError('Activity page crossed its Session or page-size limit')
  }
  return response
}

function queryFailure(error: unknown): RpcResult<never> | undefined {
  if (typeof error !== 'object' || error === null || Array.isArray(error)) return undefined
  const code = (error as { code?: unknown }).code
  if (code === 'invalid-request') return badRequest('invalid ClawDSH Activity request')
  if (code === 'invalid-cursor') return badRequest('invalid ClawDSH Activity cursor')
  if (code === 'cursor-mismatch') {
    return badRequest('ClawDSH Activity cursor does not match this Session, filter, or order')
  }
  return undefined
}

function service<T>(ctx: Context, name: string): T | undefined {
  try {
    return ctx.get(name) as T | undefined
  } catch {
    // Optional malformed service lookups are treated as unavailable.
    return undefined
  }
}

async function activityHistory(
  ctx: Context,
  sessionId: string,
  signal: AbortSignal,
): Promise<ActivityHistorySelection> {
  const sessions = service<SessionStoreView>(ctx, 'sessions')
  if (sessions !== undefined && typeof sessions.get === 'function') {
    try {
      const live = sessions.get(sessionId)
      if (live !== undefined && Array.isArray(live.events)) {
        if (typeof live.firstLiveSeq === 'number' && live.firstLiveSeq > 0) {
          return { sources: { inspect: live.events }, availability: 'inspect' }
        }
        return { sources: { live: live.events }, availability: 'live' }
      }
    } catch {
      // A malformed optional live provider falls through to the durable view.
    }
  }

  if (signal.aborted) return { sources: {}, availability: 'unavailable' }
  const persistence = service<SessionPersistenceView>(ctx, 'sessionPersistence')
  if (persistence !== undefined && typeof persistence.inspect === 'function') {
    try {
      const inspected = await persistence.inspect(sessionId, signal)
      if (Array.isArray(inspected.events)) {
        return { sources: { inspect: inspected.events }, availability: 'inspect' }
      }
    } catch {
      // Missing, corrupt, or unavailable history must not suppress sidecar Activity.
    }
  }
  return { sources: {}, availability: 'unavailable' }
}

/** Adapts strict Activity requests to optional live, persistence, and Activity services. */
export class ClawdshActivityControl {
  /** @param ctx - Host context carrying optional Session and Activity services. */
  constructor(private readonly ctx: Context) {}

  /**
   * Resolve one sanitized Activity page without exposing persistence or sidecar failures.
   * @param payload - Untrusted v1 Activity request.
   * @param signal - Connection cancellation propagated to persistence inspection.
   * @returns Strict RPC success, validation failure, or cancellation.
   */
  async handle(payload: unknown, signal: AbortSignal): Promise<ActivityControlResult> {
    let request: ClawdshActivityListRequest
    try {
      request = parseClawdshActivityListRequest(payload)
    } catch {
      return badRequest('invalid ClawDSH protocol v1 request')
    }
    if (signal.aborted) return cancelled()

    const history = await activityHistory(this.ctx, request.sessionId, signal)
    if (signal.aborted) return cancelled()
    const activity = service<ActivityServiceView>(this.ctx, 'clawdshActivity')
    if (activity === undefined || typeof activity.page !== 'function') {
      return { ok: true, value: fallbackResponse(history.availability) }
    }

    try {
      const page = await activity.page(activityPageRequest(request), history.sources)
      if (signal.aborted) return cancelled()
      return { ok: true, value: responseBoundary(page, request, history) }
    } catch (error: unknown) {
      if (signal.aborted) return cancelled()
      const failure = queryFailure(error)
      return failure ?? { ok: true, value: fallbackResponse(history.availability) }
    }
  }
}
