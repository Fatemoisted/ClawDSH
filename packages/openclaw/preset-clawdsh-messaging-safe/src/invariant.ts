/**
 * Package-owned invariant companion for the messaging-safe Agent preset.
 * @module @clawdsh/dsh-preset-messaging-safe/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@clawdsh/dsh-preset-messaging-safe'

/** Cordis companion plugin name. */
export const name = 'clawdsh-messaging-safe-preset-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: the package is a static Agent-preset carrier. The
// preset registry owns discovery, channel-agent owns tool restriction, and
// the loaded soul plugin owns prompt contribution.
const install: InvariantInstaller = () => {}

/**
 * Register this package's intentionally empty invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns The installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
