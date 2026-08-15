import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import ChannelRegistry, { deriveChannelSessionId, registerChannelAdapter } from '@clawdsh/dsh-channel-core'
import type { ChannelAdapter, ChannelMessage, Config } from '@clawdsh/dsh-channel-core'
import { MockAdapter, textResponse } from './mock-adapter.ts'

interface AgentPresetsStub {
  defaultId: string
  resolve: (id?: string) => Promise<{ id: string }>
  mount: (_agentCtx: Context, id?: string) => Promise<{ id: string }>
}

function agentPresetsStub(): AgentPresetsStub {
  return {
    defaultId: 'openclaw',
    resolve: (id?: string) => Promise.resolve({ id: id ?? 'openclaw' }),
    mount: (_agentCtx: Context, id?: string) => Promise.resolve({ id: id ?? 'openclaw' }),
  }
}

async function harness(
  adapter: MockAdapter,
  config: Config = {},
  agentPresets: AgentPresetsStub = agentPresetsStub(),
): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(Timer)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(AgentDefaultModelConfig, { provider: 'mock', model: 'mock' })
  ctx.provide('agentPresets', agentPresets as never)
  ctx.provide('sessionPersistence', {
    list: () => Promise.resolve([]),
  } as never)
  ctx.llm.registerAdapter(['mock'], adapter)
  await ctx.plugin(ChannelRegistry, config)
  return ctx
}

async function persistentHarness(root: string, adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(Timer)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(AgentDefaultModelConfig, { provider: 'mock', model: 'mock' })
  await ctx.plugin(JsonlSessionPersistence, { root })
  ctx.provide('agentPresets', {
    defaultId: 'openclaw',
    resolve: (id?: string) => Promise.resolve({ id: id ?? 'openclaw' }),
    mount: (_agentCtx: Context, id?: string) => Promise.resolve({ id: id ?? 'openclaw' }),
  } as never)
  ctx.llm.registerAdapter(['mock'], adapter)
  await ctx.plugin(ChannelRegistry, { agentPreset: 'openclaw', ackReactionScope: 'all' })
  return ctx
}

function fakeAdapter(sent: ChannelMessage[]): ChannelAdapter {
  return {
    id: 'fake',
    capabilities: { receive: true, send: true, react: false },
    start: () => () => {},
    send: async (message) => { sent.push(message) },
  }
}

/** A react-capable adapter that records every acknowledgement. */
function reactAdapter(reactions: Array<{ messageId: string | undefined; emoji: string }>): ChannelAdapter {
  return {
    id: 'fake',
    capabilities: { receive: true, send: true, react: true },
    start: () => () => {},
    send: async () => {},
    react: async (message, emoji) => { reactions.push({ messageId: message.messageId, emoji }) },
  }
}

function nextOutbound(ctx: Context): Promise<ChannelMessage> {
  return new Promise((resolve) => {
    const dispose = ctx.on('channel/outbound', (message) => {
      dispose()
      resolve(message)
    })
  })
}

describe('the channel-core seam', () => {
  it('registers an adapter and removes it on dispose', async () => {
    const ctx = await harness(new MockAdapter([]))
    const dispose = ctx.channels.registerAdapter(fakeAdapter([]))
    expect(ctx.channels.listAdapters()).toHaveLength(1)
    expect(ctx.channels.getAdapter('fake')?.id).toBe('fake')

    await dispose()

    expect(ctx.channels.listAdapters()).toHaveLength(0)
    expect(ctx.channels.getAdapter('fake')).toBeUndefined()
  })

  it('derives mention patterns from the identity and registers the adapter', async () => {
    const ctx = await harness(new MockAdapter([]), { identity: { name: 'Clawd', emoji: '🐚' } })
    const captured: RegExp[][] = []
    const dispose = registerChannelAdapter(ctx, (patterns) => {
      captured.push([...patterns])
      return fakeAdapter([])
    })

    expect(captured).toHaveLength(1)
    expect(captured[0]).toHaveLength(2)
    expect(ctx.channels.listAdapters()).toHaveLength(1)

    await dispose()
    expect(ctx.channels.listAdapters()).toHaveLength(0)
  })

  it('binds a helper-registered adapter to the owning plugin lifecycle', async () => {
    const ctx = await harness(new MockAdapter([]))
    const stop = vi.fn()
    const owner = await ctx.plugin(Object.assign((inner: Context) => {
      registerChannelAdapter(inner, () => ({
        id: 'owned',
        capabilities: { receive: true, send: true, react: false },
        start: () => () => { stop() },
        send: async () => {},
      }))
    }, { inject: ['channels'] }))

    expect(ctx.channels.getAdapter('owned')).toBeDefined()
    await owner.dispose()
    expect(ctx.channels.getAdapter('owned')).toBeUndefined()
    expect(stop).toHaveBeenCalledOnce()
  })

  it('rejects a duplicate adapter id', async () => {
    const ctx = await harness(new MockAdapter([]))
    ctx.channels.registerAdapter(fakeAdapter([]))
    expect(() => ctx.channels.registerAdapter(fakeAdapter([]))).toThrow(/already registered/)
  })

  it('rolls registration back when an adapter throws during startup', async () => {
    const ctx = await harness(new MockAdapter([]))
    const broken: ChannelAdapter = {
      id: 'fake',
      capabilities: { receive: true, send: true, react: false },
      start: () => { throw new Error('startup failed') },
      send: async () => {},
    }

    expect(() => ctx.channels.registerAdapter(broken)).toThrow(/startup failed/)
    expect(ctx.channels.getAdapter('fake')).toBeUndefined()

    const dispose = ctx.channels.registerAdapter(fakeAdapter([]))
    expect(ctx.channels.getAdapter('fake')).toBeDefined()
    await dispose()
  })

  it('routes an inbound message to an agent turn and delivers the reply', async () => {
    const ctx = await harness(new MockAdapter([textResponse('hello there')]))
    const sent: ChannelMessage[] = []
    ctx.channels.registerAdapter(fakeAdapter(sent))
    const outbound = nextOutbound(ctx)

    ctx.emit('channel/inbound', { channel: 'fake', direction: 'in', conversationId: 't1', sender: 'u1', text: 'hi' })

    const reply = await outbound
    expect(reply).toMatchObject({ channel: 'fake', direction: 'out', conversationId: 't1', sender: 'u1' })
    expect(reply.text).toBe('hello there')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual(reply)
  })

  it('returns the reply target through threadId for a legacy thread-only adapter', async () => {
    const ctx = await harness(new MockAdapter([textResponse('legacy reply')]))
    const sent: ChannelMessage[] = []
    ctx.channels.registerAdapter(fakeAdapter(sent))
    const outbound = nextOutbound(ctx)

    ctx.emit('channel/inbound', { channel: 'fake', direction: 'in', threadId: 'legacy-chat', text: 'hi' })

    await expect(outbound).resolves.toMatchObject({
      conversationId: 'legacy-chat',
      threadId: 'legacy-chat',
      text: 'legacy reply',
    })
    expect(sent[0]?.threadId).toBe('legacy-chat')
  })

  it('does not call a provider API with an empty assistant reply', async () => {
    const ctx = await harness(new MockAdapter([textResponse('')]))
    const sent: ChannelMessage[] = []
    ctx.channels.registerAdapter(fakeAdapter(sent))

    await ctx.parallel('channel/inbound', {
      channel: 'fake', direction: 'in', conversationId: 'empty-reply', text: 'hi',
    })

    expect(sent).toEqual([])
  })

  it('propagates a failed send without poisoning the conversation FIFO', async () => {
    const ctx = await harness(new MockAdapter([textResponse('first'), textResponse('second')]))
    const delivered: string[] = []
    let attempts = 0
    ctx.channels.registerAdapter({
      id: 'fake',
      capabilities: { receive: true, send: true, react: false },
      start: () => () => {},
      send: async (message) => {
        attempts += 1
        if (attempts === 1) throw new Error('provider unavailable')
        delivered.push(message.text)
      },
    })
    vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})

    const failed = ctx.parallel('channel/inbound', {
      channel: 'fake', direction: 'in', conversationId: 'retryable', text: 'one',
    })
    await expect(failed).rejects.toSatisfy((error: unknown) => {
      return error instanceof AggregateError
        && error.errors.some(reason => reason instanceof Error && reason.message === 'provider unavailable')
    })

    await ctx.parallel('channel/inbound', {
      channel: 'fake', direction: 'in', conversationId: 'retryable', text: 'two',
    })
    expect(delivered).toEqual(['second'])
  })

  it('drains an admitted turn before disposing its agent', async () => {
    const ctx = await harness(new MockAdapter([textResponse('reply')]))
    let enteredSend!: () => void
    const sendStarted = new Promise<void>((resolve) => { enteredSend = resolve })
    let releaseSend!: () => void
    const sendGate = new Promise<void>((resolve) => { releaseSend = resolve })
    let sendFinished = false
    ctx.channels.registerAdapter({
      id: 'fake',
      capabilities: { receive: true, send: true, react: false },
      start: () => () => {},
      send: async () => {
        enteredSend()
        await sendGate
        sendFinished = true
      },
    })

    const inbound = ctx.parallel('channel/inbound', {
      channel: 'fake', direction: 'in', conversationId: 'shutdown', text: 'hi',
    })
    await sendStarted
    const disposing = ctx.fiber.dispose()
    await Promise.resolve()
    expect(sendFinished).toBe(false)

    releaseSend()
    await inbound
    await disposing
    expect(sendFinished).toBe(true)
  })

  it('keeps the adapter registered while its stop drains queued replies', async () => {
    const ctx = await harness(new MockAdapter([textResponse('first'), textResponse('second')]))
    const delivered: string[] = []
    let releaseFirstSend!: () => void
    const firstSendGate = new Promise<void>((resolve) => { releaseFirstSend = resolve })
    let firstSendStarted!: () => void
    const firstSendEntered = new Promise<void>((resolve) => { firstSendStarted = resolve })
    let inbounds: Promise<void>[] = []
    const dispose = ctx.channels.registerAdapter({
      id: 'fake',
      capabilities: { receive: true, send: true, react: false },
      start: () => async () => { await Promise.allSettled(inbounds) },
      send: async (message) => {
        if (delivered.length === 0) {
          firstSendStarted()
          await firstSendGate
        }
        delivered.push(message.text)
      },
    })

    inbounds = [
      ctx.parallel('channel/inbound', {
        channel: 'fake', direction: 'in', conversationId: 'stop-drain', text: 'one',
      }),
      ctx.parallel('channel/inbound', {
        channel: 'fake', direction: 'in', conversationId: 'stop-drain', text: 'two',
      }),
    ]
    await firstSendEntered
    const disposing = dispose()
    expect(ctx.channels.getAdapter('fake')).toBeDefined()

    releaseFirstSend()
    await disposing
    await Promise.all(inbounds)

    expect(delivered).toEqual(['first', 'second'])
    expect(ctx.channels.getAdapter('fake')).toBeUndefined()
  })

  it('reuses one session per thread and creates a new one per distinct thread', async () => {
    const ctx = await harness(new MockAdapter([textResponse('a'), textResponse('b'), textResponse('c')]))
    ctx.channels.registerAdapter(fakeAdapter([]))

    const first = nextOutbound(ctx)
    ctx.emit('channel/inbound', { channel: 'fake', direction: 'in', conversationId: 't1', text: 'one' })
    await first

    const second = nextOutbound(ctx)
    ctx.emit('channel/inbound', { channel: 'fake', direction: 'in', conversationId: 't1', text: 'two' })
    await second

    const third = nextOutbound(ctx)
    ctx.emit('channel/inbound', { channel: 'fake', direction: 'in', conversationId: 't2', text: 'three' })
    await third

    expect(ctx.agents.list()).toHaveLength(2)
  })

  it('delivers the channel reply, not the output of a plugin-sourced turn queued between turns', async () => {
    const ctx = await harness(new MockAdapter([textResponse('channel reply'), textResponse('flush output')]))
    const sent: ChannelMessage[] = []
    ctx.channels.registerAdapter(fakeAdapter(sent))
    // Simulate the memory flush: a plugin-sourced followup queued at the
    // previous turn's stop boundary runs before the driver's reply extraction.
    const dispose = ctx.on('agent/turn-stopping', ({ agent }) => {
      dispose()
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: 'silent flush turn' }],
        source: { kind: 'plugin', plugin: 'memory-flush' },
      }))
    })
    const outbound = nextOutbound(ctx)

    ctx.emit('channel/inbound', { channel: 'fake', direction: 'in', conversationId: 't1', sender: 'u1', text: 'hi' })

    const reply = await outbound
    expect(reply.text).toBe('channel reply')
    expect(sent).toHaveLength(1)
    expect(sent[0]?.text).toBe('channel reply')
  })

  it('prefixes the reply with [name] when identity presentation is configured', async () => {
    const ctx = new Context()
    await ctx.plugin(Timer)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(AgentDefaultModelConfig, { provider: 'mock', model: 'mock' })
    ctx.provide('agentPresets', agentPresetsStub() as never)
    ctx.provide('sessionPersistence', { list: () => Promise.resolve([]) } as never)
    ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('hello there')]))
    await ctx.plugin(ChannelRegistry, { identity: { name: 'Clawd' } })
    const sent: ChannelMessage[] = []
    ctx.channels.registerAdapter(fakeAdapter(sent))
    const outbound = nextOutbound(ctx)

    ctx.emit('channel/inbound', { channel: 'fake', direction: 'in', conversationId: 't1', sender: 'u1', text: 'hi' })

    const reply = await outbound
    expect(reply.text).toBe('[Clawd] hello there')
  })

  it('preserves an explicit empty response prefix when identity has a name', async () => {
    const ctx = await harness(new MockAdapter([textResponse('hello there')]), {
      identity: { name: 'Clawd' },
      responsePrefix: '',
    })
    const sent: ChannelMessage[] = []
    ctx.channels.registerAdapter(fakeAdapter(sent))

    await ctx.parallel('channel/inbound', {
      channel: 'fake', direction: 'in', conversationId: 'no-prefix', text: 'hi',
    })

    expect(sent[0]?.text).toBe('hello there')
  })

  it('preserves ordinary identity-name text in direct messages', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter, { identity: { name: 'ClawDSH' } })
    ctx.channels.registerAdapter(fakeAdapter([]))

    await ctx.parallel('channel/inbound', {
      channel: 'fake', direction: 'in', conversationId: 'direct', chatType: 'direct',
      text: '介绍一下 ClawDSH',
    })

    expect(JSON.stringify(adapter.requests[0])).toContain('介绍一下 ClawDSH')
  })

  it('matches and strips a zero-width-decorated identity mention in a group fallback', async () => {
    const adapter = new MockAdapter([textResponse('accepted')])
    const ctx = await harness(adapter, { identity: { name: 'Clawd' } })
    const sent: ChannelMessage[] = []
    ctx.channels.registerAdapter(fakeAdapter(sent))

    await ctx.parallel('channel/inbound', {
      channel: 'fake', direction: 'in', conversationId: 'decorated-mention', chatType: 'group',
      text: 'hey Cl\u200bawd please',
    })

    expect(sent[0]?.text).toBe('[Clawd] accepted')
    expect(JSON.stringify(adapter.requests[0])).toContain('hey  please')
    expect(JSON.stringify(adapter.requests[0])).not.toContain('Cl\u200bawd')
  })

  it('attaches an ack reaction to the inbound message when the adapter can react', async () => {
    const ctx = await harness(new MockAdapter([textResponse('hello there')]), { ackReactionScope: 'all' })
    const reactions: Array<{ messageId: string | undefined; emoji: string }> = []
    ctx.channels.registerAdapter({
      id: 'fake',
      capabilities: { receive: true, send: true, react: true },
      start: () => () => {},
      send: async () => {},
      react: async (message, emoji) => { reactions.push({ messageId: message.messageId, emoji }) },
    })
    const outbound = nextOutbound(ctx)

    ctx.emit('channel/inbound', { channel: 'fake', direction: 'in', conversationId: 't1', sender: 'u1', messageId: 'm-1', text: 'hi' })
    await outbound

    expect(reactions).toEqual([{ messageId: 'm-1', emoji: '👀' }])
  })

  it('runs the ack concurrently but keeps route and registry disposal waiting for it', async () => {
    const ctx = await harness(new MockAdapter([textResponse('reply')]), { ackReactionScope: 'all' })
    let releaseAck!: () => void
    const ackGate = new Promise<void>((resolve) => { releaseAck = resolve })
    let ackStarted!: () => void
    const ackEntered = new Promise<void>((resolve) => { ackStarted = resolve })
    let sendStarted!: () => void
    const sendEntered = new Promise<void>((resolve) => { sendStarted = resolve })
    ctx.channels.registerAdapter({
      id: 'fake',
      capabilities: { receive: true, send: true, react: true },
      start: () => () => {},
      send: async () => { sendStarted() },
      react: async () => {
        ackStarted()
        await ackGate
      },
    })

    const route = ctx.parallel('channel/inbound', {
      channel: 'fake', direction: 'in', conversationId: 'ack-drain', messageId: 'm-1', text: 'hi',
    })
    await Promise.all([ackEntered, sendEntered])

    let routeSettled = false
    void route.then(
      () => { routeSettled = true },
      () => { routeSettled = true },
    )
    await Promise.resolve()
    expect(routeSettled).toBe(false)

    let disposalSettled = false
    const disposal = Promise.resolve(ctx.fiber.dispose()).then(() => { disposalSettled = true })
    await Promise.resolve()
    expect(disposalSettled).toBe(false)

    releaseAck()
    await route
    await disposal
    expect(routeSettled).toBe(true)
    expect(disposalSettled).toBe(true)
  })

  it('acks a later FIFO message before the preceding model turn has finished sending', async () => {
    const model = new MockAdapter([textResponse('first'), textResponse('second')])
    const ctx = await harness(model, { ackReactionScope: 'all' })
    let releaseFirstSend!: () => void
    const firstSendGate = new Promise<void>((resolve) => { releaseFirstSend = resolve })
    let firstSendStarted!: () => void
    const firstSendEntered = new Promise<void>((resolve) => { firstSendStarted = resolve })
    const reactions: string[] = []
    let sends = 0
    ctx.channels.registerAdapter({
      id: 'fake',
      capabilities: { receive: true, send: true, react: true },
      start: () => () => {},
      send: async () => {
        sends += 1
        if (sends === 1) {
          firstSendStarted()
          await firstSendGate
        }
      },
      react: async (message) => { reactions.push(message.messageId ?? '') },
    })

    const first = ctx.parallel('channel/inbound', {
      channel: 'fake', direction: 'in', conversationId: 'receipt-fifo', messageId: 'm-1', text: 'one',
    })
    await firstSendEntered
    const second = ctx.parallel('channel/inbound', {
      channel: 'fake', direction: 'in', conversationId: 'receipt-fifo', messageId: 'm-2', text: 'two',
    })

    await vi.waitFor(() => { expect(reactions).toEqual(['m-1', 'm-2']) })
    expect(model.requests).toHaveLength(1)

    releaseFirstSend()
    await Promise.all([first, second])
    expect(model.requests).toHaveLength(2)
  })

  it('logs a failed ack without blocking the text reply', async () => {
    const ctx = await harness(new MockAdapter([textResponse('reply')]), { ackReactionScope: 'all' })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const sent: ChannelMessage[] = []
    ctx.channels.registerAdapter({
      id: 'fake',
      capabilities: { receive: true, send: true, react: true },
      start: () => () => {},
      send: async (message) => { sent.push(message) },
      react: async () => { throw new Error('reaction denied') },
    })

    await ctx.parallel('channel/inbound', {
      channel: 'fake', direction: 'in', conversationId: 'ack-failure', messageId: 'm-1', text: 'hi',
    })

    expect(sent).toHaveLength(1)
    expect(sent[0]?.text).toBe('reply')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('reaction denied'))
  })

  it('skips the ack when the inbound message has no platform id', async () => {
    const ctx = await harness(new MockAdapter([textResponse('hello there')]))
    let reacted = 0
    ctx.channels.registerAdapter({
      id: 'fake',
      capabilities: { receive: true, send: true, react: true },
      start: () => () => {},
      send: async () => {},
      react: async () => { reacted += 1 },
    })
    const outbound = nextOutbound(ctx)

    ctx.emit('channel/inbound', { channel: 'fake', direction: 'in', conversationId: 't1', sender: 'u1', text: 'hi' })
    await outbound

    expect(reacted).toBe(0)
  })

  it('derives stable opaque session ids that separate channels, conversations, and topics', () => {
    const first = deriveChannelSessionId('telegram', 'secret-chat', 'topic-1')
    expect(first).toBe(deriveChannelSessionId('telegram', 'secret-chat', 'topic-1'))
    expect(first).not.toBe(deriveChannelSessionId('telegram', 'secret-chat', 'topic-2'))
    expect(first).not.toBe(deriveChannelSessionId('feishu', 'secret-chat', 'topic-1'))
    expect(first).not.toContain('secret-chat')
  })

  it('drops unmentioned group traffic and accepts a structured bot mention', async () => {
    const ctx = await harness(new MockAdapter([textResponse('accepted')]), {
      groupMode: 'mention',
      ackReactionScope: 'group-mentions',
    })
    const sent: ChannelMessage[] = []
    ctx.channels.registerAdapter(fakeAdapter(sent))

    ctx.emit('channel/inbound', {
      channel: 'fake', direction: 'in', conversationId: 'group', chatType: 'group',
      mention: { detectable: true, botMentioned: false }, text: 'ambient chatter',
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(ctx.agents.list()).toHaveLength(0)

    const outbound = nextOutbound(ctx)
    ctx.emit('channel/inbound', {
      channel: 'fake', direction: 'in', conversationId: 'group', chatType: 'group',
      mention: { detectable: true, botMentioned: true }, text: 'please help',
    })
    await expect(outbound).resolves.toMatchObject({ text: 'accepted' })
    expect(ctx.agents.list()).toHaveLength(1)
  })

  it('accepts a provider-normalized broadcast mention through the default group gate', async () => {
    const ctx = await harness(new MockAdapter([textResponse('broadcast accepted')]))
    const sent: ChannelMessage[] = []
    ctx.channels.registerAdapter(fakeAdapter(sent))

    await ctx.parallel('channel/inbound', {
      channel: 'fake', direction: 'in', conversationId: 'broadcast', chatType: 'group',
      mention: { detectable: true, botMentioned: true }, text: '@all status update',
    })

    expect(sent[0]?.text).toBe('broadcast accepted')
  })

  it('single-flights concurrent first messages and preserves their FIFO turns', async () => {
    const adapter = new MockAdapter([textResponse('first'), textResponse('second')])
    const ctx = await harness(adapter)
    const sent: ChannelMessage[] = []
    ctx.channels.registerAdapter(fakeAdapter(sent))
    const both = new Promise<void>((resolve) => {
      ctx.on('channel/outbound', () => { if (sent.length === 2) resolve() })
    })

    ctx.emit('channel/inbound', { channel: 'fake', direction: 'in', conversationId: 'same', text: 'one' })
    ctx.emit('channel/inbound', { channel: 'fake', direction: 'in', conversationId: 'same', text: 'two' })
    await both

    expect(ctx.agents.list()).toHaveLength(1)
    expect(sent.map(message => message.text)).toEqual(['first', 'second'])
    expect(adapter.requests).toHaveLength(2)
  })

  it('does not admit a turn onto an Agent selected for idle eviction', async () => {
    vi.useFakeTimers()
    let ctx: Context | undefined
    try {
      ctx = await harness(new MockAdapter([textResponse('first'), textResponse('second')]), {
        idleTimeoutMs: 1000,
      })
      const sent: ChannelMessage[] = []
      ctx.channels.registerAdapter(fakeAdapter(sent))

      await ctx.parallel('channel/inbound', {
        channel: 'fake', direction: 'in', conversationId: 'idle-race', text: 'one',
      })

      // The timer callback queues the sweep's resolved-promise continuation.
      // Route immediately afterwards to exercise the acquisition/eviction race.
      vi.advanceTimersByTime(1000)
      await ctx.parallel('channel/inbound', {
        channel: 'fake', direction: 'in', conversationId: 'idle-race', text: 'two',
      })

      expect(sent.map(message => message.text)).toEqual(['first', 'second'])
      expect(ctx.agents.list()).toHaveLength(1)
    } finally {
      await ctx?.fiber.dispose()
      vi.useRealTimers()
    }
  })

  it('records and mounts the configured agent preset before publishing the channel agent', async () => {
    const agentPresets = agentPresetsStub()
    const mount = vi.spyOn(agentPresets, 'mount')
    const ctx = await harness(new MockAdapter([textResponse('ok')]), { agentPreset: 'openclaw' }, agentPresets)
    ctx.channels.registerAdapter(fakeAdapter([]))
    const outbound = nextOutbound(ctx)

    ctx.emit('channel/inbound', { channel: 'fake', direction: 'in', conversationId: 'preset', text: 'hi' })
    await outbound

    const agent = ctx.agents.list()[0]
    expect(agent?.session.header.agentPreset).toBe('openclaw')
    expect(mount).toHaveBeenCalledWith(expect.any(Context), 'openclaw')
  })

  it('resumes the same deterministic JSONL session after a process-style restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'clawdsh-channel-resume-'))
    let first: Context | undefined
    let second: Context | undefined
    try {
      first = await persistentHarness(root, new MockAdapter([textResponse('remembered answer')]))
      first.channels.registerAdapter(fakeAdapter([]))
      const firstReply = nextOutbound(first)
      first.emit('channel/inbound', {
        channel: 'fake', direction: 'in', conversationId: 'durable-chat', text: 'remember this question',
      })
      await firstReply
      const sessionId = deriveChannelSessionId('fake', 'durable-chat')
      expect(first.agents.list()[0]?.id).toBe(sessionId)
      await first.fiber.dispose()
      first = undefined

      const resumedAdapter = new MockAdapter([textResponse('continued answer')])
      second = await persistentHarness(root, resumedAdapter)
      second.channels.registerAdapter(fakeAdapter([]))
      const secondReply = nextOutbound(second)
      second.emit('channel/inbound', {
        channel: 'fake', direction: 'in', conversationId: 'durable-chat', text: 'continue',
      })
      await secondReply

      expect(second.agents.list()[0]?.id).toBe(sessionId)
      const request = JSON.stringify(resumedAdapter.requests[0])
      expect(request).toContain('remember this question')
      expect(request).toContain('remembered answer')
      expect(request).toContain('continue')
    } finally {
      await second?.fiber.dispose()
      await first?.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('acks a mentioned group message under the default group-mentions scope', async () => {
    const ctx = await harness(new MockAdapter([textResponse('ok')]))
    const reactions: Array<{ messageId: string | undefined; emoji: string }> = []
    ctx.channels.registerAdapter(reactAdapter(reactions))
    const outbound = nextOutbound(ctx)

    ctx.emit('channel/inbound', {
      channel: 'fake', direction: 'in', conversationId: 't1', messageId: 'm-1',
      chatType: 'group', mention: { detectable: true, botMentioned: true }, text: 'hi',
    })
    await outbound

    expect(reactions).toEqual([{ messageId: 'm-1', emoji: '👀' }])
  })

  it('does not broaden group-mentions when group routing accepts every message', async () => {
    const ctx = await harness(new MockAdapter([textResponse('ok')]), { groupMode: 'always' })
    const reactions: Array<{ messageId: string | undefined; emoji: string }> = []
    ctx.channels.registerAdapter(reactAdapter(reactions))
    const outbound = nextOutbound(ctx)

    ctx.emit('channel/inbound', {
      channel: 'fake', direction: 'in', conversationId: 't1', messageId: 'm-1',
      chatType: 'group', mention: { detectable: true, botMentioned: false }, text: 'hi',
    })
    await outbound

    expect(reactions).toEqual([])
  })

  it('still acks an actual group mention when group routing also accepts unmentioned traffic', async () => {
    const ctx = await harness(new MockAdapter([textResponse('ok')]), { groupMode: 'always' })
    const reactions: Array<{ messageId: string | undefined; emoji: string }> = []
    ctx.channels.registerAdapter(reactAdapter(reactions))
    const outbound = nextOutbound(ctx)

    ctx.emit('channel/inbound', {
      channel: 'fake', direction: 'in', conversationId: 't1', messageId: 'm-1',
      chatType: 'group', mention: { detectable: true, botMentioned: true }, text: 'hi',
    })
    await outbound

    expect(reactions).toEqual([{ messageId: 'm-1', emoji: '👀' }])
  })

  it('does not ack when an accepted group message has an undetectable mention', async () => {
    const ctx = await harness(new MockAdapter([textResponse('ok')]), { groupMode: 'always' })
    const reactions: Array<{ messageId: string | undefined; emoji: string }> = []
    ctx.channels.registerAdapter(reactAdapter(reactions))
    const outbound = nextOutbound(ctx)

    ctx.emit('channel/inbound', {
      channel: 'fake', direction: 'in', conversationId: 't1', messageId: 'm-1',
      chatType: 'group', mention: { detectable: false, botMentioned: false }, text: 'hi',
    })
    await outbound

    expect(reactions).toEqual([])
  })

  it('acks a direct message under the direct scope', async () => {
    const ctx = await harness(new MockAdapter([textResponse('ok')]), { ackReactionScope: 'direct' })
    const reactions: Array<{ messageId: string | undefined; emoji: string }> = []
    ctx.channels.registerAdapter(reactAdapter(reactions))
    const outbound = nextOutbound(ctx)

    ctx.emit('channel/inbound', {
      channel: 'fake', direction: 'in', conversationId: 't1', messageId: 'm-1', chatType: 'direct', text: 'hi',
    })
    await outbound

    expect(reactions).toEqual([{ messageId: 'm-1', emoji: '👀' }])
  })

  it('acks a group message unconditionally under group-all', async () => {
    const ctx = await harness(new MockAdapter([textResponse('ok')]), {
      groupMode: 'always',
      ackReactionScope: 'group-all',
    })
    const reactions: Array<{ messageId: string | undefined; emoji: string }> = []
    ctx.channels.registerAdapter(reactAdapter(reactions))
    const outbound = nextOutbound(ctx)

    ctx.emit('channel/inbound', {
      channel: 'fake', direction: 'in', conversationId: 't1', messageId: 'm-1',
      chatType: 'group', mention: { detectable: true, botMentioned: false }, text: 'hi',
    })
    await outbound

    expect(reactions).toEqual([{ messageId: 'm-1', emoji: '👀' }])
  })

  it('disables acks entirely when ackReaction is an explicit empty string', async () => {
    const ctx = await harness(new MockAdapter([textResponse('ok')]), { ackReaction: '', ackReactionScope: 'all' })
    const reactions: Array<{ messageId: string | undefined; emoji: string }> = []
    ctx.channels.registerAdapter(reactAdapter(reactions))
    const outbound = nextOutbound(ctx)

    ctx.emit('channel/inbound', {
      channel: 'fake', direction: 'in', conversationId: 't1', messageId: 'm-1', text: 'hi',
    })
    await outbound

    expect(reactions).toEqual([])
  })
})
