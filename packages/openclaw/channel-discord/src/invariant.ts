/**
 * Package-owned invariant companion for `@clawdsh/dsh-channel-discord`.
 * @module @clawdsh/dsh-channel-discord/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@clawdsh/dsh-channel-discord'

/** Cordis companion plugin name. */
export const name = 'channel-discord-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: discord.js owns Gateway state and REST rate limits;
 * channel-core owns normalized routing, session durability, and reply logging.
 * This adapter has no additional authoritative mutable data to assert over.
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
