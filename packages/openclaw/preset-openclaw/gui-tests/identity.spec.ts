import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const repositoryRoot = resolve(import.meta.dirname, '../../../..')
const assemblyRoot = join(repositoryRoot, 'packages/openclaw/preset-openclaw')
const profileSource = join(assemblyRoot, 'profile')
const presetSource = assemblyRoot
const safePresetSource = join(repositoryRoot, 'packages/openclaw/preset-clawdsh-messaging-safe')
const linkScript = join(repositoryRoot, 'tools/link-clawdsh.sh')
const legacyLinkScript = join(repositoryRoot, 'tools/link-openclaw.sh')
const linkedPackages = [
  'channel',
  'channel-agent',
  'channel-openclaw',
  'memory',
  'embeddings',
  'embeddings-ark',
  'skills-hub',
  'automation',
  'soul',
] as const

const temporaryHomes: string[] = []

function temporaryHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'clawdsh-identity-'))
  temporaryHomes.push(home)
  return home
}

function runRefresh(home: string): SpawnSyncReturns<string> {
  return spawnSync(linkScript, [], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, DSH_HOME: home },
  })
}

function expectRefreshSuccess(result: SpawnSyncReturns<string>): void {
  expect(result.error).toBeUndefined()
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
}

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

function loaderEntry(config: string, id: string): string {
  const marker = `    - id: ${id}\n`
  const start = config.indexOf(marker)
  expect(start, `missing loader entry ${id}`).toBeGreaterThanOrEqual(0)
  const next = config.indexOf('\n    - id:', start + marker.length)
  return config.slice(start, next === -1 ? undefined : next)
}

afterEach(() => {
  for (const home of temporaryHomes.splice(0)) rmSync(home, { recursive: true, force: true })
})

describe('ClawDSH installed profile identity', () => {
  it('uses the ClawDSH ids and user-visible mode name', () => {
    const manifest = JSON.parse(read(join(profileSource, 'package.json'))) as { name?: unknown }
    const patch = read(join(profileSource, 'cordis.patch.yml'))
    const preset = read(join(presetSource, 'preset.yml'))

    expect(manifest.name).toBe('clawdsh')
    expect(patch).toMatch(/^- id: agent-presets\n  config:\n    default: clawdsh$/m)
    expect(preset).toMatch(/^name: ClawDSH 模式$/m)
  })

  it('keeps the OpenClaw communication sidecar disabled in the clean-install profile', () => {
    const entry = loaderEntry(read(join(profileSource, 'cordis.patch.yml')), 'clawdsh-communication-plane')
    expect(entry).toContain("disabled: !!js process.env.CLAWDSH_OPENCLAW_CHANNELS_ENABLED !== '1'")
    expect(entry).toMatch(/name: '@clawdsh\/dsh-channel'/)
    expect(entry).toMatch(/ownerPreset: clawdsh/)
    expect(entry).toMatch(/safePreset: clawdsh-messaging-safe/)
    expect(entry).toMatch(/name: '@clawdsh\/dsh-channel-openclaw'/)
    expect(entry).not.toMatch(/dsh-channel-(?:feishu|telegram|core)/)
  })

  it('keeps Automation disabled in the clean-install profile', () => {
    const entry = loaderEntry(read(join(profileSource, 'cordis.patch.yml')), 'automation')
    expect(entry).toMatch(/^      disabled: true$/m)
  })

  it('does not retain the obsolete development command', () => {
    expect(existsSync(linkScript)).toBe(true)
    expect(existsSync(legacyLinkScript)).toBe(false)
  })
})

describe.skipIf(process.platform === 'win32')('ClawDSH development refresh', () => {
  it('installs only clawdsh assets and refreshes them idempotently', () => {
    const home = temporaryHome()
    const profile = join(home, 'profiles/clawdsh')
    const preset = join(home, '.agent-presets/clawdsh')
    const safePreset = join(home, '.agent-presets/clawdsh-messaging-safe')

    const first = runRefresh(home)
    expectRefreshSuccess(first)
    expect(first.stdout).toContain('开发刷新完成')

    expect(read(join(profile, 'package.json'))).toBe(read(join(profileSource, 'package.json')))
    expect(read(join(profile, 'cordis.patch.yml'))).toBe(read(join(profileSource, 'cordis.patch.yml')))
    expect(read(join(preset, 'preset.yml'))).toBe(read(join(presetSource, 'preset.yml')))
    expect(read(join(preset, 'agent.cordis.yml'))).toBe(read(join(presetSource, 'agent.cordis.yml')))
    expect(read(join(preset, 'souls/assistant.md'))).toBe(read(join(presetSource, 'souls/assistant.md')))
    expect(read(join(safePreset, 'preset.yml'))).toBe(read(join(safePresetSource, 'preset.yml')))
    expect(read(join(safePreset, 'agent.cordis.yml'))).toBe(read(join(safePresetSource, 'agent.cordis.yml')))
    expect(read(join(safePreset, 'souls/assistant.md'))).toBe(read(join(safePresetSource, 'souls/assistant.md')))
    expect(existsSync(join(home, 'profiles/openclaw'))).toBe(false)
    expect(existsSync(join(home, '.agent-presets/openclaw'))).toBe(false)
    expect(existsSync(join(home, '.agent-presets/openclaw-messaging-safe'))).toBe(false)

    for (const packageName of linkedPackages) {
      const link = join(home, 'profiles/node_modules/@clawdsh', `dsh-${packageName}`)
      expect(lstatSync(link).isSymbolicLink()).toBe(true)
      expect(realpathSync(link)).toBe(realpathSync(join(repositoryRoot, 'packages/openclaw', packageName)))
    }

    writeFileSync(join(profile, 'package.json'), '{"name":"drifted"}\n')
    const second = runRefresh(home)
    expectRefreshSuccess(second)
    expect(read(join(profile, 'package.json'))).toBe(read(join(profileSource, 'package.json')))
  })

  it.each([
    { label: 'profile only', hasProfile: true, hasPreset: false, hasSafePreset: false },
    { label: 'preset only', hasProfile: false, hasPreset: true, hasSafePreset: false },
    { label: 'safe preset only', hasProfile: false, hasPreset: false, hasSafePreset: true },
    { label: 'all assets', hasProfile: true, hasPreset: true, hasSafePreset: true },
  ])('warns accurately about legacy $label assets without changing them', ({ hasProfile, hasPreset, hasSafePreset }) => {
    const home = temporaryHome()
    const legacyProfile = join(home, 'profiles/openclaw')
    const legacyPreset = join(home, '.agent-presets/openclaw')
    const legacySafePreset = join(home, '.agent-presets/openclaw-messaging-safe')
    const profileSentinel = join(legacyProfile, 'legacy-profile.txt')
    const presetSentinel = join(legacyPreset, 'legacy-preset.txt')
    const safePresetSentinel = join(legacySafePreset, 'legacy-safe-preset.txt')
    if (hasProfile) {
      mkdirSync(legacyProfile, { recursive: true })
      writeFileSync(profileSentinel, 'profile sentinel\n')
    }
    if (hasPreset) {
      mkdirSync(legacyPreset, { recursive: true })
      writeFileSync(presetSentinel, 'preset sentinel\n')
    }
    if (hasSafePreset) {
      mkdirSync(legacySafePreset, { recursive: true })
      writeFileSync(safePresetSentinel, 'safe preset sentinel\n')
    }

    const result = runRefresh(home)
    expectRefreshSuccess(result)

    expect(result.stderr.includes(`旧 profile：${legacyProfile}\n`)).toBe(hasProfile)
    expect(result.stderr.includes(`旧 agent preset：${legacyPreset}\n`)).toBe(hasPreset)
    expect(result.stderr.includes(`旧受限 preset：${legacySafePreset}\n`)).toBe(hasSafePreset)
    expect(result.stderr.includes('旧 Session 可能仍引用 preset id "openclaw"')).toBe(hasPreset)
    expect(result.stderr.includes('旧 profile 不再维护或刷新')).toBe(hasProfile)
    expect(result.stderr.includes('旧渠道 Session 可能仍引用 preset id "openclaw-messaging-safe"')).toBe(hasSafePreset)
    expect(result.stderr).toContain('tools/link-clawdsh.sh')
    expect(result.stderr).toContain('pnpm dsh --profile clawdsh')
    expect(result.stderr.includes('人工清理')).toBe(hasProfile || hasPreset)
    expect(result.stderr.includes('不会删除、移动或改写')).toBe(hasProfile || hasPreset)
    if (hasProfile) {
      expect(readdirSync(legacyProfile)).toEqual(['legacy-profile.txt'])
      expect(read(profileSentinel)).toBe('profile sentinel\n')
    }
    if (hasPreset) {
      expect(readdirSync(legacyPreset)).toEqual(['legacy-preset.txt'])
      expect(read(presetSentinel)).toBe('preset sentinel\n')
    }
    if (hasSafePreset) {
      expect(readdirSync(legacySafePreset)).toEqual(['legacy-safe-preset.txt'])
      expect(read(safePresetSentinel)).toBe('safe preset sentinel\n')
    }
  })
})
