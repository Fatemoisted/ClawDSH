import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  SettingsProvider,
  type SettingsNamespace,
} from '@deepseek-ai/dsh-settings'
import ClawdshActivity, {
  ACTIVITY_SETTINGS_NAMESPACE,
  Config,
} from '../src/index.ts'
import * as invariant from '../src/invariant.ts'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  vi.unstubAllEnvs()
  while (cleanups.length > 0) await cleanups.pop()!()
})

class TestSettings extends SettingsProvider {
  readonly writable = true

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve({})
  }

  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

async function boot(): Promise<{ ctx: Context; fiber: Awaited<ReturnType<Context['plugin']>> }> {
  const home = await mkdtemp(join(tmpdir(), 'clawdsh-activity-service-'))
  cleanups.push(() => rm(home, { recursive: true, force: true }))
  vi.stubEnv('DSH_HOME', home)
  const ctx = new Context()
  const settingsFiber = ctx.plugin(TestSettings)
  await settingsFiber
  const fiber = ctx.plugin(ClawdshActivity)
  await fiber
  cleanups.push(async () => {
    await fiber.dispose()
    await settingsFiber.dispose()
  })
  return { ctx, fiber }
}

describe('ClawdshActivity service', () => {
  it('registers the required managed namespace and rejects false configuration', async () => {
    const { ctx, fiber } = await boot()
    const descriptor = ctx.settings.describe().find(entry => entry.ns === ACTIVITY_SETTINGS_NAMESPACE)

    expect(ClawdshActivity.inject).toEqual(['settings'])
    expect(descriptor).toMatchObject({
      ns: 'clawdsh-activity',
      value: { enabled: true },
      applies: 'restart',
    })
    expect(() => Config({ enabled: false as true })).toThrow()

    await fiber.dispose()
    expect(ctx.get('clawdshActivity')).toBeUndefined()
    expect(ctx.settings.describe()).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ ns: ACTIVITY_SETTINGS_NAMESPACE }),
    ]))
  })

  it('writes every fixed kind through typed methods and returns canonical records', async () => {
    const { ctx } = await boot()
    const sessionId = SessionId('activity-session')
    const activity = ctx.clawdshActivity
    const outcomes = await Promise.all([
      activity.promptContribution({
        sessionId,
        producer: 'soul',
        section: 'clawdsh:soul',
        mode: 'append',
        characters: 42,
        sha256: 'a'.repeat(64),
        seq: 1,
      }),
      activity.memorySearch({ sessionId, status: 'started', seq: 2 }),
      activity.memoryRead({ sessionId, status: 'succeeded', seq: 3 }),
      activity.memoryWrite({ sessionId, scope: 'durable', status: 'succeeded', outcome: 'stored', seq: 4 }),
      activity.memoryUpdate({
        sessionId,
        action: 'updated',
        status: 'succeeded',
        outcome: 'already-current',
        seq: 5,
      }),
      activity.memoryFlush({ sessionId, status: 'failed', seq: 6 }),
      activity.channelReceived({ sessionId, adapter: 'feishu', conversation: 'group', mention: true, seq: 6 }),
      activity.channelDelivery({ sessionId, adapter: 'feishu', conversation: 'group', mention: true, status: 'sent', seq: 7 }),
      activity.skillCatalog({ sessionId, count: 3, seq: 8 }),
      activity.skillLoaded({ sessionId, skill: 'calendar', seq: 9 }),
      activity.skillInvoked({ sessionId, skill: 'calendar', status: 'succeeded', seq: 10 }),
      activity.automationRun({
        sessionId,
        ruleId: 'morning-brief',
        scheduledAt: '2026-08-15T01:02:03.000Z',
        status: 'started',
        seq: 11,
      }),
    ])

    expect(outcomes).toHaveLength(12)
    expect(outcomes.every(outcome => outcome.written && !outcome.degraded)).toBe(true)
    const read = await activity.list({ sessionId })
    expect(read).toMatchObject({ availability: 'available', degraded: false })
    expect(read.records.map(record => record.kind)).toEqual(expect.arrayContaining([
      'prompt.contribution',
      'memory.search',
      'memory.read',
      'memory.write',
      'memory.update',
      'memory.flush',
      'channel.received',
      'channel.delivery',
      'skill.catalog',
      'skill.loaded',
      'skill.invoked',
      'automation.run',
    ]))
    expect(read.records).toHaveLength(12)
    expect(read.records.every(record => record.version === 1 && record.sessionId === sessionId)).toBe(true)
    expect(read.records.find(record => record.kind === 'memory.write')?.metadata).toEqual({
      scope: 'durable',
      seq: 4,
      outcome: 'stored',
    })
    expect(read.records.find(record => record.kind === 'memory.update')?.metadata).toEqual({
      action: 'updated',
      seq: 5,
      outcome: 'already-current',
    })
  })

  it('drops extra caller fields and never projects content or platform identities', async () => {
    const { ctx } = await boot()
    const sessionId = SessionId('privacy-session')
    const canary = 'ACTIVITY_SECRET_CANARY'
    await ctx.clawdshActivity.channelReceived({
      sessionId,
      adapter: 'telegram',
      conversation: 'direct',
      mention: null,
      seq: 1,
      sender: canary,
      account: canary,
      thread: canary,
      text: canary,
      error: canary,
    } as Parameters<ClawdshActivity['channelReceived']>[0])

    const read = await ctx.clawdshActivity.list({ sessionId })
    expect(JSON.stringify(read)).not.toContain(canary)
    expect(read.records).toEqual([
      expect.objectContaining({
        kind: 'channel.received',
        summary: 'Channel message received',
        metadata: { adapter: 'telegram', conversation: 'direct', mention: null, seq: 1 },
      }),
    ])
  })

  it('treats absent old-session sidecars as normal', async () => {
    const { ctx } = await boot()
    await expect(ctx.clawdshActivity.list({ sessionId: SessionId('old-session') })).resolves.toEqual({
      records: [],
      availability: 'missing',
      degraded: false,
    })
  })

  it('keeps outcome-free Memory states and pages with default history sources', async () => {
    const { ctx } = await boot()
    const sessionId = SessionId('legacy-service-session')

    await ctx.clawdshActivity.memoryWrite({ sessionId, scope: 'daily', status: 'started', seq: 1 })
    await ctx.clawdshActivity.memoryUpdate({ sessionId, action: 'forgotten', status: 'failed', seq: 2 })

    const page = await ctx.clawdshActivity.page({ sessionId })
    expect(page.records).toHaveLength(2)
    expect(page.records.map(record => record.metadata)).toEqual(expect.arrayContaining([
      { scope: 'daily', seq: 1 },
      { action: 'forgotten', seq: 2 },
    ]))
    expect(page.availability).toEqual({ history: 'unavailable', sidecar: 'available' })
  })
})

describe('Activity invariant companion', () => {
  it('reserves the package name without claiming an authoritative runtime relation', async () => {
    const register = vi.fn(() => vi.fn())
    const dispose = await invariant.apply({ invariants: { register } } as unknown as Context)

    expect(invariant.name).toBe('clawdsh-activity-invariant')
    expect(invariant.inject).toEqual(['invariants'])
    expect(register).toHaveBeenCalledWith('@clawdsh/dsh-activity', expect.any(Function))
    expect(dispose).toEqual(expect.any(Function))
  })
})
