/** Agent-scoped `message` tool backed by the channel Service. @module @clawdsh/dsh-channel-agent/message-tool */

import type { Context } from '@deepseek-ai/cordis'
import {
  ChannelActionId,
  ChannelDirectoryEntryId,
  ChannelMessageId,
  channelActionResultV1Schema,
  type ChannelActionDeliveryReceiptV1,
  type ChannelActionResultV1,
  type ChannelActionTargetV1,
  type ChannelActionV1,
  type ChannelDirectoryEntryV1,
  type ChannelResolveMatchV1,
  type ChannelRouteV1,
} from '@clawdsh/dsh-channel'
import { defineTool, type GenericCallView, type JsonValue } from '@deepseek-ai/dsh-tools'
import { digestJson } from './storage.ts'

/** Arguments accepted by the model-visible channel action tool. */
interface MessageArgs {
  action:
    | 'send'
    | 'edit'
    | 'delete'
    | 'react'
    | 'poll'
    | 'typing'
    | 'directory.self'
    | 'directory.list-peers'
    | 'directory.list-groups'
    | 'directory.list-group-members'
    | 'resolve'
  text?: string
  message_id?: string
  reply_to?: string
  reaction?: string
  operation?: 'add' | 'remove'
  question?: string
  options?: string[]
  multiple?: boolean
  active?: boolean
  query?: string
  limit?: number
  source?: 'cached' | 'live'
  group_id?: string
  resolve_kind?: 'user' | 'group'
  inputs?: string[]
}

/** Stable target projection for the current channel Session. */
function targetFor(route: ChannelRouteV1): ChannelActionTargetV1 {
  return {
    gatewayInstanceId: route.gatewayInstanceId,
    channel: route.channel,
    account: route.account,
    conversation: route.conversation,
    ...(route.thread === undefined ? {} : { thread: route.thread }),
  }
}

/** Require a non-empty argument for an action-specific field. */
function required<T extends string>(value: T | undefined, field: string, action: string): T {
  if (value === undefined || value.length === 0) {
    throw new Error(`message: ${field} is required for ${action}`)
  }
  return value
}

/** Require a positive safe integer when a directory result cap is supplied. */
function optionalLimit(value: number | undefined): number | undefined {
  if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new Error('message: limit must be a positive safe integer')
  }
  return value
}

/** Derive the Provider idempotency identity from the durable tool call and complete route. */
function actionIdFor(route: ChannelRouteV1, callId: string): ChannelActionId {
  return ChannelActionId(digestJson(['channel-action-v1', 'message', route, callId]))
}

/** Convert validated tool arguments into the closed channel action union. */
function actionFor(args: MessageArgs, route: ChannelRouteV1, actionId: ChannelActionId): ChannelActionV1 {
  const base = {
    protocolVersion: 1 as const,
    actionId,
    target: targetFor(route),
  }
  switch (args.action) {
    case 'send':
      return {
        ...base,
        kind: 'send',
        text: required(args.text, 'text', args.action),
        media: [],
        ...(args.reply_to === undefined ? {} : {
          replyTo: ChannelMessageId(required(args.reply_to, 'reply_to', args.action)),
        }),
      }
    case 'edit':
      return {
        ...base,
        kind: 'edit',
        messageId: ChannelMessageId(required(args.message_id, 'message_id', args.action)),
        text: required(args.text, 'text', args.action),
        media: [],
      }
    case 'delete':
      return {
        ...base,
        kind: 'delete',
        messageId: ChannelMessageId(required(args.message_id, 'message_id', args.action)),
      }
    case 'react':
      return {
        ...base,
        kind: 'react',
        messageId: ChannelMessageId(required(args.message_id, 'message_id', args.action)),
        reaction: required(args.reaction, 'reaction', args.action),
        operation: args.operation ?? 'add',
      }
    case 'poll': {
      const options = args.options ?? []
      if (options.length < 2 || new Set(options).size !== options.length || options.some(option => option.length === 0)) {
        throw new Error('message: poll requires at least two distinct non-empty options')
      }
      return {
        ...base,
        kind: 'poll',
        question: required(args.question, 'question', args.action),
        options,
        multiple: args.multiple ?? false,
      }
    }
    case 'typing':
      if (args.active === undefined) throw new Error('message: active is required for typing')
      return { ...base, kind: 'typing', active: args.active }
    case 'directory.self':
      return { ...base, kind: 'directory.self' }
    case 'directory.list-peers': {
      const limit = optionalLimit(args.limit)
      return {
        ...base,
        kind: 'directory.list-peers',
        source: required(args.source, 'source', args.action),
        ...(args.query === undefined ? {} : { query: args.query }),
        ...(limit === undefined ? {} : { limit }),
      }
    }
    case 'directory.list-groups': {
      const limit = optionalLimit(args.limit)
      return {
        ...base,
        kind: 'directory.list-groups',
        source: required(args.source, 'source', args.action),
        ...(args.query === undefined ? {} : { query: args.query }),
        ...(limit === undefined ? {} : { limit }),
      }
    }
    case 'directory.list-group-members': {
      const limit = optionalLimit(args.limit)
      return {
        ...base,
        kind: 'directory.list-group-members',
        groupId: ChannelDirectoryEntryId(required(args.group_id, 'group_id', args.action)),
        ...(limit === undefined ? {} : { limit }),
      }
    }
    case 'resolve': {
      const inputs = args.inputs ?? []
      if (inputs.length === 0 || inputs.some(input => input.length === 0)) {
        throw new Error('message: resolve requires at least one non-empty input')
      }
      return {
        ...base,
        kind: 'resolve',
        resolveKind: required(args.resolve_kind, 'resolve_kind', args.action),
        inputs,
      }
    }
    /* v8 ignore next 3 -- defineTool validates action against the closed enum before calling this converter. */
    default: {
      const exhaustive: never = args.action
      throw new Error(`message: unsupported action ${String(exhaustive)}`)
    }
  }
}

/** Pure pending-call presentation. Channel coordinates are data, not file locations. */
function present(args: MessageArgs, route: ChannelRouteV1): GenericCallView {
  return {
    card: 'generic',
    title: `${args.action} channel message`,
    kind: 'other',
    rawInput: {
      action: args.action,
      channel: route.channel,
      account: route.account,
      conversation: route.conversation,
      ...(route.thread === undefined ? {} : { thread: route.thread }),
      ...(args.message_id === undefined ? {} : { message: args.message_id }),
    },
  }
}

/** Copy one validated receipt into the mutable JSON value accepted by the tool runtime. */
function receiptJson(receipt: ChannelActionDeliveryReceiptV1): Record<string, JsonValue> {
  const value: Record<string, JsonValue> = {
    protocolVersion: receipt.protocolVersion,
    deliveryId: receipt.deliveryId,
    subject: { kind: 'action', actionId: receipt.subject.actionId },
    attempt: receipt.attempt,
    status: receipt.status,
  }
  if (receipt.platformMessageId !== undefined) value.platformMessageId = receipt.platformMessageId
  if (receipt.status === 'retrying') value.nextAttemptAt = receipt.nextAttemptAt
  if (receipt.status === 'retrying' || receipt.status === 'ambiguous' || receipt.status === 'dead-letter') {
    value.error = {
      code: receipt.error.code,
      message: receipt.error.message,
      retryable: receipt.error.retryable,
    }
  }
  return value
}

/** Copy one sanitized directory entry into mutable tool JSON. */
function directoryEntryJson(entry: ChannelDirectoryEntryV1): Record<string, JsonValue> {
  return {
    kind: entry.kind,
    id: entry.id,
    ...(entry.name === undefined ? {} : { name: entry.name }),
    ...(entry.handle === undefined ? {} : { handle: entry.handle }),
    ...(entry.rank === undefined ? {} : { rank: entry.rank }),
  }
}

/** Copy one sanitized target-resolution result into mutable tool JSON. */
function resolveMatchJson(match: ChannelResolveMatchV1): Record<string, JsonValue> {
  if (!match.resolved) {
    return {
      input: match.input,
      resolved: false,
      ...(match.note === undefined ? {} : { note: match.note }),
    }
  }
  return {
    input: match.input,
    resolved: true,
    id: match.id,
    ...(match.name === undefined ? {} : { name: match.name }),
    ...(match.note === undefined ? {} : { note: match.note }),
  }
}

/** Validate result/action correlation and copy the closed result union to tool JSON. */
function actionResultJson(action: ChannelActionV1, result: ChannelActionResultV1): Record<string, JsonValue> {
  const resultActionId = 'status' in result ? result.subject.actionId : result.actionId
  if (resultActionId !== action.actionId) {
    throw new Error('message: channel provider returned a result for a different action')
  }
  if ('status' in result) {
    if (action.kind.startsWith('directory.')) {
      throw new Error('message: directory action did not return a directory result')
    }
    if (action.kind === 'resolve') throw new Error('message: resolve action did not return a resolve result')
    return receiptJson(result)
  }
  if (action.kind.startsWith('directory.')) {
    if (result.kind !== 'directory') throw new Error('message: directory action did not return a directory result')
    return {
      protocolVersion: result.protocolVersion,
      actionId: result.actionId,
      kind: result.kind,
      entries: result.entries.map(directoryEntryJson),
    }
  }
  if (action.kind === 'resolve') {
    if (result.kind !== 'resolve') throw new Error('message: resolve action did not return a resolve result')
    if (result.results.length !== action.inputs.length
      || result.results.some((match, index) => match.input !== action.inputs[index])) {
      throw new Error('message: resolve result does not match the requested input order')
    }
    return {
      protocolVersion: result.protocolVersion,
      actionId: result.actionId,
      kind: result.kind,
      results: result.results.map(resolveMatchJson),
    }
  }
  throw new Error('message: mutation action did not return a delivery receipt')
}

/** Dispatch one channel action through the driver owner's injected Service view. */
export type ChannelActionDispatcher = (
  action: ChannelActionV1,
  signal: AbortSignal,
) => Promise<ChannelActionResultV1>

/**
 * Register one route-bound `message` tool in an unpublished Agent scope.
 * @param ctx - Unpublished Agent context that owns the scoped tool.
 * @param route - Immutable channel destination bound to the Session.
 * @param dispatchAction - Service dispatch captured by the channel-agent plugin's injected context.
 */
export function registerMessageTool(
  ctx: Context,
  route: ChannelRouteV1,
  dispatchAction: ChannelActionDispatcher,
): void {
  ctx.tools.register(defineTool({
    name: 'message',
    description: 'Perform a capability-checked native action or sanitized directory query in the current OpenClaw conversation. Unsupported platform actions fail explicitly.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: [
          'send', 'edit', 'delete', 'react', 'poll', 'typing',
          'directory.self', 'directory.list-peers', 'directory.list-groups',
          'directory.list-group-members', 'resolve',
        ],
      },
      text: { type: 'string', description: 'Text for send or edit.' },
      message_id: { type: 'string', description: 'Platform message id for edit, delete, or react.' },
      reply_to: { type: 'string', description: 'Platform message id to reply to when sending.' },
      reaction: { type: 'string', description: 'Reaction name or emoji.' },
      operation: { type: 'string', enum: ['add', 'remove'], description: 'Reaction operation; defaults to add.' },
      question: { type: 'string', description: 'Poll question.' },
      options: { type: 'array', items: { type: 'string' }, description: 'Poll options.' },
      multiple: { type: 'boolean', description: 'Whether a poll accepts multiple selections.' },
      active: { type: 'boolean', description: 'Whether to start or stop typing.' },
      query: { type: 'string', description: 'Optional provider-native directory search text.' },
      limit: { type: 'integer', description: 'Optional positive directory result cap.' },
      source: { type: 'string', enum: ['cached', 'live'], description: 'Directory data source.' },
      group_id: { type: 'string', description: 'Platform group id for member lookup.' },
      resolve_kind: { type: 'string', enum: ['user', 'group'], description: 'Destination class to resolve.' },
      inputs: { type: 'array', items: { type: 'string' }, description: 'Ordered destination strings to resolve.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args: unknown, value: JsonValue) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: async (args, exec) => {
      const action = actionFor(args, route, actionIdFor(route, exec.callId))
      const result = channelActionResultV1Schema.parse(await dispatchAction(action, exec.signal))
      return actionResultJson(action, result)
    },
    presentCall: args => present(args, route),
  }))
}
