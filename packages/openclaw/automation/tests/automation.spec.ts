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
import AgentRegistry, { type Agent, type AgentHandle } from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
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
const testToolSignal = new AbortController().signal
let toolCall = 0

function ownerAgent(source: Record<string, unknown> = { kind: 'user' }): Agent {
  const session = Session.create(SessionId(`owner-${String(++toolCall)}`))
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'create the requested reminder' }],
    source: source as never,
  }), { surfaceOp: 'append' })
  return { id: session.id, session } as unknown as Agent
}

function callAutomation(ctx: Context, args: unknown, agent: Agent) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId(`automation-${String(++toolCall)}`),
    name: 'automation',
    arguments: args,
    agent,
  })
}

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
    expect(Automation.inject).toEqual(['agents', 'agentPresets', 'sessions', 'agentDefaultModel', 'settings', 'tools'])
  })

  it('does not create a runtime, timer, or session while disabled and applies enablement live', async () => {
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
      .toMatchObject({ applies: 'live', value: { enabled: false } })

    await ctx.settings.update(Automation.AUTOMATION_SETTINGS_NAMESPACE, { enabled: true })
    await settle()
    expect(agentFor(ctx, 'disabled')).toBeDefined()
    expect(adapter.requests).toHaveLength(0)
    expect(ctx.settings.describe().find(entry => entry.ns === Automation.AUTOMATION_SETTINGS_NAMESPACE)?.value)
      .toMatchObject({ enabled: true })
  })

  it('exposes one explicit Automation tool that creates, lists, updates, and removes live rules', async () => {
    const adapter = new ScriptedAdapter([textReply('reminder complete')])
    const store: Record<string, unknown> = {}
    const ctx = await harness(adapter, undefined, store)
    contexts.push(ctx)
    await ctx.plugin(Automation, { enabled: false, rules: [] })
    const schema = ctx.tools.schemas().find(item => item.name === 'automation')
    expect(schema?.description).toContain('never substitute Bash, Batch, jobs, sleep, or a background process')

    const agent = ownerAgent()
    const added = await callAutomation(ctx, {
      action: 'add',
      name: 'three seconds',
      message: 'return the reminder',
      after_seconds: 3,
    }, agent)
    expect(added.isError).toBe(false)
    const settings = ctx.settings.describe().find(entry => entry.ns === Automation.AUTOMATION_SETTINGS_NAMESPACE)
    const rules = (settings?.value as Automation.Config).rules ?? []
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({ name: 'three seconds', message: 'return the reminder', enabled: true })
    expect(rules[0]?.delivery).toBeUndefined()
    expect(agentFor(ctx, rules[0]!.id)).toBeDefined()

    const listed = await callAutomation(ctx, { action: 'list' }, agent)
    expect(listed.isError).toBe(false)
    expect(listed.value).toMatchObject({ enabled: true, tasks: [{ delivery: 'session' }] })

    const updated = await callAutomation(ctx, {
      action: 'update', id: rules[0]!.id, message: 'updated reminder', enabled: false,
    }, agent)
    expect(updated.isError).toBe(false)
    expect(ctx.settings.describe().find(entry => entry.ns === Automation.AUTOMATION_SETTINGS_NAMESPACE)?.value)
      .toMatchObject({ enabled: false })
    expect(agentFor(ctx, rules[0]!.id)).toBeUndefined()

    const removed = await callAutomation(ctx, { action: 'remove', id: rules[0]!.id }, agent)
    expect(removed.isError).toBe(false)
    expect(removed.value).toMatchObject({ enabled: false, tasks: [] })
    expect(store['clawdsh-automation']).toMatchObject({ enabled: false, rules: [] })
  })

  it('captures an owner channel route privately and sends the scheduled final answer back to it', async () => {
    const adapter = new ScriptedAdapter([textReply('飞书提醒已完成')])
    const action = vi.fn(async (_action: unknown) => ({ status: 'accepted' }))
    const ctx = await harness(adapter)
    contexts.push(ctx)
    ctx.provide('channels', { action } as never)
    await ctx.plugin(Automation, { enabled: false, rules: [] })
    const agent = ownerAgent({
      kind: 'channel',
      trust: 'owner',
      gatewayInstanceId: 'gateway-1',
      channel: 'feishu',
      account: 'bot-account',
      conversation: 'chat-1',
      thread: 'thread-1',
    })

    const added = await callAutomation(ctx, {
      action: 'add',
      message: '三秒后提醒我',
      after_seconds: 3,
    }, agent)
    expect(added.isError).toBe(false)
    const rule = (ctx.settings.describe().find(entry => entry.ns === Automation.AUTOMATION_SETTINGS_NAMESPACE)
      ?.value as Automation.Config).rules?.[0]
    expect(rule?.delivery).toEqual({
      kind: 'channel',
      gatewayInstanceId: 'gateway-1',
      channel: 'feishu',
      account: 'bot-account',
      conversation: 'chat-1',
      thread: 'thread-1',
    })

    await vi.advanceTimersByTimeAsync(3_000)
    await settle()
    expect(runRecords(ctx, rule!.id)).toEqual(['started', 'ok'])
    expect(action).toHaveBeenCalledOnce()
    expect(action.mock.calls[0]?.[0]).toMatchObject({
      protocolVersion: 1,
      kind: 'send',
      text: '飞书提醒已完成',
      media: [],
      target: {
        gatewayInstanceId: 'gateway-1',
        channel: 'feishu',
        account: 'bot-account',
        conversation: 'chat-1',
        thread: 'thread-1',
      },
    })
    expect((action.mock.calls[0]?.[0] as { actionId: string }).actionId).toMatch(/^[a-f0-9]{64}$/)
  })

  it('keeps owner authority when context providers inject model-visible user messages', async () => {
    const ctx = await harness(new ScriptedAdapter([]))
    contexts.push(ctx)
    await ctx.plugin(Automation, { enabled: false, rules: [] })
    const agent = ownerAgent({
      kind: 'channel',
      trust: 'owner',
      gatewayInstanceId: 'gateway-1',
      channel: 'feishu',
      account: 'bot-account',
      conversation: 'chat-1',
    })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'workspace instructions' }],
      source: { kind: 'agent-instructions', form: 'instructions', changes: [] } as never,
    }), { surfaceOp: 'append' })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'available skills' }],
      source: { kind: 'skill-catalog', form: 'catalog', entries: [] } as never,
    }), { surfaceOp: 'append' })

    const added = await callAutomation(ctx, {
      action: 'add',
      message: '三分钟后提醒我',
      after_seconds: 180,
    }, agent)

    expect(added.isError).toBe(false)
    expect((ctx.settings.describe().find(entry => entry.ns === Automation.AUTOMATION_SETTINGS_NAMESPACE)
      ?.value as Automation.Config).rules?.[0]?.delivery).toMatchObject({
      kind: 'channel',
      gatewayInstanceId: 'gateway-1',
      channel: 'feishu',
      account: 'bot-account',
      conversation: 'chat-1',
    })
  })

  it('does not reuse owner authority from an earlier turn', async () => {
    const ctx = await harness(new ScriptedAdapter([]))
    contexts.push(ctx)
    await ctx.plugin(Automation, { enabled: false, rules: [] })
    const agent = ownerAgent({
      kind: 'channel',
      trust: 'owner',
      gatewayInstanceId: 'gateway-1',
      channel: 'feishu',
      account: 'bot-account',
      conversation: 'chat-1',
    })
    agent.session.append('turn/end', { turn: 1, status: 'completed' } as never)
    agent.session.append('turn/start', { turn: 2 })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'scheduled continuation' }],
      source: { kind: 'plugin', plugin: 'automation' },
    }), { surfaceOp: 'append' })

    const added = await callAutomation(ctx, {
      action: 'add',
      message: 'must not be created',
      after_seconds: 180,
    }, agent)

    expect(added.isError).toBe(true)
    expect(JSON.stringify(added.content)).toContain('active turn')
    expect((ctx.settings.describe().find(entry => entry.ns === Automation.AUTOMATION_SETTINGS_NAMESPACE)
      ?.value as Automation.Config).rules).toEqual([])
  })

  it('rejects task mutations without direct human authority or a complete owner route', async () => {
    const ctx = await harness(new ScriptedAdapter([]))
    contexts.push(ctx)
    await ctx.plugin(Automation, { enabled: false, rules: [] })
    const args = { action: 'add', message: 'work later', every_seconds: 600 }

    const withoutAgent = await callAutomation(ctx, args, undefined as never)
    expect(withoutAgent.isError).toBe(true)
    expect(JSON.stringify(withoutAgent.content)).toContain('owning Agent')

    const noTurnSession = Session.create(SessionId('owner-no-turn'))
    const noTurn = await callAutomation(ctx, args, { id: noTurnSession.id, session: noTurnSession } as Agent)
    expect(noTurn.isError).toBe(true)
    expect(JSON.stringify(noTurn.content)).toContain('active turn')

    const malformedSession = Session.create(SessionId('owner-malformed-source'))
    malformedSession.append('turn/start', { turn: 1 })
    malformedSession.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'mutate' }],
      source: null as never,
    }), { surfaceOp: 'append' })
    const malformed = await callAutomation(ctx, args, {
      id: malformedSession.id,
      session: malformedSession,
    } as Agent)
    expect(malformed.isError).toBe(true)
    expect(JSON.stringify(malformed.content)).toContain('direct human input')

    const untrusted = await callAutomation(ctx, args, ownerAgent({
      kind: 'channel',
      trust: 'member',
      gatewayInstanceId: 'gateway',
      channel: 'feishu',
      account: 'account',
      conversation: 'chat',
    }))
    expect(untrusted.isError).toBe(true)
    expect(JSON.stringify(untrusted.content)).toContain('owner-authenticated')

    for (const field of ['gatewayInstanceId', 'channel', 'account', 'conversation'] as const) {
      const source: Record<string, unknown> = {
        kind: 'channel',
        trust: 'owner',
        gatewayInstanceId: 'gateway',
        channel: 'feishu',
        account: 'account',
        conversation: 'chat',
      }
      source[field] = ''
      const result = await callAutomation(ctx, args, ownerAgent(source))
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result.content)).toContain('durable delivery route')
    }

    const withTrailingAssistant = ownerAgent()
    withTrailingAssistant.session.append('assistant/message', {
      message: { role: 'assistant', content: [{ type: 'text', text: 'context' }] },
    } as never, { surfaceOp: 'append' })
    const accepted = await callAutomation(ctx, args, withTrailingAssistant)
    expect(accepted.isError).toBe(false)
  })

  it('rejects invalid model-authored schedules and task fields without changing Settings', async () => {
    const ctx = await harness(new ScriptedAdapter([]))
    contexts.push(ctx)
    await ctx.plugin(Automation, { enabled: false, rules: [] })
    const agent = ownerAgent()
    const invalid = [
      { action: 'add', message: 'x' },
      { action: 'add', message: 'x', time_zone: 'UTC' },
      { action: 'add', message: 'x', after_seconds: 1, every_seconds: 2 },
      { action: 'add', message: 'x', after_seconds: 0 },
      { action: 'add', message: 'x', after_seconds: 1.5 },
      { action: 'add', message: 'x', after_seconds: 1, time_zone: 'UTC' },
      { action: 'add', message: 'x', at: '   ' },
      { action: 'add', message: 'x', at: NOW, time_zone: 'UTC' },
      { action: 'add', message: 'x', every_seconds: 0 },
      { action: 'add', message: 'x', every_seconds: 60, time_zone: 'UTC' },
      { action: 'add', message: 'x', cron: '   ' },
      { action: 'add', message: '   ', every_seconds: 60 },
      { action: 'remove', id: 'missing', every_seconds: 60 },
    ]
    for (const args of invalid) {
      const result = await callAutomation(ctx, args, agent)
      expect(result.isError).toBe(true)
    }
    expect((ctx.settings.describe().find(entry => entry.ns === Automation.AUTOMATION_SETTINGS_NAMESPACE)
      ?.value as Automation.Config).rules).toEqual([])
  })

  it('reports unknown ids and updates one selected rule among multiple tasks', async () => {
    const ctx = await harness(new ScriptedAdapter([]))
    contexts.push(ctx)
    await ctx.plugin(Automation, {
      enabled: false,
      rules: [
        { id: 'first', name: 'First', schedule: { kind: 'every', seconds: 600 }, message: 'first', enabled: false },
        { id: 'second', schedule: { kind: 'cron', expr: '0 9 * * *' }, message: 'second', enabled: false },
        { id: 'third', schedule: { kind: 'at', at: '2027-08-05T09:00:00.000Z' }, message: 'third', enabled: false },
      ],
    })
    const agent = ownerAgent()

    const listed = await callAutomation(ctx, { action: 'list' }, agent)
    expect(listed.value).toMatchObject({
      enabled: false,
      tasks: [
        { schedule: { kind: 'every', seconds: 600 }, selected: false },
        { schedule: { kind: 'cron', expr: '0 9 * * *' }, selected: false },
        { schedule: { kind: 'at', at: '2027-08-05T09:00:00.000Z' }, selected: false },
      ],
    })

    for (const action of ['update', 'remove'] as const) {
      const result = await callAutomation(ctx, { action, id: 'unknown' }, agent)
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result.content)).toContain('unknown task id')
    }

    const updated = await callAutomation(ctx, {
      action: 'update',
      id: 'second',
      name: ' Updated ',
      message: ' changed ',
      enabled: true,
      cron: '30 9 * * *',
      time_zone: ' UTC ',
    }, agent)
    expect(updated.isError).toBe(false)
    expect(updated.value).toMatchObject({
      enabled: true,
      tasks: [
        { id: 'first', selected: false },
        {
          id: 'second',
          name: 'Updated',
          message: 'changed',
          enabled: true,
          schedule: { kind: 'cron', expr: '30 9 * * *', timeZone: 'UTC' },
          selected: true,
        },
        { id: 'third', selected: false },
      ],
    })

    const removed = await callAutomation(ctx, { action: 'remove', id: 'first' }, agent)
    expect(removed.isError).toBe(false)
    expect(removed.value).toMatchObject({ enabled: true })

    const nameOnly = await callAutomation(ctx, { action: 'update', id: 'second', name: 'Renamed' }, agent)
    expect(nameOnly.isError).toBe(false)
    expect(JSON.stringify(nameOnly.value)).toContain('"name":"Renamed","message":"changed","enabled":true')
  })

  it('creates a cron task without an optional timezone', async () => {
    const ctx = await harness(new ScriptedAdapter([]))
    contexts.push(ctx)
    await ctx.plugin(Automation, { enabled: false, rules: [] })

    const added = await callAutomation(ctx, {
      action: 'add', message: 'daily work', cron: '0 9 * * *',
    }, ownerAgent())

    expect(added.isError).toBe(false)
    expect(added.value).toMatchObject({ tasks: [{ schedule: { kind: 'cron', expr: '0 9 * * *' } }] })
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

  it.runIf(process.platform !== 'win32')('rejects a Windows absolute spelling at the POSIX host boundary', async () => {
    const ctx = await harness(new ScriptedAdapter([]))
    contexts.push(ctx)
    const windowsPath = 'C:\\clawdsh'
    const config: Automation.Config = {
      enabled: true,
      cwd: windowsPath,
      rules: [{ id: 'foreign-cwd', schedule: { kind: 'every', seconds: 60 }, message: 'work' }],
    }

    expect(Automation.Config(config).cwd).toBe(windowsPath)
    await expect(ctx.plugin(Automation, config)).rejects.toThrow('automation: cwd must be an absolute path')
    expect(agentFor(ctx, 'foreign-cwd')).toBeUndefined()
  })

  it('uses the rule id when publishing a title for an unnamed task', async () => {
    const rename = vi.fn()
    const ctx = await harness(new ScriptedAdapter([]), undefined, {}, {
      sessionTitle: { get: () => undefined, rename },
    })
    contexts.push(ctx)
    await ctx.plugin(Automation, {
      enabled: true,
      rules: [{ id: 'unnamed-title', schedule: { kind: 'every', seconds: 60 }, message: 'work' }],
    })

    expect(rename).toHaveBeenCalledWith(expect.anything(), '自动任务 · unnamed-title')
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

  it('turns channel delivery preconditions and dead letters into terminal run errors', async () => {
    const delivery: Automation.AutomationChannelDelivery = {
      kind: 'channel',
      gatewayInstanceId: 'gateway',
      channel: 'feishu',
      account: 'account',
      conversation: 'chat',
    }
    const cases = [
      { id: 'empty-answer', reply: '   ', channels: { action: vi.fn(async () => ({ status: 'accepted' })) } },
      { id: 'missing-channel', reply: 'answer', channels: undefined },
      {
        id: 'dead-letter',
        reply: 'answer',
        channels: { action: vi.fn(async () => ({ status: 'dead-letter', error: { message: 'offline' } })) },
      },
      { id: 'without-thread', reply: 'answer', channels: { action: vi.fn(async () => ({ status: 'accepted' })) } },
    ]

    for (const item of cases) {
      const ctx = await harness(new ScriptedAdapter([textReply(item.reply)]))
      contexts.push(ctx)
      if (item.channels !== undefined) ctx.provide('channels', item.channels as never)
      await ctx.plugin(Automation, {
        enabled: true,
        rules: [{ id: item.id, schedule: { kind: 'at', at: NOW }, message: 'work', delivery }],
      })
      await settle()
      expect(runRecords(ctx, item.id)).toEqual(['started', item.id === 'without-thread' ? 'ok' : 'error'])
      if (item.id === 'without-thread') {
        expect(item.channels?.action).toHaveBeenCalledOnce()
      }
    }
  })

  it('records an error when the started marker cannot flush', async () => {
    const ctx = await harness(new ScriptedAdapter([]))
    contexts.push(ctx)
    await ctx.plugin(Automation, {
      enabled: true,
      rules: [{ id: 'started-flush', schedule: { kind: 'at', at: NOW }, message: 'work' }],
    })
    const originalFlush = ctx.sessions.flush.bind(ctx.sessions)
    let rejected = false
    vi.spyOn(ctx.sessions, 'flush').mockImplementation(async (session) => {
      const last = session.events.at(-1)
      if (!rejected && last?.type === 'automation/run' && last.data.status === 'started') {
        rejected = true
        throw new Error('started marker unavailable')
      }
      return await originalFlush(session)
    })

    await settle()

    expect(runRecords(ctx, 'started-flush')).toEqual(['started', 'error'])
  })

  it('skips a later not-yet-due rule after completing the current occurrence', async () => {
    const ctx = await harness(new ScriptedAdapter([textReply('done')]))
    contexts.push(ctx)
    await ctx.plugin(Automation, {
      enabled: true,
      rules: [
        { id: 'no-turn-end', schedule: { kind: 'at', at: '2026-08-05T09:00:01.000Z' }, message: 'work' },
        { id: 'later', schedule: { kind: 'at', at: '2026-08-05T09:00:02.000Z' }, message: 'later' },
      ],
    })
    await vi.advanceTimersByTimeAsync(1_000)
    await settle()

    expect(runRecords(ctx, 'no-turn-end')).toEqual(['started', 'ok'])
    expect(runRecords(ctx, 'later')).toEqual([])
  })

  it('leaves an impossible cron occurrence unarmed', async () => {
    const ctx = await harness(new ScriptedAdapter([]))
    contexts.push(ctx)
    await ctx.plugin(Automation, {
      enabled: true,
      rules: [{ id: 'never', schedule: { kind: 'cron', expr: '0 0 31 2 *' }, message: 'work' }],
    })

    const listed = await callAutomation(ctx, { action: 'list' }, ownerAgent())
    expect(listed.value).toMatchObject({ tasks: [{ id: 'never', next_run_at: null }] })
  })

  it('records one failed at attempt without a zero-delay retry loop', async () => {
    const adapter = new ScriptedAdapter(['fail'])
    const ctx = await harness(adapter)
    contexts.push(ctx)
    await ctx.plugin(Automation, {
      enabled: true,
      rules: [{ id: 'failed-once', schedule: { kind: 'at', at: '2026-08-05T08:00:00.000Z' }, message: 'work' }],
    })
    await settle()

    expect(adapter.requests).toHaveLength(1)
    expect(runRecords(ctx, 'failed-once')).toEqual(['started', 'error'])
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000)
    await settle()
    expect(adapter.requests).toHaveLength(1)
    expect(runRecords(ctx, 'failed-once')).toEqual(['started', 'error'])
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

  it('records blocked and aborted at turns as errors without losing them as successful completions', async () => {
    const blockedAdapter = new ScriptedAdapter([])
    const blocked = await harness(blockedAdapter)
    contexts.push(blocked)
    blocked.on('agent/pre-step', async () => ({ kind: 'reject' }))
    await blocked.plugin(Automation, {
      enabled: true,
      rules: [{ id: 'blocked-once', schedule: { kind: 'at', at: NOW }, message: 'work' }],
    })
    await settle()
    expect(blockedAdapter.requests).toHaveLength(0)
    expect(runRecords(blocked, 'blocked-once')).toEqual(['started', 'error'])

    const abortedAdapter = new ScriptedAdapter(['hang'])
    const aborted = await harness(abortedAdapter)
    contexts.push(aborted)
    await aborted.plugin(Automation, {
      enabled: true,
      rules: [{ id: 'aborted-once', schedule: { kind: 'at', at: NOW }, message: 'work' }],
    })
    await settle()
    expect(abortedAdapter.requests).toHaveLength(1)
    agentFor(aborted, 'aborted-once')?.cancel({ kind: 'user' })
    await settle()
    expect(runRecords(aborted, 'aborted-once')).toEqual(['started', 'error'])

    await vi.advanceTimersByTimeAsync(60_000)
    await settle()
    expect(blockedAdapter.requests).toHaveLength(0)
    expect(abortedAdapter.requests).toHaveLength(1)
  })

  it('fails initialization and disposes a created candidate when startup quiescence fails', async () => {
    const adapter = new ScriptedAdapter([textReply('must not run')])
    const ctx = await harness(adapter)
    contexts.push(ctx)
    const realCreate = ctx.agents.create.bind(ctx.agents)
    let disposalCalls = 0
    vi.spyOn(ctx.agents, 'create').mockImplementation(async (options) => {
      const handle = await realCreate(options)
      vi.spyOn(handle.agent, 'whenIdle').mockRejectedValueOnce(new Error('late create startup failure'))
      return {
        agent: handle.agent,
        async dispose(): Promise<void> {
          disposalCalls += 1
          await handle.dispose()
        },
      }
    })

    await expect(ctx.plugin(Automation, {
      enabled: true,
      rules: [{ id: 'create-late-failure', schedule: { kind: 'every', seconds: 60 }, message: 'work' }],
    })).rejects.toThrow(/create-late-failure.*late create startup failure/)

    expect(disposalCalls).toBe(1)
    expect(agentFor(ctx, 'create-late-failure')).toBeUndefined()
    await vi.advanceTimersByTimeAsync(120_000)
    await settle()
    expect(adapter.requests).toHaveLength(0)
  })

  it('reports both startup and candidate-cleanup failures', async () => {
    const ctx = await harness(new ScriptedAdapter([]))
    contexts.push(ctx)
    const realCreate = ctx.agents.create.bind(ctx.agents)
    vi.spyOn(ctx.agents, 'create').mockImplementation(async (options) => {
      const handle = await realCreate(options)
      vi.spyOn(handle.agent, 'whenIdle').mockRejectedValueOnce(new Error('startup unavailable'))
      return {
        agent: handle.agent,
        async dispose(): Promise<void> {
          await handle.dispose()
          throw new Error('cleanup unavailable')
        },
      }
    })

    await expect(ctx.plugin(Automation, {
      enabled: true,
      rules: [{ id: 'aggregate-startup', schedule: { kind: 'every', seconds: 60 }, message: 'work' }],
    })).rejects.toThrow(/startup failed.*cleanup was incomplete/)
    expect(agentFor(ctx, 'aggregate-startup')).toBeUndefined()
  })

  it('logs a handle disposal rejection after the underlying agent is removed', async () => {
    const ctx = await harness(new ScriptedAdapter([]))
    contexts.push(ctx)
    const realCreate = ctx.agents.create.bind(ctx.agents)
    vi.spyOn(ctx.agents, 'create').mockImplementation(async (options) => {
      const handle = await realCreate(options)
      return {
        agent: handle.agent,
        async dispose(): Promise<void> {
          await handle.dispose()
          throw new Error('wrapper dispose failed')
        },
      }
    })
    const warning = vi.spyOn(ctx.logger, 'warn')
    const fiber = await ctx.plugin(Automation, {
      enabled: true,
      rules: [{ id: 'dispose-warning', schedule: { kind: 'every', seconds: 60 }, message: 'work' }],
    })

    await fiber.dispose()

    expect(agentFor(ctx, 'dispose-warning')).toBeUndefined()
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('cannot dispose agent'))
  })

  it('recovers a later live reconciliation after one candidate acquisition fails', async () => {
    const ctx = await harness(new ScriptedAdapter([]))
    contexts.push(ctx)
    const fiber = await ctx.plugin(Automation, { enabled: false, rules: [] })
    const realCreate = ctx.agents.create.bind(ctx.agents)
    vi.spyOn(ctx.agents, 'create')
      .mockRejectedValueOnce(new Error('transient create failure'))
      .mockImplementation(options => realCreate(options))

    await ctx.settings.update(Automation.AUTOMATION_SETTINGS_NAMESPACE, {
      enabled: true,
      rules: [{ id: 'first-fails', schedule: { kind: 'every', seconds: 60 }, message: 'work' }],
    })
    await settle()
    expect(agentFor(ctx, 'first-fails')).toBeUndefined()

    await ctx.settings.update(Automation.AUTOMATION_SETTINGS_NAMESPACE, {
      rules: [{ id: 'recovered', schedule: { kind: 'every', seconds: 60 }, message: 'work' }],
    })
    await settle()
    expect(agentFor(ctx, 'recovered')).toBeDefined()
    await fiber.dispose()
  })

  it('disposes a late candidate and skips a queued reconciliation after its coordinator owner', async () => {
    const ctx = await harness(new ScriptedAdapter([]))
    contexts.push(ctx)
    const fiber = await ctx.plugin(Automation, { enabled: false, rules: [] })
    const realCreate = ctx.agents.create.bind(ctx.agents)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const create = vi.spyOn(ctx.agents, 'create').mockImplementation(async (options) => {
      const handle = await realCreate(options)
      entered.resolve(undefined)
      await release.promise
      return handle
    })

    await ctx.settings.update(Automation.AUTOMATION_SETTINGS_NAMESPACE, {
      enabled: true,
      rules: [{ id: 'late-coordinator', schedule: { kind: 'every', seconds: 60 }, message: 'work' }],
    })
    await entered.promise
    const queued = callAutomation(ctx, {
      action: 'add', message: 'queued after the first reconciliation', every_seconds: 60,
    }, ownerAgent())
    await settle()
    const pending = await callAutomation(ctx, { action: 'list' }, ownerAgent())
    expect(pending.value).toMatchObject({ tasks: [{ id: 'late-coordinator' }, { message: 'queued after the first reconciliation' }] })
    const disposal = fiber.dispose()
    release.resolve(undefined)
    const queuedResult = await queued
    await disposal

    expect(queuedResult.isError).toBe(false)
    const queuedTask = (queuedResult.value as { tasks: Array<{ id: string; selected: boolean }> }).tasks
      .find(task => task.selected)
    if (queuedTask === undefined) throw new Error('expected the queued task to remain selected')
    expect(agentFor(ctx, 'late-coordinator')).toBeUndefined()
    expect(agentFor(ctx, queuedTask.id)).toBeUndefined()
    expect(create).toHaveBeenCalledOnce()
  })

  it('rejects a queued mutation after disposal and drains its rejected tail', async () => {
    const ctx = await harness(new ScriptedAdapter([]))
    contexts.push(ctx)
    const fiber = await ctx.plugin(Automation, { enabled: false, rules: [] })
    const realUpdate = ctx.settings.update.bind(ctx.settings)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let blocked = false
    vi.spyOn(ctx.settings, 'update').mockImplementation(async (ns, patch) => {
      if (!blocked) {
        blocked = true
        await realUpdate(ns, patch)
        entered.resolve(undefined)
        await release.promise
        return
      }
      await realUpdate(ns, patch)
    })
    const agent = ownerAgent()
    const first = callAutomation(ctx, { action: 'add', message: 'first', every_seconds: 60 }, agent)
    await entered.promise
    const second = callAutomation(ctx, { action: 'add', message: 'second', every_seconds: 60 }, agent)
    const disposal = fiber.dispose()
    release.resolve(undefined)

    const [firstResult, secondResult] = await Promise.all([first, second])
    await disposal
    expect(firstResult.isError).toBe(true)
    expect(secondResult.isError).toBe(true)
    expect(JSON.stringify(secondResult.content)).toContain('runtime is disposed')
  })

  it('fails initialization, disposes a resumed candidate, and does not create a replacement', { timeout: 15_000 }, async () => {
    vi.useRealTimers()
    const root = await tempDir('automation-resume-late-failure')
    tempDirs.push(root)
    const sessionId = SessionId('automation:resume-late-failure')
    const first = await harness(new ScriptedAdapter([]), root)
    contexts.push(first)
    const seeded = await first.agents.create({
      sessionId,
      meta: { cwd: process.cwd() },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    seeded.agent.session.append('automation/run', {
      ruleId: 'resume-late-failure',
      scheduledAt: NOW,
      status: 'started',
    })
    await first.sessions.flush(seeded.agent.session)
    await seeded.dispose()
    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)

    const adapter = new ScriptedAdapter([textReply('must not run')])
    const second = await harness(adapter, root)
    contexts.push(second)
    const realResume = second.agents.resume.bind(second.agents)
    const create = vi.spyOn(second.agents, 'create')
    let disposalCalls = 0
    const resume = vi.spyOn(second.agents, 'resume').mockImplementation(async (options) => {
      const handle = await realResume(options)
      vi.spyOn(handle.agent, 'whenIdle').mockRejectedValueOnce(new Error('late resume startup failure'))
      return {
        agent: handle.agent,
        async dispose(): Promise<void> {
          disposalCalls += 1
          await handle.dispose()
        },
      }
    })

    await expect(second.plugin(Automation, {
      enabled: true,
      rules: [{ id: 'resume-late-failure', schedule: { kind: 'every', seconds: 60 }, message: 'work' }],
    })).rejects.toThrow(/resume-late-failure.*late resume startup failure/)

    expect(disposalCalls).toBe(1)
    expect(resume).toHaveBeenCalledTimes(1)
    expect(create).not.toHaveBeenCalled()
    expect(agentFor(second, 'resume-late-failure')).toBeUndefined()
    expect(adapter.requests).toHaveLength(0)
  })

  it('joins late initialization and the AgentHandle teardown before plugin disposal resolves', async () => {
    const adapter = new ScriptedAdapter([])
    const ctx = await harness(adapter)
    contexts.push(ctx)
    const realCreate = ctx.agents.create.bind(ctx.agents)
    const acquired = Promise.withResolvers<AgentHandle>()
    const releaseAcquire = Promise.withResolvers<undefined>()
    const disposalStarted = Promise.withResolvers<undefined>()
    const releaseDisposal = Promise.withResolvers<undefined>()
    vi.spyOn(ctx.agents, 'create').mockImplementation(async (options) => {
      const handle = await realCreate(options)
      acquired.resolve(handle)
      await releaseAcquire.promise
      return {
        agent: handle.agent,
        async dispose(): Promise<void> {
          disposalStarted.resolve(undefined)
          await releaseDisposal.promise
          await handle.dispose()
        },
      }
    })

    const fiber = ctx.plugin(Automation, {
      enabled: true,
      rules: [{ id: 'late', schedule: { kind: 'every', seconds: 60 }, message: 'work' }],
    })
    await acquired.promise
    const disposed = fiber.dispose()
    let settled = false
    void disposed.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    releaseAcquire.resolve(undefined)
    await disposalStarted.promise
    expect(settled).toBe(false)
    releaseDisposal.resolve(undefined)
    await Promise.allSettled([fiber, disposed])
    expect(agentFor(ctx, 'late')).toBeUndefined()
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

  it('does not start a later due rule after disposal begins during the current rule', async () => {
    const adapter = new ScriptedAdapter(['hang', textReply('must not run')])
    const ctx = await harness(adapter)
    contexts.push(ctx)
    const fiber = await ctx.plugin(Automation, {
      enabled: true,
      rules: [
        { id: 'first-due', schedule: { kind: 'at', at: NOW }, message: 'hold the tick open' },
        { id: 'second-due', schedule: { kind: 'at', at: NOW }, message: 'must not start' },
      ],
    })
    const first = agentFor(ctx, 'first-due')
    const second = agentFor(ctx, 'second-due')

    await settle()
    expect(adapter.requests).toHaveLength(1)
    expect(runRecords(ctx, 'first-due')).toEqual(['started'])
    expect(runRecords(ctx, 'second-due')).toEqual([])

    await fiber.dispose()

    expect(adapter.requests).toHaveLength(1)
    expect(first?.session.events.filter(event => event.type === 'automation/run').map(event => event.data.status))
      .toEqual(['started', 'error'])
    expect(second?.session.events.some(event => event.type === 'automation/run')).toBe(false)
    expect(agentFor(ctx, 'first-due')).toBeUndefined()
    expect(agentFor(ctx, 'second-due')).toBeUndefined()
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
