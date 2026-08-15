/** Provider-owned durable action and delivery receipt ledger. @module @clawdsh/dsh-channel-openclaw/storage */

import { z } from 'zod'
import {
  channelActionResultV1Schema,
  channelActionV1Schema,
  channelDeliveryReceiptV1Schema,
  type ChannelActionResultV1,
  type ChannelActionV1,
  type ChannelDeliveryReceiptV1,
} from '@clawdsh/dsh-channel'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** Latest provider-durable receipt for one delivery identity. */
export interface ProviderDeliveryRecord {
  readonly receipt: ChannelDeliveryReceiptV1
  readonly updatedAt: number
}

/** Fields shared by every durable side-effecting platform action state. */
interface ProviderActionRecordBase {
  readonly digest: string
  readonly action: ChannelActionV1
  readonly updatedAt: number
}

/** Durable idempotency state for one side-effecting platform action. */
export type ProviderActionRecord =
  | (ProviderActionRecordBase & { readonly phase: 'running' | 'needs-recovery' })
  | (ProviderActionRecordBase & { readonly phase: 'completed'; readonly result: ChannelActionResultV1 })

const deliveryRecordSchema = z.object({
  receipt: channelDeliveryReceiptV1Schema,
  updatedAt: z.number().int().nonnegative(),
}).strict() satisfies z.ZodType<ProviderDeliveryRecord>

const actionRecordBase = {
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  action: channelActionV1Schema,
  updatedAt: z.number().int().nonnegative(),
}

const actionRecordSchema = z.union([
  z.object({ ...actionRecordBase, phase: z.enum(['running', 'needs-recovery']) }).strict(),
  z.object({ ...actionRecordBase, phase: z.literal('completed'), result: channelActionResultV1Schema }).strict(),
]) satisfies z.ZodType<ProviderActionRecord>

/** Durable provider state; this owns platform receipt durability before consumer projection. */
export const openClawChannelDomainSpec = defineDomain({
  name: 'clawdsh_channel_openclaw',
  version: 1,
  tables: {
    deliveries: domainTable<string, ProviderDeliveryRecord>(deliveryRecordSchema),
    actions: domainTable<string, ProviderActionRecord>(actionRecordSchema),
  },
})
