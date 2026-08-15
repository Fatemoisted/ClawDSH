/** Package-owned invariant companion for the OpenClaw Provider. @module @clawdsh/dsh-channel-openclaw/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@clawdsh/dsh-channel-openclaw'

/** Cordis companion plugin name. */
export const name = 'channel-openclaw-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the provider's authoritative mutable delivery relation is
 * validated on every durable transition before publication, while the authenticated transport,
 * immutable host identity, and singleton registration fail at their owning operations.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
