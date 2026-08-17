#!/usr/bin/env node
/** Resumable, provenance-gated publication of the public ClawDSH release. */

import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PUBLIC_NPM_REGISTRY,
  PUBLIC_TAG,
  RELEASE_VERSION,
} from './release-contract.mjs'
import { verifyReleaseIndex } from './release-verify.mjs'

const MAX_REGISTRY_METADATA_BYTES = 4 * 1024 * 1024
export const SLSA_PROVENANCE_PREDICATE = 'https://slsa.dev/provenance/v1'

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value
}

async function registryMetadata(name, request) {
  const url = new URL(encodeURIComponent(name), PUBLIC_NPM_REGISTRY)
  const response = await request(url, {
    method: 'GET',
    redirect: 'error',
    cache: 'no-store',
    headers: {
      accept: 'application/json',
      'cache-control': 'no-cache',
    },
  })
  if (response.status === 404) return undefined
  if (!response.ok) {
    throw new Error(`npm registry metadata request for ${name} failed with HTTP ${String(response.status)}`)
  }
  const text = await response.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_REGISTRY_METADATA_BYTES) {
    throw new TypeError(`npm registry metadata for ${name} exceeds the audit limit`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new TypeError(`npm registry metadata for ${name} is not valid JSON`)
  }
}

function inspectPackage(metadata, expected) {
  if (metadata === undefined) return Object.freeze({ name: expected.name, state: 'missing' })
  const tags = object(metadata['dist-tags'] ?? {}, `${expected.name} dist-tags`)
  if (Object.hasOwn(tags, 'latest')) {
    throw new TypeError(`${expected.name} unexpectedly has a latest dist-tag`)
  }
  const versions = object(metadata.versions ?? {}, `${expected.name} versions`)
  const version = versions[RELEASE_VERSION]
  if (version === undefined) {
    if (Object.hasOwn(tags, PUBLIC_TAG)) {
      throw new TypeError(`${expected.name} ${PUBLIC_TAG} dist-tag exists before ${RELEASE_VERSION}`)
    }
    return Object.freeze({ name: expected.name, state: 'missing' })
  }
  if (tags[PUBLIC_TAG] !== RELEASE_VERSION) {
    throw new TypeError(`${expected.name} ${PUBLIC_TAG} dist-tag must point to ${RELEASE_VERSION}`)
  }
  const dist = object(object(version, `${expected.name}@${RELEASE_VERSION}`).dist, `${expected.name}@${RELEASE_VERSION} dist`)
  if (dist.integrity !== expected.integrity) {
    throw new TypeError(`${expected.name}@${RELEASE_VERSION} remote integrity differs from release-index.json`)
  }
  const attestations = object(dist.attestations, `${expected.name}@${RELEASE_VERSION} dist.attestations`)
  const provenance = object(attestations.provenance, `${expected.name}@${RELEASE_VERSION} provenance attestation`)
  if (provenance.predicateType !== SLSA_PROVENANCE_PREDICATE) {
    throw new TypeError(`${expected.name}@${RELEASE_VERSION} provenance predicateType must be ${SLSA_PROVENANCE_PREDICATE}`)
  }
  return Object.freeze({
    name: expected.name,
    state: 'verified',
    integrity: expected.integrity,
    predicateType: SLSA_PROVENANCE_PREDICATE,
  })
}

async function inspectIndex(index, request) {
  const states = []
  for (const entry of index.packages) {
    states.push(inspectPackage(await registryMetadata(entry.name, request), entry))
  }
  return Object.freeze(states)
}

function requireComplete(states) {
  const missing = states.filter(state => state.state === 'missing')
  if (missing.length > 0) {
    throw new TypeError(`public npm release is incomplete: ${String(missing.length)} of 13 packages are missing ${RELEASE_VERSION}`)
  }
  return states
}

/** Return the one permitted public npm publish argument list. */
export function publicPublishArguments(tarball) {
  return Object.freeze([
    'publish',
    tarball,
    '--ignore-scripts',
    '--access', 'public',
    '--tag', PUBLIC_TAG,
    '--registry', PUBLIC_NPM_REGISTRY,
    '--provenance',
  ])
}

function defaultPublisher({ tarball }) {
  const result = spawnSync('npm', publicPublishArguments(tarball), {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 4 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`npm publish failed:\n${result.stderr || result.stdout}`)
}

function checkedRelease(directory) {
  if (!directory) throw new TypeError('release directory is required')
  const root = realpathSync(resolve(directory))
  return Object.freeze({ root, index: verifyReleaseIndex(root) })
}

/** Verify that all 13 immutable remote versions match the local release and provenance requirements. */
export async function verifyPublicReleasePublication({
  directory,
  request = globalThis.fetch,
}) {
  if (typeof request !== 'function') throw new TypeError('public npm registry request function is unavailable')
  const { index } = checkedRelease(directory)
  const states = requireComplete(await inspectIndex(index, request))
  return Object.freeze({ complete: true, verified: states.length, states })
}

/** Publish missing packages dependency-first while treating exact remote versions as resumable checkpoints. */
export async function publishPublicReleasePublication({
  directory,
  request = globalThis.fetch,
  publish = defaultPublisher,
}) {
  if (typeof request !== 'function') throw new TypeError('public npm registry request function is unavailable')
  if (typeof publish !== 'function') throw new TypeError('public npm publisher function is unavailable')
  const { root, index } = checkedRelease(directory)

  const initial = await inspectIndex(index, request)
  const resumed = initial.filter(state => state.state === 'verified').length
  const published = []
  for (const [position, entry] of index.packages.entries()) {
    if (initial[position].state === 'verified') continue
    await publish(Object.freeze({
      name: entry.name,
      tarball: join(root, entry.filename),
      registry: PUBLIC_NPM_REGISTRY,
      tag: PUBLIC_TAG,
      provenance: true,
      ignoreScripts: true,
    }))
    const state = inspectPackage(await registryMetadata(entry.name, request), entry)
    if (state.state !== 'verified') {
      throw new TypeError(`${entry.name}@${RELEASE_VERSION} is not visible after publication`)
    }
    published.push(entry.name)
  }

  const final = requireComplete(await inspectIndex(index, request))
  return Object.freeze({
    complete: true,
    verified: final.length,
    resumed,
    published: Object.freeze(published),
    states: final,
  })
}

function argumentsFrom(argv) {
  const flags = new Set()
  const values = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (key === '--provenance' || key === '--verify-only') {
      if (flags.has(key)) throw new TypeError(`duplicate flag ${key}`)
      flags.add(key)
      continue
    }
    const value = argv[index + 1]
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--') || values.has(key)) {
      throw new TypeError('public-release-publication arguments are invalid')
    }
    values.set(key, value)
    index += 1
  }
  for (const key of values.keys()) {
    if (!['--directory', '--registry', '--tag'].includes(key)) throw new TypeError(`unknown argument ${key}`)
  }
  if (values.get('--registry') !== PUBLIC_NPM_REGISTRY) {
    throw new TypeError(`public registry must be ${PUBLIC_NPM_REGISTRY}`)
  }
  if (values.get('--tag') !== PUBLIC_TAG) throw new TypeError(`public release tag must be ${PUBLIC_TAG}`)
  if (!flags.has('--provenance')) throw new TypeError('public npm publication requires provenance')
  return { flags, values }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const { flags, values } = argumentsFrom(process.argv.slice(2))
  if (flags.has('--verify-only')) {
    const result = await verifyPublicReleasePublication({ directory: values.get('--directory') })
    process.stdout.write(`verified all ${String(result.verified)} ClawDSH ${RELEASE_VERSION} packages on public npm with provenance; latest is absent\n`)
  } else {
    const result = await publishPublicReleasePublication({ directory: values.get('--directory') })
    process.stdout.write(`public npm release complete: ${String(result.published.length)} published, ${String(result.resumed)} exactly resumed, ${String(result.verified)} verified\n`)
  }
}
