/**
 * Contract tests for the automation row: a real composition (agent loop +
 * scripted LLM adapter) over fake timers, with the real session-persistence
 * backend where durability is asserted. The scripted adapter is local to this
 * package — sibling channel packages keep their own test doubles.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionPersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import * as Automation from '../src/index.ts'

class TestSettings extends SettingsProvider {
  constructor(ctx: Context, private readonly store: Record<string, unknown>) { super(ctx) }
  get writable(): boolean { return true }
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve(structuredClone(this.store)) }
  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.store[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

/** Minimal scripted adapter: each model call consumes the next entry. */
interface DelayedReply {
  delayMs: number
  chunks: StreamChunk[]
}

class ScriptedAdapter extends LlmAdapter {
  requests: GenerateOptions[] = []

  constructor(private script: Array<StreamChunk[] | DelayedReply | 'hang' | 'fail'>) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const entry = this.script.shift()
    if (entry === undefined) throw new Error('ScriptedAdapter: script exhausted')
    if (entry === 'fail') throw new Error('adapter failure')
    if (entry === 'hang') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      await new Promise<void>((_resolve, reject) => {
        if (options.signal?.aborted) { reject(new Error('aborted')); return }
        options.signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
      })
      return
    }
    const chunks = Array.isArray(entry) ? entry : await new Promise<StreamChunk[]>((resolve) => {
      setTimeout(() => { resolve(entry.chunks) }, entry.delayMs)
    })
    for (const chunk of chunks) {
      if (options.signal?.aborted) throw new Error('aborted')
      yield chunk
    }
  }
}

function textReply(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

interface HarnessOptions {
  presetMount?: (agentCtx: Context, preset: string) => Promise<void>
  sessionTitle?: object
  workspaceRegistry?: object
}

const presetMounts = new WeakMap<Context, string[]>()

async function harness(
  adapter: ScriptedAdapter,
  persistenceRoot?: string,
  settingsStore: Record<string, unknown> = {},
  options: HarnessOptions = {},
): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(TestSettings, settingsStore)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(AgentDefaultModelConfig, { provider: 'mock', model: 'mock' })
  if (persistenceRoot !== undefined) await ctx.plugin(SessionPersistenceJsonl, { root: persistenceRoot })
  ctx.llm.registerAdapter(['mock'], adapter)
  const mounts: string[] = []
  presetMounts.set(ctx, mounts)
  ctx.provide('agentPresets', {
    async mount(agentCtx: Context, preset: string): Promise<void> {
      mounts.push(preset)
      if (options.presetMount !== undefined) {
        await options.presetMount(agentCtx, preset)
        return
      }
      agentCtx.systemPrompt.section({
        name: 'automation:test-preset',
        order: 1,
        text: `automation test preset ${preset}`,
      })
    },
  } as never)
  if (options.sessionTitle !== undefined) ctx.provide('sessionTitle', options.sessionTitle as never)
  if (options.workspaceRegistry !== undefined) ctx.provide('workspaceRegistry', options.workspaceRegistry as never)
  return ctx
}

async function tempDir(name: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), `dsh-${name}-`))
}

/** Drain microtask chains and fire due zero-delay timers until quiescence. */
async function settle(): Promise<void> {
  for (let index = 0; index < 40; index += 1) await Promise.resolve()
  await vi.advanceTimersByTimeAsync(0)
  for (let index = 0; index < 40; index += 1) await Promise.resolve()
}

const NOW = '2026-08-05T09:00:00.000Z'

const contexts: Context[] = []
const tempDirs: string[] = []

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(NOW))
})

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.allSettled(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  vi.useRealTimers()
})

function agentFor(ctx: Context, id: string) {
  return ctx.agents.get(SessionId(`automation:${id}`))
}

function runRecords(ctx: Context, id: string) {
  const agent = agentFor(ctx, id)
  if (agent === undefined) return []
  const records: string[] = []
  for (const event of agent.session.events) {
    if (event.type === 'automation/run' && event.data.ruleId === id) records.push(event.data.status)
  }
  return records
}

describe('automation row', () => {
  it('declares preset composition and Settings as required plugin dependencies', () => {
    expect(Automation.inject).toEqual(['agents', 'agentPresets', 'sessions', 'agentDefaultModel', 'settings'])
  })

  it('does not create a runtime, timer, or session while the restart setting is disabled', async () => {
    const adapter = new ScriptedAdapter([textReply('must not run')])
    const ctx = await harness(adapter, undefined, { 'clawdsh-automation': { enabled: false } })
    contexts.push(ctx)
    await ctx.plugin(Automation, {
      enabled: true,
      rules: [{ id: 'disabled', schedule: { kind: 'every', seconds: 60 }, message: 'work' }],
    })
    await settle()
    expect(agentFor(ctx, 'disabled')).toBeUndefined()
    expect(adapter.requests).toHaveLength(0)
    expect(ctx.settings.describe().find(entry => entry.ns === Automation.AUTOMATION_SETTINGS_NAMESPACE))
      .toMatchObject({ applies: 'restart', value: { enabled: false } })

    await ctx.settings.update(Automation.AUTOMATION_SETTINGS_NAMESPACE, { enabled: true })
    await settle()
    expect(agentFor(ctx, 'disabled')).toBeUndefined()
    expect(adapter.requests).toHaveLength(0)
  })

  it('fails mount loudly on invalid rules, naming the rule', async () => {
    const ctx = await harness(new ScriptedAdapter([]))
    contexts.push(ctx)
    await expect(ctx.plugin(Automation, {
      enabled: true,
      rules: [
        { id: 'ok-1', schedule: { kind: 'at', at: NOW }, message: 'x' },
        { id: 'ok-1', schedule: { kind: 'at', at: NOW }, message: 'y' },
      ],
    })).rejects.toThrow(/duplicate rule id "ok-1"/)
    await expect(ctx.plugin(Automation, {
      enabled: true,
      rules: [{ id: 'bad-cron', schedule: { kind: 'cron', expr: 'not a cron' }, message: 'x' }],
    })).rejects.toThrow(/bad-cron.*invalid cron expression/)
    await expect(ctx.plugin(Automation, {
      enabled: true,
      rules: [{ id: 'bad-tz', schedule: { kind: 'cron', expr: '0 9 * * *', timeZone: 'Mars/Olympus' }, message: 'x' }],
    })).rejects.toThrow(/bad-tz.*invalid timezone/)
    await expect(ctx.plugin(Automation, {
      enabled: true,
      rules: [{ id: 'bad-at', schedule: { kind: 'at', at: 'not a time' }, message: 'x' }],
    })).rejects.toThrow(/bad-at.*invalid "at" time/)
    await expect(ctx.plugin(Automation, {
      enabled: true,
      rules: [{ id: 'bad id', schedule: { kind: 'at', at: NOW }, message: 'x' }],
    })).rejects.toThrow(/bad id.*invalid id/)
  })

  it('rejects a relative cwd before agent acquisition without exposing its value', async () => {
    const ctx = await harness(new ScriptedAdapter([]))
    contexts.push(ctx)
    const privateRelativePath = 'private-customer-workspace'
    let failure: unknown
    try {
      await ctx.plugin(Automation, {
        enabled: true,
        cwd: privateRelativePath,
        rules: [{ id: 'relative-cwd', schedule: { kind: 'every', seconds: 60 }, message: 'work' }],
      })
    } catch (error) {
      failure = error
    }
    expect(String(failure)).toContain('automation: cwd must be an absolute path')
    expect(String(failure)).not.toContain(privateRelativePath)
    expect(agentFor(ctx, 'relative-cwd')).toBeUndefined()
  })

  it('fires a cron rule at the minute boundary with the framed turn and run records', async () => {
    const adapter = new ScriptedAdapter([textReply('digest done')])
    const ctx = await harness(adapter)
    contexts.push(ctx)
    vi.setSystemTime(new Date('2026-08-05T08:59:50.000Z'))
    await ctx.plugin(Automation, {
      enabled: true,
      rules: [{ id: 'digest', name: 'Daily', schedule: { kind: 'cron', expr: '0 9 * * *', timeZone: 'UTC' }, message: 'post the digest' }],
    })
    await settle()
    expect(adapter.requests).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(10_000)
    await settle()

    expect(adapter.requests).toHaveLength(1)
    expect(presetMounts.get(ctx)).toEqual(['clawdsh'])
    expect(adapter.requests[0]?.system).toContain('automation test preset clawdsh')
    const agent = agentFor(ctx, 'digest')
    expect(agent).toBeDefined()
    const turn = agent?.session.events.find(event =>
      event.type === 'user/message' && event.data.source.kind === 'plugin')
    expect(turn?.type).toBe('user/message')
    if (turn?.type === 'user/message') {
      expect(turn.data.content[0]).toMatchObject({ type: 'text', text: '[automation:digest Daily] post the digest' })
      expect(turn.data.source).toEqual({ kind: 'plugin', plugin: 'automation' })
    }
    expect(runRecords(ctx, 'digest')).toEqual(['started', 'ok'])
  })

  it('records the configured preset and cwd on a new session, then publishes title and workspace membership', async () => {
    const titles = new Map<string, { title: string }>()
    const renamed: string[] = []
    const attached: string[] = []
    const resolveByPath = vi.fn(async () => ({
      async attachSession(id: SessionId): Promise<void> { attached.push(id) },
    }))
    const ctx = await harness(new ScriptedAdapter([]), undefined, {}, {
      sessionTitle: {
        get: (session: { id: SessionId }) => titles.get(session.id),
        rename: (session: { id: SessionId }, title: string) => {
          const snapshot = { title }
          titles.set(session.id, snapshot)
          renamed.push(title)
          return snapshot
        },
      },
      workspaceRegistry: { resolveByPath },
    })
    contexts.push(ctx)

    await ctx.plugin(Automation, {
      enabled: true,
      preset: 'personal-assistant',
      cwd: process.cwd(),
      rules: [{ id: 'visible', name: '晨间摘要', schedule: { kind: 'every', seconds: 60 }, message: 'work' }],
    })

    const agent = agentFor(ctx, 'visible')
    expect(agent?.session.header).toMatchObject({ cwd: process.cwd(), agentPreset: 'personal-assistant' })
    expect(presetMounts.get(ctx)).toEqual(['personal-assistant'])
    expect(renamed).toEqual(['自动任务 · 晨间摘要'])
    expect(resolveByPath).toHaveBeenCalledWith(process.cwd())
    expect(attached).toEqual([SessionId('automation:visible')])
  })

  it('publishes a resumed session from its immutable cwd after the configured cwd changes', { timeout: 15_000 }, async () => {
    vi.useRealTimers()
    const root = await tempDir('automation-cwd-resume')
    tempDirs.push(root)
    const originalCwd = join(root, 'original-workspace')
    const changedCwd = join(root, 'changed-workspace')
    const first = await harness(new ScriptedAdapter([textReply('persisted')]), root)
    contexts.push(first)
    const rules: Automation.Config['rules'] = [{
      id: 'stable-cwd',
      schedule: { kind: 'at', at: NOW },
      message: 'work',
    }]
    await first.plugin(Automation, {
      enabled: true,
      cwd: originalCwd,
      rules,
    })
    await vi.waitFor(() => { expect(runRecords(first, 'stable-cwd')).toEqual(['started', 'ok']) }, { timeout: 5_000 })
    expect(agentFor(first, 'stable-cwd')?.session.header.cwd).toBe(originalCwd)
    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)

    const attached: SessionId[] = []
    const resolveByPath = vi.fn(async () => ({
      async attachSession(id: SessionId): Promise<void> { attached.push(id) },
    }))
    const second = await harness(new ScriptedAdapter([]), root, {}, {
      workspaceRegistry: { resolveByPath },
    })
    contexts.push(second)
    await second.plugin(Automation, {
      enabled: true,
      cwd: changedCwd,
      rules,
    })

    expect(agentFor(second, 'stable-cwd')?.session.header.cwd).toBe(originalCwd)
    expect(resolveByPath).toHaveBeenCalledWith(originalCwd)
    expect(resolveByPath).not.toHaveBeenCalledWith(changedCwd)
    expect(attached).toEqual([SessionId('automation:stable-cwd')])
  })

  it('waits a complete interval before the first every occurrence', async () => {
    const adapter = new ScriptedAdapter([textReply('done')])
    const ctx = await harness(adapter)
    contexts.push(ctx)
    await ctx.plugin(Automation, {
      enabled: true,
      rules: [{ id: 'interval', schedule: { kind: 'every', seconds: 60 }, message: 'work' }],
    })

    await vi.advanceTimersByTimeAsync(59_999)
    await settle()
    expect(adapter.requests).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    await settle()
    expect(adapter.requests).toHaveLength(1)
    expect(runRecords(ctx, 'interval')).toEqual(['started', 'ok'])
  })

  it('skips overlapping fires while a run is in flight', async () => {
    const adapter = new ScriptedAdapter(['hang'])
    const ctx = await harness(adapter)
    contexts.push(ctx)
    await ctx.plugin(Automation, {
      enabled: true,
      rules: [{ id: 'slow', schedule: { kind: 'every', seconds: 60 }, message: 'work' }],
    })
    await settle()
    expect(adapter.requests).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(60_000)
    await settle()
    expect(adapter.requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(60_000)
    await settle()
    expect(adapter.requests).toHaveLength(1)
    expect(runRecords(ctx, 'slow')).toEqual(['started'])
  })

  it('skips missed occurrences without catch-up and re-arms for the next one', async () => {
    const adapter = new ScriptedAdapter([textReply('a'), textReply('b')])
    const ctx = await harness(adapter)
    contexts.push(ctx)
    vi.setSystemTime(new Date('2026-08-05T09:00:30.000Z'))
    await ctx.plugin(Automation, {
      enabled: true,
      rules: [{ id: 'minutely', schedule: { kind: 'cron', expr: '*/1 * * * *', timeZone: 'UTC' }, message: 'tick' }],
    })
    await settle()
    expect(adapter.requests).toHaveLength(0)

    // The clock jumps ten minutes: exactly one occurrence runs, the in-between minutes are skipped.
    // (`setSystemTime` moves `Date.now()` only; the timer clock still crosses the armed 09:01:00 deadline.)
    vi.setSystemTime(new Date('2026-08-05T09:10:30.000Z'))
    await vi.advanceTimersByTimeAsync(30_000)
    await settle()
    expect(adapter.requests).toHaveLength(1)

    // The next occurrence after completion still fires without replaying the missed minutes.
    await vi.advanceTimersByTimeAsync(60_000)
    await settle()
    expect(adapter.requests).toHaveLength(2)
  })

  it('schedules an interval from completion time instead of catching up after a long run', async () => {
    const adapter = new ScriptedAdapter([
      { delayMs: 90_000, chunks: textReply('slow') },
      textReply('next'),
    ])
    const ctx = await harness(adapter)
    contexts.push(ctx)
    await ctx.plugin(Automation, {
      enabled: true,
      rules: [{ id: 'long', schedule: { kind: 'every', seconds: 60 }, message: 'work' }],
    })

    await vi.advanceTimersByTimeAsync(60_000)
    await settle()
    expect(adapter.requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(90_000)
    await settle()
    expect(runRecords(ctx, 'long')).toEqual(['started', 'ok'])

    await vi.advanceTimersByTimeAsync(29_999)
    await settle()
    expect(adapter.requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    await settle()
    expect(adapter.requests).toHaveLength(2)
  })

  it('resumes the same durable session across remounts, keeping prior run records', { timeout: 15_000 }, async () => {
    // Real timers: the persistence write-behind window runs on real 200ms
    // deadlines; fake timers would require tens of seconds of clock advancement.
    vi.useRealTimers()
    const root = await tempDir('automation-persist')
    tempDirs.push(root)
    const first = await harness(new ScriptedAdapter([textReply('run one')]), root)
    contexts.push(first)
    await first.plugin(Automation, {
      enabled: true,
      rules: [{ id: 'daily', schedule: { kind: 'every', seconds: 1 }, message: 'work' }],
    })
    await vi.waitFor(() => { expect(runRecords(first, 'daily')).toEqual(['started', 'ok']) }, { timeout: 5_000 })

    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)

    const second = await harness(new ScriptedAdapter([textReply('run two')]), root)
    contexts.push(second)
    await second.plugin(Automation, {
      enabled: true,
      rules: [{ id: 'daily', schedule: { kind: 'every', seconds: 1 }, message: 'work' }],
    })
    // The remounted rule waits one interval, then the resumed session carries both runs.
    await vi.waitFor(() => { expect(runRecords(second, 'daily')).toEqual(['started', 'ok', 'started', 'ok']) }, { timeout: 5_000 })
    const agent = agentFor(second, 'daily')
    const turnCount = agent?.session.events.filter(event =>
      event.type === 'user/message' && event.data.source.kind === 'plugin').length
    expect(turnCount).toBe(2)
  })

  it('suppresses a past one-shot at rule that already recorded an ok run', { timeout: 15_000 }, async () => {
    // Real timers: the persistence write-behind window runs on real deadlines (see the resume test).
    vi.useRealTimers()
    const root = await tempDir('automation-once')
    tempDirs.push(root)
    const first = await harness(new ScriptedAdapter([textReply('once')]), root)
    contexts.push(first)
    const rules: Automation.Config['rules'] = [{ id: 'once', schedule: { kind: 'at', at: '2026-08-05T08:00:00.000Z' }, message: 'run once' }]
    await first.plugin(Automation, { enabled: true, rules })
    await vi.waitFor(() => { expect(runRecords(first, 'once')).toEqual(['started', 'ok']) }, { timeout: 5_000 })

    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)

    const secondAdapter = new ScriptedAdapter([])
    const second = await harness(secondAdapter, root)
    contexts.push(second)
    await second.plugin(Automation, { enabled: true, rules })
    // The mount-time once-guard skips the completed rule; give any hypothetical fire a window, then assert nothing ran.
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(secondAdapter.requests).toHaveLength(0)
    expect(runRecords(second, 'once')).toEqual(['started', 'ok'])
  })

  it('treats a failed at occurrence as terminal across restart', { timeout: 15_000 }, async () => {
    vi.useRealTimers()
    const root = await tempDir('automation-once-error')
    tempDirs.push(root)
    const rules: Automation.Config['rules'] = [{
      id: 'once-error',
      schedule: { kind: 'at', at: '2026-08-05T08:00:00.000Z' },
      message: 'run once',
    }]
    const first = await harness(new ScriptedAdapter(['fail']), root)
    contexts.push(first)
    await first.plugin(Automation, { enabled: true, rules })
    await vi.waitFor(() => { expect(runRecords(first, 'once-error')).toEqual(['started', 'error']) }, { timeout: 5_000 })

    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)
    const secondAdapter = new ScriptedAdapter([])
    const second = await harness(secondAdapter, root)
    contexts.push(second)
    await second.plugin(Automation, { enabled: true, rules })
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(secondAdapter.requests).toHaveLength(0)
    expect(runRecords(second, 'once-error')).toEqual(['started', 'error'])
  })

  it('records an error run and re-arms for the next occurrence', async () => {
    const adapter = new ScriptedAdapter(['fail', 'fail'])
    const ctx = await harness(adapter)
    contexts.push(ctx)
    await ctx.plugin(Automation, {
      enabled: true,
      rules: [{ id: 'flaky', schedule: { kind: 'every', seconds: 60 }, message: 'work' }],
    })
    await settle()
    expect(runRecords(ctx, 'flaky')).toEqual([])

    await vi.advanceTimersByTimeAsync(60_000)
    await settle()
    expect(runRecords(ctx, 'flaky')).toEqual(['started', 'error'])
    await vi.advanceTimersByTimeAsync(60_000)
    await settle()
    expect(runRecords(ctx, 'flaky')).toEqual(['started', 'error', 'started', 'error'])
    expect(adapter.requests).toHaveLength(2)
  })

  it('never appends a second terminal record when the terminal flush fails', async () => {
    const adapter = new ScriptedAdapter([textReply('done')])
    const ctx = await harness(adapter)
    contexts.push(ctx)
    await ctx.plugin(Automation, {
      enabled: true,
      rules: [{ id: 'flush-failure', schedule: { kind: 'every', seconds: 60 }, message: 'work' }],
    })
    const originalFlush = ctx.sessions.flush.bind(ctx.sessions)
    vi.spyOn(ctx.sessions, 'flush').mockImplementation(async (session) => {
      const last = session.events.at(-1)
      if (last?.type === 'automation/run' && last.data.status === 'ok') throw new Error('disk unavailable')
      return await originalFlush(session)
    })

    await vi.advanceTimersByTimeAsync(60_000)
    await settle()
    expect(runRecords(ctx, 'flush-failure')).toEqual(['started', 'ok'])
  })

  it('fails plugin initialization when preset composition or workspace discovery fails', async () => {
    const presetFailure = await harness(new ScriptedAdapter([]), undefined, {}, {
      presetMount: () => Promise.reject(new Error('preset broken')),
    })
    contexts.push(presetFailure)
    await expect(presetFailure.plugin(Automation, {
      enabled: true,
      rules: [{ id: 'broken-preset', schedule: { kind: 'every', seconds: 60 }, message: 'work' }],
    })).rejects.toThrow(/broken-preset.*preset broken/)
    expect(agentFor(presetFailure, 'broken-preset')).toBeUndefined()

    const workspaceFailure = await harness(new ScriptedAdapter([]), undefined, {}, {
      workspaceRegistry: { resolveByPath: () => Promise.resolve(undefined) },
    })
    contexts.push(workspaceFailure)
    await expect(workspaceFailure.plugin(Automation, {
      enabled: true,
      rules: [{ id: 'hidden', schedule: { kind: 'every', seconds: 60 }, message: 'work' }],
    })).rejects.toThrow(/hidden.*no registered workspace owns the Automation session cwd/)
    expect(agentFor(workspaceFailure, 'hidden')).toBeUndefined()
  })

  it('does not publish a late agent when its owner is disposed during preset acquisition', async () => {
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const ctx = await harness(new ScriptedAdapter([]), undefined, {}, {
      presetMount: async () => {
        entered.resolve(undefined)
        await release.promise
      },
    })
    contexts.push(ctx)
    const agents = ctx.agents
    const mounting = ctx.plugin(Automation, {
      enabled: true,
      rules: [{ id: 'acquiring', schedule: { kind: 'every', seconds: 60 }, message: 'work' }],
    })
    await entered.promise
    const disposing = ctx.fiber.dispose()
    release.resolve(undefined)
    await Promise.allSettled([mounting, disposing])
    contexts.splice(contexts.indexOf(ctx), 1)
    expect(agents.get(SessionId('automation:acquiring'))).toBeUndefined()
  })

  it('stops firing and disposes its agents when the plugin fiber is disposed', async () => {
    const adapter = new ScriptedAdapter([textReply('one')])
    const ctx = await harness(adapter)
    contexts.push(ctx)
    const fiber = await ctx.plugin(Automation, {
      enabled: true,
      rules: [{ id: 'stops', schedule: { kind: 'every', seconds: 60 }, message: 'work' }],
    })
    await settle()
    expect(adapter.requests).toHaveLength(0)
    expect(agentFor(ctx, 'stops')).toBeDefined()

    await fiber.dispose()
    await vi.advanceTimersByTimeAsync(120_000)
    await settle()
    expect(adapter.requests).toHaveLength(0)
    expect(agentFor(ctx, 'stops')).toBeUndefined()
  })
})
