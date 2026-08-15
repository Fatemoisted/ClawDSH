/** Privacy-preserving semantic projection from standard Session history. */

import { createHash } from 'node:crypto'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { createActivityRecord } from './records.ts'
import type {
  ClawdshActivityHistoryProjection,
  ClawdshActivityKind,
  ClawdshActivityRecord,
  ClawdshActivityStatus,
} from './types.ts'

interface EventView {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
}

interface TrackedToolCall {
  readonly kind: 'memory.search' | 'memory.read' | 'skill.invoked'
  readonly skill?: string
}

const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/

/**
 * Project standard and already-registered plugin Session events into sanitized Activity records.
 * Unknown events are ignored; recognized malformed events are skipped and mark the projection degraded.
 * @param sessionId - Owning Session identity supplied independently from event payloads.
 * @param events - Live `Session.events` or validated `sessionPersistence.inspect().events`.
 * @returns canonical records and a sanitized degradation flag.
 */
export function projectSessionHistory(
  sessionId: string,
  events: readonly SessionEvent[],
): ClawdshActivityHistoryProjection {
  const records: ClawdshActivityRecord[] = []
  const toolCalls = new Map<string, TrackedToolCall>()
  let degraded = false
  for (const original of events) {
    const event = original as unknown as EventView
    switch (event.type) {
      case 'tool/call': {
        const data = asRecord(event.data)
        if (data === undefined || typeof data.callId !== 'string' || typeof data.name !== 'string') {
          degraded = true
          break
        }
        let tracked: TrackedToolCall | undefined
        if (data.name === 'memory_search') tracked = { kind: 'memory.search' }
        else if (data.name === 'memory_get') tracked = { kind: 'memory.read' }
        else if (data.name === 'skill') {
          const skill = typeof data.arguments === 'string' ? skillNameFromArguments(data.arguments) : undefined
          if (skill === undefined) {
            degraded = true
            break
          }
          tracked = { kind: 'skill.invoked', skill }
        }
        if (tracked === undefined) break
        const record = toolActivity(sessionId, event, tracked, 'started')
        if (record === undefined) {
          degraded = true
          break
        }
        toolCalls.set(data.callId, tracked)
        records.push(record)
        break
      }
      case 'tool/result': {
        const data = asRecord(event.data)
        const message = asRecord(data?.message)
        const source = asRecord(message?.source)
        const callId = source?.callId
        if (typeof callId !== 'string') break
        const tracked = toolCalls.get(callId)
        if (tracked === undefined) break
        toolCalls.delete(callId)
        const status = data?.error === undefined && !toolResultIsError(message) ? 'succeeded' : 'failed'
        const record = toolActivity(sessionId, event, tracked, status)
        if (record === undefined) degraded = true
        else records.push(record)
        break
      }
      case 'user/message': {
        const data = asRecord(event.data)
        const source = asRecord(data?.source)
        if (source === undefined || typeof source.kind !== 'string') break
        if (source.kind === 'plugin' && source.plugin === 'memory-flush') {
          const record = eventRecord(sessionId, event, 'memory.flush', { seq: event.seq }, 'started')
          if (record === undefined) degraded = true
          else records.push(record)
          break
        }
        if (source.kind === 'channel') {
          const record = projectChannelReceived(sessionId, event, source)
          if (record === undefined) degraded = true
          else records.push(record)
          break
        }
        if (source.kind === 'skill-catalog') {
          const entries = source.entries
          if (!Array.isArray(entries) || !Number.isSafeInteger(entries.length)) {
            degraded = true
            break
          }
          const record = eventRecord(
            sessionId,
            event,
            'skill.catalog',
            { count: entries.length, seq: event.seq },
            'succeeded',
          )
          if (record === undefined) degraded = true
          else records.push(record)
          break
        }
        if (source.kind === 'skill-invocation') {
          if (!isSafeLabel(source.name)) {
            degraded = true
            break
          }
          const record = eventRecord(
            sessionId,
            event,
            'skill.loaded',
            { skill: source.name, seq: event.seq },
            'succeeded',
          )
          if (record === undefined) degraded = true
          else records.push(record)
        }
        break
      }
      case 'automation/run': {
        const record = projectAutomationRun(sessionId, event)
        if (record === undefined) degraded = true
        else records.push(record)
        break
      }
      default:
        break
    }
  }
  return Object.freeze({ records: Object.freeze(records), degraded })
}

function toolActivity(
  sessionId: string,
  event: EventView,
  tracked: TrackedToolCall,
  status: 'started' | 'succeeded' | 'failed',
): ClawdshActivityRecord | undefined {
  return eventRecord(
    sessionId,
    event,
    tracked.kind,
    tracked.kind === 'skill.invoked'
      ? { skill: tracked.skill ?? '', seq: event.seq }
      : { seq: event.seq },
    status,
  )
}

function projectChannelReceived(
  sessionId: string,
  event: EventView,
  source: Record<string, unknown>,
): ClawdshActivityRecord | undefined {
  if (!isSafeLabel(source.channel) || typeof source.isGroup !== 'boolean') return undefined
  const mention = source.wasMentioned === undefined ? null : source.wasMentioned
  if (typeof mention !== 'boolean' && mention !== null) return undefined
  return eventRecord(sessionId, event, 'channel.received', {
    adapter: source.channel,
    conversation: source.isGroup ? 'group' : 'direct',
    mention,
    seq: event.seq,
  })
}

function projectAutomationRun(
  sessionId: string,
  event: EventView,
): ClawdshActivityRecord | undefined {
  const data = asRecord(event.data)
  if (data === undefined
    || !isSafeLabel(data.ruleId)
    || typeof data.scheduledAt !== 'string'
    || !isCanonicalTimestamp(data.scheduledAt)) return undefined
  let status: 'started' | 'succeeded' | 'failed'
  if (data.status === 'started') status = 'started'
  else if (data.status === 'ok') status = 'succeeded'
  else if (data.status === 'error') status = 'failed'
  else return undefined
  return eventRecord(sessionId, event, 'automation.run', {
    ruleId: data.ruleId,
    scheduledAt: data.scheduledAt,
    seq: event.seq,
  }, status)
}

function eventRecord(
  sessionId: string,
  event: EventView,
  kind: ClawdshActivityKind,
  metadata: Record<string, string | number | boolean | null>,
  status?: ClawdshActivityStatus,
): ClawdshActivityRecord | undefined {
  if (!Number.isSafeInteger(event.seq)
    || event.seq < 0
    || !Number.isSafeInteger(event.time)
    || event.time < 0) return undefined
  const timestamp = new Date(event.time).toISOString()
  const id = `history:${createHash('sha256')
    .update(`${sessionId}\u0000${String(event.seq)}\u0000${kind}\u0000${status ?? ''}`)
    .digest('hex')}`
  return Object.freeze(createActivityRecord({ id, timestamp, sessionId }, kind, Object.freeze(metadata), status))
}

function skillNameFromArguments(argumentsJson: string): string | undefined {
  let value: unknown
  try {
    value = JSON.parse(argumentsJson)
  } catch {
    return undefined
  }
  const record = asRecord(value)
  return isSafeLabel(record?.name) ? record.name : undefined
}

function toolResultIsError(message: Record<string, unknown> | undefined): boolean {
  const content = message?.content
  if (!Array.isArray(content)) return false
  const first = asRecord(content[0])
  return first?.type === 'tool-result' && first.isError === true
}

function isSafeLabel(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value === value.trim()
    && !CONTROL_PATTERN.test(value)
    && Buffer.byteLength(value, 'utf8') <= 256
}

function isCanonicalTimestamp(value: string): boolean {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}
