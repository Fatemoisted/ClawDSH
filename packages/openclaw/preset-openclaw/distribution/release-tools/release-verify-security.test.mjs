import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { verifyPackageTarball } from './release-verify.mjs'

function packageArchive(manifest, files) {
  const temporary = mkdtempSync(join(tmpdir(), 'clawdsh-release-verify-'))
  const packageRoot = join(temporary, 'root/package')
  mkdirSync(packageRoot, { recursive: true })
  writeFileSync(join(packageRoot, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  for (const [path, contents] of Object.entries(files)) {
    const target = join(packageRoot, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, contents)
  }
  const archive = join(temporary, 'package.tgz')
  execFileSync('tar', ['-czf', archive, '-C', join(temporary, 'root'), 'package'], {
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  })
  return { archive, cleanup: () => rmSync(temporary, { recursive: true }) }
}

test('tarball verification scans private-registry URLs in text files larger than four MiB', () => {
  const fixture = packageArchive({
    name: '@clawdsh/dsh-activity',
    version: '0.1.0-rc.1',
    license: 'MIT',
    publishConfig: { access: 'public' },
    files: ['lib/index.js'],
  }, {
    'lib/index.js': `${'a'.repeat(4 * 1024 * 1024 + 1)}\nhttps://registry.private.invalid/package.tgz\n`,
  })
  try {
    assert.throws(
      () => verifyPackageTarball(fixture.archive, '@clawdsh/dsh-activity'),
      /private registry URL/,
    )
  } finally {
    fixture.cleanup()
  }
})

test('tarball verification does not let a NUL byte suppress registry and URL-credential scans', () => {
  const manifest = {
    name: '@clawdsh/dsh-activity',
    version: '0.1.0-rc.1',
    license: 'MIT',
    publishConfig: { access: 'public' },
    files: ['lib/index.js'],
  }
  for (const leakedUrl of [
    'https://registry.private.invalid/package.tgz',
    'https://username:password@registry.npmjs.org/package.tgz',
  ]) {
    const fixture = packageArchive(manifest, {
      'lib/index.js': Buffer.from(`export {}\n\0${leakedUrl}\n`),
    })
    try {
      assert.throws(
        () => verifyPackageTarball(fixture.archive, '@clawdsh/dsh-activity'),
        /private registry URL|credentials in a URL/,
      )
    } finally {
      fixture.cleanup()
    }
  }
})

test('OpenClaw Provider tarball rejects Canary and development bridge payload declarations', () => {
  const fixture = packageArchive({
    name: '@clawdsh/dsh-channel-openclaw',
    version: '0.1.0-rc.1',
    license: 'MIT',
    publishConfig: { access: 'public' },
    files: ['lib/index.js', 'bridge/**'],
  }, {
    'lib/index.js': 'export {}\n',
    'bridge/canary-v2/index.js': 'export {}\n',
  })
  try {
    assert.throws(
      () => verifyPackageTarball(fixture.archive, '@clawdsh/dsh-channel-openclaw'),
      /only the production bridge and runtime locks/,
    )
  } finally {
    fixture.cleanup()
  }
})

test('OpenClaw Provider tarball requires separate product and third-party license files', () => {
  const fixture = packageArchive({
    name: '@clawdsh/dsh-channel-openclaw',
    version: '0.1.0-rc.1',
    license: 'MIT',
    publishConfig: { access: 'public' },
    main: 'lib/index.js',
    files: ['lib/index.js', 'bridge/stable-v1/**', 'bridge/shared/**', 'runtime/package.json', 'runtime/package-lock.json'],
  }, {
    'lib/index.js': 'export {}\n',
    'bridge/stable-v1/index.js': 'export {}\n',
    'bridge/shared/protocol-v1.js': 'export const version = 1\n',
    'runtime/package.json': '{}\n',
    'runtime/package-lock.json': '{}\n',
  })
  try {
    assert.throws(
      () => verifyPackageTarball(fixture.archive, '@clawdsh/dsh-channel-openclaw'),
      /primary MIT LICENSE/,
    )
  } finally {
    fixture.cleanup()
  }
})
