/**
 * A file-backed per-agent soul: OpenClaw's Soul concept as a Cordis row.
 *
 * `dsh-persona` contributes an inline persona section; `soul` is the
 * OpenClaw-shaped upgrade on the same seam — the persona text comes from a
 * soul file (a markdown document, the OpenClaw unit of identity), in two
 * modes:
 *
 * - `replace` — the soul is the complete system prompt (a `complete` section):
 *   every other section is suppressed after cooperative assembly.
 * - `append` (default) — the soul lands as an additional `clawdsh:soul`
 *   section right after the deployment persona, ahead of tool guidance, so
 *   the harness guidance stays while the identity comes from the soul. A
 *   precedence note ({@link SOUL_PRECEDENCE_NOTE}) is baked in ahead of the
 *   soul text unless `precedenceNote: false`; `replace` never adds it.
 *
 * Scope-only, like `dsh-persona`: an unscoped mount would publish a
 * process-global soul and rejects at mount. Mount it inside an agent preset
 * (see tools/openclaw-preset-openclaw). The soul text is read once at
 * mount — swap souls by re-mounting (patch + session restart), which keeps
 * the prompt prefix stable for KV-cache reuse, matching the upstream design.
 * @module @clawdsh/dsh-soul
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { PERSONA_ORDER, PERSONA_SECTION } from '@deepseek-ai/dsh-system-prompt'

export { PERSONA_ORDER, PERSONA_SECTION }

/** Prompt section name for append-mode souls. */
export const SOUL_SECTION = 'clawdsh:soul'
/** Order band: right after the order-0 deployment persona, before tool guidance (100–199). */
export const SOUL_ORDER = 10

/**
 * Precedence note baked into append-mode soul sections, mirroring OpenClaw's
 * soul.md injection ("SOUL.md: persona/tone. Follow it unless higher-priority
 * instructions override."). Model-visible text; keep it verbatim-pinned by the
 * soul tests and the README Model Experience section.
 */
export const SOUL_PRECEDENCE_NOTE = 'Soul: persona and tone. Follow it unless higher-priority instructions (such as direct user instructions) override it.'

/** Cordis plugin name. */
export const name = 'soul'

/** The prompt registry this row contributes to. */
export const inject = ['systemPrompt']

/** Plugin config: where the soul text comes from and how it lands. */
export interface Config {
  /**
   * Path to a soul file (markdown). Wins over `text`. A relative path resolves
   * against the mount tree's `ctx.baseUrl` — the preset composition directory
   * for agent presets, the profile directory under the profile launcher — and
   * against `process.cwd()` when the context has no base (raw test contexts).
   * An absolute path is used as-is. This mirrors how relative module
   * specifiers resolve under the Loader, so a preset's soul file travels with it.
   */
  source?: string
  /** Inline soul text; used when `source` is absent or empty. */
  text?: string
  /** `replace` makes the soul the complete system prompt; `append` (default) adds it as a section. */
  mode?: 'replace' | 'append'
  /** Prepend the {@link SOUL_PRECEDENCE_NOTE} declaration to append-mode souls (default true); never in replace mode. */
  precedenceNote?: boolean
  /** Suppress dynamic runtime-context snapshots for this agent scope. */
  includeRuntimeContext?: boolean
}

/** Runtime schema for the soul row. */
export const Config: z<Config> = z.object({
  source: z.string().default(''),
  text: z.string().default(''),
  mode: z.union([z.const('replace'), z.const('append')]).default('append'),
  precedenceNote: z.boolean().default(true),
  includeRuntimeContext: z.boolean().default(true),
})

/**
 * Mount the soul row for the calling context's agent scope.
 * @param ctx - an agent scope context; an unscoped context rejects.
 * @param config - soul source, mode, precedence-note policy, and runtime-context policy.
 */
export function apply(ctx: Context, config: Config): void {
  if (scopeOf(ctx) === undefined) {
    throw new Error('soul: mounts only inside an agent scope (an unscoped mount would publish a process-global soul)')
  }
  const mode = config.mode ?? 'append'
  if (mode !== 'replace' && mode !== 'append') {
    throw new Error(`soul: unknown mode ${JSON.stringify(mode)}; expected "replace" or "append"`)
  }
  const base = ctx.baseUrl === undefined ? undefined : fileURLToPath(ctx.baseUrl)
  const text = config.source ? readFileSync(resolve(base ?? '.', config.source), 'utf8') : (config.text ?? '')
  if (text === '') {
    throw new Error('soul: config requires a non-empty "source" file path or inline "text"')
  }
  const sectionText = mode === 'append' && (config.precedenceNote ?? true)
    ? `${SOUL_PRECEDENCE_NOTE}\n\n${text}`
    : text
  ctx.effect(() => ctx.systemPrompt.section({
    name: mode === 'replace' ? PERSONA_SECTION : SOUL_SECTION,
    order: mode === 'replace' ? PERSONA_ORDER : SOUL_ORDER,
    text: sectionText,
    ...(mode === 'replace' ? { complete: true } : {}),
  }), 'soul.section()')
  if (!(config.includeRuntimeContext ?? true)) ctx.systemPrompt.suppressRuntimeContext()
}
