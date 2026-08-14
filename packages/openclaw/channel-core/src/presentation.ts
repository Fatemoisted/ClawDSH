/**
 * Channel identity presentation — pure functions, keyless-testable.
 *
 * OpenClaw's `identity.{name,theme,emoji}` config never enters the prompt; it
 * drives channel presentation only: the ack reaction, the outbound response
 * prefix, and the mention patterns group chats use to detect a callout. This
 * module ports those resolutions verbatim (v2026.1.15 `src/agents/identity.ts`
 * + `src/auto-reply/reply/mentions.ts`): ack emoji falls back
 * `ackReaction → identity.emoji → 👀`; the response prefix `'auto'` renders
 * `[name]` (empty without a name); mention patterns derive from the name
 * (`\b@?<parts joined by \s+>\b`, case-insensitive) plus the raw emoji literal.
 * @module @clawdsh/dsh-channel-core/presentation
 */

/** Identity config: presentation only, never injected into the prompt. */
export interface IdentityConfig {
  /** Display name rendered as `[name]` and matched in mention patterns. */
  name?: string
  /** OpenClaw's theme slot; accepted for config parity and reserved — nothing reads it yet. */
  theme?: string
  /** Emoji used as the ack reaction fallback and a literal mention pattern. */
  emoji?: string
}

/** Presentation config of the channel registry. */
export interface PresentationConfig {
  /** Identity the presentation resolves against. */
  identity?: IdentityConfig
  /** Outbound prefix; `'auto'` renders `[name]` (absent name renders nothing). */
  responsePrefix?: string
  /** Ack emoji; falls back to `identity.emoji`, then `👀`. */
  ackReaction?: string
}

/** Default ack reaction when neither config nor identity carries one (OpenClaw's default). */
export const DEFAULT_ACK_REACTION = '👀'

/** Sentinel prefix value meaning "render `[name]`". */
export const AUTO_RESPONSE_PREFIX = 'auto'

/**
 * Resolve the ack reaction: explicit `ackReaction`, else `identity.emoji`, else `👀`.
 * @param config - presentation config.
 * @returns the ack emoji, never empty.
 */
export function resolveAckReaction(config: PresentationConfig): string {
  if (config.ackReaction !== undefined && config.ackReaction.length > 0) return config.ackReaction
  const emoji = config.identity?.emoji
  if (emoji !== undefined && emoji.length > 0) return emoji
  return DEFAULT_ACK_REACTION
}

/**
 * Resolve the outbound response prefix: `'auto'` renders `[name]`; a name
 * renders `[name]`; any other literal is used as-is; without a name `'auto'`
 * renders nothing.
 * @param config - presentation config.
 * @returns the prefix, possibly empty.
 */
export function resolveResponsePrefix(config: PresentationConfig): string {
  const name = config.identity?.name
  const prefix = config.responsePrefix ?? AUTO_RESPONSE_PREFIX
  if (prefix === AUTO_RESPONSE_PREFIX) return name === undefined || name.length === 0 ? '' : `[${name}]`
  return prefix
}

/**
 * Resolve the inbound message prefix (OpenClaw's `messagePrefix` without its
 * allowlist special case): `[name]` when a name exists, else empty.
 * @param config - presentation config.
 * @returns the prefix, possibly empty.
 */
export function resolveMessagePrefix(config: PresentationConfig): string {
  const name = config.identity?.name
  return name === undefined || name.length === 0 ? '' : `[${name}]`
}

/** Escape a literal for use inside a `RegExp` body. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Derive group-chat mention patterns from the identity: the name as
 * `\b@?<parts joined by \s+>\b` (case-insensitive, `@` optional), plus the raw
 * emoji as a literal pattern. A `` (backspace) inside configured values
 * is normalized to `\b` (OpenClaw's JSON round-trip workaround).
 * @param name - the identity name; absent yields no name pattern.
 * @param emoji - the identity emoji; absent yields no emoji pattern.
 * @returns the compiled patterns, possibly empty.
 */
export function deriveMentionPatterns(name?: string, emoji?: string): RegExp[] {
  const patterns: RegExp[] = []
  if (name !== undefined && name.trim().length > 0) {
    const joined = name.trim().split(/\s+/).map(escapeRegExp).join('\\s+').replace(//g, '\\b')
    patterns.push(new RegExp(`\\b@?${joined}\\b`, 'i'))
  }
  if (emoji !== undefined && emoji.length > 0) {
    patterns.push(new RegExp(escapeRegExp(emoji).replace(//g, '\\b')))
  }
  return patterns
}

/**
 * Remove every mention-pattern match from a message text.
 * @param text - the message text.
 * @param patterns - the mention patterns to strip.
 * @returns the text with mention matches removed.
 */
export function stripMentions(text: string, patterns: readonly RegExp[]): string {
  let stripped = text
  for (const pattern of patterns) {
    stripped = stripped.replace(pattern, '')
  }
  return stripped
}
