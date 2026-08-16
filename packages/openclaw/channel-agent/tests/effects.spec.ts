import { describe, expect, it } from 'vitest'
import { messageSendReceiptStatus } from '../src/effects.ts'

function toolResult(content: unknown[], isError = false): Record<string, unknown> {
  return {
    type: 'tool/result',
    data: {
      message: {
        content: [{ type: 'tool-result', isError, content }],
      },
    },
  }
}

describe('message tool effect evidence', () => {
  it('accepts only a complete confirmed receipt', () => {
    expect(messageSendReceiptStatus(toolResult([{
      type: 'text',
      text: JSON.stringify({
        protocolVersion: 1,
        deliveryId: 'delivery-1',
        subject: { kind: 'action', actionId: 'action-1' },
        attempt: 1,
        status: 'confirmed',
      }),
    }]))).toBe('confirmed')
  })

  it('preserves a validated accepted receipt as pending send evidence', () => {
    expect(messageSendReceiptStatus(toolResult([{
      type: 'text',
      text: JSON.stringify({
        protocolVersion: 1,
        deliveryId: 'delivery-accepted',
        subject: { kind: 'action', actionId: 'action-1' },
        attempt: 1,
        status: 'accepted',
      }),
    }]))).toBe('accepted')
  })

  it('preserves a validated retrying receipt with its required retry evidence', () => {
    expect(messageSendReceiptStatus(toolResult([{
      type: 'text',
      text: JSON.stringify({
        protocolVersion: 1,
        deliveryId: 'delivery-retrying',
        subject: { kind: 'action', actionId: 'action-1' },
        attempt: 1,
        status: 'retrying',
        nextAttemptAt: '2026-08-16T12:00:00Z',
        error: { code: 'RATE_LIMIT', message: 'retry scheduled', retryable: true },
      }),
    }]))).toBe('retrying')
  })

  it.each(['ambiguous', 'dead-letter'] as const)('preserves the validated %s receipt boundary', (status) => {
    expect(messageSendReceiptStatus(toolResult([{
      type: 'text',
      text: JSON.stringify({
        protocolVersion: 1,
        deliveryId: `delivery-${status}`,
        subject: { kind: 'action', actionId: 'action-1' },
        attempt: 1,
        status,
        error: { code: 'DELIVERY', message: 'delivery outcome', retryable: false },
      }),
    }]))).toBe(status)
  })

  it.each([
    undefined,
    {},
    { type: 'tool/result', data: {} },
    { type: 'tool/result', data: { message: { content: [] } } },
    { type: 'tool/result', data: { message: { content: [{}] } } },
    toolResult([]),
    toolResult([{ type: 'text', text: '{' }]),
    toolResult([{ type: 'text', text: JSON.stringify({ status: 'confirmed' }) }]),
    toolResult([{ type: 'text', text: JSON.stringify({
      protocolVersion: 1,
      deliveryId: 'delivery-1',
      subject: { kind: 'action', actionId: 'action-1' },
      attempt: 1,
      status: 'confirmed',
    }) }], true),
  ])('fails closed for malformed or error tool results', (value) => {
    expect(() => messageSendReceiptStatus(value)).not.toThrow()
    expect(messageSendReceiptStatus(value)).toBeUndefined()
  })
})
