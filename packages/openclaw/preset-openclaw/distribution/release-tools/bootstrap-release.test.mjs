import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  BOOTSTRAP_INDEX_FILENAME,
  bootstrapManifest,
  bootstrapReadme,
  bootstrapSpecifications,
  bootstrapTarballFilename,
  canonicalBootstrapJson,
} from './bootstrap-contract.mjs'
import { packBootstrap } from './bootstrap-pack.mjs'
import {
  inspectBootstrapPublication,
  verifyBootstrapAttestation,
} from './bootstrap-publication.mjs'
import { deterministicNpmTarball } from './bootstrap-tar.mjs'
import {
  verifyBootstrapDirectory,
  verifyBootstrapTarball,
} from './bootstrap-verify.mjs'
import { BOOTSTRAP_TAG, BOOTSTRAP_VERSION, PUBLIC_TAG, RELEASE_VERSION } from './release-contract.mjs'
import { createReleaseFixture, packedRelease } from './release-fixture.mjs'
import { readTarball } from './tar-reader.mjs'

const repository = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../..')

function temporaryDirectory() {
  return mkdtempSync(join(tmpdir(), 'clawdsh-bootstrap-test-'))
}

function registryResponse(metadata) {
  if (metadata === undefined) {
    return { status: 404, ok: false, async text() { return '{}' } }
  }
  return { status: 200, ok: true, async text() { return JSON.stringify(metadata) } }
}

function metadata(entry, { latest = BOOTSTRAP_VERSION, integrity = entry.integrity } = {}) {
  return {
    'dist-tags': {
      [BOOTSTRAP_TAG]: BOOTSTRAP_VERSION,
      ...(latest === false ? {} : { latest }),
    },
    versions: {
      [BOOTSTRAP_VERSION]: { dist: { integrity } },
    },
  }
}

function metadataWithRelease(bootstrapEntry, releaseEntry, {
  releaseIntegrity = releaseEntry.integrity,
  releaseTag = RELEASE_VERSION,
  predicateType = 'https://slsa.dev/provenance/v1',
  extraTag,
  extraVersion,
} = {}) {
  return {
    'dist-tags': {
      [BOOTSTRAP_TAG]: BOOTSTRAP_VERSION,
      latest: BOOTSTRAP_VERSION,
      [PUBLIC_TAG]: releaseTag,
      ...(extraTag === undefined ? {} : { beta: extraTag }),
    },
    versions: {
      [BOOTSTRAP_VERSION]: { dist: { integrity: bootstrapEntry.integrity } },
      [RELEASE_VERSION]: {
        dist: {
          integrity: releaseIntegrity,
          attestations: { provenance: { predicateType } },
        },
      },
      ...(extraVersion === undefined
        ? {}
        : { [extraVersion]: { dist: { integrity: releaseIntegrity } } }),
    },
  }
}

test('generates exactly 13 byte-identical inert bootstrap tarballs and a closed SHA-512 index', () => {
  const temporary = temporaryDirectory()
  try {
    const first = join(temporary, 'first')
    const second = join(temporary, 'second')
    const firstIndex = packBootstrap({ repositoryRoot: repository, outputDirectory: first })
    const secondIndex = packBootstrap({ repositoryRoot: repository, outputDirectory: second })
    assert.equal(firstIndex.packages.length, 13)
    assert.deepEqual(firstIndex, secondIndex)
    assert.deepEqual(
      readFileSync(join(first, BOOTSTRAP_INDEX_FILENAME)),
      readFileSync(join(second, BOOTSTRAP_INDEX_FILENAME)),
    )
    for (const specification of bootstrapSpecifications()) {
      const filename = bootstrapTarballFilename(specification.name)
      assert.deepEqual(readFileSync(join(first, filename)), readFileSync(join(second, filename)))
      const entries = readTarball(join(first, filename))
      assert.deepEqual(entries.map(entry => entry.name).sort(), [
        'package',
        'package/LICENSE',
        'package/README.md',
        'package/package.json',
      ])
      const manifest = JSON.parse(entries.find(entry => entry.name === 'package/package.json').bytes)
      for (const forbidden of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies', 'bin', 'exports', 'main', 'scripts', 'files']) {
        assert.equal(Object.hasOwn(manifest, forbidden), false)
      }
    }
    verifyBootstrapDirectory(first, { repositoryRoot: repository })
    writeFileSync(join(first, 'unexpected.txt'), 'not in the closed bootstrap\n')
    assert.throws(
      () => verifyBootstrapDirectory(first, { repositoryRoot: repository }),
      /exactly 13 canonical tarballs and bootstrap-index\.json/,
    )
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})

test('bootstrap verifier rejects executable payload and dependency metadata', () => {
  const temporary = temporaryDirectory()
  try {
    const specification = bootstrapSpecifications()[0]
    const license = readFileSync(join(repository, 'LICENSE'))
    const withCode = deterministicNpmTarball([
      { path: 'package.json', bytes: canonicalBootstrapJson(bootstrapManifest(specification)) },
      { path: 'LICENSE', bytes: license },
      { path: 'README.md', bytes: bootstrapReadme(specification.name) },
      { path: 'index.js', bytes: 'export {}\n' },
    ])
    const codeArchive = join(temporary, 'code.tgz')
    writeFileSync(codeArchive, withCode)
    assert.throws(
      () => verifyBootstrapTarball(codeArchive, specification, license),
      /only package\.json, LICENSE, and README\.md/,
    )

    const dependent = { ...bootstrapManifest(specification), dependencies: { unsafe: '1.0.0' } }
    const withDependency = deterministicNpmTarball([
      { path: 'package.json', bytes: canonicalBootstrapJson(dependent) },
      { path: 'LICENSE', bytes: license },
      { path: 'README.md', bytes: bootstrapReadme(specification.name) },
    ])
    const dependencyArchive = join(temporary, 'dependency.tgz')
    writeFileSync(dependencyArchive, withDependency)
    assert.throws(
      () => verifyBootstrapTarball(dependencyArchive, specification, license),
      /package\.json fields/,
    )

    const noncanonicalGzip = deterministicNpmTarball([
      { path: 'package.json', bytes: canonicalBootstrapJson(bootstrapManifest(specification)) },
      { path: 'LICENSE', bytes: license },
      { path: 'README.md', bytes: bootstrapReadme(specification.name) },
    ])
    noncanonicalGzip[9] = 3
    const noncanonicalArchive = join(temporary, 'noncanonical.tgz')
    writeFileSync(noncanonicalArchive, noncanonicalGzip)
    assert.throws(
      () => verifyBootstrapTarball(noncanonicalArchive, specification, license),
      /differs from the deterministic inert archive/,
    )
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})

test('npm accepts the deterministic inert archive without running a lifecycle script', () => {
  const temporary = temporaryDirectory()
  try {
    const directory = join(temporary, 'bootstrap')
    const index = packBootstrap({ repositoryRoot: repository, outputDirectory: directory })
    const output = execFileSync('npm', [
      'publish',
      join(directory, index.packages[0].filename),
      '--dry-run',
      '--ignore-scripts',
      '--access', 'public',
      '--tag', BOOTSTRAP_TAG,
      '--registry', 'https://registry.npmjs.org/',
    ], {
      encoding: 'utf8',
      env: { ...process.env, npm_config_cache: join(temporary, 'npm-cache') },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    assert.match(output, /@clawdsh\/dsh-activity@0\.1\.0-rc\.0/)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})

test('read-only publication inspector resumes by integrity and requires latest pinned to bootstrap', async () => {
  const temporary = temporaryDirectory()
  try {
    const directory = join(temporary, 'bootstrap')
    const index = packBootstrap({ repositoryRoot: repository, outputDirectory: directory })
    const published = new Map()
    const request = async (url) => {
      const name = decodeURIComponent(new URL(url).pathname.slice(1))
      return registryResponse(published.get(name))
    }
    const initial = await inspectBootstrapPublication({ directory, repositoryRoot: repository, request })
    assert.equal(initial.complete, false)
    assert.equal(initial.verified, 0)
    assert.match(initial.nextCommand, new RegExp(bootstrapTarballFilename(index.packages[0].name).replaceAll('.', '\\.')))
    assert.match(initial.nextCommand, /--tag bootstrap/)
    assert.doesNotMatch(initial.nextCommand, /--tag latest/)

    published.set(index.packages[0].name, metadata(index.packages[0]))
    const resumed = await inspectBootstrapPublication({ directory, repositoryRoot: repository, request })
    assert.equal(resumed.verified, 1)
    assert.match(resumed.nextCommand, new RegExp(bootstrapTarballFilename(index.packages[1].name).replaceAll('.', '\\.')))

    for (const entry of index.packages) published.set(entry.name, metadata(entry))
    const attestationPath = join(temporary, 'bootstrap-attestation.json')
    const complete = await inspectBootstrapPublication({
      directory,
      repositoryRoot: repository,
      requireComplete: true,
      attestationPath,
      request,
    })
    assert.equal(complete.complete, true)
    assert.equal(complete.verified, 13)
    assert.equal(complete.attestation.latestTagsPinnedToBootstrap, true)
    verifyBootstrapAttestation(join(directory, BOOTSTRAP_INDEX_FILENAME), attestationPath)

    published.set(index.packages[0].name, metadata(index.packages[0], { latest: RELEASE_VERSION }))
    await assert.rejects(
      () => inspectBootstrapPublication({ directory, repositoryRoot: repository, request }),
      /latest dist-tag must remain pinned/,
    )
    published.set(index.packages[0].name, metadata(index.packages[0], { latest: false }))
    await assert.rejects(
      () => inspectBootstrapPublication({ directory, repositoryRoot: repository, request }),
      /latest dist-tag must remain pinned/,
    )
    published.set(index.packages[0].name, metadata(index.packages[0], { integrity: 'sha512-invalid' }))
    await assert.rejects(
      () => inspectBootstrapPublication({ directory, repositoryRoot: repository, request }),
      /remote integrity differs/,
    )

    published.set(index.packages[0].name, {
      'dist-tags': { beta: '9.9.9' },
      versions: { '9.9.9': { dist: { integrity: index.packages[0].integrity } } },
    })
    await assert.rejects(
      () => inspectBootstrapPublication({ directory, repositoryRoot: repository, request }),
      /registry state conflicts with the exact inert bootstrap/,
    )

    published.set(index.packages[0].name, {
      ...metadata(index.packages[0]),
      'dist-tags': {
        [BOOTSTRAP_TAG]: BOOTSTRAP_VERSION,
        beta: BOOTSTRAP_VERSION,
      },
    })
    await assert.rejects(
      () => inspectBootstrapPublication({ directory, repositoryRoot: repository, request }),
      /registry state conflicts with the exact inert bootstrap/,
    )
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})

test('bootstrap inspection permits only exact provenance-bearing release checkpoints when given a release index', async () => {
  const temporary = temporaryDirectory()
  const releaseFixture = createReleaseFixture()
  try {
    const directory = join(temporary, 'bootstrap')
    const bootstrapIndex = packBootstrap({ repositoryRoot: repository, outputDirectory: directory })
    const releaseDirectory = packedRelease(releaseFixture)
    const releaseIndexPath = join(releaseDirectory, 'release-index.json')
    const releaseIndex = JSON.parse(readFileSync(releaseIndexPath, 'utf8'))
    const published = new Map(bootstrapIndex.packages.map(entry => [entry.name, metadata(entry)]))
    const request = async (url) => {
      const name = decodeURIComponent(new URL(url).pathname.slice(1))
      return registryResponse(published.get(name))
    }
    const firstBootstrap = bootstrapIndex.packages[0]
    const firstRelease = releaseIndex.packages.find(entry => entry.name === firstBootstrap.name)
    published.set(firstBootstrap.name, metadataWithRelease(firstBootstrap, firstRelease))

    await assert.rejects(
      () => inspectBootstrapPublication({ directory, repositoryRoot: repository, request }),
      /registry state conflicts with the exact inert bootstrap/,
    )
    const resumed = await inspectBootstrapPublication({
      directory,
      repositoryRoot: repository,
      releaseIndex: releaseIndexPath,
      requireComplete: true,
      request,
    })
    assert.equal(resumed.complete, true)
    assert.equal(resumed.verified, 13)

    published.set(firstBootstrap.name, metadataWithRelease(firstBootstrap, firstRelease, {
      extraVersion: '9.9.9',
    }))
    await assert.rejects(
      () => inspectBootstrapPublication({
        directory,
        repositoryRoot: repository,
        releaseIndex: releaseIndexPath,
        request,
      }),
      /registry state conflicts with the exact inert bootstrap/,
    )

    published.set(firstBootstrap.name, metadataWithRelease(firstBootstrap, firstRelease, {
      extraTag: RELEASE_VERSION,
    }))
    await assert.rejects(
      () => inspectBootstrapPublication({
        directory,
        repositoryRoot: repository,
        releaseIndex: releaseIndexPath,
        request,
      }),
      /registry state conflicts with the exact inert bootstrap/,
    )

    published.set(firstBootstrap.name, metadataWithRelease(firstBootstrap, firstRelease, {
      releaseIntegrity: 'sha512-invalid',
    }))
    await assert.rejects(
      () => inspectBootstrapPublication({
        directory,
        repositoryRoot: repository,
        releaseIndex: releaseIndexPath,
        request,
      }),
      /remote integrity differs from release-index\.json/,
    )

    published.set(firstBootstrap.name, metadataWithRelease(firstBootstrap, firstRelease, {
      releaseTag: BOOTSTRAP_VERSION,
    }))
    await assert.rejects(
      () => inspectBootstrapPublication({
        directory,
        repositoryRoot: repository,
        releaseIndex: releaseIndexPath,
        request,
      }),
      /next dist-tag must point to/,
    )

    published.set(firstBootstrap.name, metadataWithRelease(firstBootstrap, firstRelease, {
      predicateType: 'https://example.invalid/provenance',
    }))
    await assert.rejects(
      () => inspectBootstrapPublication({
        directory,
        repositoryRoot: repository,
        releaseIndex: releaseIndexPath,
        request,
      }),
      /provenance predicateType/,
    )
  } finally {
    releaseFixture.cleanup()
    rmSync(temporary, { recursive: true, force: true })
  }
})
