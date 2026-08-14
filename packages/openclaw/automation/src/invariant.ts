/**
 * Package-owned invariant companion for `@clawdsh/dsh-automation`.
 * @module @clawdsh/dsh-automation/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@clawdsh/dsh-automation'

/** Cordis companion plugin name. */
export const name = 'automation-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this row owns no event stream or mutable runtime data of its own — the
 * `automation/run` records are structurally validated by `Session.append`, and the model-visible
 * turn content (the plugin-sourced `user/message` and the assistant reply) is covered by the
 * agent-loop's surface-event invariant.
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
