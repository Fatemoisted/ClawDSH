import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  createLaunchEnvironmentSnapshot,
  DSH_LAUNCH_ENVIRONMENT_KEY,
} from '@deepseek-ai/dsh-launch-environment'
import { describe, expect, it, vi } from 'vitest'
import {
  createChannelMaintenanceQueue,
  normalizeChannelCredential,
  resolveChannelCredential,
} from '@clawdsh/dsh-channel-core'

describe('shared channel credential normalization', () => {
  it('trims configured values and treats missing or blank values as absent', () => {
    expect(normalizeChannelCredential(undefined)).toBeUndefined()
    expect(normalizeChannelCredential('   ')).toBeUndefined()
    expect(normalizeChannelCredential('  opaque value  ')).toBe('opaque value')
  })

  it('honors literals and test overrides before Harness services', async () => {
    const ctx = new Context()
    const ref = credentialRef('CHANNEL_CORE_TEST_TOKEN')
    const override = vi.fn(async () => '  from override  ')
    expect(await resolveChannelCredential(ctx, '  literal  ', ref, override)).toBe('literal')
    expect(override).not.toHaveBeenCalled()
    expect(await resolveChannelCredential(ctx, undefined, ref, override)).toBe('from override')
  })

  it('uses the Harness credential service before the launch snapshot', async () => {
    const ctx = new Context()
    const ref = credentialRef('CHANNEL_CORE_TEST_TOKEN')
    ctx.provide('credentials', {
      resolve: vi.fn(async () => ({ value: '  from provider  ', source: 'test' })),
    } as never)
    ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([
      { source: 'process', values: { CHANNEL_CORE_TEST_TOKEN: 'from launch' } },
    ]))
    expect(await resolveChannelCredential(ctx, undefined, ref)).toBe('from provider')
  })

  it('falls back to the Harness launch snapshot and accepts provider normalization', async () => {
    const ctx = new Context()
    const ref = credentialRef('CHANNEL_CORE_TEST_TOKEN')
    ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([
      { source: 'process', values: { CHANNEL_CORE_TEST_TOKEN: 'Bot provider-token' } },
    ]))
    const withoutBotPrefix = (value: string | undefined): string | undefined =>
      value?.replace(/^Bot /, '')
    expect(await resolveChannelCredential(ctx, undefined, ref, undefined, withoutBotPrefix))
      .toBe('provider-token')
  })
})

describe('shared channel maintenance queue', () => {
  it('starts the first transition immediately and serializes later work after failure', async () => {
    const events: string[] = []
    const report = vi.fn()
    let rejectFirst: ((reason: Error) => void) | undefined
    const queue = createChannelMaintenanceQueue(report)
    queue.enqueue(async () => {
      events.push('first started')
      await new Promise<void>((_resolve, reject) => { rejectFirst = reject })
    })
    queue.enqueue(async () => { events.push('second started') })
    expect(events).toEqual(['first started'])
    rejectFirst?.(new Error('first failed'))
    await queue.settle(async () => { events.push('settled') })
    expect(events).toEqual(['first started', 'second started', 'settled'])
    expect(report).toHaveBeenCalledOnce()
  })

  it('uses a teardown-specific reporter when the final transition fails', async () => {
    const ordinaryReport = vi.fn()
    const finalReport = vi.fn()
    const queue = createChannelMaintenanceQueue(ordinaryReport)
    await queue.settle(async () => { throw new Error('stop failed') }, finalReport)
    expect(finalReport).toHaveBeenCalledOnce()
    expect(ordinaryReport).not.toHaveBeenCalled()
  })
})
