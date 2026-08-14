/**
 * Package-owned invariant companion for `@clawdsh/dsh-skills-hub`.
 * @module @clawdsh/dsh-skills-hub/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@clawdsh/dsh-skills-hub'

/** Cordis companion plugin name. */
export const name = 'skills-hub-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this row owns no event stream or mutable runtime data — it contributes
 * one skill provider, and the skill registry owns duplicate-name resolution, rank ordering,
 * cache invalidation, and registration disposal.
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
