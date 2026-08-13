/**
 * Package-owned invariant companion for `@clawdsh/dsh-soul`.
 * @module @clawdsh/dsh-soul/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@clawdsh/dsh-soul'

/** Cordis companion plugin name. */
export const name = 'soul-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this row owns no event stream or mutable runtime data — it registers one
 * prompt section and the prompt registry owns identity, complete-prompt enforcement, shadowing,
 * and disposal.
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
