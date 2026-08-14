/** Installed-consumer probes for packed release families. */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { releaseFamily, tarballName, type ReleaseMember } from './families.ts'
import { installedImportSpecifiers, verifyPackedInstall } from './verify-packed-install.ts'

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
  writeFileSync(join(packageRoot, 'lib/index.js'), `export const packageName = ${JSON.stringify(member.name)}\n`)
  writeFileSync(join(packageRoot, 'lib/invariant.js'), 'export const invariant = true\n')
  execFileSync('tar', ['-czf', join(packed, tarballName(member)), '-C', staging, 'package'])
}

describe('packed ClawDSH install verification', () => {
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

      expect(() => { verifyPackedInstall('clawdsh', [packed], repositoryRoot) }).not.toThrow()
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  }, 30_000)
})
