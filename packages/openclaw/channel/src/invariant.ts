/**
 * Package-owned invariant companion for `@clawdsh/dsh-channel`.
 * @module @clawdsh/dsh-channel/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@clawdsh/dsh-channel'

/** Cordis companion plugin name. */
export const name = 'channel-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: provider/driver cardinality is checked synchronously at registration,
 * missing roles fail at each dispatch, and this Service Definition owns no event stream or
 * durable data. Providers and consumers own invariants for their ledgers and session records.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns The installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
