/**
 * Package-owned invariant companion for `@clawdsh/dsh-embeddings-ark`.
 * @module @clawdsh/dsh-embeddings-ark/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@clawdsh/dsh-embeddings-ark'

/** Cordis companion plugin name. */
export const name = 'embeddings-ark-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this provider is a stateless HTTP client with no event stream and no
 * mutable runtime data beyond the dimension-drift guard — response validation (entry count,
 * finite non-empty vectors, batch and cross-call dimension consistency) fails each call loudly
 * at the operation that makes it, and one-implementation-per-context is enforced by cordis'
 * duplicate-service throw at load. Credential resolution belongs to the credentials seam.
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
