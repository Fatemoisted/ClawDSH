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
 * No runtime invariant: this plugin owns no event stream or public mutable registry. Recalled
 * memories and append receipts reach the model as tool results, logged by the tools seam
 * (dsh-agent's invariant covers model-visible-means-logged), and the guidance section rides
 * `request/header.header.system` — both reconstruction paths are owned elsewhere. Memory writes
 * go through `FileSystem.writeText`; path containment and the narrow per-call sandbox root are
 * enforced before each append (`isMemoryPath` + `FileSystem.contains` + the fs provider), which
 * is call-time failure handling rather than a relationship an asynchronous invariant can inspect.
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
