/** Exact-family artifact boundary for the npm publish step. */

import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { releaseFamily } from './families.ts'
import { verifyPackedFamilyArtifacts } from './publish.ts'
import { PUBLISH_ORDER_FILE } from './tarball.ts'

const PACKAGE_NAME = '@clawdsh/dsh-fixture'
const VERSION = '0.1.0'
const TARBALL = 'clawdsh-dsh-fixture-0.1.0.tgz'

interface Fixture {
  readonly root: string
  readonly packed: string
}

/** Build one minimal checkout plus a real npm-shaped tar archive. */
function fixture(identity: { name: string; version: string } = { name: PACKAGE_NAME, version: VERSION }): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'clawdsh-publish-boundary-'))
  const packageDir = join(root, 'packages/openclaw/fixture')
  const profileDir = join(root, 'tools/openclaw-preset-openclaw/profile')
  const stage = join(root, 'stage/package')
  const packed = join(root, 'packed')
  mkdirSync(join(stage, 'lib'), { recursive: true })
  mkdirSync(packageDir, { recursive: true })
  mkdirSync(profileDir, { recursive: true })
  mkdirSync(packed, { recursive: true })
  const manifest = {
    name: PACKAGE_NAME,
    version: VERSION,
    files: ['lib/index.js'],
    exports: { '.': './lib/index.js' },
  }
  writeFileSync(join(packageDir, 'package.json'), `${JSON.stringify(manifest)}\n`)
  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
    dependencies: { [PACKAGE_NAME]: `^${VERSION}` },
  })}\n`)
  writeFileSync(join(stage, 'package.json'), `${JSON.stringify({ ...manifest, ...identity })}\n`)
  writeFileSync(join(stage, 'lib/index.js'), 'export const fixture = true\n')
  execFileSync('tar', ['-czf', join(packed, TARBALL), '-C', join(root, 'stage'), 'package'])
  writeFileSync(join(packed, PUBLISH_ORDER_FILE), `${TARBALL}\n`)
  return { root, packed }
}

describe('release publish artifact boundary', () => {
  it('accepts the exact checkout-defined family artifact', () => {
    const subject = fixture()
    try {
      expect(verifyPackedFamilyArtifacts(releaseFamily('clawdsh'), subject.packed, subject.root)).toEqual([{
        filename: TARBALL,
        name: PACKAGE_NAME,
        version: VERSION,
      }])
    } finally {
      rmSync(subject.root, { recursive: true, force: true })
    }
  })

  it('rejects traversal, duplicates, missing members, and reordered order files', () => {
    const subject = fixture()
    try {
      writeFileSync(join(subject.packed, PUBLISH_ORDER_FILE), `../${TARBALL}\n${TARBALL}\n`)
      expect(() => verifyPackedFamilyArtifacts(releaseFamily('clawdsh'), subject.packed, subject.root))
        .toThrow(/artifact order does not exactly match/)
    } finally {
      rmSync(subject.root, { recursive: true, force: true })
    }
  })

  it('rejects an extra archive that is absent from the family', () => {
    const subject = fixture()
    try {
      copyFileSync(join(subject.packed, TARBALL), join(subject.packed, 'unexpected.tgz'))
      expect(() => verifyPackedFamilyArtifacts(releaseFamily('clawdsh'), subject.packed, subject.root))
        .toThrow(/tarball set does not exactly match/)
    } finally {
      rmSync(subject.root, { recursive: true, force: true })
    }
  })

  it('rejects a correctly named archive carrying another identity', () => {
    const subject = fixture({ name: '@clawdsh/dsh-impostor', version: VERSION })
    try {
      expect(() => verifyPackedFamilyArtifacts(releaseFamily('clawdsh'), subject.packed, subject.root))
        .toThrow(/declares @clawdsh\/dsh-impostor@0\.1\.0/)
    } finally {
      rmSync(subject.root, { recursive: true, force: true })
    }
  })
})
