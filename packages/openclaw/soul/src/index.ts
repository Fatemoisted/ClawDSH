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
 *   the harness guidance stays while the identity comes from the soul.
 *
 * Scope-only, like `dsh-persona`: an unscoped mount would publish a
 * process-global soul and rejects at mount. Mount it inside an agent preset
 * (see packages/openclaw/preset-openclaw). The soul text is read once at
 * mount — swap souls by re-mounting (patch + session restart), which keeps
 * the prompt prefix stable for KV-cache reuse, matching the upstream design.
 * @module @clawdsh/dsh-soul
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import type {} from '@deepseek-ai/dsh-session'
import { settingsNamespace, type SettingsProvider } from '@deepseek-ai/dsh-settings'
import {
  PERSONA_ORDER,
  PERSONA_SECTION,
  renderPrompt,
  type AssembleContext,
  type PromptAssembly,
} from '@deepseek-ai/dsh-system-prompt'

export { PERSONA_ORDER, PERSONA_SECTION }

/** Prompt section name for append-mode souls. */
export const SOUL_SECTION = 'clawdsh:soul'
/** Order band: right after the order-0 deployment persona, before tool guidance (100–199). */
export const SOUL_ORDER = 10

/** User-settings namespace owned by the ClawDSH Soul host singleton. */
export const SOUL_SETTINGS_NAMESPACE = settingsNamespace('clawdsh-soul')

/** Cordis plugin name. */
export const name = 'soul'

/** The prompt registry and Host settings snapshot this session row requires. */
export const inject = ['systemPrompt', 'clawdshSoulSettings']

/** Plugin config: where the soul text comes from and how it lands. */
export interface Config {
  /** Whether new agent scopes receive a Soul prompt contribution. */
  enabled?: boolean
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
  /** Suppress dynamic runtime-context snapshots for this agent scope. */
  includeRuntimeContext?: boolean
}

interface PromptActivitySink {
  promptContribution(input: {
    readonly sessionId: string
    readonly producer: 'soul'
    readonly section: 'persona' | 'clawdsh:soul'
    readonly mode: 'append' | 'replace'
    readonly characters: number
    readonly sha256: string
    readonly seq: number
  }): Promise<unknown>
}

interface SoulPromptCandidate {
  readonly sessionId: string
  readonly system: string
  readonly contribution: string
}

/** Runtime schema for the soul row. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  source: z.string().default(''),
  text: z.string().default(''),
  mode: z.union([z.const('replace'), z.const('append')]).default('append'),
  includeRuntimeContext: z.boolean().default(true),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host singleton that resolves the Soul settings snapshot for a new agent scope. */
    clawdshSoulSettings: SoulSettingsHost
  }
}

/**
 * Host-owned Soul settings registration. Agent-scope Soul rows query it once
 * at mount, so a committed change affects only subsequently mounted sessions.
 */
export class SoulSettingsHost extends Service {
  static inject = ['settings']
  static Config: z<Config> = Config

  private readonly settings: SettingsProvider | undefined

  /**
   * @param ctx - Host context that may carry the optional settings provider.
   * @param config - composition-layer defaults mirrored from the managed preset.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'clawdshSoulSettings')
    this.settings = ctx.get('settings')
    this.settings?.register(SOUL_SETTINGS_NAMESPACE, Config, {
      base: config,
      applies: 'live',
      validate: validateSoulConfig,
    })
  }

  /**
   * Resolve one new agent scope from its preset entry plus the current user layer.
   * @param entry - Soul entry from the agent preset being mounted.
   * @returns the immutable-at-session-mount Soul settings snapshot.
   */
  forSession(entry: Config): Config {
    const user = this.settings?.describe().find(descriptor => descriptor.ns === SOUL_SETTINGS_NAMESPACE)?.user
    const merged = Config(entry)
    if (!isRecord(user)) return merged
    if (Object.hasOwn(user, 'enabled')) {
      if (typeof user.enabled !== 'boolean') throw new TypeError('soul: setting "enabled" must be a boolean')
      merged.enabled = user.enabled
    }
    if (Object.hasOwn(user, 'source')) {
      if (typeof user.source !== 'string') throw new TypeError('soul: setting "source" must be a string')
      merged.source = user.source
    }
    if (Object.hasOwn(user, 'text')) {
      if (typeof user.text !== 'string') throw new TypeError('soul: setting "text" must be a string')
      merged.text = user.text
    }
    if (Object.hasOwn(user, 'mode')) {
      if (user.mode !== 'replace' && user.mode !== 'append') {
        throw new TypeError('soul: setting "mode" must be "replace" or "append"')
      }
      merged.mode = user.mode
    }
    if (Object.hasOwn(user, 'includeRuntimeContext')) {
      if (typeof user.includeRuntimeContext !== 'boolean') {
        throw new TypeError('soul: setting "includeRuntimeContext" must be a boolean')
      }
      merged.includeRuntimeContext = user.includeRuntimeContext
    }
    return Config(merged)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateSoulConfig(config: Config): void {
  if (config.enabled === false) return
  if (!hasContent(config.source) && !hasContent(config.text)) {
    throw new Error('soul: settings require a non-empty "source" file path or inline "text"')
  }
}

function hasContent(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0
}

/**
 * Mount the soul row for the calling context's agent scope.
 * @param ctx - an agent scope context; an unscoped context rejects.
 * @param config - soul source, mode, and runtime-context policy.
 */
export function apply(ctx: Context, config: Config): void {
  if (scopeOf(ctx) === undefined) {
    throw new Error('soul: mounts only inside an agent scope (an unscoped mount would publish a process-global soul)')
  }
  resolveMode(Reflect.get(config, 'mode'))
  const resolved = ctx.get('clawdshSoulSettings')?.forSession(config) ?? Config(config)
  if (!(resolved.enabled ?? true)) return
  const mode = resolveMode(Reflect.get(resolved, 'mode'))
  const base = ctx.baseUrl === undefined ? undefined : fileURLToPath(ctx.baseUrl)
  const source = resolved.source?.trim() ?? ''
  const text = source === '' ? (resolved.text ?? '') : readFileSync(resolve(base ?? '.', source), 'utf8')
  if (!hasContent(text)) {
    throw new Error('soul: config requires a non-empty "source" file path or inline "text"')
  }
  ctx.effect(() => ctx.systemPrompt.section({
    name: mode === 'replace' ? PERSONA_SECTION : SOUL_SECTION,
    order: mode === 'replace' ? PERSONA_ORDER : SOUL_ORDER,
    text,
    ...(mode === 'replace' ? { complete: true } : {}),
  }), 'soul.section()')
  installPromptActivity(ctx, mode, text)
  if (!(resolved.includeRuntimeContext ?? true)) ctx.systemPrompt.suppressRuntimeContext()
}

function resolveMode(value: unknown): 'replace' | 'append' {
  if (value === undefined || value === 'append') return 'append'
  if (value === 'replace') return 'replace'
  throw new Error(`soul: unknown mode ${JSON.stringify(value)}; expected "replace" or "append"`)
}

/** Attribute a Soul section only after its rendered assembly matches the committed request header. */
function installPromptActivity(ctx: Context, mode: 'replace' | 'append', text: string): void {
  let candidate: SoulPromptCandidate | undefined
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const transformed = await next()
    const sessionId = assemblySessionId(context)
    if (sessionId === undefined || context.signal === undefined) return transformed
    try {
      const contribution = mode === 'replace'
        ? renderSection(transformed, PERSONA_SECTION, text)
        : appendContribution(transformed, text)
      candidate = contribution === undefined || contribution === ''
        ? undefined
        : {
          sessionId,
          contribution,
          system: mode === 'replace' ? contribution : renderPrompt(transformed),
        }
    } catch (_promptRenderFailed) {
      // The Agent loop owns prompt-render failures; optional Activity records no candidate.
      candidate = undefined
    }
    return transformed
  }, { prepend: true })
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'request/header') return
    const current = candidate
    candidate = undefined
    if (current === undefined || current.sessionId !== String(session.id)) return
    if (event.data.header.system !== current.system) return
    recordPromptContribution(ctx, current, event.seq, mode)
  })
}

function assemblySessionId(context: AssembleContext): string | undefined {
  return context.agent === undefined ? undefined : String(context.agent.id)
}

function appendContribution(assembly: PromptAssembly, text: string): string | undefined {
  const section = assembly.sections.find(candidate => candidate.name === SOUL_SECTION)
  if (section === undefined || section.text !== text) return undefined
  return renderPrompt({ ...assembly, sections: [section] })
}

function renderSection(assembly: PromptAssembly, name: string, text: string): string {
  return renderPrompt({ ...assembly, sections: [{ name, text }] })
}

function recordPromptContribution(
  ctx: Context,
  candidate: SoulPromptCandidate,
  seq: number,
  mode: 'replace' | 'append',
): void {
  const activity = ctx.get('clawdshActivity') as PromptActivitySink | undefined
  if (activity === undefined) return
  try {
    void activity.promptContribution({
      sessionId: candidate.sessionId,
      producer: 'soul',
      section: mode === 'replace' ? 'persona' : 'clawdsh:soul',
      mode,
      characters: candidate.contribution.length,
      sha256: createHash('sha256').update(candidate.contribution).digest('hex'),
      seq,
    }).catch((_activityWriteFailed: unknown) => {
      // Activity is a best-effort projection and cannot own prompt assembly.
    })
  } catch (_activityWriteFailed) {
    // Activity is a best-effort projection and cannot own prompt assembly.
  }
}
