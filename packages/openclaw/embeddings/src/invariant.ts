/**
 * Package-owned invariant companion for `@clawdsh/dsh-embeddings`.
 * @module @clawdsh/dsh-embeddings/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@clawdsh/dsh-embeddings'

/** Cordis companion plugin name. */
export const name = 'embeddings-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this Service Definition owns no event stream or mutable runtime data — it
 * declares one abstract method whose per-call contract (one vector per text, batch-consistent
 * dimension, reject-without-partial-results) is enforced by each provider, and one-implementation-
 * per-context fails loud at load through cordis' duplicate-service throw.
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
