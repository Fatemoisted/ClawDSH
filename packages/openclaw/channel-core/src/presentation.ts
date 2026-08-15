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

/** Where the ack emoji reaction applies (OpenClaw's `messages.ackReactionScope`). */
export type AckReactionScope = 'all' | 'direct' | 'group-all' | 'group-mentions' | 'off' | 'none'

/** Default ack scope: groups only, and only when the bot was mentioned. */
export const DEFAULT_ACK_REACTION_SCOPE: AckReactionScope = 'group-mentions'

/**
 * Decide whether an inbound message gets an ack reaction, porting OpenClaw
 * v2026.1.15 `shouldAckReaction` verbatim (without the control-command bypass,
 * which is deferred): `all` acks everything; `direct` acks non-group chats;
 * `group-all` acks groups unconditionally; `off`/`none` disable acks;
 * `group-mentions` acks groups only
 * when mention detection is possible and the bot was mentioned, even if group
 * routing accepts unmentioned traffic. When detection is impossible the caller passes
 * `canDetectMention: false`, which fails open (no ack, no blocked message).
 * @param scope - the configured scope.
 * @param isGroup - whether the message arrived in a group chat.
 * @param _mentionRequired - whether groups demand a mention (retained for OpenClaw call-site parity).
 * @param canDetectMention - whether the adapter could evaluate mentions at all.
 * @param wasMentioned - whether the message mentioned the bot.
 * @returns whether to attach the ack emoji.
 */
export function shouldAckReaction(
  scope: AckReactionScope,
  isGroup: boolean,
  _mentionRequired: boolean,
  canDetectMention: boolean,
  wasMentioned: boolean,
): boolean {
  if (scope === 'off' || scope === 'none') return false
  if (scope === 'all') return true
  if (scope === 'direct') return !isGroup
  if (scope === 'group-all') return isGroup
  if (!isGroup) return false
  if (!canDetectMention) return false
  return wasMentioned
}

/**
 * Resolve the ack reaction: an explicit `ackReaction` is used as-is — an
 * explicit empty string disables acks entirely (OpenClaw semantics) — then
 * `identity.emoji`, then `👀`.
 * @param config - presentation config.
 * @returns the ack emoji, or `''` when acks are disabled.
 */
export function resolveAckReaction(config: PresentationConfig): string {
  if (config.ackReaction !== undefined) return config.ackReaction
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

/** Zero-width and bidi characters removed before mention matching (OpenClaw's workaround). */
const ZERO_WIDTH_RE = /[​-‏‪-‮⁠-⁯]/g

/**
 * Strip zero-width and bidi characters so mention patterns match text that
 * platforms render invisibly decorated.
 * @param text - the raw message text.
 * @returns the stripped text.
 */
export function stripZeroWidth(text: string): string {
  return text.replace(ZERO_WIDTH_RE, '')
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
  const sanitizedName = name === undefined ? '' : stripZeroWidth(name).trim()
  if (sanitizedName.length > 0) {
    const joined = sanitizedName.split(/\s+/).map(escapeRegExp).join('\\s+').replace(//g, '\\b')
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
