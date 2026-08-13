/**
 * Package-owned invariant companion for `@clawdsh/dsh-channel-feishu`.
 * @module @clawdsh/dsh-channel-feishu/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@clawdsh/dsh-channel-feishu'

/** Cordis companion plugin name. */
export const name = 'channel-feishu-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the adapter owns no authoritative event stream or mutable runtime data — it
 * emits `channel/inbound`, and routing plus reply logging are the channel-core registry's and
 * `dsh-agent`'s invariants. Its only mutable state is the per-thread reply-target map and the
 * de-duplication set, which are protocol bookkeeping verified by unit tests rather than runtime
 * invariants; the tenant token is owned by the Lark SDK's `tokenManager`.
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
