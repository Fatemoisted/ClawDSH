/** npm package-lock platform selector evaluation. @module @clawdsh/dsh-channel-openclaw/npm-platform */

/**
 * Match npm's positive and negative OS/CPU selectors.
 * @param value Package-lock entry carrying optional `os` and `cpu` arrays.
 * @param platform Platform identifier to compare, defaulting to the current process.
 * @param architecture Architecture identifier to compare, defaulting to the current process.
 * @returns Whether npm considers the package applicable to the selected host.
 */
export function supportsCurrentPlatform(
  value: Record<string, unknown>,
  platform = process.platform,
  architecture = process.arch,
): boolean {
  return selectorAllows(value.os, platform) && selectorAllows(value.cpu, architecture)
}

/** Apply one npm positive/negative selector list. */
function selectorAllows(value: unknown, current: string): boolean {
  if (value === undefined) return true
  if (!Array.isArray(value) || value.some(candidate => typeof candidate !== 'string')) return false
  const selectors = value as string[]
  if (selectors.includes(`!${current}`)) return false
  const positive = selectors.filter(selector => !selector.startsWith('!'))
  return positive.length === 0 || positive.includes(current)
}
