/**
 * Package-owned invariant companion for `@clawdsh/dsh-channel-core`.
 * @module @clawdsh/dsh-channel-core/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@clawdsh/dsh-channel-core'

/** Cordis companion plugin name. */
export const name = 'channel-core-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the registry owns no authoritative event stream or mutable runtime data —
 * each inbound message becomes a `user/message` session event and the reply is logged by `dsh-agent`
 * (its own invariant covers model-visible-means-logged). Adapter-id uniqueness fails loud in
 * `registerAdapter` rather than at runtime.
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
