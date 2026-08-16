/**
 * ClawHub-compatible skill directory provider.
 *
 * This package is one implementation of the `ctx.skills` provider registry. It
 * discovers OpenClaw/ClawHub-style skills — a directory containing one
 * `SKILL.md` with AgentSkills-compatible YAML frontmatter — from three roots:
 * the lookup workspace (`<cwd>/skills`), configurable extra directories, and
 * the legacy managed directory (`~/.clawdbot/skills`). `metadata` frontmatter
 * is accepted as a record or as the single-line JSON string OpenClaw writes;
 * its `clawdbot.requires.{bins,anyBins,env}` gates are evaluated at list time.
 *
 * The registry (`@deepseek-ai/dsh-skill`) already owns discovery merging,
 * duplicate resolution, cache invalidation, disposal, and the model surface
 * (`tool-skill` catalog + load-by-name), so this provider adds only the
 * OpenClaw source conventions and gating — see the skills-domain mapping Agent
 * Note. Install execution and remote ClawHub registries are not part of this
 * package.
 * @module @clawdsh/dsh-skills-hub
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { Context, LoggerService } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { parse as parseYaml } from 'yaml'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import {
  isSkillName,
  type SkillCandidate,
  type SkillDefinition,
  type SkillInvocationPolicy,
  type SkillLookupOptions,
  type SkillProvider,
  type SkillSource,
} from '@deepseek-ai/dsh-skill'

/** Standard precedence rank for workspace skills: the custom slot (below dsh-native project dirs, above user dirs). */
export const WORKSPACE_SKILL_RANK = 300
/** Standard precedence rank for configurable extra directories. */
export const EXTRA_SKILL_RANK = 350
/** Standard precedence rank for the legacy OpenClaw managed directory (below dsh-native user dirs). */
export const MANAGED_SKILL_RANK = 450

/** Cordis plugin name. */
export const name = 'skills-hub'

/** User-settings namespace for the ClawHub-compatible provider. */
export const SKILLS_HUB_SETTINGS_NAMESPACE = settingsNamespace('clawdsh-skills-hub')

/** Required registry, settings, and execution-world resolver services. */
export const inject = ['skills', 'settings', 'subprocess']

/** Default legacy managed root: `~/.clawdbot/skills`. */
export const DEFAULT_MANAGED_DIR = join(homedir(), '.clawdbot', 'skills')

/** Plugin config: which OpenClaw-style roots to scan and whether to evaluate `metadata.clawdbot` gating. */
export interface Config {
  /** Whether this row registers the ClawHub provider. */
  enabled?: boolean
  /**
   * Fixed workspace skills directory. Empty (default) scans `<cwd>/skills`
   * per lookup instead, mirroring OpenClaw's `<workspaceDir>/skills`.
   */
  workspaceDir?: string
  /** Legacy managed skills directory. Empty (default) uses `~/.clawdbot/skills`. */
  managedDir?: string
  /** Additional skill directories scanned between workspace and managed. */
  extraDirs?: string[]
  /** Evaluate `metadata.clawdbot.requires.{bins,anyBins,env}` at list time and exclude gated-out skills. */
  gating?: boolean
}

/** Runtime schema for the skills-hub row. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  workspaceDir: z.string().default(''),
  managedDir: z.string().default(''),
  extraDirs: z.array(z.string()).default([]),
  gating: z.boolean().default(true),
})

/** Config with defaults applied and paths resolved, for raw (non-Loader) callers that bypass schemastery. */
export interface ResolvedConfig {
  enabled: boolean
  workspaceDir?: string
  managedDir: string
  extraDirs: string[]
  gating: boolean
}

/** Skill parse outcome: frontmatter summary plus the markdown body. */
interface ParsedSkill {
  name: string
  description: string
  whenToUse?: string
  invocation: SkillInvocationPolicy
  metadata?: Record<string, unknown>
  content: string
}

/** One discovery root with its precedence and prompt-visible origin label. */
interface RootSpec {
  source: SkillSource
  rank: number
  dir?: string
}

/**
 * Defensively resolve plugin config for callers that mount the row directly
 * instead of through the Loader's schemastery validation.
 * @param config - raw row config.
 * @returns the resolved config; invalid field types fail loudly.
 */
export function resolveConfig(config: Config = {}): ResolvedConfig {
  if (config.enabled !== undefined && typeof config.enabled !== 'boolean') {
    throw new TypeError('skills-hub: config "enabled" must be a boolean')
  }
  const workspaceDir = config.workspaceDir
  if (workspaceDir !== undefined && typeof workspaceDir !== 'string') {
    throw new TypeError('skills-hub: config "workspaceDir" must be a string')
  }
  const managedDir = config.managedDir
  if (managedDir !== undefined && typeof managedDir !== 'string') {
    throw new TypeError('skills-hub: config "managedDir" must be a string')
  }
  const extraDirs = config.extraDirs ?? []
  if (!Array.isArray(extraDirs) || extraDirs.some(dir => typeof dir !== 'string')) {
    throw new TypeError('skills-hub: config "extraDirs" must be an array of strings')
  }
  if (extraDirs.some(dir => dir.trim() === '')) {
    throw new TypeError('skills-hub: config "extraDirs" cannot contain an empty path')
  }
  if (config.gating !== undefined && typeof config.gating !== 'boolean') {
    throw new TypeError('skills-hub: config "gating" must be a boolean')
  }
  return {
    enabled: config.enabled ?? true,
    ...(workspaceDir === '' || workspaceDir === undefined ? {} : { workspaceDir: resolve(workspaceDir) }),
    managedDir: managedDir === '' || managedDir === undefined ? DEFAULT_MANAGED_DIR : resolve(managedDir),
    extraDirs: extraDirs.map(dir => resolve(dir)),
    gating: config.gating ?? true,
  }
}

/**
 * Mount the skills-hub row: register the ClawHub provider on `ctx.skills`.
 * @param ctx - Cordis context carrying the skill registry.
 * @param config - root directories and gating policy.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const settings = ctx.get('settings')
  const runtimeConfig = settings?.register(SKILLS_HUB_SETTINGS_NAMESPACE, Config, {
    base: config,
    applies: 'restart',
    validate: value => void resolveConfig(value),
  }).get() ?? Config(config)
  const resolved = resolveConfig(runtimeConfig)
  if (!resolved.enabled) return
  ctx.skills.registerProvider(control => new ClawHubProvider(
    resolved,
    ctx.logger,
    ctx.subprocess,
    control.signal,
  ))
}

/** Provider that maps OpenClaw-style skill directories into `ctx.skills`. */
export class ClawHubProvider implements SkillProvider {
  readonly name = 'clawhub'

  constructor(
    private readonly config: ResolvedConfig,
    private readonly logger: LoggerService,
    private readonly subprocess: Pick<SubprocessRuntime, 'resolveExecutable'>,
    private readonly lifecycleSignal?: AbortSignal,
  ) {}

  private rootSpecs(options: SkillLookupOptions): RootSpec[] {
    const workspaceDir = this.config.workspaceDir !== undefined
      ? this.config.workspaceDir
      : (options.cwd === undefined ? undefined : resolve(options.cwd, 'skills'))
    const specs: RootSpec[] = []
    if (workspaceDir !== undefined) specs.push({ source: 'clawhub-workspace', rank: WORKSPACE_SKILL_RANK, dir: workspaceDir })
    for (const dir of this.config.extraDirs) specs.push({ source: 'clawhub-extra', rank: EXTRA_SKILL_RANK, dir })
    specs.push({ source: 'clawhub-managed', rank: MANAGED_SKILL_RANK, dir: this.config.managedDir })
    return specs
  }

  async list(options: SkillLookupOptions): Promise<readonly SkillCandidate[]> {
    const signal = combineSignals(this.lifecycleSignal, options.signal)
    signal?.throwIfAborted()
    const candidates: SkillCandidate[] = []
    for (const spec of this.rootSpecs(options)) {
      signal?.throwIfAborted()
      for (const skillFile of await this.scanRoot(spec, signal)) {
        const parsed = await this.parseSkill(skillFile, signal)
        if (parsed === undefined) continue
        if (this.config.gating && !(await passesGating(parsed.metadata, this.subprocess, signal))) continue
        candidates.push({
          name: parsed.name,
          description: parsed.description,
          ...(parsed.whenToUse === undefined ? {} : { whenToUse: parsed.whenToUse }),
          invocation: parsed.invocation,
          source: spec.source,
          provider: this.name,
          resourceBase: { kind: 'directory', path: dirname(skillFile) },
          rank: spec.rank,
          locator: { skillFile },
          path: skillFile,
          ...(parsed.metadata === undefined ? {} : { metadata: parsed.metadata }),
        })
      }
    }
    return candidates
  }

  async get(candidate: SkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
    const signal = combineSignals(this.lifecycleSignal, options.signal)
    signal?.throwIfAborted()
    if (candidate.path === undefined) return undefined
    const parsed = await this.parseSkill(candidate.path, signal)
    if (parsed === undefined || parsed.name !== candidate.name) return undefined
    return {
      name: parsed.name,
      description: parsed.description,
      ...(parsed.whenToUse === undefined ? {} : { whenToUse: parsed.whenToUse }),
      invocation: parsed.invocation,
      source: candidate.source,
      provider: this.name,
      ...(candidate.resourceBase === undefined ? {} : { resourceBase: candidate.resourceBase }),
      content: parsed.content,
      path: candidate.path,
      ...(parsed.metadata === undefined ? {} : { metadata: parsed.metadata }),
    }
  }

  /** List SKILL.md files directly inside a root; a missing root yields no skills (OpenClaw-style). */
  private async scanRoot(spec: RootSpec, signal?: AbortSignal): Promise<string[]> {
    if (spec.dir === undefined) return []
    signal?.throwIfAborted()
    let entries: string[]
    try {
      entries = await readdir(spec.dir)
    } catch (error) {
      signal?.throwIfAborted()
      if (isMissingDirectory(error)) return []
      this.logger.warn(`skills-hub: cannot scan ${spec.dir}: ${errorMessage(error)}`)
      return []
    }
    signal?.throwIfAborted()
    const skills: string[] = []
    for (const entry of entries) {
      signal?.throwIfAborted()
      const skillFile = join(spec.dir, entry, 'SKILL.md')
      try {
        const info = await stat(skillFile)
        if (info.isFile()) skills.push(skillFile)
      } catch {
        // Non-directory entries and unreadable paths are not skills.
        signal?.throwIfAborted()
      }
    }
    return skills
  }

  private async parseSkill(skillFile: string, signal?: AbortSignal): Promise<ParsedSkill | undefined> {
    let raw: string
    try {
      raw = await readFile(skillFile, { encoding: 'utf8', signal })
    } catch (error) {
      signal?.throwIfAborted()
      this.logger.warn(`skills-hub: cannot read ${skillFile}: ${errorMessage(error)}`)
      return undefined
    }
    signal?.throwIfAborted()
    let frontmatter: ReturnType<typeof parseFrontmatter>
    try {
      frontmatter = parseFrontmatter(raw)
    } catch (_invalidYaml) {
      // YAML diagnostics can quote source lines. Keep local Skill contents out of logs.
      this.logger.warn(`skills-hub: skill file ${skillFile} ignored: invalid YAML frontmatter`)
      return undefined
    }
    if (frontmatter === undefined) {
      this.logger.warn(`skills-hub: skill file ${skillFile} ignored: missing YAML frontmatter`)
      return undefined
    }
    const { data, body } = frontmatter
    const name = stringField(data, 'name')
    const description = stringField(data, 'description')
    if (name === undefined || description === undefined) {
      this.logger.warn(`skills-hub: skill file ${skillFile} ignored: frontmatter requires name and description`)
      return undefined
    }
    if (!isSkillName(name)) {
      // The name is local file content and may contain secrets or control text.
      this.logger.warn(`skills-hub: skill file ${skillFile} ignored: invalid skill name`)
      return undefined
    }
    let invocation: SkillInvocationPolicy
    try {
      invocation = parseInvocationPolicy(data)
    } catch (error) {
      this.logger.warn(`skills-hub: skill file ${skillFile} ignored: invalid invocation frontmatter: ${errorMessage(error)}`)
      return undefined
    }
    let metadata: ReturnType<typeof parseMetadata>
    try {
      metadata = parseMetadata(data)
    } catch (_invalidMetadata) {
      this.logger.warn(`skills-hub: skill file ${skillFile} ignored: metadata must be an object or JSON object string`)
      return undefined
    }
    const whenToUse = stringField(data, 'whenToUse')
    return {
      name,
      description,
      ...(whenToUse === undefined ? {} : { whenToUse }),
      invocation,
      ...metadata,
      content: body.trim(),
    }
  }
}

/** Split `---`-fenced YAML frontmatter from the markdown body (the same envelope skill-filesystem parses). */
function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } | undefined {
  const input = raw.startsWith('\uFEFF') ? raw.slice(1) : raw
  if (!input.startsWith('---\n') && !input.startsWith('---\r\n')) return undefined
  const envelope = /^---\r?\n([\s\S]*?)^---[ \t]*(\r?\n|$)/m.exec(input)
  if (envelope === null) return undefined
  const [full, yaml = ''] = envelope
  const parsed = parseYaml(yaml) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  return { data: parsed as Record<string, unknown>, body: input.slice(full.length) }
}

/**
 * Parse `metadata` as a record or as the single-line JSON string OpenClaw writes.
 * @returns the normalized metadata record, or nothing when absent.
 * @throws {TypeError} when a present value is not an object or JSON object string.
 */
function parseMetadata(data: Record<string, unknown>): { metadata?: Record<string, unknown> } {
  if (!Object.hasOwn(data, 'metadata')) return {}
  const value = data.metadata
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return { metadata: value as Record<string, unknown> }
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return { metadata: parsed as Record<string, unknown> }
      }
    } catch (_invalidJson) {
      // The fixed error below deliberately omits the local metadata string.
    }
  }
  throw new TypeError('metadata must be an object or JSON object string')
}

/** Evaluate `metadata.clawdbot.requires.*` gates; a skill without gates passes. */
async function passesGating(
  metadata: Readonly<Record<string, unknown>> | undefined,
  subprocess: Pick<SubprocessRuntime, 'resolveExecutable'>,
  signal?: AbortSignal,
): Promise<boolean> {
  signal?.throwIfAborted()
  const clawdbot = metadata?.clawdbot
  if (clawdbot === undefined) return true
  if (typeof clawdbot !== 'object' || clawdbot === null || Array.isArray(clawdbot)) return false
  const requires = (clawdbot as { requires?: unknown }).requires
  if (requires === undefined) return true
  if (typeof requires !== 'object' || requires === null || Array.isArray(requires)) return false
  const gates = requires as { bins?: unknown; anyBins?: unknown; env?: unknown }
  if (gates.bins !== undefined) {
    if (!isStringArray(gates.bins) || !(await everyBinOnPath(gates.bins, subprocess, signal))) return false
  }
  if (gates.anyBins !== undefined) {
    if (!isStringArray(gates.anyBins) || !(await anyBinOnPath(gates.anyBins, subprocess, signal))) return false
  }
  if (gates.env !== undefined) {
    if (!isStringArray(gates.env) || !gates.env.every(entry => (process.env[entry]?.length ?? 0) > 0)) return false
  }
  return true
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string')
}

async function everyBinOnPath(
  names: string[],
  subprocess: Pick<SubprocessRuntime, 'resolveExecutable'>,
  signal?: AbortSignal,
): Promise<boolean> {
  for (const entry of names) {
    signal?.throwIfAborted()
    if (!(await binOnPath(entry, subprocess, signal))) return false
  }
  return true
}

async function anyBinOnPath(
  names: string[],
  subprocess: Pick<SubprocessRuntime, 'resolveExecutable'>,
  signal?: AbortSignal,
): Promise<boolean> {
  for (const entry of names) {
    signal?.throwIfAborted()
    if (await binOnPath(entry, subprocess, signal)) return true
  }
  return false
}

/** Resolve a gate through the Harness execution-world resolver without spawning it. */
async function binOnPath(
  name: string,
  subprocess: Pick<SubprocessRuntime, 'resolveExecutable'>,
  signal?: AbortSignal,
): Promise<boolean> {
  signal?.throwIfAborted()
  if (name === '') return false
  try {
    await subprocess.resolveExecutable(name, undefined, signal)
    signal?.throwIfAborted()
    return true
  } catch {
    signal?.throwIfAborted()
    return false
  }
}

/** Parse dsh invocation-policy frontmatter keys with the same semantics as skill-filesystem. */
function parseInvocationPolicy(data: Record<string, unknown>): SkillInvocationPolicy {
  for (const [legacy, canonical] of INVOCATION_LEGACY_KEYS) {
    if (Object.hasOwn(data, legacy)) {
      throw new Error(`frontmatter field "${legacy}" is unsupported; use "${canonical}"`)
    }
  }
  return {
    modelInvocable: readFrontmatterBoolean(data, 'disable-model-invocation') !== true,
    userInvocable: readFrontmatterBoolean(data, 'user-invocable') !== false,
  }
}

/** Legacy invocation keys rejected with their canonical replacement (same messages as skill-filesystem). */
const INVOCATION_LEGACY_KEYS: ReadonlyArray<readonly [legacy: string, canonical: string]> = [
  ['disableModelInvocation', 'disable-model-invocation'],
  ['modelInvocable', 'disable-model-invocation'],
  ['userInvocable', 'user-invocable'],
]

function readFrontmatterBoolean(data: Record<string, unknown>, key: string): boolean | undefined {
  if (!Object.hasOwn(data, key)) return undefined
  const value = data[key]
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
  }
  if (typeof value === 'string') {
    const normalized = value.toLowerCase()
    if (normalized === '1' || TRUTHY_WORDS.includes(normalized)) return true
    if (normalized === '0' || FALSEY_WORDS.includes(normalized)) return false
  }
  throw new TypeError(`frontmatter field "${key}" must be a boolean`)
}

const TRUTHY_WORDS: readonly string[] = ['true', 'yes', 'on']
const FALSEY_WORDS: readonly string[] = ['false', 'no', 'off']

/** Read a required non-empty string frontmatter field; absent or empty yields undefined. */
function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function combineSignals(first: AbortSignal | undefined, second: AbortSignal | undefined): AbortSignal | undefined {
  if (first === undefined) return second
  if (second === undefined) return first
  return AbortSignal.any([first, second])
}

function isMissingDirectory(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && ((error as { code?: unknown }).code === 'ENOENT' || (error as { code?: unknown }).code === 'ENOTDIR')
}

function errorMessage(error: unknown): string {
  return String(error)
}
