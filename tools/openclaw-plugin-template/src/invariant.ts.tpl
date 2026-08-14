/**
 * Package-owned invariant companion for `@clawdsh/dsh-<pkg-name>`.
 * @module @clawdsh/dsh-<pkg-name>/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@clawdsh/dsh-<pkg-name>'

/** Cordis companion plugin name. */
export const name = '<pkg-name>-invariant'

/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Replace with the package-specific runtime invariant, if one is required. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
