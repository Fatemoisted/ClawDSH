/**
 * Package-owned invariant companion for `@clawdsh/dsh-channel-feishu`.
 * @module @clawdsh/dsh-channel-feishu/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@clawdsh/dsh-channel-feishu'

/** Cordis companion plugin name. */
export const name = 'channel-feishu-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package owns no authoritative provider state. It
 * emits `channel/inbound`, while channel-core and `dsh-agent` own routing and
 * durable reply logging. The official Lark SDK owns token, de-duplication,
 * send bookkeeping, and WebSocket reconnect state; adapter-local
 * connect/retry/in-flight lifecycle is bounded by its disposer and shutdown
 * tests.
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
