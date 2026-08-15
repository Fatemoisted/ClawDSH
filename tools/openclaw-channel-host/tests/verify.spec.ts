import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type ArtifactSet, validateArtifactSet } from '../schema.ts'
import { summarizeHostTree, verifyHostTree } from '../tree.ts'
import { checkArtifacts, loadArtifactSet, parseArguments } from '../verify.ts'

const temporaryRoots: string[] = []

const ARTIFACT_FILES = {
  productionLock: 'host.production.json',
  canaryLock: 'host.canary.json',
  productionCatalog: 'channels.production.json',
  canaryCatalog: 'channels.canary.json',
  productionSupport: 'support.production.json',
  canarySupport: 'support.canary.json',
  productionGovernance: 'governance.production.json',
  canaryGovernance: 'governance.canary.json',
} as const satisfies Record<keyof ArtifactSet, string>

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true })
})

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  temporaryRoots.push(root)
  return root
}

function validArtifacts(): ArtifactSet {
  const rawArtifacts = structuredClone(loadArtifactSet())
  const errors = validateArtifactSet(rawArtifacts)
  if (errors.length > 0) throw new Error(errors.join('\n'))
  return rawArtifacts as ArtifactSet
}

function writeArtifactSet(artifactDirectory: string, artifacts: ArtifactSet): void {
  mkdirSync(artifactDirectory, { recursive: true })
  for (const [key, filename] of Object.entries(ARTIFACT_FILES) as Array<
    [keyof ArtifactSet, string]
  >) {
    writeFileSync(join(artifactDirectory, filename), `${JSON.stringify(artifacts[key], null, 2)}\n`)
  }
}

function fixtureTree(): string {
  const root = temporaryRoot('openclaw-channel-host-')
  mkdirSync(join(root, 'nested'))
  writeFileSync(join(root, 'a.txt'), 'x')
  writeFileSync(join(root, 'nested', 'b.bin'), Buffer.from([0, 1, 2]))
  return root
}

describe('channel-host artifact verifier', () => {
  it('accepts the pinned production and canary artifact set', () => {
    expect(checkArtifacts()).toEqual([])

    const artifacts = validArtifacts()
    expect(artifacts.productionCatalog.channels).toHaveLength(27)
    expect(artifacts.canaryCatalog.channels).toHaveLength(31)
    expect(artifacts.productionSupport.channels).toHaveLength(27)
    expect(artifacts.canarySupport.channels).toHaveLength(31)
    expect(artifacts.productionGovernance.channels).toHaveLength(3)
    expect(artifacts.canaryGovernance.channels).toHaveLength(5)
    expect(
      Object.fromEntries(
        ['core', 'bundled', 'repo-official', 'external'].map(status => [
          status,
          artifacts.productionCatalog.channels.filter(channel => channel.status === status).length,
        ]),
      ),
    ).toEqual({ core: 1, bundled: 2, 'repo-official': 21, external: 3 })
    expect(artifacts.productionCatalog.channels.find(channel => channel.id === 'qqbot')?.status).toBe(
      'repo-official',
    )
    expect(artifacts.productionLock).toMatchObject({
      source: {
        ref: 'v2026.7.1-2',
        commit: '0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c',
      },
      npm: {
        version: '2026.7.1-2',
        integrity: 'sha512-ycF3yPcbjN6bUPeaUx6Mh6vze1hQWoD3CT/wWcmD7a8xaHHHRUaAlaq+lFxMHf1ssEgODVAwjlzYqp2twkYZ7g==',
      },
      tree: {
        fileCount: 8550,
        integrity: 'sha512-t7hGQR0QkaIGfP6WS5OV1EOq4KZK6dcHB7nu0B7E6UlxS4UdtuFT6f+E2akFVAii6xjHndlEANWSk9OaZI4Niw==',
      },
    })
    expect(artifacts.canaryLock.source).toMatchObject({
      commit: 'f1ced37ce5df8c7bc7f3b46c579e5ce181feaae0',
      observedAt: '2026-08-15T08:18:37Z',
      archive: {
        url: 'https://github.com/openclaw/openclaw/archive/f1ced37ce5df8c7bc7f3b46c579e5ce181feaae0.tar.gz',
        byteLength: 100754581,
        integrity: 'sha512-PEjiTam3vygesQ22Pr0DF51CEqF6d9eCaxhzHxgyOkwKAIWJgoJO1ooskLPMakolKmP6J797QkG5aIyM4B/hRQ==',
      },
    })
    expect(new Set(artifacts.productionSupport.channels.map(channel => channel.status))).toEqual(
      new Set(['cataloged']),
    )
    expect(new Set(artifacts.canarySupport.channels.map(channel => channel.status))).toEqual(
      new Set(['cataloged']),
    )
    expect(
      artifacts.productionSupport.channels
        .filter(channel => channel.optIn)
        .map(channel => channel.id),
    ).toEqual(['wechat', 'yuanbao', 'zaloclawbot'])
    expect(
      artifacts.canarySupport.channels
        .filter(channel => channel.optIn)
        .map(channel => channel.id),
    ).toEqual(['qqbot', 'wechat', 'wecom', 'yuanbao', 'zaloclawbot'])
    expect(
      [...artifacts.productionSupport.channels, ...artifacts.canarySupport.channels].every(
        channel => channel.installability === null
          && channel.certifications.length === 0
          && channel.enablements.length === 0,
      ),
    ).toBe(true)
    expect(
      [...artifacts.productionGovernance.channels, ...artifacts.canaryGovernance.channels].every(
        channel => channel.license.status === 'pending-review'
          && channel.platformTerms.status === 'pending-review'
          && channel.security.status === 'pending-review',
      ),
    ).toBe(true)
    expect(
      artifacts.canaryGovernance.channels.find(channel => channel.id === 'qqbot')?.license.declaredSpdx,
    ).toBeNull()
  })

  it('rejects replacing the approved canary observation with a moving main head', () => {
    const artifacts = validArtifacts()
    const movingMain = '447393dc3221e14f63dc9b3818ddd04051553936'
    artifacts.canaryLock.source.commit = movingMain
    artifacts.canaryCatalog.hostCommit = movingMain

    expect(validateArtifactSet(artifacts)).toEqual(
      expect.arrayContaining([expect.stringContaining('canaryLock.commit: expected approved value')]),
    )
  })

  it('rejects duplicate channel ids', () => {
    const artifacts = validArtifacts()
    artifacts.canaryCatalog.channels.push(structuredClone(artifacts.canaryCatalog.channels[0]!))

    expect(validateArtifactSet(artifacts)).toEqual(
      expect.arrayContaining([expect.stringContaining('duplicate id')]),
    )
  })

  it('rejects host version disagreement', () => {
    const artifacts = validArtifacts()
    artifacts.productionLock.source.manifestVersion = '2026.7.2'

    expect(validateArtifactSet(artifacts)).toEqual(
      expect.arrayContaining([expect.stringContaining('base version must match source manifestVersion')]),
    )
  })

  it('rejects a canary status that moves inward from production', () => {
    const artifacts = validArtifacts()
    const imessage = artifacts.canaryCatalog.channels.find(channel => channel.id === 'imessage')!
    imessage.status = 'core'

    expect(validateArtifactSet(artifacts)).toEqual(
      expect.arrayContaining([expect.stringContaining('status monotonicity: imessage')]),
    )
  })

  it('rejects a non-canonical SHA-512 SRI', () => {
    const artifacts = validArtifacts()
    artifacts.productionLock.npm.integrity = 'sha512-not-base64'

    expect(validateArtifactSet(artifacts)).toEqual(
      expect.arrayContaining([expect.stringContaining('expected canonical sha512 SRI')]),
    )
  })

  it('enforces fixed production and canary counts', () => {
    const artifacts = validArtifacts()
    artifacts.productionCatalog.channels.pop()
    artifacts.productionCatalog.expectedCount = 26

    expect(validateArtifactSet(artifacts)).toEqual(
      expect.arrayContaining([
        'productionCatalog.expectedCount: expected 27',
        'productionCatalog.channels: expected 27 entries',
      ]),
    )
  })

  it('requires every production channel to remain in canary', () => {
    const artifacts = validArtifacts()
    artifacts.canaryCatalog.channels = artifacts.canaryCatalog.channels.filter(channel => channel.id !== 'discord')

    expect(validateArtifactSet(artifacts)).toEqual(
      expect.arrayContaining([expect.stringContaining('canary is missing production channel discord')]),
    )
  })

  it('rejects installable support without an exact host artifact', () => {
    const artifacts = validArtifacts()
    artifacts.canarySupport.channels[0]!.status = 'installable'

    expect(validateArtifactSet(artifacts)).toEqual(
      expect.arrayContaining([expect.stringContaining('installable requires exact install artifacts')]),
    )
  })

  it('rejects installable support without configuration, capability, and contract evidence', () => {
    const artifacts = validArtifacts()
    artifacts.productionSupport.channels[0]!.status = 'installable'

    expect(validateArtifactSet(artifacts)).toEqual(
      expect.arrayContaining([expect.stringContaining('installable requires assembly evidence')]),
    )
  })

  it('requires live and deployment evidence for promoted support levels', () => {
    const artifacts = validArtifacts()
    artifacts.productionSupport.channels[0]!.status = 'enabled'

    expect(validateArtifactSet(artifacts)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('enabled requires live smoke evidence'),
        expect.stringContaining('enabled requires deployment evidence'),
      ]),
    )
  })

  it('requires external channels, and only external channels, to remain opt-in', () => {
    const artifacts = validArtifacts()
    artifacts.productionSupport.channels.find(channel => channel.id === 'wechat')!.optIn = false
    artifacts.productionSupport.channels.find(channel => channel.id === 'telegram')!.optIn = true

    expect(validateArtifactSet(artifacts)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('expected true for external channel'),
        expect.stringContaining('expected false for bundled channel'),
      ]),
    )
  })

  it('requires exact external package identities in the governance catalog', () => {
    const artifacts = validArtifacts()
    artifacts.productionGovernance.channels[0]!.integrity =
      'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=='

    expect(validateArtifactSet(artifacts)).toEqual(
      expect.arrayContaining([expect.stringContaining('must match channel npm evidence')]),
    )
  })

  it.each(['', 'https://', 'https:///missing-host', 'http://example.com/evidence'])(
    'rejects malformed or non-HTTPS evidence reference %s',
    reference => {
      const artifacts = validArtifacts()
      artifacts.productionGovernance.channels[0]!.license.evidence = [reference]

      expect(validateArtifactSet(artifacts)).toEqual(
        expect.arrayContaining([
          expect.stringContaining('expected a valid HTTPS URL with a hostname'),
        ]),
      )
    },
  )

  it.each(['MIT OR', 'NOT A LICENSE', '()'])(
    'rejects invalid SPDX expression %s',
    declaredSpdx => {
      const artifacts = validArtifacts()
      artifacts.productionGovernance.channels[0]!.license.declaredSpdx = declaredSpdx

      expect(validateArtifactSet(artifacts)).toEqual(
        expect.arrayContaining([expect.stringContaining('expected an SPDX expression or null')]),
      )
    },
  )

  it('blocks external installability until every governance review is approved', () => {
    const artifacts = validArtifacts()
    const support = artifacts.productionSupport.channels.find(channel => channel.id === 'wechat')!
    support.status = 'installable'
    support.installability = {
      configuration: 'docs/channels/wechat.md',
      capabilityProbe: 'tests/wechat-capability.json',
      contractTest: 'tests/wechat-contract.json',
    }

    expect(validateArtifactSet(artifacts)).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'external installable requires approved license, platform-terms, and security reviews',
        ),
      ]),
    )
  })

  it('accepts repository evidence that resolves to ordinary files inside the repository root', () => {
    const repositoryRoot = temporaryRoot('openclaw-channel-evidence-valid-')
    const artifactDirectory = join(repositoryRoot, 'tools', 'openclaw-channel-host')
    for (const path of ['docs', 'evidence', 'tests']) mkdirSync(join(repositoryRoot, path))
    writeFileSync(join(repositoryRoot, 'docs', 'discord.md'), '# Discord\n')
    writeFileSync(join(repositoryRoot, 'evidence', 'discord-capability.json'), '{}\n')
    writeFileSync(join(repositoryRoot, 'tests', 'discord-contract.json'), '{}\n')

    const artifacts = validArtifacts()
    const discord = artifacts.productionSupport.channels.find(channel => channel.id === 'discord')!
    discord.status = 'installable'
    discord.installability = {
      configuration: 'docs/discord.md',
      capabilityProbe: 'evidence/discord-capability.json',
      contractTest: 'tests/discord-contract.json',
    }
    writeArtifactSet(artifactDirectory, artifacts)

    expect(checkArtifacts({ artifactDirectory, repoRoot: repositoryRoot })).toEqual([])
  })

  it('requires repository evidence to exist as an ordinary file without symlink escape', () => {
    const repositoryRoot = temporaryRoot('openclaw-channel-evidence-repo-')
    const outsideRoot = temporaryRoot('openclaw-channel-evidence-outside-')
    const artifactDirectory = join(repositoryRoot, 'tools', 'openclaw-channel-host')
    mkdirSync(join(repositoryRoot, 'docs'), { recursive: true })
    mkdirSync(join(repositoryRoot, 'evidence-directory'))
    writeFileSync(join(outsideRoot, 'contract.json'), '{}\n')
    symlinkSync(
      outsideRoot,
      join(repositoryRoot, 'outside-link'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )

    const artifacts = validArtifacts()
    const discord = artifacts.productionSupport.channels.find(channel => channel.id === 'discord')!
    discord.status = 'installable'
    discord.installability = {
      configuration: 'docs/missing.md',
      capabilityProbe: 'evidence-directory',
      contractTest: 'outside-link/contract.json',
    }
    writeArtifactSet(artifactDirectory, artifacts)

    expect(checkArtifacts({ artifactDirectory, repoRoot: repositoryRoot })).toEqual(
      expect.arrayContaining([
        expect.stringContaining('repository evidence file is unavailable'),
        expect.stringContaining('repository evidence must be an ordinary file'),
        expect.stringContaining('repository evidence resolves outside the repository root'),
      ]),
    )
  })
})

describe('host tree verifier', () => {
  it('uses the path, byte length, and raw file SHA-512 record algorithm', () => {
    expect(summarizeHostTree(fixtureTree())).toEqual({
      algorithm: 'sha512-path-size-content-v1',
      fileCount: 2,
      integrity: 'sha512-yaxJkOovEl6AQ/6yNPsx1VJSJOUl5qvFRChlX+ui9VnO2OQCkLG1TljLqHcoHtGGbCxzs7RSTrXbeIeIB8WVQg==',
    })
  })

  it('excludes the installed dependency tree owned by the runtime assembly lock', () => {
    const root = fixtureTree()
    mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true })
    writeFileSync(join(root, 'node_modules', 'dependency.js'), 'dependency')
    if (process.platform !== 'win32') {
      symlinkSync(
        join(root, 'node_modules', 'dependency.js'),
        join(root, 'node_modules', '.bin', 'dependency'),
        'file',
      )
    }

    expect(summarizeHostTree(root)).toEqual({
      algorithm: 'sha512-path-size-content-v1',
      fileCount: 2,
      integrity: 'sha512-yaxJkOovEl6AQ/6yNPsx1VJSJOUl5qvFRChlX+ui9VnO2OQCkLG1TljLqHcoHtGGbCxzs7RSTrXbeIeIB8WVQg==',
    })
  })

  it('reports tree count and integrity mismatches', () => {
    expect(
      verifyHostTree(fixtureTree(), {
        algorithm: 'sha512-path-size-content-v1',
        fileCount: 3,
        integrity: 'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
      }),
    ).toEqual([
      'host tree fileCount: expected 3, got 2',
      expect.stringContaining('host tree integrity:'),
    ])
  })

  it('rejects symbolic links instead of omitting them from the digest', () => {
    const root = fixtureTree()
    symlinkSync(
      join(root, 'nested'),
      join(root, 'nested-link'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )

    expect(() => summarizeHostTree(root)).toThrow('host tree contains non-ordinary entry')
  })

  it.runIf(process.platform !== 'win32')('rejects non-ordinary socket entries', async () => {
    const root = fixtureTree()
    const socketPath = join(root, 'host.sock')
    const server = createServer()
    await new Promise<void>((resolve, reject) => {
      const rejectListen = (error: Error): void => reject(error)
      server.once('error', rejectListen)
      server.listen(socketPath, () => {
        server.off('error', rejectListen)
        resolve()
      })
    })

    try {
      expect(() => summarizeHostTree(root)).toThrow('host tree contains non-ordinary entry')
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close(error => {
          if (error === undefined) resolve()
          else reject(error)
        })
      })
    }
  })
})

describe('offline CLI arguments', () => {
  it('accepts a catalog-only check and an optional extracted host root', () => {
    expect(parseArguments(['--check'])).toEqual({})
    expect(parseArguments(['--host-root', '/tmp/package', '--check'])).toEqual({ hostRoot: '/tmp/package' })
    expect(parseArguments(['--repo-root', '/tmp/repository', '--check'])).toEqual({
      repoRoot: '/tmp/repository',
    })
  })

  it('rejects missing and unknown operations', () => {
    expect(() => parseArguments([])).toThrow('expected --check')
    expect(() => parseArguments(['--fetch'])).toThrow('unknown argument: --fetch')
    expect(() => parseArguments(['--check', '--host-root'])).toThrow('--host-root requires a path')
    expect(() => parseArguments(['--check', '--repo-root'])).toThrow('--repo-root requires a path')
  })
})
