import { describe, expect, it, vi, type Mock } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Channels, {
  ChannelAccountId,
  ChannelActionId,
  ChannelDeliveryId,
  ChannelDirectoryEntryId,
  ChannelError,
  ChannelId,
  ChannelIdempotencyKey,
  ChannelMediaId,
  ChannelMediaSha256,
  ChannelMessageId,
  ChannelProviderId,
  ChannelReplayId,
  ChannelRunId,
  ChannelSenderId,
  ChannelStartupNonce,
  ChannelThreadId,
  ChannelToolCallId,
  ChannelTraceId,
  ChannelTurnId,
  ChannelConversationId,
  GatewayInstanceId,
  OpenClawArtifactSha512,
  OpenClawCommitSha,
  OpenClawSessionKey,
  type ChannelDriverV1,
  type ChannelProviderV1,
  type ChannelTurnExecutionV1,
} from '../src/index.ts'
import * as invariant from '../src/invariant.ts'
import {
  action,
  cancelRequest,
  closeRequest,
  health,
  receipt,
  report,
  resetRequest,
  result,
  turn,
} from './fixtures.ts'

async function mount(): Promise<{ ctx: Context; channels: Channels }> {
  const ctx = new Context()
  await ctx.plugin(Channels)
  return { ctx, channels: ctx.channels }
}

interface TestProvider {
  readonly id: ReturnType<typeof ChannelProviderId>
  readonly action: Mock<ChannelProviderV1['action']>
  readonly health: Mock<ChannelProviderV1['health']>
}

interface TestDriver {
  readonly runTurn: Mock<ChannelDriverV1['runTurn']>
  readonly cancel: Mock<ChannelDriverV1['cancel']>
  readonly reset: Mock<ChannelDriverV1['reset']>
  readonly close: Mock<ChannelDriverV1['close']>
  reportDelivery?: Mock<NonNullable<ChannelDriverV1['reportDelivery']>>
}

function provider(): TestProvider {
  return {
    id: ChannelProviderId('openclaw'),
    action: vi.fn<ChannelProviderV1['action']>(async () => receipt()),
    health: vi.fn<ChannelProviderV1['health']>(async () => health()),
  }
}

function driver(): TestDriver {
  return {
    runTurn: vi.fn<ChannelDriverV1['runTurn']>(async (_turn, execution) => {
      execution.notify({
        kind: 'status',
        turnId: ChannelTurnId('turn-1'),
        runId: ChannelRunId('run-1'),
        sequence: 0,
        status: 'running',
      })
      return result()
    }),
    cancel: vi.fn<ChannelDriverV1['cancel']>(async () => {}),
    reset: vi.fn<ChannelDriverV1['reset']>(async request => ({
      protocolVersion: 1 as const,
      route: { ...request.route, generation: request.nextGeneration },
    })),
    close: vi.fn<ChannelDriverV1['close']>(async () => {}),
    reportDelivery: vi.fn<NonNullable<ChannelDriverV1['reportDelivery']>>(async () => {}),
  }
}

describe('Channels registration', () => {
  it('registers one provider, routes calls, and releases the slot', async () => {
    const { channels } = await mount()
    const implementation = provider()
    const actionMock = implementation.action
    const healthMock = implementation.health
    const dispose = channels.registerProvider(implementation)
    const signal = new AbortController().signal

    await expect(channels.action(action(), signal)).resolves.toEqual(receipt())
    await expect(channels.health(signal)).resolves.toEqual(health())
    expect(actionMock).toHaveBeenCalledWith(action(), signal)
    expect(healthMock).toHaveBeenCalledWith(signal)

    dispose()
    expect(() => channels.health()).toThrow(expect.objectContaining({ code: 'CHANNEL_NO_PROVIDER' }))
    expect(() => channels.registerProvider(provider())).not.toThrow()
  })

  it('rejects blank and duplicate providers before replacing the active one', async () => {
    const { channels } = await mount()
    expect(() => channels.registerProvider({ ...provider(), id: ChannelProviderId('  ') }))
      .toThrow(expect.objectContaining({ code: 'CHANNEL_INVALID_PROVIDER' }))
    const first = provider()
    channels.registerProvider(first)
    expect(() => channels.registerProvider(provider()))
      .toThrow(expect.objectContaining({ code: 'CHANNEL_DUPLICATE_PROVIDER' }))
    await expect(channels.health()).resolves.toEqual(health())
  })

  it('registers one driver, routes every operation and notification, then releases it', async () => {
    const { channels } = await mount()
    const implementation = driver()
    const runTurnMock = implementation.runTurn
    const cancelMock = implementation.cancel
    const resetMock = implementation.reset
    const closeMock = implementation.close
    const reportDeliveryMock = implementation.reportDelivery
    const dispose = channels.registerDriver(implementation)
    const signal = new AbortController().signal
    const notifications: unknown[] = []
    const execution: ChannelTurnExecutionV1 = { signal, notify: (notification) => { notifications.push(notification) } }

    await expect(channels.runTurn(turn(), execution)).resolves.toEqual(result())
    await expect(channels.cancel(cancelRequest(), signal)).resolves.toBeUndefined()
    await expect(channels.reset(resetRequest(), signal)).resolves.toMatchObject({ route: { generation: 1 } })
    await expect(channels.close(closeRequest(), signal)).resolves.toBeUndefined()
    await expect(channels.reportDelivery(report(), signal)).resolves.toBeUndefined()
    expect(notifications).toEqual([expect.objectContaining({ kind: 'status', status: 'running' })])
    expect(runTurnMock).toHaveBeenCalledWith(turn(), execution)
    expect(cancelMock).toHaveBeenCalledWith(cancelRequest(), signal)
    expect(resetMock).toHaveBeenCalledWith(resetRequest(), signal)
    expect(closeMock).toHaveBeenCalledWith(closeRequest(), signal)
    expect(reportDeliveryMock).toHaveBeenCalledWith(report(), signal)

    dispose()
    expect(() => channels.runTurn(turn(), execution))
      .toThrow(expect.objectContaining({ code: 'CHANNEL_NO_DRIVER' }))
    expect(() => channels.registerDriver(driver())).not.toThrow()
  })

  it('rejects a duplicate driver and an unimplemented delivery extension', async () => {
    const { channels } = await mount()
    const implementation = driver()
    delete implementation.reportDelivery
    channels.registerDriver(implementation)
    expect(() => channels.registerDriver(driver()))
      .toThrow(expect.objectContaining({ code: 'CHANNEL_DUPLICATE_DRIVER' }))
    expect(() => channels.reportDelivery(report()))
      .toThrow(expect.objectContaining({ code: 'CHANNEL_DELIVERY_REPORT_UNSUPPORTED' }))
  })

  it('unregisters provider and driver with their contributing fiber', async () => {
    const { ctx, channels } = await mount()
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      inner.channels.registerProvider(provider())
      inner.channels.registerDriver(driver())
    }, { inject: ['channels'] }))

    await expect(channels.health()).resolves.toEqual(health())
    await fiber.dispose()
    expect(() => channels.health()).toThrow(expect.objectContaining({ code: 'CHANNEL_NO_PROVIDER' }))
    expect(() => channels.cancel(cancelRequest())).toThrow(expect.objectContaining({ code: 'CHANNEL_NO_DRIVER' }))
  })
})

describe('Channels failure behavior', () => {
  it('fails every provider and driver dispatch when its role is absent', async () => {
    const { channels } = await mount()
    const execution = { signal: new AbortController().signal, notify: () => {} }

    expect(() => channels.runTurn(turn(), execution)).toThrow(expect.objectContaining({ code: 'CHANNEL_NO_DRIVER' }))
    expect(() => channels.cancel(cancelRequest())).toThrow(expect.objectContaining({ code: 'CHANNEL_NO_DRIVER' }))
    expect(() => channels.reset(resetRequest())).toThrow(expect.objectContaining({ code: 'CHANNEL_NO_DRIVER' }))
    expect(() => channels.close(closeRequest())).toThrow(expect.objectContaining({ code: 'CHANNEL_NO_DRIVER' }))
    expect(() => channels.reportDelivery(report())).toThrow(expect.objectContaining({ code: 'CHANNEL_NO_DRIVER' }))
    expect(() => channels.action(action())).toThrow(expect.objectContaining({ code: 'CHANNEL_NO_PROVIDER' }))
    expect(() => channels.health()).toThrow(expect.objectContaining({ code: 'CHANNEL_NO_PROVIDER' }))
  })

  it('propagates provider and driver failures without reclassification', async () => {
    const { channels } = await mount()
    const providerFailure = new Error('platform rejected')
    const driverFailure = new Error('agent failed')
    channels.registerProvider({
      ...provider(),
      action: vi.fn(async () => { throw providerFailure }),
    })
    channels.registerDriver({
      ...driver(),
      runTurn: vi.fn(async () => { throw driverFailure }),
    })

    await expect(channels.action(action())).rejects.toBe(providerFailure)
    await expect(channels.runTurn(turn(), { signal: new AbortController().signal, notify: () => {} }))
      .rejects.toBe(driverFailure)
  })

  it('retains a typed code and chained cause on ChannelError', () => {
    const cause = new Error('cause')
    const error = new ChannelError('failure', 'CHANNEL_NO_DRIVER', { cause })
    expect(error).toMatchObject({ name: 'ChannelError', code: 'CHANNEL_NO_DRIVER', cause })
  })
})

describe('channel brands and invariant companion', () => {
  it('brands every external identity without changing its runtime value', () => {
    const factories = [
      GatewayInstanceId,
      ChannelProviderId,
      ChannelId,
      ChannelAccountId,
      ChannelConversationId,
      ChannelThreadId,
      ChannelMessageId,
      ChannelSenderId,
      ChannelTurnId,
      ChannelRunId,
      ChannelIdempotencyKey,
      OpenClawSessionKey,
      ChannelStartupNonce,
      ChannelReplayId,
      ChannelMediaId,
      ChannelMediaSha256,
      ChannelActionId,
      ChannelDeliveryId,
      ChannelDirectoryEntryId,
      ChannelTraceId,
      ChannelToolCallId,
      OpenClawCommitSha,
      OpenClawArtifactSha512,
    ]
    expect(factories.map(factory => factory('value'))).toEqual(factories.map(() => 'value'))
  })

  it('exports the invariant companion identity and dependency', () => {
    expect(invariant.name).toBe('channel-invariant')
    expect(invariant.inject).toEqual(['invariants'])
  })
})
