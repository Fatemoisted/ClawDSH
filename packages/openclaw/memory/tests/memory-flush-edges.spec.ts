import { Context } from '@deepseek-ai/cordis'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import { describe, expect, it, type Mock, vi } from 'vitest'
import {
  DEFAULT_FLUSH_PROMPT,
  installMemoryFlush,
  resolveFlushConfig,
  type ResolvedFlushConfig,
} from '../src/flush.ts'

const signal = new AbortController().signal
const enabled: ResolvedFlushConfig = {
  enabled: true,
  reserveTokensFloor: 0,
  softThresholdTokens: 0,
  prompt: DEFAULT_FLUSH_PROMPT,
}

type StubAgent = Agent & {
  followup: Mock<Agent['followup']>
  session: Session & { events: SessionEvent[] }
}

function stubAgent(options: {
  header?: { provider: string; model: string }
  provider?: string
  model?: string
  events?: SessionEvent[]
} = {}): StubAgent {
  const session = {
    id: SessionId(`flush-edge-${Math.random()}`),
    events: options.events ?? [],
    requestHeader: () => options.header === undefined ? undefined : { config: options.header },
  } as unknown as Session & { events: SessionEvent[] }
  return {
    id: session.id,
    session,
    options: {
      ...(options.provider === undefined ? {} : { provider: options.provider }),
      ...(options.model === undefined ? {} : { model: options.model }),
    },
    followup: vi.fn<Agent['followup']>(),
  } as unknown as StubAgent
}

function provideRuntime(
  ctx: Context,
  measure: () => { totalTokens: number },
  resolveModelInfo: (provider: string, model: string, signal: AbortSignal) => Promise<unknown>,
): void {
  ctx.provide('tokenMeter', { measure } as never)
  ctx.provide('llm', { resolveModelInfo } as never)
}

async function stop(ctx: Context, agent: Agent, stopSignal: AbortSignal = signal): Promise<void> {
  await agentEvents(ctx, agent).serial('agent/turn-stopping', { turn: 1, signal: stopSignal })
}

async function preStep(ctx: Context, agent: Agent, messages: ReturnType<typeof createUserMessage>[]): Promise<void> {
  await agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages, turn: 1, step: 1, signal },
    () => Promise.resolve({ kind: 'enter', messages }),
  )
}

function emitSession(ctx: Context, agent: Agent, event: SessionEvent): void {
  const emit = ctx.emit.bind(ctx) as unknown as (
    target: object,
    name: 'session/event',
    session: Session,
    entry: SessionEvent,
  ) => void
  emit(scopeTarget(agent.session, agent), 'session/event', agent.session, event)
}

function event(value: unknown): SessionEvent {
  return value as SessionEvent
}

describe('memory flush config edges', () => {
  it('resolves defaults and rejects every invalid raw field', () => {
    expect(resolveFlushConfig()).toEqual({
      enabled: true,
      reserveTokensFloor: 20_000,
      softThresholdTokens: 4_000,
      prompt: DEFAULT_FLUSH_PROMPT,
    })
    expect(resolveFlushConfig({ enabled: false, reserveTokensFloor: 1, softThresholdTokens: 2, prompt: 'flush' }))
      .toEqual({ enabled: false, reserveTokensFloor: 1, softThresholdTokens: 2, prompt: 'flush' })
    expect(() => resolveFlushConfig({ enabled: 'yes' as never })).toThrow(/enabled/)
    for (const reserveTokensFloor of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => resolveFlushConfig({ reserveTokensFloor })).toThrow(/reserveTokensFloor/)
    }
    for (const softThresholdTokens of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => resolveFlushConfig({ softThresholdTokens })).toThrow(/softThresholdTokens/)
    }
    expect(() => resolveFlushConfig({ prompt: '' })).toThrow(/prompt/)
    expect(() => resolveFlushConfig({ prompt: 1 as never })).toThrow(/prompt/)
  })

  it('returns an inert disposer while disabled', () => {
    const ctx = new Context()
    const dispose = installMemoryFlush(ctx, { ...enabled, enabled: false })
    expect(() => { dispose() }).not.toThrow()
  })
})

describe('memory flush event edges', () => {
  it('observes only post-flush assistant NO_REPLY messages', () => {
    const ctx = new Context()
    const info = vi.spyOn(ctx.logger, 'info').mockImplementation(() => {})
    const dispose = installMemoryFlush(ctx, enabled)
    const agent = stubAgent()
    const other = stubAgent()

    emitSession(ctx, agent, event({ type: 'turn/start', seq: 0, data: {} }))
    emitSession(ctx, other, event({
      type: 'assistant/message',
      seq: 1,
      data: { message: { content: [{ type: 'text', text: 'NO_REPLY' }] } },
    }))
    emitSession(ctx, agent, event({
      type: 'user/message',
      seq: 2,
      data: { source: { kind: 'plugin', plugin: 'memory-flush' } },
    }))
    emitSession(ctx, agent, event({
      type: 'assistant/message',
      seq: 2,
      data: { message: { content: [{ type: 'text', text: 'NO_REPLY' }] } },
    }))
    emitSession(ctx, agent, event({
      type: 'assistant/message',
      seq: 3,
      data: { message: { content: [{ type: 'tool-call' }, { type: 'text', text: '  NO_REPLY.' }] } },
    }))
    emitSession(ctx, agent, event({
      type: 'user/message',
      seq: 4,
      data: { source: { kind: 'plugin', plugin: 'memory-flush' } },
    }))
    emitSession(ctx, agent, event({
      type: 'assistant/message',
      seq: 5,
      data: { message: { content: [{ type: 'text', text: 'stored: NO_REPLY!' }] } },
    }))

    expect(info).toHaveBeenCalledTimes(2)
    dispose()
  })

  it('warns once for missing seams and skips an already-aborted stop', async () => {
    const none = new Context()
    const noneWarn = vi.spyOn(none.logger, 'warn').mockImplementation(() => {})
    installMemoryFlush(none, enabled)
    await stop(none, stubAgent())
    await stop(none, stubAgent())
    expect(noneWarn).toHaveBeenCalledTimes(1)

    const meterOnly = new Context()
    meterOnly.provide('tokenMeter', { measure: () => ({ totalTokens: 10 }) } as never)
    installMemoryFlush(meterOnly, enabled)
    await stop(meterOnly, stubAgent())

    const aborted = new Context()
    const resolveModelInfo = vi.fn(async () => ({ context: { contextWindow: 100 } }))
    provideRuntime(aborted, () => ({ totalTokens: 10 }), resolveModelInfo)
    installMemoryFlush(aborted, enabled)
    const controller = new AbortController()
    controller.abort()
    await stop(aborted, stubAgent({ provider: 'p', model: 'm' }), controller.signal)
    expect(resolveModelInfo).not.toHaveBeenCalled()
  })

  it('contains token measurement and model-resolution failures', async () => {
    const measureFailure = new Context()
    const measureWarn = vi.spyOn(measureFailure.logger, 'warn').mockImplementation(() => {})
    provideRuntime(measureFailure, () => { throw new Error('measure failed') }, async () => ({ context: { contextWindow: 100 } }))
    installMemoryFlush(measureFailure, enabled)
    await stop(measureFailure, stubAgent({ provider: 'p', model: 'm' }))
    expect(measureWarn).toHaveBeenCalledWith(expect.stringContaining('token measurement failed'))

    const modelFailure = new Context()
    provideRuntime(modelFailure, () => ({ totalTokens: 10 }), async () => { throw new Error('model failed') })
    installMemoryFlush(modelFailure, enabled)
    await expect(stop(modelFailure, stubAgent({ provider: 'p', model: 'm' }))).resolves.toBeUndefined()
  })

  it('warns once for missing routes and absent context windows', async () => {
    const noRoute = new Context()
    const routeWarn = vi.spyOn(noRoute.logger, 'warn').mockImplementation(() => {})
    provideRuntime(noRoute, () => ({ totalTokens: 10 }), async () => ({ context: { contextWindow: 100 } }))
    installMemoryFlush(noRoute, enabled)
    await stop(noRoute, stubAgent())
    await stop(noRoute, stubAgent({ header: { provider: '', model: '' }, provider: 'p' }))
    expect(routeWarn).toHaveBeenCalledTimes(1)

    const noWindow = new Context()
    const windowWarn = vi.spyOn(noWindow.logger, 'warn').mockImplementation(() => {})
    provideRuntime(noWindow, () => ({ totalTokens: 10 }), async () => ({ context: {} }))
    installMemoryFlush(noWindow, enabled)
    const target = stubAgent({ provider: 'p', model: 'm' })
    await stop(noWindow, target)
    await stop(noWindow, target)
    expect(windowWarn).toHaveBeenCalledTimes(1)
  })

  it('honors threshold bounds and suppresses duplicate pending claims', async () => {
    const nonPositive = new Context()
    provideRuntime(nonPositive, () => ({ totalTokens: 100 }), async () => ({ context: { contextWindow: 0 } }))
    installMemoryFlush(nonPositive, enabled)
    const nonPositiveAgent = stubAgent({ provider: 'p', model: 'm' })
    await stop(nonPositive, nonPositiveAgent)
    expect(nonPositiveAgent.followup.mock.calls).toHaveLength(0)

    const below = new Context()
    provideRuntime(below, () => ({ totalTokens: 9 }), async () => ({ context: { contextWindow: 10 } }))
    installMemoryFlush(below, enabled)
    const belowAgent = stubAgent({ provider: 'p', model: 'm' })
    await stop(below, belowAgent)
    expect(belowAgent.followup.mock.calls).toHaveLength(0)

    const due = new Context()
    provideRuntime(due, () => ({ totalTokens: 10 }), async () => ({ context: { contextWindow: 10 } }))
    installMemoryFlush(due, enabled)
    const dueAgent = stubAgent({ header: { provider: 'header', model: 'model' }, provider: 'fallback', model: 'fallback' })
    await stop(due, dueAgent)
    await stop(due, dueAgent)
    expect(dueAgent.followup.mock.calls).toHaveLength(1)

    dueAgent.session.events.push(event({
      type: 'user/message',
      seq: 1,
      data: { source: { kind: 'user' } },
    }))
    await stop(due, dueAgent)
    expect(dueAgent.followup.mock.calls).toHaveLength(1)
  })

  it('clears a pending claim from a flush message and reuses cached model info after compaction', async () => {
    const ctx = new Context()
    const resolveModelInfo = vi.fn(async () => ({ context: { contextWindow: 10 } }))
    provideRuntime(ctx, () => ({ totalTokens: 10 }), resolveModelInfo)
    installMemoryFlush(ctx, enabled)
    const agent = stubAgent({ provider: 'p', model: 'm' })

    await stop(ctx, agent)
    agent.session.events.push(event({
      type: 'user/message',
      seq: 1,
      data: { source: { kind: 'plugin', plugin: 'memory-flush' } },
    }))
    await stop(ctx, agent)

    agent.session.events.push(event({ type: 'compaction/end', seq: 2, data: {} }))
    await preStep(ctx, agent, [createUserMessage({
      content: [{ type: 'text', text: 'flush' }],
      source: { kind: 'plugin', plugin: 'memory-flush' },
    })])
    await stop(ctx, agent)

    expect(agent.followup.mock.calls).toHaveLength(2)
    expect(resolveModelInfo).toHaveBeenCalledTimes(1)
  })
})
