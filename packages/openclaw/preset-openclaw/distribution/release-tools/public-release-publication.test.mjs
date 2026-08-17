import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PUBLIC_NPM_REGISTRY,
  PUBLIC_TAG,
  RELEASE_PACKAGE_NAMES,
  RELEASE_VERSION,
} from './release-contract.mjs'
import { createReleaseFixture, packedRelease } from './release-fixture.mjs'
import {
  SLSA_PROVENANCE_PREDICATE,
  publicPublishArguments,
  publishPublicReleasePublication,
  verifyPublicReleasePublication,
} from './public-release-publication.mjs'
import { verifyReleaseIndex } from './release-verify.mjs'

function registryResponse(metadata) {
  if (metadata === undefined) {
    return { status: 404, ok: false, async text() { return '{}' } }
  }
  return { status: 200, ok: true, async text() { return JSON.stringify(metadata) } }
}

function metadata(entry, {
  integrity = entry.integrity,
  latest = false,
  next = RELEASE_VERSION,
  provenance = SLSA_PROVENANCE_PREDICATE,
  includeNext = true,
  includeProvenance = true,
  includeVersion = true,
} = {}) {
  const dist = { integrity }
  if (includeProvenance) {
    dist.attestations = { provenance: { predicateType: provenance } }
  }
  return {
    'dist-tags': {
      ...(includeNext ? { [PUBLIC_TAG]: next } : {}),
      ...(latest ? { latest: RELEASE_VERSION } : {}),
    },
    versions: includeVersion ? { [RELEASE_VERSION]: { dist } } : {},
  }
}

function registry(published, requests = []) {
  return async (url, options) => {
    requests.push({ url: String(url), options })
    const name = decodeURIComponent(new URL(url).pathname.slice(1))
    return registryResponse(published.get(name))
  }
}

test('publishes all missing packages dependency-first with the exact public npm command', async () => {
  const fixture = createReleaseFixture()
  try {
    const directory = packedRelease(fixture)
    const index = verifyReleaseIndex(directory)
    const remote = new Map()
    const requests = []
    const calls = []
    const result = await publishPublicReleasePublication({
      directory,
      request: registry(remote, requests),
      async publish(call) {
        calls.push(call)
        const entry = index.packages.find(candidate => candidate.name === call.name)
        remote.set(call.name, metadata(entry))
      },
    })

    assert.deepEqual(calls.map(call => call.name), RELEASE_PACKAGE_NAMES)
    assert.ok(calls.every(call => (
      call.registry === PUBLIC_NPM_REGISTRY
        && call.tag === PUBLIC_TAG
        && call.provenance === true
        && call.ignoreScripts === true
    )))
    assert.deepEqual(publicPublishArguments(calls[0].tarball), [
      'publish',
      calls[0].tarball,
      '--ignore-scripts',
      '--access', 'public',
      '--tag', PUBLIC_TAG,
      '--registry', PUBLIC_NPM_REGISTRY,
      '--provenance',
    ])
    assert.equal(result.resumed, 0)
    assert.deepEqual(result.published, RELEASE_PACKAGE_NAMES)
    assert.equal(result.verified, 13)
    assert.ok(requests.every(({ options }) => (
      options.method === 'GET'
        && options.redirect === 'error'
        && options.headers.accept === 'application/json'
        && !Object.hasOwn(options.headers, 'authorization')
    )))
  } finally {
    fixture.cleanup()
  }
})

test('resumes only exact provenance-bearing packages and publishes the missing suffix', async () => {
  const fixture = createReleaseFixture()
  try {
    const directory = packedRelease(fixture)
    const index = verifyReleaseIndex(directory)
    const remote = new Map(index.packages.slice(0, 5).map(entry => [entry.name, metadata(entry)]))
    const calls = []
    const result = await publishPublicReleasePublication({
      directory,
      request: registry(remote),
      async publish(call) {
        calls.push(call)
        const entry = index.packages.find(candidate => candidate.name === call.name)
        remote.set(call.name, metadata(entry))
      },
    })

    assert.equal(result.resumed, 5)
    assert.deepEqual(calls.map(call => call.name), RELEASE_PACKAGE_NAMES.slice(5))
    assert.deepEqual(result.published, RELEASE_PACKAGE_NAMES.slice(5))
    assert.equal(result.verified, 13)
  } finally {
    fixture.cleanup()
  }
})

test('fails closed before publishing on integrity, tag, latest, or provenance conflicts', async t => {
  const fixture = createReleaseFixture()
  try {
    const directory = packedRelease(fixture)
    const index = verifyReleaseIndex(directory)
    const first = index.packages[0]
    const cases = [
      ['integrity', metadata(first, { integrity: 'sha512-conflict' }), /remote integrity differs/],
      ['next tag', metadata(first, { next: '0.1.0-rc.0' }), /next dist-tag must point/],
      ['missing next tag', metadata(first, { includeNext: false }), /next dist-tag must point/],
      ['latest tag', metadata(first, { latest: true }), /latest dist-tag/],
      ['missing provenance', metadata(first, { includeProvenance: false }), /dist\.attestations/],
      ['wrong provenance', metadata(first, { provenance: 'https://example.invalid/predicate' }), /predicateType/],
      ['tag without version', metadata(first, { includeVersion: false }), /next dist-tag exists before/],
    ]
    for (const [name, conflicting, pattern] of cases) {
      await t.test(name, async () => {
        const remote = new Map([[first.name, conflicting]])
        const calls = []
        await assert.rejects(
          () => publishPublicReleasePublication({
            directory,
            request: registry(remote),
            publish(call) { calls.push(call) },
          }),
          pattern,
        )
        assert.deepEqual(calls, [])
      })
    }
  } finally {
    fixture.cleanup()
  }
})

test('stops after a package when its post-publication packument is not verified', async () => {
  const fixture = createReleaseFixture()
  try {
    const directory = packedRelease(fixture)
    const remote = new Map()
    const calls = []
    await assert.rejects(
      () => publishPublicReleasePublication({
        directory,
        request: registry(remote),
        publish(call) { calls.push(call) },
      }),
      /is not visible after publication/,
    )
    assert.deepEqual(calls.map(call => call.name), RELEASE_PACKAGE_NAMES.slice(0, 1))
  } finally {
    fixture.cleanup()
  }
})

test('verify-only requires all 13 exact remote packages with provenance', async () => {
  const fixture = createReleaseFixture()
  try {
    const directory = packedRelease(fixture)
    const index = verifyReleaseIndex(directory)
    const remote = new Map(index.packages.map(entry => [entry.name, metadata(entry)]))
    const complete = await verifyPublicReleasePublication({ directory, request: registry(remote) })
    assert.equal(complete.verified, 13)

    remote.delete(index.packages.at(-1).name)
    await assert.rejects(
      () => verifyPublicReleasePublication({ directory, request: registry(remote) }),
      /public npm release is incomplete: 1 of 13 packages/,
    )
  } finally {
    fixture.cleanup()
  }
})
