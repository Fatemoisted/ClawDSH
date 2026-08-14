/** Installed-consumer probes for packed release families. */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { releaseFamily, tarballName, type ReleaseMember } from './families.ts'
import {
  installedImportSpecifiers,
  PACKED_INSTALL_NPM_ARGS,
  verifyPackedInstall,
} from './verify-packed-install.ts'

const repositoryRoot = resolve(import.meta.dirname, '../..')

/** Build a dependency-free npm tarball exposing the two ClawDSH entry points. */
function writeLibraryTarball(root: string, packed: string, member: ReleaseMember): void {
  const staging = join(root, member.name.replaceAll('/', '-'))
  const packageRoot = join(staging, 'package')
  mkdirSync(join(packageRoot, 'lib'), { recursive: true })
  writeFileSync(join(packageRoot, 'package.json'), `${JSON.stringify({
    name: member.name,
    version: member.version,
    type: 'module',
    main: 'lib/index.js',
    exports: {
      '.': './lib/index.js',
      './invariant': './lib/invariant.js',
    },
  }, null, 2)}\n`)
  const credentialGuard = `
const forbidden = ['NODE_AUTH_TOKEN', 'NPM_TOKEN', 'NPM_AUTH_TOKEN', 'YARN_NPM_AUTH_TOKEN',
  'GITHUB_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN'].find((key) => process.env[key] !== undefined)
if (forbidden !== undefined) throw new Error('probe inherited credential: ' + forbidden)
`
  writeFileSync(
    join(packageRoot, 'lib/index.js'),
    `${credentialGuard}export const packageName = ${JSON.stringify(member.name)}\n`,
  )
  writeFileSync(join(packageRoot, 'lib/invariant.js'), `${credentialGuard}export const invariant = true\n`)
  execFileSync('tar', ['-czf', join(packed, tarballName(member)), '-C', staging, 'package'])
}

describe('packed ClawDSH install verification', () => {
  it('keeps the payload probe independent of optional native builds', () => {
    expect(PACKED_INSTALL_NPM_ARGS).toContain('--omit=optional')
    expect(PACKED_INSTALL_NPM_ARGS).toContain('--ignore-scripts')
  })

  it('plans both the main and invariant import for every member', () => {
    const family = releaseFamily('clawdsh')
    const members = family.members(repositoryRoot)
    const specifiers = installedImportSpecifiers(family, members)

    expect(specifiers).toHaveLength(members.length * 2)
    for (const member of members) {
      expect(specifiers).toContain(member.name)
      expect(specifiers).toContain(`${member.name}/invariant`)
    }
  })

  it('installs the complete tarball set before importing every public runtime surface', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'clawdsh-packed-probe-'))
    const packed = join(scratch, 'packed')
    mkdirSync(packed)
    try {
      const members = releaseFamily('clawdsh').members(repositoryRoot)
      for (const member of members) writeLibraryTarball(scratch, packed, member)
      const credentialKeys = [
        'NODE_AUTH_TOKEN', 'NPM_TOKEN', 'NPM_AUTH_TOKEN', 'YARN_NPM_AUTH_TOKEN',
        'GITHUB_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
      ] as const
      const previous = new Map(credentialKeys.map(key => [key, process.env[key]]))
      try {
        for (const key of credentialKeys) process.env[key] = `fixture-${key.toLowerCase()}`
        expect(() => { verifyPackedInstall('clawdsh', [packed], repositoryRoot) }).not.toThrow()
      } finally {
        for (const key of credentialKeys) {
          const value = previous.get(key)
          if (value === undefined) Reflect.deleteProperty(process.env, key)
          else process.env[key] = value
        }
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  }, 30_000)
})
