/**
 * Shared Harness credential resolution for legacy channel adapters.
 * @module @clawdsh/dsh-channel-core/credentials
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'

/** Test seam matching the Harness credential-provider lookup contract. */
export type ChannelCredentialResolver = (
  ctx: Context,
  ref: CredentialRef,
) => Promise<string | undefined>

/** Provider-specific cleanup applied to every credential source. */
export type ChannelCredentialNormalizer = (
  value: string | undefined,
) => string | undefined

/**
 * Trim a credential value and treat a blank as absent.
 * @param value - unresolved or provider-supplied credential value.
 * @returns the trimmed non-empty value, or `undefined` when absent.
 */
export function normalizeChannelCredential(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const normalized = value.trim()
  return normalized === '' ? undefined : normalized
}

/**
 * Resolve one channel credential through the existing Harness layers.
 *
 * Programmatic literals remain the compatibility override. Tests may inject
 * a resolver; production then uses `ctx.credentials` when mounted and the
 * launcher-owned environment snapshot otherwise.
 *
 * @param ctx - Cordis context carrying optional Harness services.
 * @param literal - programmatic literal from adapter configuration.
 * @param ref - Harness credential reference.
 * @param override - optional deterministic resolver used by adapter tests.
 * @param normalize - provider-specific normalization, such as Discord's `Bot` prefix removal.
 * @returns the first normalized value, or `undefined` when no layer supplies one.
 */
export async function resolveChannelCredential(
  ctx: Context,
  literal: string | undefined,
  ref: CredentialRef,
  override?: ChannelCredentialResolver,
  normalize: ChannelCredentialNormalizer = normalizeChannelCredential,
): Promise<string | undefined> {
  const configured = normalize(literal)
  if (configured !== undefined) return configured
  if (override !== undefined) return normalize(await override(ctx, ref))
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) return normalize((await credentials.resolve(ref))?.value)
  return normalize(launchEnvironmentOf(ctx).get(String(ref))?.value)
}
