import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { SkillCandidate } from '@deepseek-ai/dsh-skill'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as SkillsHub from '../src/index.ts'

type ExecutableResolver = Pick<SubprocessRuntime, 'resolveExecutable'>

const roots: string[] = []

async function tempDir(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `dsh-skills-hub-${name}-`))
  roots.push(root)
  return root
}

async function writeRawSkill(root: string, directory: string, raw: string): Promise<string> {
  const skillDir = join(root, directory)
  await mkdir(skillDir, { recursive: true })
  const path = join(skillDir, 'SKILL.md')
  await writeFile(path, raw)
  return path
}

function skill(name: string, extra = '', body = 'Body.'): string {
  return `---\nname: ${name}\ndescription: ${name} description${extra}\n---\n${body}\n`
}

const resolver: ExecutableResolver = {
  async resolveExecutable(command, _env, signal) {
    signal?.throwIfAborted()
    if (command === 'node') return process.execPath
    throw new Error(`missing executable: ${command}`)
  },
}

function provider(
  config: SkillsHub.ResolvedConfig,
  subprocess: ExecutableResolver = resolver,
  lifecycleSignal?: AbortSignal,
): { ctx: Context; value: SkillsHub.ClawHubProvider } {
  const ctx = new Context()
  return {
    ctx,
    value: new SkillsHub.ClawHubProvider(config, ctx.logger, subprocess, lifecycleSignal),
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  vi.unstubAllEnvs()
})

describe('skills-hub edge behavior', () => {
  it('resolves defaults and rejects every invalid raw config field', () => {
    expect(SkillsHub.resolveConfig()).toEqual({
      enabled: true,
      managedDir: SkillsHub.DEFAULT_MANAGED_DIR,
      extraDirs: [],
      gating: true,
    })
    expect(SkillsHub.resolveConfig({
      workspaceDir: '.',
      managedDir: '.',
      extraDirs: ['.'],
      gating: false,
    })).toEqual({
      enabled: true,
      workspaceDir: resolve('.'),
      managedDir: resolve('.'),
      extraDirs: [resolve('.')],
      gating: false,
    })

    expect(() => SkillsHub.resolveConfig({ enabled: 'yes' as never })).toThrow(/enabled/)
    expect(() => SkillsHub.resolveConfig({ workspaceDir: 1 as never })).toThrow(/workspaceDir/)
    expect(() => SkillsHub.resolveConfig({ managedDir: 1 as never })).toThrow(/managedDir/)
    expect(() => SkillsHub.resolveConfig({ extraDirs: 'one' as never })).toThrow(/array of strings/)
    expect(() => SkillsHub.resolveConfig({ extraDirs: [1 as never] })).toThrow(/array of strings/)
    expect(() => SkillsHub.resolveConfig({ extraDirs: [' '] })).toThrow(/empty path/)
    expect(() => SkillsHub.resolveConfig({ gating: 'yes' as never })).toThrow(/gating/)
  })

  it('scans fixed workspace, extra, and managed roots and preserves optional candidate fields', async () => {
    const workspace = await tempDir('roots-workspace')
    const extra = await tempDir('roots-extra')
    const managed = await tempDir('roots-managed')
    await writeRawSkill(workspace, 'workspace', skill('workspace', '\nwhenToUse: On demand'))
    await writeRawSkill(extra, 'extra', skill('extra'))
    await writeRawSkill(managed, 'managed', skill('managed'))
    const { ctx, value } = provider({
      enabled: true,
      workspaceDir: workspace,
      managedDir: managed,
      extraDirs: [extra],
      gating: true,
    })

    const candidates = await value.list({})
    expect(candidates.map(candidate => [candidate.name, candidate.source, candidate.rank])).toEqual([
      ['workspace', 'clawhub-workspace', SkillsHub.WORKSPACE_SKILL_RANK],
      ['extra', 'clawhub-extra', SkillsHub.EXTRA_SKILL_RANK],
      ['managed', 'clawhub-managed', SkillsHub.MANAGED_SKILL_RANK],
    ])
    expect(candidates[0]?.whenToUse).toBe('On demand')
    expect((await value.get(candidates[0] as SkillCandidate, {}))?.whenToUse).toBe('On demand')

    const managedCandidate = candidates.find(candidate => candidate.name === 'managed')
    if (managedCandidate === undefined) throw new Error('managed candidate missing')
    expect(await value.get({ ...managedCandidate, name: 'renamed' }, {})).toBeUndefined()

    const dynamic = provider({ enabled: true, managedDir: join(managed, 'missing'), extraDirs: [], gating: true })
    expect(await dynamic.value.list({})).toEqual([])
    await Promise.all([ctx.fiber.dispose(), dynamic.ctx.fiber.dispose()])
  })

  it('ignores non-files, malformed envelopes, YAML, metadata, and invocation policies', async () => {
    const root = await tempDir('malformed')
    await mkdir(join(root, 'skill-file-is-directory', 'SKILL.md'), { recursive: true })
    await writeRawSkill(root, 'invalid-yaml', '---\nname: [\n---\nBody\n')
    await writeRawSkill(root, 'missing-close', '---\nname: missing-close\ndescription: Missing close\n')
    await writeRawSkill(root, 'array-yaml', '---\n- item\n---\nBody\n')
    await writeRawSkill(root, 'null-yaml', '---\nnull\n---\nBody\n')
    await writeRawSkill(root, 'json-number', skill('json-number', '\nmetadata: "1"'))
    await writeRawSkill(root, 'json-array', skill('json-array', '\nmetadata: "[1]"'))
    await writeRawSkill(root, 'json-object', skill('json-object', '\nmetadata: \'{"origin":"json-string"}\''))
    await writeRawSkill(root, 'metadata-array', skill('metadata-array', '\nmetadata: [one]'))
    await writeRawSkill(root, 'legacy-one', skill('legacy-one', '\ndisableModelInvocation: true'))
    await writeRawSkill(root, 'legacy-two', skill('legacy-two', '\nmodelInvocable: true'))
    await writeRawSkill(root, 'legacy-three', skill('legacy-three', '\nuserInvocable: true'))
    await writeRawSkill(root, 'invalid-boolean', skill('invalid-boolean', '\nuser-invocable: 2'))
    await writeRawSkill(root, 'invalid-word', skill('invalid-word', '\nuser-invocable: sometimes'))
    await writeRawSkill(root, 'number-true', skill('number-true', '\ndisable-model-invocation: 1'))
    await writeRawSkill(root, 'number-false', skill('number-false', '\nuser-invocable: 0'))
    await writeRawSkill(root, 'word-true', skill('word-true', '\ndisable-model-invocation: YES'))
    await writeRawSkill(root, 'word-false', skill('word-false', '\nuser-invocable: OFF'))
    await writeRawSkill(root, 'bom-crlf', '\uFEFF---\r\nname: bom-crlf\r\ndescription: BOM skill\r\n---\r\nBody.\r\n')
    const { ctx, value } = provider({ enabled: true, workspaceDir: root, managedDir: join(root, 'missing'), extraDirs: [], gating: true })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})

    const candidates = await value.list({})

    expect(candidates.map(candidate => candidate.name).sort()).toEqual([
      'bom-crlf',
      'json-object',
      'number-false',
      'number-true',
      'word-false',
      'word-true',
    ])
    expect(candidates.find(candidate => candidate.name === 'number-true')?.invocation.modelInvocable).toBe(false)
    expect(candidates.find(candidate => candidate.name === 'number-false')?.invocation.userInvocable).toBe(false)
    expect(candidates.find(candidate => candidate.name === 'word-true')?.invocation.modelInvocable).toBe(false)
    expect(candidates.find(candidate => candidate.name === 'word-false')?.invocation.userInvocable).toBe(false)
    expect(warn.mock.calls.some(call => String(call[0]).includes('invalid YAML frontmatter'))).toBe(true)
    expect(warn.mock.calls.some(call => String(call[0]).includes('invalid invocation frontmatter'))).toBe(true)
    await ctx.fiber.dispose()
  })

  it('applies directly without a Settings provider', async () => {
    const root = await tempDir('without-settings')
    await writeRawSkill(join(root, 'skills'), 'direct', skill('direct'))
    const ctx = new Context()
    ctx.provide('subprocess', resolver as SubprocessRuntime)
    const SkillRegistry = (await import('@deepseek-ai/dsh-skill')).default
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(Object.assign((pluginCtx: Context) => {
      SkillsHub.apply(pluginCtx, { managedDir: join(root, 'managed') })
    }, { inject: ['skills', 'subprocess'] }))

    expect((await ctx.skills.list({ cwd: root })).map(candidate => candidate.name)).toEqual(['direct'])
    await ctx.fiber.dispose()
  })

  it('fails closed for malformed gates while accepting empty and satisfied gates', async () => {
    const root = await tempDir('gates')
    vi.stubEnv('SKILLS_HUB_PRESENT', 'yes')
    const fixtures: Array<[string, string]> = [
      ['clawdbot-scalar', '\nmetadata: {"clawdbot":"bad"}'],
      ['clawdbot-array', '\nmetadata: {"clawdbot":[]}'],
      ['requires-null', '\nmetadata: {"clawdbot":{"requires":null}}'],
      ['requires-array', '\nmetadata: {"clawdbot":{"requires":[]}}'],
      ['bins-scalar', '\nmetadata: {"clawdbot":{"requires":{"bins":"node"}}}'],
      ['bins-empty-name', '\nmetadata: {"clawdbot":{"requires":{"bins":[""]}}}'],
      ['bins-late-missing', '\nmetadata: {"clawdbot":{"requires":{"bins":["node","missing"]}}}'],
      ['any-bins-scalar', '\nmetadata: {"clawdbot":{"requires":{"anyBins":"node"}}}'],
      ['any-bins-none', '\nmetadata: {"clawdbot":{"requires":{"anyBins":["missing"]}}}'],
      ['env-scalar', '\nmetadata: {"clawdbot":{"requires":{"env":"SKILLS_HUB_PRESENT"}}}'],
      ['no-requires', '\nmetadata: {"clawdbot":{}}'],
      ['empty-gates', '\nmetadata: {"clawdbot":{"requires":{"bins":[],"env":[]}}}'],
      ['satisfied', '\nmetadata: {"clawdbot":{"requires":{"bins":["node"],"anyBins":["missing","node"],"env":["SKILLS_HUB_PRESENT"]}}}'],
    ]
    await Promise.all(fixtures.map(([name, extra]) => writeRawSkill(root, name, skill(name, extra))))
    const { ctx, value } = provider({ enabled: true, workspaceDir: root, managedDir: join(root, 'missing'), extraDirs: [], gating: true })

    expect((await value.list({})).map(candidate => candidate.name).sort()).toEqual([
      'empty-gates',
      'no-requires',
      'satisfied',
    ])
    await ctx.fiber.dispose()
  })

  it('contains scan/read failures and propagates cancellation from either signal', async () => {
    const root = await tempDir('failure')
    const path = await writeRawSkill(root, 'vanish', skill('vanish'))
    const { ctx, value } = provider({ enabled: true, workspaceDir: root, managedDir: join(root, 'missing'), extraDirs: [], gating: true })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const candidate = (await value.list({}))[0]
    if (candidate === undefined) throw new Error('candidate missing')
    await rm(path)
    expect(await value.get(candidate, {})).toBeUndefined()
    expect(warn.mock.calls.some(call => String(call[0]).includes('cannot read'))).toBe(true)

    const invalid = provider({ enabled: true, managedDir: '\0', extraDirs: [], gating: true })
    const invalidWarn = vi.spyOn(invalid.ctx.logger, 'warn').mockImplementation(() => {})
    expect(await invalid.value.list({})).toEqual([])
    expect(invalidWarn).toHaveBeenCalledWith(expect.stringContaining('cannot scan'))

    const lifecycle = new AbortController()
    const request = new AbortController()
    const combined = provider({ enabled: true, managedDir: root, extraDirs: [], gating: true }, resolver, lifecycle.signal)
    request.abort(new Error('request cancelled'))
    await expect(combined.value.list({ signal: request.signal })).rejects.toThrow(/request cancelled/)

    const gateAbort = new AbortController()
    const abortingResolver: ExecutableResolver = {
      async resolveExecutable() {
        gateAbort.abort(new Error('gate cancelled'))
        throw new Error('resolver stopped')
      },
    }
    await writeRawSkill(root, 'cancel-gate', skill('cancel-gate', '\nmetadata: {"clawdbot":{"requires":{"bins":["tool"]}}}'))
    const aborting = provider({ enabled: true, workspaceDir: root, managedDir: join(root, 'missing'), extraDirs: [], gating: true }, abortingResolver)
    await expect(aborting.value.list({ signal: gateAbort.signal })).rejects.toThrow(/gate cancelled/)

    await Promise.all([
      ctx.fiber.dispose(),
      invalid.ctx.fiber.dispose(),
      combined.ctx.fiber.dispose(),
      aborting.ctx.fiber.dispose(),
    ])
  })
})
