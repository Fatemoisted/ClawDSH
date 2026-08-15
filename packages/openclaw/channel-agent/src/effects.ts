/** Fail-closed parsing helpers for durable Agent tool-result evidence. @module */

import {
  channelActionDeliveryReceiptV1Schema,
  type ChannelActionDeliveryReceiptV1,
} from '@clawdsh/dsh-channel'

/**
 * Read a validated action-receipt status from an unknown Session event.
 * @param value - Candidate `tool/result` event from durable Session history.
 * @returns The validated receipt status, or undefined for a missing, error, or malformed result.
 */
export function messageSendReceiptStatus(
  value: unknown,
): ChannelActionDeliveryReceiptV1['status'] | undefined {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
    const event = value as Record<string, unknown>
    if (event.type !== 'tool/result') return undefined
    const data = event.data
    if (data === null || typeof data !== 'object' || Array.isArray(data)) return undefined
    const message = (data as Record<string, unknown>).message
    if (message === null || typeof message !== 'object' || Array.isArray(message)) return undefined
    const content = (message as Record<string, unknown>).content
    if (!Array.isArray(content) || content.length !== 1) return undefined
    const block: unknown = content[0]
    if (block === null || typeof block !== 'object' || Array.isArray(block)) return undefined
    const result = block as Record<string, unknown>
    const resultContent: unknown = result.content
    if (result.type !== 'tool-result' || result.isError !== false
      || !Array.isArray(resultContent) || resultContent.length !== 1) return undefined
    const rendered: unknown = resultContent[0]
    if (rendered === null || typeof rendered !== 'object' || Array.isArray(rendered)) return undefined
    const output = rendered as Record<string, unknown>
    if (output.type !== 'text' || typeof output.text !== 'string') return undefined
    return channelActionDeliveryReceiptV1Schema.parse(JSON.parse(output.text)).status
  } catch (_invalidReceipt) {
    return undefined
  }
}
