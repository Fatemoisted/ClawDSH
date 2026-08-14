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
import * as Automation from '../src/index.ts'

/** Minimal scripted adapter: each model call consumes the next entry. */
class ScriptedAdapter extends LlmAdapter {
  requests: GenerateOptions[] = []

  constructor(private script: Array<StreamChunk[] | 'hang' | 'fail'>) {
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
    for (const chunk of entry) {
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

async function harness(adapter: ScriptedAdapter, persistenceRoot?: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(AgentDefaultModelConfig, { provider: 'mock', model: 'mock' })
  if (persistenceRoot !== undefined) await ctx.plugin(SessionPersistenceJsonl, { root: persistenceRoot })
  ctx.llm.registerAdapter(['mock'], adapter)
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
  it('fails mount loudly on invalid rules, naming the rule', async () => {
    const ctx = await harness(new ScriptedAdapter([]))
    contexts.push(ctx)
    await expect(ctx.plugin(Automation, {
      rules: [
        { id: 'ok-1', schedule: { kind: 'at', at: NOW }, message: 'x' },
        { id: 'ok-1', schedule: { kind: 'at', at: NOW }, message: 'y' },
      ],
    })).rejects.toThrow(/duplicate rule id "ok-1"/)
    await expect(ctx.plugin(Automation, {
      rules: [{ id: 'bad-cron', schedule: { kind: 'cron', expr: 'not a cron' }, message: 'x' }],
    })).rejects.toThrow(/bad-cron.*invalid cron expression/)
    await expect(ctx.plugin(Automation, {
      rules: [{ id: 'bad-tz', schedule: { kind: 'cron', expr: '0 9 * * *', timeZone: 'Mars/Olympus' }, message: 'x' }],
    })).rejects.toThrow(/bad-tz.*invalid timezone/)
    await expect(ctx.plugin(Automation, {
      rules: [{ id: 'bad-at', schedule: { kind: 'at', at: 'not a time' }, message: 'x' }],
    })).rejects.toThrow(/bad-at.*invalid "at" time/)
    await expect(ctx.plugin(Automation, {
      rules: [{ id: 'bad id', schedule: { kind: 'at', at: NOW }, message: 'x' }],
    })).rejects.toThrow(/bad id.*invalid id/)
  })

  it('fires a cron rule at the minute boundary with the framed turn and run records', async () => {
    const adapter = new ScriptedAdapter([textReply('digest done')])
    const ctx = await harness(adapter)
    contexts.push(ctx)
    vi.setSystemTime(new Date('2026-08-05T08:59:50.000Z'))
    await ctx.plugin(Automation, {
      rules: [{ id: 'digest', name: 'Daily', schedule: { kind: 'cron', expr: '0 9 * * *', timeZone: 'UTC' }, message: 'post the digest' }],
    })
    await settle()
    expect(adapter.requests).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(10_000)
    await settle()

    expect(adapter.requests).toHaveLength(1)
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

  it('skips overlapping fires while a run is in flight', async () => {
    const adapter = new ScriptedAdapter(['hang'])
    const ctx = await harness(adapter)
    contexts.push(ctx)
    await ctx.plugin(Automation, {
      rules: [{ id: 'slow', schedule: { kind: 'every', seconds: 60 }, message: 'work' }],
    })
    await settle()
    expect(adapter.requests).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(60_000)
    await settle()
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

    // The next occurrence (09:12:00) still fires.
    await vi.advanceTimersByTimeAsync(60_000)
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
      rules: [{ id: 'daily', schedule: { kind: 'every', seconds: 60 }, message: 'work' }],
    })
    await vi.waitFor(() => expect(runRecords(first, 'daily')).toEqual(['started', 'ok']), { timeout: 5_000 })

    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)

    const second = await harness(new ScriptedAdapter([textReply('run two')]), root)
    contexts.push(second)
    await second.plugin(Automation, {
      rules: [{ id: 'daily', schedule: { kind: 'every', seconds: 60 }, message: 'work' }],
    })
    // The remounted rule fires once more (anchor reset), and the resumed session carries run one's records.
    await vi.waitFor(() => expect(runRecords(second, 'daily')).toEqual(['started', 'ok', 'started', 'ok']), { timeout: 5_000 })
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
    await first.plugin(Automation, { rules })
    await vi.waitFor(() => expect(runRecords(first, 'once')).toEqual(['started', 'ok']), { timeout: 5_000 })

    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)

    const secondAdapter = new ScriptedAdapter([])
    const second = await harness(secondAdapter, root)
    contexts.push(second)
    await second.plugin(Automation, { rules })
    // The mount-time once-guard skips the completed rule; give any hypothetical fire a window, then assert nothing ran.
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(secondAdapter.requests).toHaveLength(0)
    expect(runRecords(second, 'once')).toEqual(['started', 'ok'])
  })

  it('records an error run and re-arms for the next occurrence', async () => {
    const adapter = new ScriptedAdapter(['fail', 'fail'])
    const ctx = await harness(adapter)
    contexts.push(ctx)
    await ctx.plugin(Automation, {
      rules: [{ id: 'flaky', schedule: { kind: 'every', seconds: 60 }, message: 'work' }],
    })
    await settle()
    expect(runRecords(ctx, 'flaky')).toEqual(['started', 'error'])

    await vi.advanceTimersByTimeAsync(60_000)
    await settle()
    expect(runRecords(ctx, 'flaky')).toEqual(['started', 'error', 'started', 'error'])
    expect(adapter.requests).toHaveLength(2)
  })

  it('stops firing and disposes its agents when the plugin fiber is disposed', async () => {
    const adapter = new ScriptedAdapter([textReply('one')])
    const ctx = await harness(adapter)
    contexts.push(ctx)
    const fiber = await ctx.plugin(Automation, {
      rules: [{ id: 'stops', schedule: { kind: 'every', seconds: 60 }, message: 'work' }],
    })
    await settle()
    expect(adapter.requests).toHaveLength(1)
    expect(agentFor(ctx, 'stops')).toBeDefined()

    await fiber.dispose()
    await vi.advanceTimersByTimeAsync(120_000)
    await settle()
    expect(adapter.requests).toHaveLength(1)
    expect(agentFor(ctx, 'stops')).toBeUndefined()
  })
})
