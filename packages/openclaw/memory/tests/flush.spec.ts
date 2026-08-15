/**
 * Contract tests for the memory flush turn: the real agent loop over fake
 * context windows, driven with a scripted adapter. The flush queues at
 * `agent/turn-stopping` when the measured context crosses the threshold, once
 * per compaction cycle; turns are ordinary logged turns with a plugin source.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { installModelSelection } from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import * as Memory from '@clawdsh/dsh-memory'

const MODEL = 'flush-test-model'

class TestSettings extends SettingsProvider {
  get writable(): boolean { return true }
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

/** Scripted adapter with a fixed context window; each model call consumes the next entry. */
class WindowAdapter extends LlmAdapter {
  constructor(
    private readonly contextWindow: number,
    private script: Array<StreamChunk[] | 'fail'>,
  ) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: this.contextWindow } })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const entry = this.script.shift()
    if (entry === undefined) throw new Error('WindowAdapter: script exhausted')
    if (entry === 'fail') throw new Error('adapter failure')
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

interface Harness {
  ctx: Context
  root: string
  dispose: () => Promise<void>
}

async function harness(options: {
  window: number
  flush?: Memory.Config['flush']
  adapter?: WindowAdapter
  withTokenMeter?: boolean
  compaction?: { thresholdRatio: number; retainRatio?: number }
}): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), 'dsh-flush-'))
  const adapter = options.adapter ?? new WindowAdapter(options.window, [])
  const ctx = new Context()
  await ctx.plugin(TestSettings)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalFileSystem)
  if (options.withTokenMeter ?? true) await ctx.plugin(TokenMeter)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(AgentDefaultModelConfig, { provider: MODEL, model: MODEL })
  if (options.compaction !== undefined) {
    const { default: BasicCompactionEngine } = await import('@deepseek-ai/dsh-compaction-basic')
    await ctx.plugin(BasicCompactionEngine, options.compaction)
  }
  ctx.llm.registerAdapter([MODEL], adapter)
  await ctx.plugin(Memory, { root, flush: options.flush ?? { reserveTokensFloor: 0, softThresholdTokens: 0 } })
  return {
    ctx,
    root,
    dispose: async () => {
      await ctx.fiber.dispose()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

/** Create (or reuse) one live agent per id and drive a user turn to quiescence. */
async function driveTurn(ctx: Context, id: string, text: string): Promise<void> {
  const existing = ctx.agents.get(SessionId(id))
  if (existing === undefined) {
    const selection = ctx.agentDefaultModel.currentSelection()
    const handle = await ctx.agents.create({
      sessionId: SessionId(id),
      meta: { cwd: process.cwd() },
      agentOptions: { provider: selection.provider, model: selection.model },
      setup: (agentCtx) => {
        installModelSelection(agentCtx, { current: selection, assembled: undefined })
      },
    })
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    return
  }
  existing.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await existing.whenIdle()
}

function flushMessages(ctx: Context, id: string): Array<{ text: string }> {
  const agent = ctx.agents.get(SessionId(id))
  if (agent === undefined) return []
  const messages: Array<{ text: string }> = []
  for (const event of agent.session.events) {
    if (event.type !== 'user/message') continue
    if (event.data.source.kind !== 'plugin' || event.data.source.plugin !== Memory.FLUSH_PLUGIN_SOURCE) continue
    messages.push({ text: event.data.content.map(block => block.type === 'text' ? block.text : '').join('') })
  }
  return messages
}

/** A message whose estimated size crosses a tiny window: ~12k chars ≈ 3k tokens. */
const BIG_MESSAGE = 'fixture words '.repeat(1_200)

describe('memory flush turn', () => {
  it('queues a flush turn when the context crosses the threshold, once per compaction cycle', async () => {
    const h = await harness({
      window: 1_000,
      adapter: new WindowAdapter(1_000, [textReply('main one'), textReply('NO_REPLY'), textReply('main two')]),
    })
    await driveTurn(h.ctx, 's-1', BIG_MESSAGE)
    expect(flushMessages(h.ctx, 's-1')).toEqual([{ text: Memory.DEFAULT_FLUSH_PROMPT }])

    // No new compaction landed: the second turn must not queue another flush.
    await driveTurn(h.ctx, 's-1', BIG_MESSAGE)
    expect(flushMessages(h.ctx, 's-1')).toHaveLength(1)
    await h.dispose()
  })

  it('stays silent below the threshold', async () => {
    const h = await harness({
      window: 1_000_000,
      adapter: new WindowAdapter(1_000_000, [textReply('small reply')]),
    })
    await driveTurn(h.ctx, 's-2', 'a small message')
    expect(flushMessages(h.ctx, 's-2')).toEqual([])
    await h.dispose()
  })

  it('re-arms after a newer compaction lands', async () => {
    const h = await harness({
      window: 1_000,
      adapter: new WindowAdapter(1_000, [textReply('main one'), textReply('flush one'), textReply('main two'), textReply('flush two')]),
    })
    await driveTurn(h.ctx, 's-3', BIG_MESSAGE)
    expect(flushMessages(h.ctx, 's-3')).toHaveLength(1)

    const agent = h.ctx.agents.get(SessionId('s-3'))
    if (agent === undefined) throw new Error('agent missing')
    agent.session.append('compaction/end', { compactionId: CompactionId('test-cycle'), turn: null })

    await driveTurn(h.ctx, 's-3', BIG_MESSAGE)
    expect(flushMessages(h.ctx, 's-3')).toHaveLength(2)
    await h.dispose()
  })

  it('queues the flush before the compaction that shrinks the context (real compaction integration)', async () => {
    const h = await harness({
      window: 1_000,
      compaction: { thresholdRatio: 0.9, retainRatio: 0.001 },
      // Three calls: the main turn, the compaction summarizer, then the flush turn.
      adapter: new WindowAdapter(1_000, [textReply('main one'), textReply('summary'), textReply('flush one')]),
    })
    await driveTurn(h.ctx, 's-4', BIG_MESSAGE)
    const agent = h.ctx.agents.get(SessionId('s-4'))
    if (agent === undefined) throw new Error('agent missing')
    const flushSeq = agent.session.events.find(event =>
      event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === Memory.FLUSH_PLUGIN_SOURCE)?.seq
    const compactionSeq = agent.session.events.find(event => event.type === 'compaction/end')?.seq
    expect(flushSeq).toBeDefined()
    expect(compactionSeq).toBeDefined()
    // The flush decision precedes the compaction: the flush turn's `turn/start`
    // opens before the compaction that runs in the same turn's pre-step.
    const flushTurnStart = agent.session.events.findLast(event =>
      event.type === 'turn/start' && event.seq < (flushSeq ?? 0))?.seq
    expect(flushTurnStart).toBeDefined()
    expect((flushTurnStart ?? 0) < (compactionSeq ?? 0)).toBe(true)
    await h.dispose()
  })

  it('records the flush reply in the log and does not wedge after NO_REPLY', async () => {
    const h = await harness({
      window: 1_000,
      adapter: new WindowAdapter(1_000, [textReply('main one'), textReply('NO_REPLY'), textReply('main two')]),
    })
    await driveTurn(h.ctx, 's-5', BIG_MESSAGE)
    const agent = h.ctx.agents.get(SessionId('s-5'))
    if (agent === undefined) throw new Error('agent missing')
    const replies = agent.session.events
      .filter(event => event.type === 'assistant/message')
      .map(event => event.type === 'assistant/message'
        ? event.data.message.content.map(block => block.type === 'text' ? block.text : '').join('')
        : '')
    expect(replies).toContain('NO_REPLY')
    await driveTurn(h.ctx, 's-5', BIG_MESSAGE)
    expect(flushMessages(h.ctx, 's-5')).toHaveLength(1)
    await h.dispose()
  })

  it('contains a failing flush turn and never blocks the main turn', async () => {
    const h = await harness({
      window: 1_000,
      adapter: new WindowAdapter(1_000, [textReply('main one'), 'fail', textReply('main two')]),
    })
    await driveTurn(h.ctx, 's-6', BIG_MESSAGE)
    const agent = h.ctx.agents.get(SessionId('s-6'))
    if (agent === undefined) throw new Error('agent missing')
    const mainReplies = agent.session.events
      .filter(event => event.type === 'assistant/message')
      .map(event => event.type === 'assistant/message'
        ? event.data.message.content.map(block => block.type === 'text' ? block.text : '').join('')
        : '')
    expect(mainReplies).toContain('main one')
    expect(flushMessages(h.ctx, 's-6')).toHaveLength(1)
    await driveTurn(h.ctx, 's-6', BIG_MESSAGE)
    expect(flushMessages(h.ctx, 's-6')).toHaveLength(1)
    await h.dispose()
  })

  it('disables gracefully when ctx.tokenMeter is absent', async () => {
    const h = await harness({
      window: 1_000,
      withTokenMeter: false,
      adapter: new WindowAdapter(1_000, [textReply('main one')]),
    })
    await driveTurn(h.ctx, 's-7', BIG_MESSAGE)
    expect(flushMessages(h.ctx, 's-7')).toEqual([])
    await h.dispose()
  })

  it('removes its hooks when the plugin fiber is disposed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-flush-'))
    const adapter = new WindowAdapter(1_000, [textReply('main one'), textReply('main two')])
    const ctx = new Context()
    await ctx.plugin(TestSettings)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem)
    await ctx.plugin(TokenMeter)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(AgentDefaultModelConfig, { provider: MODEL, model: MODEL })
    ctx.llm.registerAdapter([MODEL], adapter)
    const memoryFiber = await ctx.plugin(Memory, { root, flush: { reserveTokensFloor: 0, softThresholdTokens: 0 } })
    await driveTurn(ctx, 's-8', BIG_MESSAGE)
    expect(flushMessages(ctx, 's-8')).toHaveLength(1)

    await memoryFiber.dispose()
    await driveTurn(ctx, 's-8', BIG_MESSAGE)
    expect(flushMessages(ctx, 's-8')).toHaveLength(1)
    await ctx.fiber.dispose()
    rmSync(root, { recursive: true, force: true })
  })
})
