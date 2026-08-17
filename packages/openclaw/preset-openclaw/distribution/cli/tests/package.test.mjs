import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { temporary } from './fixtures.mjs'

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))

test('packs a closed public CLI with exact runtime dependencies', () => {
  const scratch = temporary()
  try {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    assert.deepEqual(manifest.dependencies, {
      '@clawdsh/dsh-bundle': 'workspace:0.1.0-rc.1',
      '@deepseek-ai/dsh': '0.1.0-rc.6',
    })
    assert.deepEqual(manifest.bin, { clawdsh: 'lib/bin.mjs' })
    const tarball = join(scratch, 'clawdsh-cli.tgz')
    const packed = spawnSync('pnpm', ['pack', '--out', tarball], {
      cwd: PACKAGE_ROOT,
      encoding: 'utf8',
      env: { ...process.env, npm_config_ignore_scripts: 'true' },
    })
    assert.equal(packed.status, 0, packed.stderr)
    const listing = spawnSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
    assert.equal(listing.status, 0, listing.stderr)
    const files = listing.stdout.split('\n').filter(Boolean).map(path => path.replace(/^package\//, '')).sort()
    assert.ok(files.includes('README.md'))
    assert.ok(files.includes('LICENSE'))
    assert.ok(files.includes('lib/bin.mjs'))
    assert.ok(files.includes('lib/index.mjs'))
    assert.ok(files.includes('lib/source-migration.mjs'))
    assert.ok(files.includes('package.json'))
    assert.ok(files.every(path => !path.startsWith('tests/') && !path.endsWith('.map')))
    const packedManifest = spawnSync('tar', ['-xOzf', tarball, 'package/package.json'], { encoding: 'utf8' })
    assert.equal(packedManifest.status, 0, packedManifest.stderr)
    const publication = JSON.stringify({ manifest: JSON.parse(packedManifest.stdout), files })
    assert.deepEqual(JSON.parse(packedManifest.stdout).dependencies, {
      '@clawdsh/dsh-bundle': '0.1.0-rc.1',
      '@deepseek-ai/dsh': '0.1.0-rc.6',
    })
    assert.doesNotMatch(publication, /workspace:|file:|npm\.example|registry\.internal/)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})
