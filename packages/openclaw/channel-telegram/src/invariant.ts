/**
 * Package-owned invariant companion for `@clawdsh/dsh-channel-telegram`.
 * @module @clawdsh/dsh-channel-telegram/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@clawdsh/dsh-channel-telegram'

/** Cordis companion plugin name. */
export const name = 'channel-telegram-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the adapter owns no authoritative event stream or mutable runtime data — it
 * emits `channel/inbound`, and routing plus reply logging are the channel-core registry's and
 * `dsh-agent`'s invariants. Its only mutable state is the polling offset, which is protocol
 * bookkeeping verified by unit tests rather than a runtime invariant.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
