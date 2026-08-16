/**
 * Package-owned invariant companion for `@clawdsh/dsh-memory`.
 * @module @clawdsh/dsh-memory/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@clawdsh/dsh-memory'

/** Cordis companion plugin name. */
export const name = 'memory-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this plugin owns no event stream. Recalled memories reach the model as
 * tool results, logged by the tools seam (dsh-agent's invariant covers model-visible-means-logged),
 * and the guidance section rides `request/header.header.system` — both reconstruction paths are
 * owned elsewhere. `memory_write` and `memory_update` mutate only two derived targets below the
 * configured root and apply create/version guards through the fs seam. Target containment and
 * guarded publication are enforced at the operation that makes each decision, not by a later
 * runtime scan.
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
