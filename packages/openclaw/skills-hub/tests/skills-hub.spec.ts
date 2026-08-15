/**
 * Contract tests for the skills-hub row, keyless: the real SkillRegistry, the
 * real provider over temp roots, and fixture SKILL.md files. Gating probes the
 * Harness executable resolver and host environment without child processes.
 * Registry-level assertions observe summaries (rank/metadata are provider-level
 * fields); candidate-level fields are asserted against the provider directly.
 */
import { describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import * as SkillsHub from '../src/index.ts'

class TestSettings extends SettingsProvider {
  constructor(ctx: Context, private readonly store: Record<string, unknown>) { super(ctx) }
  get writable(): boolean { return true }
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve(structuredClone(this.store)) }
  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.store[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

type ExecutableResolver = Pick<SubprocessRuntime, 'resolveExecutable'>

const defaultExecutableResolver: ExecutableResolver = {
  async resolveExecutable(command, _env, signal) {
    signal?.throwIfAborted()
    if (command === 'node') return process.execPath
    throw new Error(`test executable not found: ${command}`)
  },
}

async function tempDir(name: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), `dsh-${name}-`))
}

async function writeSkill(root: string, name: string, description: string, body = 'Use the skill.', frontmatter = ''): Promise<void> {
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}${frontmatter}\n---\n\n${body}\n`)
}

/** Override only the managed root without spreading Schemastery's config instance type. */
function testConfig(workspace: string, config: SkillsHub.Config): SkillsHub.Config {
  const resolved: SkillsHub.Config = { managedDir: join(workspace, 'no-clawdbot') }
  if (config.enabled !== undefined) resolved.enabled = config.enabled
  if (config.workspaceDir !== undefined) resolved.workspaceDir = config.workspaceDir
  if (config.extraDirs !== undefined) resolved.extraDirs = config.extraDirs
  if (config.gating !== undefined) resolved.gating = config.gating
  return resolved
}

/** Mount the registry + hub row; the managed dir points into the temp tree so the host's real `~/.clawdbot` never leaks in. */
async function setup(
  workspace: string,
  config: SkillsHub.Config = {},
  subprocess: ExecutableResolver = defaultExecutableResolver,
): Promise<{ ctx: Context; fiber: { dispose: () => Promise<void> } }> {
  const ctx = new Context()
  await ctx.plugin(TestSettings, {})
  ctx.provide('subprocess', subprocess as SubprocessRuntime)
  await ctx.plugin(SkillRegistry)
  const fiber = await ctx.plugin(SkillsHub, testConfig(workspace, config))
  return { ctx, fiber }
}

/** A provider over the same roots as `setup`, for candidate-level fields the registry summaries strip. */
function hubProvider(
  workspace: string,
  logger: Context['logger'],
  config: SkillsHub.Config = {},
): SkillsHub.ClawHubProvider {
  return new SkillsHub.ClawHubProvider(
    SkillsHub.resolveConfig(testConfig(workspace, config)),
    logger,
    defaultExecutableResolver,
  )
}

describe('skills-hub provider', () => {
  it('declares Settings and the Harness executable resolver as required plugin dependencies', () => {
    expect(SkillsHub.inject).toEqual(['skills', 'settings', 'subprocess'])
  })

  it('keeps the provider absent until restart when the resolved setting is disabled', async () => {
    const workspace = await tempDir('hub-disabled')
    try {
      await writeSkill(join(workspace, 'skills'), 'hidden', 'Hidden while disabled')
      const ctx = new Context()
      await ctx.plugin(TestSettings, { 'clawdsh-skills-hub': { enabled: false } })
      ctx.provide('subprocess', defaultExecutableResolver as SubprocessRuntime)
      await ctx.plugin(SkillRegistry)
      const fiber = await ctx.plugin(SkillsHub, { enabled: true, managedDir: join(workspace, 'managed') })
      expect(await ctx.skills.list({ cwd: workspace })).toEqual([])
      expect(ctx.settings.describe().find(entry => entry.ns === SkillsHub.SKILLS_HUB_SETTINGS_NAMESPACE))
        .toMatchObject({ applies: 'restart', value: { enabled: false } })

      await ctx.settings.update(SkillsHub.SKILLS_HUB_SETTINGS_NAMESPACE, { enabled: true })
      expect(await ctx.skills.list({ cwd: workspace })).toEqual([])
      await fiber.dispose()
      await ctx.plugin(SkillsHub, { enabled: true, managedDir: join(workspace, 'managed') })
      expect((await ctx.skills.list({ cwd: workspace })).map(skill => skill.name)).toEqual(['hidden'])
      await ctx.fiber.dispose()
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('lists SKILL.md directory skills from the workspace root and skips invalid files', async () => {
    const workspace = await tempDir('hub-workspace')
    try {
      await writeSkill(join(workspace, 'skills'), 'summarize', 'Summarize URLs or files')
      await writeSkill(join(workspace, 'skills'), 'no-description', '')
      // A directory without SKILL.md is not a skill.
      await mkdir(join(workspace, 'skills', 'empty-dir'), { recursive: true })
      const { ctx } = await setup(workspace)
      const skills = await ctx.skills.list({ cwd: workspace })
      expect(skills.map(skill => [skill.name, skill.provider])).toEqual([['summarize', 'clawhub']])
      const candidates = await hubProvider(workspace, ctx.logger).list({ cwd: workspace })
      expect(candidates.map(candidate => [candidate.rank, candidate.source]))
        .toEqual([[SkillsHub.WORKSPACE_SKILL_RANK, 'clawhub-workspace']])
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('resolves a duplicate name by rank: workspace (300) beats managed (450)', async () => {
    const workspace = await tempDir('hub-ws-win')
    const managed = await tempDir('hub-managed')
    try {
      await writeSkill(join(workspace, 'skills'), 'shared', 'Workspace body', 'Workspace body')
      await writeSkill(managed, 'shared', 'Managed body', 'Managed body')
      const { ctx } = await setup(workspace, { managedDir: managed })
      const skills = await ctx.skills.list({ cwd: workspace })
      expect(skills.map(skill => skill.description)).toEqual(['Workspace body'])
      expect((await ctx.skills.get('shared', { cwd: workspace }))?.content).toBe('Workspace body')
    } finally {
      await rm(workspace, { recursive: true, force: true })
      await rm(managed, { recursive: true, force: true })
    }
  })

  it('evaluates metadata.clawdbot gating: missing bins and env exclude the skill', async () => {
    const workspace = await tempDir('hub-gating')
    try {
      await writeSkill(join(workspace, 'skills'), 'needs-bin', 'Requires a bin', 'Bin body.',
        '\nmetadata: {"clawdbot":{"requires":{"bins":["definitely-not-a-real-bin-xyz"]}}}')
      await writeSkill(join(workspace, 'skills'), 'needs-env', 'Requires an env var', 'Env body.',
        '\nmetadata: {"clawdbot":{"requires":{"env":["DH_SKILLS_HUB_TEST_UNSET_VAR"]}}}')
      await writeSkill(join(workspace, 'skills'), 'passes', 'No gates', 'Pass body.')
      const { ctx } = await setup(workspace)
      expect((await ctx.skills.list({ cwd: workspace })).map(skill => skill.name)).toEqual(['passes'])

      // With gating disabled the same skills are all listed.
      const ungated = await setup(workspace, { gating: false })
      expect((await ungated.ctx.skills.list({ cwd: workspace })).map(skill => skill.name))
        .toEqual(['needs-bin', 'needs-env', 'passes'])
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('passes an anyBins gate when at least one binary exists on PATH', async () => {
    const workspace = await tempDir('hub-anybins')
    try {
      await writeSkill(join(workspace, 'skills'), 'any-bin', 'Requires any bin', 'Any body.',
        '\nmetadata: {"clawdbot":{"requires":{"anyBins":["definitely-not-a-real-bin-xyz","node"]}}}')
      const { ctx } = await setup(workspace)
      const skills = await ctx.skills.list({ cwd: workspace })
      expect(skills.map(skill => skill.name)).toEqual(['any-bin'])
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('delegates Windows PATHEXT lookup to the Harness executable resolver', async () => {
    const workspace = await tempDir('hub-pathext')
    const resolveExecutable = vi.fn<SubprocessRuntime['resolveExecutable']>(async (command, _env, signal) => {
      signal?.throwIfAborted()
      if (command === 'win-tool') return String.raw`C:\tools\win-tool.EXE`
      throw new Error(`test executable not found: ${command}`)
    })
    try {
      await writeSkill(join(workspace, 'skills'), 'windows-bin', 'Requires a Windows executable', 'Windows body.',
        '\nmetadata: {"clawdbot":{"requires":{"bins":["win-tool"]}}}')
      const { ctx } = await setup(workspace, {}, { resolveExecutable })

      expect((await ctx.skills.list({ cwd: workspace })).map(skill => skill.name)).toEqual(['windows-bin'])
      expect(resolveExecutable).toHaveBeenCalledWith('win-tool', undefined, undefined)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('normalizes single-line JSON metadata into the candidate and the loaded definition', async () => {
    const workspace = await tempDir('hub-metadata')
    try {
      await writeSkill(join(workspace, 'skills'), 'meta-skill', 'Has metadata', 'Meta body.',
        '\nmetadata: {"clawdbot":{"emoji":"🧾","requires":{"bins":[]}}}')
      const { ctx } = await setup(workspace)
      const candidates = await hubProvider(workspace, ctx.logger).list({ cwd: workspace })
      expect(candidates.map(candidate => candidate.metadata))
        .toEqual([{ clawdbot: { emoji: '🧾', requires: { bins: [] } } }])
      const definition = await ctx.skills.get('meta-skill', { cwd: workspace })
      expect(definition?.metadata).toEqual({ clawdbot: { emoji: '🧾', requires: { bins: [] } } })
      expect(definition?.content).toBe('Meta body.')
      expect(definition?.resourceBase).toEqual({ kind: 'directory', path: join(workspace, 'skills', 'meta-skill') })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('keeps the dsh invocation-policy keys and loads a definition without frontmatter', async () => {
    const workspace = await tempDir('hub-policy')
    try {
      await writeSkill(join(workspace, 'skills'), 'quiet-skill', 'Not model invocable', 'Quiet body.',
        '\ndisable-model-invocation: true')
      const { ctx } = await setup(workspace)
      const skills = await ctx.skills.list({ cwd: workspace })
      expect(skills.map(skill => skill.invocation)).toEqual([{ modelInvocable: false, userInvocable: true }])
      const definition = await ctx.skills.get('quiet-skill', { cwd: workspace })
      expect(definition?.content).toBe('Quiet body.')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('unregisters the provider when the plugin fiber is disposed', async () => {
    const workspace = await tempDir('hub-dispose')
    try {
      await writeSkill(join(workspace, 'skills'), 'disposed', 'Disposed skill')
      const { ctx, fiber } = await setup(workspace)
      expect(await ctx.skills.list({ cwd: workspace })).toHaveLength(1)
      await fiber.dispose()
      expect(await ctx.skills.list({ cwd: workspace })).toEqual([])
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('returns nothing when the provider cannot load a vanished candidate', async () => {
    const workspace = await tempDir('hub-vanish')
    try {
      await writeSkill(join(workspace, 'skills'), 'vanishing', 'Vanishing skill')
      const { ctx } = await setup(workspace)
      const skills = await ctx.skills.list({ cwd: workspace })
      expect(skills).toHaveLength(1)
      await rm(join(workspace, 'skills', 'vanishing'), { recursive: true })
      expect(await ctx.skills.get('vanishing', { cwd: workspace })).toBeUndefined()
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('validates raw config types defensively for non-Loader callers', async () => {
    const ctx = new Context()
    await ctx.plugin(TestSettings, {})
    ctx.provide('subprocess', defaultExecutableResolver as SubprocessRuntime)
    await ctx.plugin(SkillRegistry)
    await expect(ctx.plugin(SkillsHub, { gating: 'yes' as never })).rejects.toThrow(/gating/)
    await expect(ctx.plugin(SkillsHub, { extraDirs: 'nope' as never })).rejects.toThrow(/extraDirs/)
  })

  it('lets a same-rank skill-filesystem custom dir beat the hub workspace candidate', async () => {
    const workspace = await tempDir('hub-tiebreak')
    const customRoot = await tempDir('hub-custom')
    try {
      await writeSkill(join(workspace, 'skills'), 'tie-skill', 'Hub body')
      await writeSkill(join(customRoot, 'skills'), 'tie-skill', 'Filesystem body')
      const ctx = new Context()
      await ctx.plugin(TestSettings, {})
      ctx.provide('subprocess', defaultExecutableResolver as SubprocessRuntime)
      await ctx.plugin(SkillRegistry)
      const SkillFileSystem = await import('@deepseek-ai/dsh-skill-filesystem')
      // Registration order: skill-filesystem (base bundle) first, then the hub provider.
      await ctx.plugin(SkillFileSystem, { customSkillDirs: [join(customRoot, 'skills')], includeDefaultRoots: false })
      await ctx.plugin(SkillsHub, { managedDir: join(workspace, 'no-clawdbot') })
      const skills = await ctx.skills.list({ cwd: workspace })
      const tie = skills.find(skill => skill.name === 'tie-skill')
      expect(tie?.provider).toBe('filesystem')
      expect(tie?.description).toBe('Filesystem body')
    } finally {
      await rm(workspace, { recursive: true, force: true })
      await rm(customRoot, { recursive: true, force: true })
    }
  })
})
