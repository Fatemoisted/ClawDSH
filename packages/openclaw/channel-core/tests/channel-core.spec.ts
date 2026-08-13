import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import ChannelRegistry from '@clawdsh/dsh-channel-core'
import type { ChannelAdapter, ChannelMessage } from '@clawdsh/dsh-channel-core'
import { MockAdapter, textResponse } from './mock-adapter.ts'

async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(AgentDefaultModelConfig, { provider: 'mock', model: 'mock' })
  ctx.llm.registerAdapter(['mock'], adapter)
  await ctx.plugin(ChannelRegistry)
  return ctx
}

function fakeAdapter(sent: ChannelMessage[]): ChannelAdapter {
  return {
    id: 'fake',
    capabilities: { receive: true, send: true },
    start: () => () => {},
    send: async (message) => { sent.push(message) },
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

    dispose()

    expect(ctx.channels.listAdapters()).toHaveLength(0)
    expect(ctx.channels.getAdapter('fake')).toBeUndefined()
  })

  it('rejects a duplicate adapter id', async () => {
    const ctx = await harness(new MockAdapter([]))
    ctx.channels.registerAdapter(fakeAdapter([]))
    expect(() => ctx.channels.registerAdapter(fakeAdapter([]))).toThrow(/already registered/)
  })

  it('routes an inbound message to an agent turn and delivers the reply', async () => {
    const ctx = await harness(new MockAdapter([textResponse('hello there')]))
    const sent: ChannelMessage[] = []
    ctx.channels.registerAdapter(fakeAdapter(sent))
    const outbound = nextOutbound(ctx)

    ctx.emit('channel/inbound', { channel: 'fake', direction: 'in', threadId: 't1', sender: 'u1', text: 'hi' })

    const reply = await outbound
    expect(reply).toMatchObject({ channel: 'fake', direction: 'out', threadId: 't1', sender: 'u1' })
    expect(reply.text).toBe('hello there')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual(reply)
  })

  it('reuses one session per thread and creates a new one per distinct thread', async () => {
    const ctx = await harness(new MockAdapter([textResponse('a'), textResponse('b'), textResponse('c')]))
    ctx.channels.registerAdapter(fakeAdapter([]))

    const first = nextOutbound(ctx)
    ctx.emit('channel/inbound', { channel: 'fake', direction: 'in', threadId: 't1', text: 'one' })
    await first

    const second = nextOutbound(ctx)
    ctx.emit('channel/inbound', { channel: 'fake', direction: 'in', threadId: 't1', text: 'two' })
    await second

    const third = nextOutbound(ctx)
    ctx.emit('channel/inbound', { channel: 'fake', direction: 'in', threadId: 't2', text: 'three' })
    await third

    expect(ctx.agents.list()).toHaveLength(2)
  })
})
