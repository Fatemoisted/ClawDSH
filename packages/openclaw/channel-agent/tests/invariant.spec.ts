import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import * as ChannelInvariant from '../src/invariant.ts'
import type { ChannelMessageSource } from '../src/events.ts'

function source(overrides: Record<string, unknown> = {}): ChannelMessageSource {
  return {
    kind: 'channel',
    gatewayInstanceId: 'gateway-1',
    openclawSessionKey: 'openclaw-session-1',
    generation: 0,
    channel: 'telegram',
    account: 'account-1',
    conversation: 'conversation-1',
    messageId: 'message-1',
    idempotencyKey: 'inbound-1',
    runId: 'run-1',
    senderId: 'sender-1',
    trust: 'owner',
    isGroup: false,
    turnId: 'turn-1',
    ...overrides,
  } as ChannelMessageSource
}

function append(session: Session, provenance: ChannelMessageSource): void {
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'hello' }],
    source: provenance,
  }), { surfaceOp: 'append' })
}

async function setup(before?: (ctx: Context) => void): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  before?.(ctx)
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(ChannelInvariant)
  return ctx
}

describe('channel message invariants', () => {
  it('accepts multiple unique messages on one exact route and ignores unrelated events', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('valid-channel'))
    session.append('turn/start', { turn: 1 })
    append(session, source())
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    append(session, source({
      turnId: 'turn-2', runId: 'run-2', idempotencyKey: 'inbound-2', messageId: 'message-2',
    }))
    expect(session.events.filter(event => event.type === 'user/message')).toHaveLength(2)
  })

  it('rejects invalid generation and conversation/admission disagreement', async () => {
    const ctx = await setup()
    expect(() => { append(ctx.sessions.create(), source({ generation: -1 })) }).toThrow(/invalid route generation/)
    expect(() => { append(ctx.sessions.create(), source({ isGroup: true, trust: 'owner' })) })
      .toThrow(/admission class inconsistent/)
    expect(() => { append(ctx.sessions.create(), source({ isGroup: false, trust: 'group-allowlisted' })) })
      .toThrow(/admission class inconsistent/)
  })

  it('rejects unknown admission classes in live and restored Sessions', async () => {
    const live = await setup()
    expect(() => { append(live.sessions.create(), source({ trust: 'administrator' })) })
      .toThrow(/unknown admission class/)
    await live.fiber.dispose()

    await expect(setup((ctx) => {
      append(ctx.sessions.create(), source({ trust: 'administrator' }))
    })).rejects.toThrow(/unknown admission class/)
  })

  it('rejects every route identity field changing inside one Session', async () => {
    const changes: Record<string, unknown>[] = [
      { gatewayInstanceId: 'gateway-2' },
      { openclawSessionKey: 'session-2' },
      { generation: 1 },
      { channel: 'feishu' },
      { account: 'account-2' },
      { conversation: 'conversation-2' },
      { thread: 'thread-2' },
      { isGroup: true, trust: 'group-allowlisted' },
    ]
    for (const [index, change] of changes.entries()) {
      const ctx = await setup()
      const session = ctx.sessions.create(SessionId(`route-${String(index)}`))
      append(session, source())
      expect(() => { append(session, source({
        turnId: `turn-${String(index + 2)}`,
        runId: `run-${String(index + 2)}`,
        idempotencyKey: `inbound-${String(index + 2)}`,
        messageId: `message-${String(index + 2)}`,
        ...change,
      })) }).toThrow(/crossed.*route/)
      await ctx.fiber.dispose()
    }
  })

  it('rejects duplicate turn, run, idempotency, and platform message identities', async () => {
    const duplicates = [
      {},
      { turnId: 'turn-2' },
      { turnId: 'turn-2', runId: 'run-2' },
      { turnId: 'turn-2', runId: 'run-2', idempotencyKey: 'inbound-2' },
    ]
    const labels = ['turn', 'run', 'idempotency key', 'platform message']
    for (const [index, change] of duplicates.entries()) {
      const ctx = await setup()
      const session = ctx.sessions.create(SessionId(`duplicate-${String(index)}`))
      append(session, source())
      expect(() => { append(session, source(change)) }).toThrow(new RegExp(labels[index] ?? 'duplicate'))
      await ctx.fiber.dispose()
    }
  })

  it('seeds Sessions that already existed before the invariant companion mounted', async () => {
    let existing!: Session
    const ctx = await setup((inner) => {
      existing = inner.sessions.create(SessionId('preexisting-channel'))
      append(existing, source())
    })
    expect(() => { append(existing, source({
      turnId: 'turn-2', runId: 'run-2', idempotencyKey: 'inbound-2', messageId: 'message-2',
    })) }).not.toThrow()
    expect(() => { append(existing, source({
      turnId: 'turn-3', runId: 'run-3', idempotencyKey: 'inbound-3', messageId: 'message-2',
    })) }).toThrow(/platform message/)
    await ctx.fiber.dispose()
  })

  it('registers through the invariant registry under its package identity', async () => {
    const register = (packageName: string) => {
      expect(packageName).toBe('@clawdsh/dsh-channel-agent')
      return () => {}
    }
    const disposer = await ChannelInvariant.apply({ invariants: { register } } as never)
    expect(ChannelInvariant.name).toBe('channel-agent-invariant')
    expect(ChannelInvariant.inject).toEqual(['invariants'])
    expect(disposer).toBeTypeOf('function')
  })
})
