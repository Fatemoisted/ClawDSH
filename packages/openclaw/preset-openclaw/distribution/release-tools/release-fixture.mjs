/** Hermetic package fixtures shared by release-tool tests. */

import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { RELEASE_PACKAGES, RELEASE_VERSION } from './release-contract.mjs'
import { packRelease } from './release-pack.mjs'

const INTERNAL_DEPENDENCIES = Object.freeze({
  '@clawdsh/dsh-automation': ['@clawdsh/dsh-activity'],
  '@clawdsh/dsh-skills-hub': ['@clawdsh/dsh-activity'],
  '@clawdsh/dsh-soul': ['@clawdsh/dsh-activity'],
  '@clawdsh/dsh-channel-agent': ['@clawdsh/dsh-activity', '@clawdsh/dsh-channel'],
  '@clawdsh/dsh-channel-openclaw': ['@clawdsh/dsh-channel'],
  '@clawdsh/dsh-embeddings-ark': ['@clawdsh/dsh-embeddings'],
  '@clawdsh/dsh-memory': ['@clawdsh/dsh-activity', '@clawdsh/dsh-embeddings'],
  '@clawdsh/dsh-preset-messaging-safe': ['@clawdsh/dsh-soul'],
})

function write(root, path, value, mode = 0o644) {
  const absolute = join(root, path)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, value, { mode })
  chmodSync(absolute, mode)
  return absolute
}

function packageManifest(name) {
  const dependencies = Object.fromEntries((INTERNAL_DEPENDENCIES[name] ?? []).map(value => [value, RELEASE_VERSION]))
  if (name === '@clawdsh/dsh-bundle') {
    for (const specification of RELEASE_PACKAGES.slice(0, 11)) dependencies[specification.name] = RELEASE_VERSION
  }
  if (name === '@clawdsh/cli') {
    dependencies['@clawdsh/dsh-bundle'] = RELEASE_VERSION
    dependencies['@deepseek-ai/dsh'] = '0.1.0-rc.6'
  }
  const cli = name === '@clawdsh/cli'
  const files = ['LICENSE', 'lib/**']
  if (name === '@clawdsh/dsh-channel-openclaw') {
    files.push('LICENSE.openclaw', 'THIRD_PARTY_NOTICES.md')
  }
  return {
    name,
    version: RELEASE_VERSION,
    license: 'MIT',
    type: 'module',
    main: cli ? 'lib/cli.mjs' : 'lib/index.js',
    types: 'lib/index.d.ts',
    bin: cli ? { clawdsh: './lib/cli.mjs' } : undefined,
    exports: {
      '.': {
        types: './lib/index.d.ts',
        default: cli ? './lib/cli.mjs' : './lib/index.js',
      },
      './package.json': './package.json',
    },
    files,
    publishConfig: { access: 'public' },
    dependencies,
  }
}

function writePackage(directory, name) {
  mkdirSync(directory, { recursive: true })
  const manifest = packageManifest(name)
  writeFileSync(join(directory, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(join(directory, 'LICENSE'), 'MIT License\n\nPermission is hereby granted, free of charge, to use this fixture.\n')
  if (name === '@clawdsh/dsh-channel-openclaw') {
    writeFileSync(join(directory, 'LICENSE.openclaw'), 'OpenClaw fixture license\n')
    writeFileSync(join(directory, 'THIRD_PARTY_NOTICES.md'), '# Third-party fixture notices\n')
  }
  write(directory, 'lib/index.d.ts', 'export declare const fixture: true\n')
  if (name === '@clawdsh/cli') write(directory, 'lib/cli.mjs', '#!/usr/bin/env node\nexport const fixture = true\n', 0o755)
  else write(directory, 'lib/index.js', 'export const fixture = true\n')
}

/** Create source and staged-bundle directories for all release packages. */
export function createReleaseFixture() {
  const temporary = mkdtempSync(join(tmpdir(), 'clawdsh-release-test-'))
  const repository = join(temporary, 'repository')
  mkdirSync(repository)
  for (const specification of RELEASE_PACKAGES) {
    writePackage(join(repository, specification.directory), specification.name)
  }
  const stagedBundle = join(temporary, 'staged-bundle')
  writePackage(stagedBundle, '@clawdsh/dsh-bundle')
  return {
    temporary,
    repository,
    stagedBundle,
    cleanup: () => rmSync(temporary, { recursive: true, force: true }),
  }
}

/** Run npm pack without network access for one fixture package. */
export function fixturePacker(cacheDirectory) {
  return ({ directory, output }) => {
    mkdirSync(dirname(output), { recursive: true })
    execFileSync('npm', [
      'pack',
      '--ignore-scripts',
      '--pack-destination', dirname(output),
    ], {
      cwd: directory,
      env: { ...process.env, npm_config_cache: cacheDirectory },
      stdio: 'pipe',
    })
  }
}

/** Produce a complete verified fixture release directory. */
export function packedRelease(fixture) {
  const releaseDirectory = join(fixture.temporary, 'release')
  packRelease({
    repositoryRoot: fixture.repository,
    outputDirectory: releaseDirectory,
    stagedBundleDirectory: fixture.stagedBundle,
    pack: fixturePacker(join(fixture.temporary, 'npm-cache')),
  })
  return releaseDirectory
}
