import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  ChannelActionId,
  ChannelDeliveryId,
  ChannelDirectoryEntryId,
  ChannelMessageId,
  ChannelProviderId,
  channelActionDeliveryReceiptV1Schema,
  type ChannelActionResultV1,
  type ChannelActionV1,
  type ChannelDeliveryReceiptV1,
  type ChannelProviderV1,
  type ChannelRouteV1,
} from '@clawdsh/dsh-channel'
import ChannelService from '@clawdsh/dsh-channel'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { registerMessageTool } from '../src/message-tool.ts'
import { turn } from './fixtures.ts'

const contexts: Context[] = []
const signal = new AbortController().signal

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function delivery(action: ChannelActionV1, status: ChannelDeliveryReceiptV1['status']): ChannelActionResultV1 {
  const common = {
    protocolVersion: 1,
    deliveryId: ChannelDeliveryId(`delivery-${action.actionId}`),
    subject: { kind: 'action' as const, actionId: action.actionId },
    attempt: 1,
    platformMessageId: ChannelMessageId(`platform-${action.actionId}`),
  }
  if (status === 'retrying') {
    return channelActionDeliveryReceiptV1Schema.parse({
      ...common,
      status,
      nextAttemptAt: '2026-08-16T00:00:00Z',
      error: { code: 'RATE_LIMIT', message: 'retry later', retryable: true },
    })
  }
  if (status === 'ambiguous' || status === 'dead-letter') {
    return channelActionDeliveryReceiptV1Schema.parse({
      ...common,
      status,
      error: { code: 'DELIVERY_FAILED', message: 'delivery unresolved', retryable: false },
    })
  }
  return channelActionDeliveryReceiptV1Schema.parse({ ...common, status })
}

function directory(action: ChannelActionV1): ChannelActionResultV1 {
  return {
    protocolVersion: 1,
    actionId: action.actionId,
    kind: 'directory',
    entries: [
      {
        kind: 'user',
        id: ChannelDirectoryEntryId('peer-1'),
        name: 'Alice',
        handle: '@alice',
        rank: 1,
      },
      { kind: 'group', id: ChannelDirectoryEntryId('group-1') },
    ],
  }
}

function resolved(action: ChannelActionV1): ChannelActionResultV1 {
  return {
    protocolVersion: 1,
    actionId: action.actionId,
    kind: 'resolve',
    results: [
      {
        input: '@alice',
        resolved: true,
        id: ChannelDirectoryEntryId('peer-1'),
        name: 'Alice',
        note: 'exact',
      },
      { input: 'missing', resolved: false, note: 'not found' },
      { input: 'anonymous', resolved: false },
      { input: 'id-only', resolved: true, id: ChannelDirectoryEntryId('peer-2') },
    ],
  }
}

async function setup(
  responder: (action: ChannelActionV1) => ChannelActionResultV1,
  route: ChannelRouteV1 = turn().route,
): Promise<{ ctx: Context; actions: ChannelActionV1[] }> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(ChannelService)
  const actions: ChannelActionV1[] = []
  const provider: ChannelProviderV1 = {
    id: ChannelProviderId('test-provider'),
    async action(action) {
      actions.push(action)
      return responder(action)
    },
    async health() {
      return {
        protocolVersion: 1,
        status: 'ready',
        checkedAt: '2026-08-16T00:00:00Z',
        accounts: [],
        diagnostics: [],
      }
    },
  }
  ctx.channels.registerProvider(provider)
  registerMessageTool(ctx, route, (action, signal_) => ctx.channels.action(action, signal_))
  return { ctx, actions }
}

async function execute(ctx: Context, callId: string, arguments_: Record<string, unknown>) {
  return await ctx.tools.execute({ signal, callId: CallId(callId), name: 'message', arguments: arguments_ })
}

describe('the route-bound message tool', () => {
  it('maps every action and returns delivery, directory, and resolve results as canonical JSON', async () => {
    const statuses: ChannelDeliveryReceiptV1['status'][] = [
      'accepted', 'confirmed', 'retrying', 'ambiguous', 'dead-letter', 'confirmed',
    ]
    let index = 0
    const { ctx, actions } = await setup((action) => {
      if (action.kind.startsWith('directory.')) return directory(action)
      if (action.kind === 'resolve') return resolved(action)
      return delivery(action, statuses[index++] ?? 'confirmed')
    })
    const calls = [
      { action: 'send', text: 'hello', reply_to: 'message-0' },
      { action: 'edit', message_id: 'message-1', text: 'changed' },
      { action: 'delete', message_id: 'message-2' },
      { action: 'react', message_id: 'message-3', reaction: '👍' },
      { action: 'poll', question: 'Pick', options: ['A', 'B'] },
      { action: 'typing', active: false },
      { action: 'directory.self' },
      { action: 'directory.list-peers', source: 'cached', query: 'ali', limit: 10 },
      { action: 'directory.list-groups', source: 'live' },
      { action: 'directory.list-group-members', group_id: 'group-1', limit: 2 },
      { action: 'resolve', resolve_kind: 'user', inputs: ['@alice', 'missing', 'anonymous', 'id-only'] },
    ]
    const results = []
    for (const [callIndex, args] of calls.entries()) {
      results.push(await execute(ctx, `call-${String(callIndex)}`, args))
    }

    expect(actions.map(action => action.kind)).toEqual([
      'send', 'edit', 'delete', 'react', 'poll', 'typing',
      'directory.self', 'directory.list-peers', 'directory.list-groups',
      'directory.list-group-members', 'resolve',
    ])
    expect(actions[0]).toMatchObject({ text: 'hello', media: [], replyTo: 'message-0' })
    expect(actions[1]).toMatchObject({ messageId: 'message-1', text: 'changed', media: [] })
    expect(actions[2]).toMatchObject({ messageId: 'message-2' })
    expect(actions[3]).toMatchObject({ messageId: 'message-3', reaction: '👍', operation: 'add' })
    expect(actions[4]).toMatchObject({ question: 'Pick', options: ['A', 'B'], multiple: false })
    expect(actions[5]).toMatchObject({ active: false })
    expect(actions[7]).toMatchObject({ source: 'cached', query: 'ali', limit: 10 })
    expect(actions[8]).toMatchObject({ source: 'live' })
    expect(actions[9]).toMatchObject({ groupId: 'group-1', limit: 2 })
    expect(actions[10]).toMatchObject({
      resolveKind: 'user', inputs: ['@alice', 'missing', 'anonymous', 'id-only'],
    })
    expect(results.every(result => !result.isError)).toBe(true)
    expect(results[2]?.value).toMatchObject({
      status: 'retrying',
      nextAttemptAt: '2026-08-16T00:00:00Z',
      error: { code: 'RATE_LIMIT', retryable: true },
    })
    expect(results[3]?.value).toMatchObject({ status: 'ambiguous', error: { code: 'DELIVERY_FAILED' } })
    expect(results[4]?.value).toMatchObject({ status: 'dead-letter', error: { code: 'DELIVERY_FAILED' } })
    expect(results[6]?.value).toMatchObject({
      kind: 'directory',
      entries: [
        { kind: 'user', id: 'peer-1', name: 'Alice', handle: '@alice', rank: 1 },
        { kind: 'group', id: 'group-1' },
      ],
    })
    expect(results[10]?.value).toMatchObject({
      kind: 'resolve',
      results: [
        { input: '@alice', resolved: true, id: 'peer-1', name: 'Alice', note: 'exact' },
        { input: 'missing', resolved: false, note: 'not found' },
        { input: 'anonymous', resolved: false },
        { input: 'id-only', resolved: true, id: 'peer-2' },
      ],
    })
    expect(ctx.tools.get('message')?.presentCall?.({ action: 'send', text: 'hello' })).toMatchObject({
      rawInput: { action: 'send', channel: turn().route.channel },
    })
  })

  it('forwards explicit optional values and presents channel coordinates only as generic raw input', async () => {
    const route = turn({
      route: { ...turn().route, thread: 'thread-1' },
    }).route
    const { ctx, actions } = await setup(action => delivery(action, 'confirmed'), route)
    const reaction = await execute(ctx, 'remove', {
      action: 'react', message_id: 'message-1', reaction: '👀', operation: 'remove',
    })
    const poll = await execute(ctx, 'multiple', {
      action: 'poll', question: 'Pick', options: ['A', 'B'], multiple: true,
    })
    expect(reaction.isError).toBe(false)
    expect(poll.isError).toBe(false)
    expect(actions.at(-2)).toMatchObject({ operation: 'remove' })
    expect(actions.at(-1)).toMatchObject({ multiple: true })

    const definition = ctx.tools.get('message')
    expect(definition?.presentCall?.({ action: 'edit', message_id: 'message-9', text: 'x' })).toEqual({
      card: 'generic',
      title: 'edit channel message',
      kind: 'other',
      rawInput: {
        action: 'edit',
        channel: route.channel,
        account: route.account,
        conversation: route.conversation,
        thread: route.thread,
        message: 'message-9',
      },
    })
    expect(definition?.presentCall?.({ action: 'send', text: 'x' })).toMatchObject({
      rawInput: { action: 'send', channel: route.channel },
    })
    expect(definition?.presentCall?.({ action: 'unknown' })).toBeUndefined()

    const optionalDirectory = await setup(action => action.kind === 'resolve' ? resolved(action) : directory(action))
    await execute(optionalDirectory.ctx, 'peers-defaults', {
      action: 'directory.list-peers', source: 'live',
    })
    await execute(optionalDirectory.ctx, 'groups-complete', {
      action: 'directory.list-groups', source: 'cached', query: 'team', limit: 3,
    })
    await execute(optionalDirectory.ctx, 'members-defaults', {
      action: 'directory.list-group-members', group_id: 'group-1',
    })
    expect(optionalDirectory.actions).toEqual([
      expect.objectContaining({ kind: 'directory.list-peers', source: 'live' }),
      expect.objectContaining({ kind: 'directory.list-groups', source: 'cached', query: 'team', limit: 3 }),
      expect.objectContaining({ kind: 'directory.list-group-members', groupId: 'group-1' }),
    ])
  })

  it('derives a stable action identity from the durable call and complete route', async () => {
    const first = await setup(action => delivery(action, 'confirmed'))
    await execute(first.ctx, 'durable-call', { action: 'send', text: 'hello' })
    await execute(first.ctx, 'durable-call', { action: 'send', text: 'hello' })
    expect(first.actions).toHaveLength(2)
    expect(first.actions[0]?.actionId).toBe(first.actions[1]?.actionId)
    expect(first.actions[0]?.actionId).toMatch(/^[a-f0-9]{64}$/)

    const otherSession = await setup(
      action => delivery(action, 'confirmed'),
      turn({ route: { ...turn().route, openclawSessionKey: 'other-session' } }).route,
    )
    const otherRoute = await setup(
      action => delivery(action, 'confirmed'),
      turn({ route: { ...turn().route, account: 'other-account', conversation: 'other-conversation' } }).route,
    )
    await execute(otherSession.ctx, 'durable-call', { action: 'send', text: 'hello' })
    await execute(otherRoute.ctx, 'durable-call', { action: 'send', text: 'hello' })
    expect(new Set([
      first.actions[0]?.actionId,
      otherSession.actions[0]?.actionId,
      otherRoute.actions[0]?.actionId,
    ])).toHaveLength(3)
  })

  it('rejects missing or malformed action-specific arguments before provider dispatch', async () => {
    const { ctx, actions } = await setup(action => delivery(action, 'confirmed'))
    const invalid = [
      { action: 'send' },
      { action: 'send', text: '' },
      { action: 'edit', message_id: 'm' },
      { action: 'edit', text: 'x' },
      { action: 'delete' },
      { action: 'react', message_id: 'm' },
      { action: 'react', reaction: '👍' },
      { action: 'poll', question: 'Q', options: ['A'] },
      { action: 'poll', question: 'Q' },
      { action: 'poll', question: 'Q', options: ['A', 'A'] },
      { action: 'poll', question: 'Q', options: ['A', ''] },
      { action: 'poll', options: ['A', 'B'] },
      { action: 'typing' },
      { action: 'directory.list-peers' },
      { action: 'directory.list-groups', source: 'cached', limit: 0 },
      { action: 'directory.list-groups', source: 'cached', limit: Number.MAX_SAFE_INTEGER + 1 },
      { action: 'directory.list-group-members' },
      { action: 'resolve', resolve_kind: 'user' },
      { action: 'resolve', inputs: ['alice'] },
      { action: 'resolve', resolve_kind: 'user', inputs: [] },
      { action: 'resolve', resolve_kind: 'user', inputs: [''] },
      { action: 'unknown' },
    ]
    for (const [index, args] of invalid.entries()) {
      expect((await execute(ctx, `invalid-${String(index)}`, args)).isError).toBe(true)
    }
    expect(actions).toEqual([])
  })

  it('fails closed for unsupported actions and mismatched provider result variants or identities', async () => {
    const { ctx } = await setup(action => ({
      protocolVersion: 1,
      actionId: action.actionId,
      kind: 'directory',
      entries: [],
    }))
    const result = await execute(ctx, 'wrong-result', { action: 'send', text: 'hello' })
    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ type: 'text' })

    const directoryReceipt = await setup(action => delivery(action, 'confirmed'))
    expect((await execute(directoryReceipt.ctx, 'directory-receipt', {
      action: 'directory.self',
    })).isError).toBe(true)
    expect((await execute(directoryReceipt.ctx, 'resolve-receipt', {
      action: 'resolve', resolve_kind: 'user', inputs: ['alice'],
    })).isError).toBe(true)

    const resolveDirectory = await setup(directory)
    expect((await execute(resolveDirectory.ctx, 'resolve-directory', {
      action: 'resolve', resolve_kind: 'user', inputs: ['alice'],
    })).isError).toBe(true)

    const directoryResolve = await setup(resolved)
    expect((await execute(directoryResolve.ctx, 'directory-resolve', {
      action: 'directory.self',
    })).isError).toBe(true)

    const shortResolve = await setup(action => ({
      protocolVersion: 1,
      actionId: action.actionId,
      kind: 'resolve',
      results: [],
    }))
    expect((await execute(shortResolve.ctx, 'short-resolve', {
      action: 'resolve', resolve_kind: 'user', inputs: ['alice'],
    })).isError).toBe(true)
    const reorderedResolve = await setup(action => ({
      protocolVersion: 1,
      actionId: action.actionId,
      kind: 'resolve',
      results: [{ input: 'other', resolved: false }],
    }))
    expect((await execute(reorderedResolve.ctx, 'reordered-resolve', {
      action: 'resolve', resolve_kind: 'user', inputs: ['alice'],
    })).isError).toBe(true)

    const wrongIdentity = await setup(() => ({
      protocolVersion: 1,
      actionId: ChannelActionId('other-action'),
      kind: 'directory',
      entries: [],
    }))
    expect((await execute(wrongIdentity.ctx, 'wrong-identity', { action: 'directory.self' })).isError).toBe(true)

    const unsupported = await setup(() => { throw new Error('channel action is unsupported by this account') })
    const unsupportedResult = await execute(unsupported.ctx, 'unsupported', { action: 'directory.self' })
    expect(unsupportedResult.isError).toBe(true)
    expect(unsupportedResult.content).toHaveLength(1)
    const errorContent = unsupportedResult.content[0]
    expect(errorContent?.type).toBe('text')
    if (errorContent?.type !== 'text') throw new Error('expected a text tool error')
    expect(errorContent.text).toContain('unsupported by this account')

    const noPlatformId = await setup(action => channelActionDeliveryReceiptV1Schema.parse({
      protocolVersion: 1,
      deliveryId: ChannelDeliveryId(`delivery-${action.actionId}`),
      subject: { kind: 'action', actionId: action.actionId },
      attempt: 1,
      status: 'accepted',
    }))
    const accepted = await execute(noPlatformId.ctx, 'without-platform-id', { action: 'send', text: 'hello' })
    expect(accepted.value).not.toHaveProperty('platformMessageId')
  })
})
