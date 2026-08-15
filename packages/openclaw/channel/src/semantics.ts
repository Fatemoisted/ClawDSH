/**
 * Shared protocol semantics for channel identities and durable delivery state.
 * @module @clawdsh/dsh-channel/semantics
 */

import { createHash } from 'node:crypto'
import type { ChannelDeliveryReceiptV1, ChannelRouteV1 } from './types.ts'

/** Route fields shared by bridge envelopes and durable Session provenance. */
export type ChannelRouteAddressV1 = Pick<ChannelRouteV1,
  | 'gatewayInstanceId'
  | 'openclawSessionKey'
  | 'generation'
  | 'channel'
  | 'account'
  | 'conversation'
  | 'thread'
>

/**
 * Compare the complete platform address of two channel routes.
 * Conversation kind remains caller-owned because durable provenance records it as `isGroup`.
 * @param left - First route address.
 * @param right - Second route address.
 * @returns Whether both values identify the same route generation and platform target.
 */
export function sameChannelRouteAddress(
  left: ChannelRouteAddressV1,
  right: ChannelRouteAddressV1,
): boolean {
  return left.gatewayInstanceId === right.gatewayInstanceId
    && left.openclawSessionKey === right.openclawSessionKey
    && left.generation === right.generation
    && left.channel === right.channel
    && left.account === right.account
    && left.conversation === right.conversation
    && left.thread === right.thread
}

/**
 * Check that a replacement delivery receipt advances its durable predecessor.
 * @param previous - Existing committed receipt.
 * @param next - Candidate replacement receipt.
 * @returns Whether attempt, status, and learned platform identity advance monotonically.
 */
export function deliveryReceiptAdvances(
  previous: ChannelDeliveryReceiptV1,
  next: ChannelDeliveryReceiptV1,
): boolean {
  const terminal = previous.status === 'confirmed'
    || previous.status === 'ambiguous'
    || previous.status === 'dead-letter'
  if (terminal || next.attempt < previous.attempt) return false
  if (previous.platformMessageId !== undefined && next.platformMessageId !== previous.platformMessageId) return false
  if (previous.status === 'retrying') {
    if (next.status === 'accepted') return false
    if (next.status === 'retrying' && next.attempt <= previous.attempt) return false
  }
  return true
}

/**
 * Encode a lossless JSON value with lexicographically sorted object keys.
 * @param value - Lossless JSON value to encode.
 * @returns Deterministic JSON text for the complete value.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('channel-agent: canonical identity value contains a non-finite number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item)).join(',')}]`
  if (typeof value !== 'object' || (Object.getPrototypeOf(value) !== Object.prototype
    && Object.getPrototypeOf(value) !== null)) {
    throw new Error('channel-agent: canonical identity value is not plain JSON')
  }
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
}

/**
 * Hash a lossless JSON value for channel protocol identity and equality.
 * @param value - Lossless JSON value to hash canonically.
 * @returns Lowercase hexadecimal SHA-256 digest.
 */
export function digestJson(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}
