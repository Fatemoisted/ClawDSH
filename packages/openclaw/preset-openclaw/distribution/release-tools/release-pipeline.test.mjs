import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import {
  PUBLIC_NPM_REGISTRY,
  RELEASE_PACKAGE_NAMES,
  RELEASE_VERSION,
  parseReleaseOrder,
} from './release-contract.mjs'
import { createReleaseFixture, packedRelease } from './release-fixture.mjs'
import { publishRelease } from './publish-release.mjs'
import {
  verifyPackageTarball,
  verifyReleaseIndex,
  verifySourcePackageSet,
} from './release-verify.mjs'

test('packs exactly 13 real tarballs and verifies their topological release index', () => {
  const fixture = createReleaseFixture()
  try {
    const directory = packedRelease(fixture)
    const index = verifyReleaseIndex(directory)
    assert.equal(index.packages.length, 13)
    assert.deepEqual(index.packages.map(entry => entry.name), RELEASE_PACKAGE_NAMES)
    assert.ok(index.packages.every(entry => entry.version === RELEASE_VERSION))
  } finally {
    fixture.cleanup()
  }
})

test('source discovery rejects missing, extra, duplicate, and misplaced public packages', () => {
  const fixture = createReleaseFixture()
  try {
    verifySourcePackageSet(fixture.repository)
    const extra = join(fixture.repository, 'packages/openclaw/unreviewed/package.json')
    mkdirSync(dirname(extra), { recursive: true })
    writeFileSync(extra, JSON.stringify({ name: '@clawdsh/unreviewed', version: RELEASE_VERSION }))
    assert.throws(() => verifySourcePackageSet(fixture.repository), /unexpected public package/)
    rmSync(dirname(extra), { recursive: true })

    const cli = join(fixture.repository, 'packages/openclaw/preset-openclaw/distribution/cli/package.json')
    const manifest = JSON.parse(readFileSync(cli, 'utf8'))
    manifest.private = true
    writeFileSync(cli, JSON.stringify(manifest))
    assert.throws(() => verifySourcePackageSet(fixture.repository), /missing public package @clawdsh\/cli/)
  } finally {
    fixture.cleanup()
  }
})

test('tarball verifier rejects a symbolic link before reading publication data', {
  skip: process.platform === 'win32',
}, () => {
  const fixture = createReleaseFixture()
  try {
    const archiveRoot = join(fixture.temporary, 'malicious')
    const packageRoot = join(archiveRoot, 'package')
    mkdirSync(join(packageRoot, 'lib'), { recursive: true })
    writeFileSync(join(packageRoot, 'package.json'), '{}')
    writeFileSync(join(packageRoot, 'lib/target.js'), 'safe\n')
    symlinkSync('target.js', join(packageRoot, 'lib/link.js'))
    const archive = join(fixture.temporary, 'malicious.tgz')
    execFileSync('tar', ['-czf', archive, '-C', archiveRoot, 'package'], {
      env: { ...process.env, COPYFILE_DISABLE: '1' },
    })
    assert.throws(
      () => verifyPackageTarball(archive, '@clawdsh/dsh-activity'),
      /forbidden entry type/,
    )
  } finally {
    fixture.cleanup()
  }
})

test('tarball verifier rejects local protocols, private registries, and undeclared payloads', () => {
  const fixture = createReleaseFixture()
  try {
    const packageRoot = join(fixture.repository, 'packages/openclaw/activity')
    const manifestPath = join(packageRoot, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.dependencies = { local: 'workspace:0.1.0', remote: 'https://registry.example.internal/x.tgz' }
    writeFileSync(manifestPath, JSON.stringify(manifest))
    const archive = join(fixture.temporary, 'clawdsh-dsh-activity-0.1.0-rc.1.tgz')
    execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', fixture.temporary], {
      cwd: packageRoot,
      env: { ...process.env, npm_config_cache: join(fixture.temporary, 'npm-cache') },
      stdio: 'pipe',
    })
    assert.throws(() => verifyPackageTarball(archive, '@clawdsh/dsh-activity'), /forbidden dependency specifier/)
    manifest.dependencies = { remote: 'https://registry.example.internal/x.tgz' }
    writeFileSync(manifestPath, JSON.stringify(manifest))
    rmSync(archive)
    execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', fixture.temporary], {
      cwd: packageRoot,
      env: { ...process.env, npm_config_cache: join(fixture.temporary, 'npm-cache') },
      stdio: 'pipe',
    })
    assert.throws(() => verifyPackageTarball(archive, '@clawdsh/dsh-activity'), /private registry URL/)

    delete manifest.dependencies
    manifest.publishConfig.tag = 'latest'
    writeFileSync(manifestPath, JSON.stringify(manifest))
    rmSync(archive)
    execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', fixture.temporary], {
      cwd: packageRoot,
      env: { ...process.env, npm_config_cache: join(fixture.temporary, 'npm-cache') },
      stdio: 'pipe',
    })
    assert.throws(() => verifyPackageTarball(archive, '@clawdsh/dsh-activity'), /exactly public access/)

    delete manifest.publishConfig.tag
    manifest.files = ['lib/index.js', 'lib/index.d.ts']
    writeFileSync(manifestPath, JSON.stringify(manifest))
    writeFileSync(join(packageRoot, 'undeclared.txt'), 'must not ship\n')
    const rawRoot = join(fixture.temporary, 'raw')
    mkdirSync(rawRoot)
    cpSync(packageRoot, join(rawRoot, 'package'), { recursive: true })
    const rawArchive = join(fixture.temporary, 'undeclared.tgz')
    execFileSync('tar', ['-czf', rawArchive, '-C', rawRoot, 'package'], {
      env: { ...process.env, COPYFILE_DISABLE: '1' },
    })
    assert.throws(() => verifyPackageTarball(rawArchive, '@clawdsh/dsh-activity'), /undeclared file/)
  } finally {
    fixture.cleanup()
  }
})

test('publisher accepts only canonical order and public-provenance or loopback-test modes', () => {
  const fixture = createReleaseFixture()
  try {
    const directory = packedRelease(fixture)
    const calls = []
    publishRelease({
      directory,
      registry: 'http://127.0.0.1:4873/',
      order: RELEASE_PACKAGE_NAMES.join(','),
      allowLoopback: true,
      publish: value => calls.push(value),
    })
    assert.deepEqual(calls.map(call => call.name), RELEASE_PACKAGE_NAMES)
    assert.ok(calls.every(call => (
      call.registry === 'http://127.0.0.1:4873/'
        && call.provenance === false
        && call.tag === 'next'
    )))
    assert.throws(() => publishRelease({
      directory,
      registry: PUBLIC_NPM_REGISTRY,
      order: RELEASE_PACKAGE_NAMES.join(','),
      publish() {},
    }), /requires provenance/)
    assert.throws(() => parseReleaseOrder([...RELEASE_PACKAGE_NAMES].reverse().join(',')), /release order/)
  } finally {
    fixture.cleanup()
  }
})
