/** Privacy-preserving semantic projection from standard Session history. */

import { createHash } from 'node:crypto'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  createActivityRecord,
  isCanonicalTimestamp,
  isNonNegativeSafeInteger,
  isSafeLabel,
} from './records.ts'
import type {
  ClawdshActivityHistoryProjection,
  ClawdshActivityKind,
  ClawdshActivityRecord,
  ClawdshActivityStatus,
  MemoryUpdateOutcome,
  MemoryWriteOutcome,
} from './types.ts'

interface EventView {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
}

type TrackedToolCall =
  | { readonly kind: 'memory.search' | 'memory.read'; readonly callId: string; readonly start: EventView }
  | {
    readonly kind: 'memory.write'
    readonly callId: string
    readonly scope: 'durable' | 'daily'
    readonly start: EventView
  }
  | {
    readonly kind: 'memory.update'
    readonly action: 'updated' | 'forgotten'
    readonly callId: string
    readonly start: EventView
  }
  | { readonly kind: 'skill.invoked'; readonly callId: string; readonly skill: string; readonly start: EventView }

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
        if (data.name === 'memory_search') tracked = { kind: 'memory.search', callId: data.callId, start: event }
        else if (data.name === 'memory_get') tracked = { kind: 'memory.read', callId: data.callId, start: event }
        else if (data.name === 'memory_write') {
          const scope = typeof data.arguments === 'string' ? memoryWriteScopeFromArguments(data.arguments) : undefined
          if (scope === undefined) {
            degraded = true
            break
          }
          tracked = { kind: 'memory.write', callId: data.callId, scope, start: event }
        }
        else if (data.name === 'memory_update') {
          const action = typeof data.arguments === 'string' ? memoryUpdateActionFromArguments(data.arguments) : undefined
          if (action === undefined) {
            degraded = true
            break
          }
          tracked = { kind: 'memory.update', action, callId: data.callId, start: event }
        }
        else if (data.name === 'skill') {
          const skill = typeof data.arguments === 'string' ? skillNameFromArguments(data.arguments) : undefined
          if (skill === undefined) {
            degraded = true
            break
          }
          tracked = { kind: 'skill.invoked', callId: data.callId, skill, start: event }
        }
        if (tracked === undefined) break
        const key = toolCallKey(data, data.callId)
        if (key === undefined) {
          degraded = true
          break
        }
        if (toolCalls.has(key)) degraded = true
        toolCalls.set(key, tracked)
        break
      }
      case 'tool/result': {
        const data = asRecord(event.data)
        if (data === undefined) break
        const message = asRecord(data.message)
        const source = asRecord(message?.source)
        const callId = source?.callId
        if (typeof callId !== 'string') break
        const key = toolCallKey(data, callId)
        if (key === undefined) {
          if ([...toolCalls.values()].some(tracked => tracked.callId === callId)) degraded = true
          break
        }
        const tracked = toolCalls.get(key)
        if (tracked === undefined) break
        toolCalls.delete(key)
        const status = data.error === undefined && !toolResultIsError(message) ? 'succeeded' : 'failed'
        const record = toolActivity(sessionId, event, tracked, status, message)
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
  for (const tracked of toolCalls.values()) {
    const record = toolActivity(sessionId, tracked.start, tracked, 'started')
    if (record === undefined) degraded = true
    else records.push(record)
  }
  return Object.freeze({ records: Object.freeze(records), degraded })
}

function toolActivity(
  sessionId: string,
  event: EventView,
  tracked: TrackedToolCall,
  status: 'started' | 'succeeded' | 'failed',
  message?: Record<string, unknown>,
): ClawdshActivityRecord | undefined {
  const outcome = status === 'succeeded' ? memoryOutcome(tracked, message) : undefined
  return eventRecord(
    sessionId,
    event,
    tracked.kind,
    toolMetadata(tracked, event.seq, outcome),
    status,
  )
}

function toolMetadata(
  tracked: TrackedToolCall,
  seq: number,
  outcome: MemoryWriteOutcome | MemoryUpdateOutcome | undefined,
): Record<string, string | number | boolean | null> {
  switch (tracked.kind) {
    case 'memory.search':
    case 'memory.read':
      return { seq }
    case 'memory.write':
      return { scope: tracked.scope, seq, ...(outcome === undefined ? {} : { outcome }) }
    case 'memory.update':
      return { action: tracked.action, seq, ...(outcome === undefined ? {} : { outcome }) }
    case 'skill.invoked':
      return { skill: tracked.skill, seq }
  }
}

function memoryOutcome(
  tracked: TrackedToolCall,
  message: Record<string, unknown> | undefined,
): MemoryWriteOutcome | MemoryUpdateOutcome | undefined {
  const text = toolResultText(message)
  if (tracked.kind === 'memory.write') {
    if (text === 'Stored durable memory.' || text === 'Stored daily memory.') return 'stored'
    if (text === 'Durable memory already stored.' && tracked.scope === 'durable') return 'already-stored'
    return undefined
  }
  if (tracked.kind !== 'memory.update') return undefined
  if (text === 'Updated durable memory.' && tracked.action === 'updated') return 'updated'
  if (text === 'Forgot durable memory.' && tracked.action === 'forgotten') return 'forgotten'
  if (text === 'Durable memory is already current.' && tracked.action === 'updated') return 'already-current'
  if (text === 'No exact durable memory entry matched. Read MEMORY.md and retry with the exact line.') {
    return 'not-found'
  }
  return undefined
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
  const date = new Date(event.time)
  if (!Number.isFinite(date.getTime())) return undefined
  const timestamp = date.toISOString()
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

function memoryWriteScopeFromArguments(argumentsJson: string): 'durable' | 'daily' | undefined {
  let value: unknown
  try {
    value = JSON.parse(argumentsJson)
  } catch {
    return undefined
  }
  const scope = asRecord(value)?.scope
  return scope === 'durable' || scope === 'daily' ? scope : undefined
}

function memoryUpdateActionFromArguments(argumentsJson: string): 'updated' | 'forgotten' | undefined {
  let value: unknown
  try {
    value = JSON.parse(argumentsJson)
  } catch {
    return undefined
  }
  const record = asRecord(value)
  if (typeof record?.oldContent !== 'string' || typeof record.newContent !== 'string') return undefined
  return record.newContent.trim() === '' ? 'forgotten' : 'updated'
}

function toolCallKey(data: Record<string, unknown>, callId: string): string | undefined {
  if (!isNonNegativeSafeInteger(data.turn) || !isNonNegativeSafeInteger(data.step)) return undefined
  return JSON.stringify([data.turn, data.step, callId])
}

function toolResultIsError(message: Record<string, unknown> | undefined): boolean {
  const content = message?.content
  if (!Array.isArray(content)) return false
  const first = asRecord(content[0])
  return first?.type === 'tool-result' && first.isError === true
}

function toolResultText(message: Record<string, unknown> | undefined): string | undefined {
  const content = message?.content
  if (!Array.isArray(content)) return undefined
  const result = content.map(asRecord).find(block => block?.type === 'tool-result')
  if (result === undefined || !Array.isArray(result.content) || result.content.length !== 1) return undefined
  const text = asRecord(result.content[0])
  return text?.type === 'text' && typeof text.text === 'string' ? text.text : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}
