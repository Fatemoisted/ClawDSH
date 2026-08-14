/** Release family discovery, publish order, tag naming, and the bump judgements. */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { releaseFamily, type ReleaseMember } from './families.ts'
import { compareVersions, nextVendorVersion, planShared, reachesPayload, writeDependencyRanges } from './bump.ts'

const repositoryRoot = resolve(import.meta.dirname, '../..')

/**
 * A release member standing in for a manifest on disk.
 * @param directory - repository-relative package directory.
 * @param name - package name.
 * @param manifest - manifest fields the subject reads.
 * @returns The member.
 */
function member(directory: string, name: string, manifest: Record<string, unknown> = {}): ReleaseMember {
  return { directory, name, version: '0.0.1', manifest }
}

describe('release families', () => {
  it('discovers ClawDSH separately from the upstream dsh family', () => {
    const dshMembers = releaseFamily('dsh').members(repositoryRoot)
    const clawdshMembers = releaseFamily('clawdsh').members(repositoryRoot)

    expect(dshMembers.some(entry => entry.directory.startsWith('packages/openclaw/'))).toBe(false)
    expect(dshMembers.every(entry => entry.name.startsWith('@deepseek-ai/'))).toBe(true)
    expect(clawdshMembers.map(entry => entry.directory)).toEqual([
      'packages/openclaw/automation',
      'packages/openclaw/channel-core',
      'packages/openclaw/channel-feishu',
      'packages/openclaw/channel-telegram',
      'packages/openclaw/embeddings-ark',
      'packages/openclaw/embeddings',
      'packages/openclaw/memory',
      'packages/openclaw/skills-hub',
      'packages/openclaw/soul',
    ])
    expect(clawdshMembers.every(entry => entry.name.startsWith('@clawdsh/dsh-'))).toBe(true)
  })

  it('names one tag per shared-version family and one per vendored package', () => {
    const dsh = releaseFamily('dsh')
    const clawdsh = releaseFamily('clawdsh')
    const vendor = releaseFamily('vendor')
    const cli = member('apps/cli', '@deepseek-ai/dsh')
    const channel = member('packages/openclaw/channel-core', '@clawdsh/dsh-channel-core')
    const cordis = { ...member('vendor/cordis', '@deepseek-ai/cordis'), version: '4.0.1' }

    expect(dsh.tagFor(cli)).toBe('dsh-v0.0.1')
    expect(clawdsh.tagFor(channel)).toBe('clawdsh-v0.0.1')
    expect(vendor.tagFor(cordis)).toBe('vendor-cordis-v4.0.1')
    // The prefix is constructed, not recovered from a tag: a version with a
    // hyphen would defeat any suffix-stripping.
    expect(vendor.tagPrefixFor({ ...cordis, version: '4.0.0-rc.7' })).toBe('vendor-cordis-v')
    expect(vendor.tagFor({ ...cordis, version: '4.0.0-rc.7' })).toBe('vendor-cordis-v4.0.0-rc.7')
    expect(dsh.releaseBranch).toBe('master')
    expect(clawdsh.releaseBranch).toBe('clawdsh')
    expect(vendor.releaseBranch).toBe('master')
  })

  it('rejects a family whose members disagree on the shared version', () => {
    const dsh = releaseFamily('dsh')
    const clawdsh = releaseFamily('clawdsh')
    const members = [member('apps/cli', '@deepseek-ai/dsh'), { ...member('apps/web', '@deepseek-ai/dsh-web-frontend'), version: '0.0.2' }]
    const clawdshMembers = [
      member('packages/openclaw/channel-core', '@clawdsh/dsh-channel-core'),
      { ...member('packages/openclaw/soul', '@clawdsh/dsh-soul'), version: '0.0.2' },
    ]

    expect(() => { dsh.verifyVersions(members) }).toThrow(/must share one version/)
    expect(() => { dsh.verifyVersions([members[0]!]) }).not.toThrow()
    expect(() => { clawdsh.verifyVersions(clawdshMembers) }).toThrow(/must share one version/)
    expect(() => { clawdsh.verifyVersions([clawdshMembers[0]!]) }).not.toThrow()
  })

  it('bumps ClawDSH as one version without rewriting the dsh workspace root', () => {
    const clawdsh = releaseFamily('clawdsh')
    const clawdshMembers = clawdsh.members(repositoryRoot)
    const clawdshPlan = planShared(clawdsh, repositoryRoot, clawdshMembers, 'patch')

    expect(clawdsh.versioning).toBe('shared')
    expect(clawdshPlan.version).toBe('0.1.1')
    expect(clawdshPlan.planned).toHaveLength(clawdshMembers.length)
    expect(clawdshPlan.planned.some(entry => entry.manifestPath === 'package.json')).toBe(false)
    expect(new Set(clawdshPlan.planned.map(entry => entry.tag))).toEqual(new Set(['clawdsh-v0.1.1']))
    const dependencyRanges = clawdsh.planSynchronizedDependencyRanges(
      repositoryRoot,
      clawdshMembers,
      clawdshPlan.version,
    )
    expect(dependencyRanges).toHaveLength(clawdshMembers.length)
    expect(new Set(dependencyRanges.map(entry => entry.manifestPath))).toEqual(new Set([
      'tools/openclaw-preset-openclaw/profile/package.json',
    ]))
    expect(new Set(dependencyRanges.map(entry => entry.packageName)))
      .toEqual(new Set(clawdshMembers.map(entry => entry.name)))
    expect(dependencyRanges.every(entry => entry.from === `^${clawdshMembers[0]!.version}`)).toBe(true)
    expect(dependencyRanges.every(entry => entry.to === `^${clawdshPlan.version}`)).toBe(true)
    expect(() => { clawdsh.verifySynchronizedDependencyRanges(repositoryRoot, clawdshMembers) }).not.toThrow()

    const dsh = releaseFamily('dsh')
    const [firstDsh] = dsh.members(repositoryRoot)
    expect(firstDsh).toBeDefined()
    const dshPlan = planShared(dsh, repositoryRoot, [firstDsh!], 'patch')
    expect(dsh.versioning).toBe('shared-with-root')
    expect(dshPlan.planned[0]?.manifestPath).toBe('package.json')
    expect(releaseFamily('vendor').versioning).toBe('per-package')
  })

  it('rewrites synchronized ranges and gates a stale ClawDSH profile', () => {
    const root = mkdtempSync(join(tmpdir(), 'clawdsh-release-profile-'))
    const profilePath = 'tools/openclaw-preset-openclaw/profile/package.json'
    const members = [
      { ...member('packages/openclaw/channel-core', '@clawdsh/dsh-channel-core'), version: '2.0.0' },
      { ...member('packages/openclaw/soul', '@clawdsh/dsh-soul'), version: '2.0.0' },
    ]
    try {
      mkdirSync(join(root, 'tools/openclaw-preset-openclaw/profile'), { recursive: true })
      writeFileSync(join(root, profilePath), `${JSON.stringify({
        dependencies: {
          '@clawdsh/dsh-channel-core': '^1.9.0',
          '@clawdsh/dsh-soul': '^2.0.0',
        },
      }, undefined, 2)}\n`)

      const clawdsh = releaseFamily('clawdsh')
      expect(() => { clawdsh.verifySynchronizedDependencyRanges(root, members) })
        .toThrow(/channel-core is \^1\.9\.0, expected \^2\.0\.0/)

      const planned = clawdsh.planSynchronizedDependencyRanges(root, members, '2.1.0')
      writeDependencyRanges(root, planned)
      const rewritten = JSON.parse(readFileSync(join(root, profilePath), 'utf8')) as {
        dependencies: Record<string, string>
      }
      expect(rewritten.dependencies).toEqual({
        '@clawdsh/dsh-channel-core': '^2.1.0',
        '@clawdsh/dsh-soul': '^2.1.0',
      })
      const advanced = members.map(entry => ({ ...entry, version: '2.1.0' }))
      expect(() => { clawdsh.verifySynchronizedDependencyRanges(root, advanced) }).not.toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('accepts independent vendored versions and rejects an unpublishable one', () => {
    const vendor = releaseFamily('vendor')
    const members = [
      { ...member('vendor/cordis', '@deepseek-ai/cordis'), version: '4.0.1' },
      { ...member('vendor/cosmokit', '@deepseek-ai/cosmokit'), version: '1.8.2' },
    ]

    expect(() => { vendor.verifyVersions(members) }).not.toThrow()
    expect(() => { vendor.verifyVersions([{ ...members[0]!, version: 'latest' }]) }).toThrow(/unpublishable version/)
  })

  it('publishes a dependency before its consumer, and orders ties by name', () => {
    const dsh = releaseFamily('dsh')
    const members = [
      member('packages/a/consumer', '@deepseek-ai/dsh-consumer', { dependencies: { '@deepseek-ai/dsh-library': 'workspace:^' } }),
      member('packages/a/library', '@deepseek-ai/dsh-library'),
      member('packages/a/zebra', '@deepseek-ai/dsh-zebra'),
    ]

    expect(dsh.publishOrder(members).map(entry => entry.name)).toEqual([
      '@deepseek-ai/dsh-library',
      '@deepseek-ai/dsh-consumer',
      '@deepseek-ai/dsh-zebra',
    ])
  })

  it('reports a runtime dependency cycle instead of emitting an arbitrary order', () => {
    const dsh = releaseFamily('dsh')
    const members = [
      member('packages/a/left', '@deepseek-ai/dsh-left', { dependencies: { '@deepseek-ai/dsh-right': 'workspace:^' } }),
      member('packages/a/right', '@deepseek-ai/dsh-right', { dependencies: { '@deepseek-ai/dsh-left': 'workspace:^' } }),
    ]

    expect(() => { dsh.publishOrder(members) }).toThrow(/dependency cycle/)
  })

  it('applies the harness payload policy to dsh and ClawDSH but keeps upstream vendor payloads', () => {
    const dsh = releaseFamily('dsh')
    const clawdsh = releaseFamily('clawdsh')
    const vendor = releaseFamily('vendor')
    const harness = member('packages/a/library', '@deepseek-ai/dsh-library')
    const channel = member('packages/openclaw/channel-core', '@clawdsh/dsh-channel-core')
    const vendored = member('vendor/cordis', '@deepseek-ai/cordis')

    expect(() => { dsh.validatePayload(harness, ['package/lib/index.js', 'package/src/index.ts']) })
      .toThrow(/publishes source file/)
    expect(() => { clawdsh.validatePayload(channel, ['package/lib/index.js', 'package/src/index.ts']) })
      .toThrow(/publishes source file/)
    expect(() => { vendor.validatePayload(vendored, ['package/lib/index.js', 'package/src/index.ts']) }).not.toThrow()
    expect(() => { vendor.validatePayload(vendored, []) }).toThrow(/empty tarball/)
  })

  it('requires every ClawDSH export target to resolve from the packed payload', () => {
    const clawdsh = releaseFamily('clawdsh')
    const payload = [
      'package/package.json',
      'package/lib/index.js',
      'package/lib/invariant.js',
      'package/lib/types/index.d.ts',
      'package/lib/types/invariant.d.ts',
    ]
    const manifest = {
      exports: {
        '.': {
          types: './lib/types/index.d.ts',
          default: './lib/index.js',
        },
        './invariant': {
          types: './lib/types/invariant.d.ts',
          default: './lib/invariant.js',
        },
        './package.json': './package.json',
      },
    }
    const channel = member('packages/openclaw/channel-core', '@clawdsh/dsh-channel-core', manifest)

    expect(() => { clawdsh.validatePayload(channel, payload) }).not.toThrow()

    const sourceExport = member(channel.directory, channel.name, {
      exports: { ...manifest.exports, './src/*': './src/*' },
    })
    expect(() => { clawdsh.validatePayload(sourceExport, payload) })
      .toThrow(/exports\["\.\/src\/\*"\] target "\.\/src\/\*" is absent from the packed tarball/)

    expect(() => { clawdsh.validatePayload(channel, payload.filter(file => file !== 'package/lib/types/index.d.ts')) })
      .toThrow(/exports\["\."\]\["types"\] target "\.\/lib\/types\/index\.d\.ts" is absent/)

    expect(() => { clawdsh.validatePayload(channel, [...payload, 'package/lib/types/stale.d.ts']) })
      .toThrow(/packed stale declaration package\/lib\/types\/stale\.d\.ts: no current source src\/stale\.ts or src\/stale\.tsx/)
  })

  it('drives the installed entry only for the family that publishes one', () => {
    expect(releaseFamily('dsh').installedEntry).toEqual({ packageName: '@deepseek-ai/dsh', binPath: 'lib/bin.js' })
    expect(releaseFamily('clawdsh').installedEntry).toBeUndefined()
    expect(releaseFamily('clawdsh').installedImportSubpaths).toEqual(['', '/invariant'])
    expect(releaseFamily('vendor').installedEntry).toBeUndefined()
  })

  it('rejects an unknown family identifier', () => {
    expect(() => { releaseFamily('native') }).toThrow(/unknown release family/)
  })
})

describe('vendored version baseline', () => {
  it('drops an upstream prerelease segment and increments the patch', () => {
    expect(nextVendorVersion('4.0.0-rc.7', undefined)).toBe('4.0.1')
    expect(nextVendorVersion('1.0.0-rc.5', undefined)).toBe('1.0.1')
    expect(nextVendorVersion('1.8.1', undefined)).toBe('1.8.2')
  })

  it('increments from the last published version when a re-sync restored a lower one', () => {
    // Upstream moved rc.7 -> rc.8 after this repository published 4.0.1;
    // incrementing the manifest alone would name 4.0.1 a second time.
    expect(nextVendorVersion('4.0.0-rc.8', '4.0.1')).toBe('4.0.2')
    expect(nextVendorVersion('4.1.0', '4.0.1')).toBe('4.1.1')
  })

  it('appends a rehearsal prerelease without consuming its release numbers', () => {
    // A rehearsal burns 4.0.1-rc.1 and leaves 4.0.1 free, so the stable release
    // that follows takes those same numbers instead of skipping to 4.0.2.
    expect(nextVendorVersion('4.0.0-rc.7', undefined, 'rc.1')).toBe('4.0.1-rc.1')
    expect(nextVendorVersion('4.0.0-rc.7', '4.0.1-rc.1', 'rc.2')).toBe('4.0.1-rc.2')
    expect(nextVendorVersion('4.0.0-rc.7', '4.0.1-rc.1')).toBe('4.0.1')
    expect(nextVendorVersion('4.0.0-rc.7', '4.0.1')).toBe('4.0.2')
  })
})

describe('version precedence', () => {
  it('ranks a release above the prerelease it follows', () => {
    // git --sort=v:refname disagrees, placing 4.0.1-rc.1 above 4.0.1, which is
    // why the newest published version is chosen here rather than by git.
    expect(compareVersions('4.0.1', '4.0.1-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('4.0.1-rc.1', '4.0.1')).toBeLessThan(0)
  })

  it('compares numeric prerelease fields numerically', () => {
    expect(compareVersions('4.0.1-rc.10', '4.0.1-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('4.0.1-rc.2', '4.0.1-rc.10')).toBeLessThan(0)
  })

  it('ranks a numeric field below an alphanumeric one, and a shorter list below a longer', () => {
    expect(compareVersions('4.0.1-1', '4.0.1-alpha')).toBeLessThan(0)
    expect(compareVersions('4.0.1-rc', '4.0.1-rc.1')).toBeLessThan(0)
    expect(compareVersions('4.0.2', '4.0.1')).toBeGreaterThan(0)
    expect(compareVersions('4.0.1-rc.1', '4.0.1-rc.1')).toBe(0)
  })
})

describe('payload change judgement', () => {
  const sourceShipping = member('vendor/cosmokit', '@deepseek-ai/cosmokit', {
    files: ['lib/index.js', 'lib/types/**/*.d.ts', 'src'],
  })
  const buildOutputOnly = member('vendor/cordis', '@deepseek-ai/cordis', {
    files: ['lib/index.js', 'lib/types/**/*.d.ts', 'bin.js'],
  })

  it('counts the manifest and the files npm always publishes', () => {
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/package.json')).toBe(true)
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/README.md')).toBe(true)
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/src/index.ts')).toBe(true)
  })

  it('counts build inputs for a package whose payload is build output', () => {
    // cordis publishes lib/ only, and lib/ is not tracked: without this, a real
    // source change reads as "nothing changed" and the next publish fails on a
    // version whose bytes moved.
    expect(reachesPayload(buildOutputOnly, 'vendor/cordis/src/context.ts')).toBe(true)
    expect(reachesPayload(buildOutputOnly, 'vendor/cordis/tsconfig.json')).toBe(true)
  })

  it('ignores paths no tarball carries', () => {
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/tests/unit.spec.ts')).toBe(false)
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/CHANGELOG.md')).toBe(false)
    // The README pattern is deliberately loose: over-reporting a change costs one
    // unnecessary patch bump, while under-reporting fails the next publish on a
    // version whose bytes moved.
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/README.i18n.yaml')).toBe(true)
    expect(reachesPayload(member('packages/a/library', '@deepseek-ai/dsh-library', { files: ['lib/index.js'] }),
      'packages/a/library/tests/library.spec.ts')).toBe(false)
  })
})
