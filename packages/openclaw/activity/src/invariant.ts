/** Package-owned invariant companion for `@clawdsh/dsh-activity`. @module @clawdsh/dsh-activity/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@clawdsh/dsh-activity'

/** Cordis companion plugin name. */
export const name = 'clawdsh-activity-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: Activity is an optional best-effort projection and owns no authoritative
 * Session fact. Every sidecar line is validated against its fixed producer, Session hash, kind,
 * metadata fields, byte limit, and generated summary at the append and read operations; invalid
 * or unavailable data degrades the projection without changing the authoritative subsystem.
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
