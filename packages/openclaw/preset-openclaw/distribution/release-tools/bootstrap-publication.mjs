#!/usr/bin/env node
/** Read-only remote bootstrap verification and one-command-at-a-time instructions. */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BOOTSTRAP_INDEX_FILENAME,
  bootstrapSpecifications,
  canonicalBootstrapJson,
} from './bootstrap-contract.mjs'
import {
  BOOTSTRAP_TAG,
  BOOTSTRAP_VERSION,
  PUBLIC_NPM_REGISTRY,
  PUBLIC_TAG,
  RELEASE_VERSION,
} from './release-contract.mjs'
import { parseBootstrapIndex, verifyBootstrapDirectory } from './bootstrap-verify.mjs'
import { verifyReleaseIndex } from './release-verify.mjs'

const MAX_REGISTRY_METADATA_BYTES = 4 * 1024 * 1024
const SLSA_PROVENANCE_PREDICATE = 'https://slsa.dev/provenance/v1'

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`)
  return value
}

function exactKeys(value, expected, label) {
  const record = object(value, label)
  const keys = Object.keys(record).sort()
  const wanted = [...expected].sort()
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label} fields must equal ${wanted.join(', ')}`)
  }
  return record
}

async function registryMetadata(name, request) {
  const url = new URL(encodeURIComponent(name), PUBLIC_NPM_REGISTRY)
  const response = await request(url, {
    method: 'GET',
    redirect: 'error',
    headers: { accept: 'application/json' },
  })
  if (response.status === 404) return undefined
  if (!response.ok) throw new Error(`npm registry metadata request for ${name} failed with HTTP ${String(response.status)}`)
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

function sameKeys(value, expected) {
  const keys = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index])
}

function releasePackages(releaseIndex) {
  if (releaseIndex === undefined) return undefined
  if (typeof releaseIndex !== 'string' || releaseIndex === '') throw new TypeError('release index path must be a non-empty string')
  const path = realpathSync(resolve(releaseIndex))
  const directory = dirname(path)
  if (realpathSync(join(directory, 'release-index.json')) !== path) {
    throw new TypeError('release index path must name the verified release-index.json')
  }
  const index = verifyReleaseIndex(directory)
  return new Map(index.packages.map(entry => [entry.name, entry]))
}

function inspectPackage(metadata, expected, expectedRelease) {
  if (metadata === undefined) return Object.freeze({ name: expected.name, state: 'missing' })
  const tags = object(metadata['dist-tags'] ?? {}, `${expected.name} dist-tags`)
  if (tags.latest !== BOOTSTRAP_VERSION) {
    throw new TypeError(`${expected.name} latest dist-tag must remain pinned to ${BOOTSTRAP_VERSION}`)
  }
  const versions = object(metadata.versions ?? {}, `${expected.name} versions`)
  const hasRelease = Object.hasOwn(versions, RELEASE_VERSION)
  const permittedRelease = expectedRelease !== undefined && hasRelease
  const expectedVersions = permittedRelease ? [BOOTSTRAP_VERSION, RELEASE_VERSION] : [BOOTSTRAP_VERSION]
  const expectedTags = permittedRelease ? [BOOTSTRAP_TAG, 'latest', PUBLIC_TAG] : [BOOTSTRAP_TAG, 'latest']
  if (!sameKeys(versions, expectedVersions) || !sameKeys(tags, expectedTags)) {
    throw new TypeError(`${expected.name} registry state conflicts with the exact inert bootstrap`)
  }
  const version = versions[BOOTSTRAP_VERSION]
  if (version === undefined) throw new TypeError(`${expected.name} registry state conflicts with the exact inert bootstrap`)
  const integrity = object(version, `${expected.name}@${BOOTSTRAP_VERSION}`).dist?.integrity
  if (integrity !== expected.integrity) {
    throw new TypeError(`${expected.name}@${BOOTSTRAP_VERSION} remote integrity differs from bootstrap-index.json`)
  }
  if (tags[BOOTSTRAP_TAG] !== BOOTSTRAP_VERSION) {
    throw new TypeError(`${expected.name} bootstrap dist-tag must point to ${BOOTSTRAP_VERSION}`)
  }
  if (permittedRelease) {
    const release = object(versions[RELEASE_VERSION], `${expected.name}@${RELEASE_VERSION}`)
    const dist = object(release.dist, `${expected.name}@${RELEASE_VERSION} dist`)
    if (dist.integrity !== expectedRelease.integrity) {
      throw new TypeError(`${expected.name}@${RELEASE_VERSION} remote integrity differs from release-index.json`)
    }
    if (tags[PUBLIC_TAG] !== RELEASE_VERSION) {
      throw new TypeError(`${expected.name} ${PUBLIC_TAG} dist-tag must point to ${RELEASE_VERSION}`)
    }
    const attestations = object(dist.attestations, `${expected.name}@${RELEASE_VERSION} dist.attestations`)
    const provenance = object(attestations.provenance, `${expected.name}@${RELEASE_VERSION} provenance attestation`)
    if (provenance.predicateType !== SLSA_PROVENANCE_PREDICATE) {
      throw new TypeError(`${expected.name}@${RELEASE_VERSION} provenance predicateType must be ${SLSA_PROVENANCE_PREDICATE}`)
    }
  }
  return Object.freeze({ name: expected.name, state: 'verified', integrity })
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

function publicationCommand(directory, entry) {
  const tarball = resolve(directory, entry.filename)
  return [
    'npm publish',
    shellQuote(tarball),
    '--ignore-scripts',
    '--access public',
    `--tag ${BOOTSTRAP_TAG}`,
    `--registry ${PUBLIC_NPM_REGISTRY}`,
  ].join(' ')
}

function bootstrapIndexIntegrity(bytes) {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`
}

/** Return canonical remote evidence only when every inert package matches and latest remains pinned to bootstrap. */
export function bootstrapAttestation(indexBytes, states) {
  const index = parseBootstrapIndex(indexBytes)
  if (states.length !== index.packages.length || states.some((state, position) => (
    state.name !== index.packages[position].name
      || state.state !== 'verified'
      || state.integrity !== index.packages[position].integrity
  ))) {
    throw new TypeError('bootstrap registry state is incomplete')
  }
  return Object.freeze({
    version: 1,
    registry: PUBLIC_NPM_REGISTRY,
    bootstrapVersion: BOOTSTRAP_VERSION,
    bootstrapTag: BOOTSTRAP_TAG,
    latestTagsPinnedToBootstrap: true,
    bootstrapIndexIntegrity: bootstrapIndexIntegrity(indexBytes),
    packages: Object.freeze(states.map(state => Object.freeze({
      name: state.name,
      integrity: state.integrity,
    }))),
  })
}

/** Verify checked remote evidence against a closed bootstrap index without network access. */
export function verifyBootstrapAttestation(indexPath, attestationPath) {
  const indexBytes = readFileSync(indexPath)
  const index = parseBootstrapIndex(indexBytes)
  const raw = JSON.parse(readFileSync(attestationPath, 'utf8'))
  const attestation = exactKeys(
    raw,
    [
      'version',
      'registry',
      'bootstrapVersion',
      'bootstrapTag',
      'latestTagsPinnedToBootstrap',
      'bootstrapIndexIntegrity',
      'packages',
    ],
    'bootstrap attestation',
  )
  if (attestation.version !== 1
    || attestation.registry !== PUBLIC_NPM_REGISTRY
    || attestation.bootstrapVersion !== BOOTSTRAP_VERSION
    || attestation.bootstrapTag !== BOOTSTRAP_TAG
    || attestation.latestTagsPinnedToBootstrap !== true
    || attestation.bootstrapIndexIntegrity !== bootstrapIndexIntegrity(indexBytes)
    || !Array.isArray(attestation.packages)
    || attestation.packages.length !== index.packages.length) {
    throw new TypeError('bootstrap attestation identity is invalid')
  }
  for (const [position, expected] of index.packages.entries()) {
    const entry = exactKeys(attestation.packages[position], ['name', 'integrity'], `bootstrap attestation package ${String(position)}`)
    if (entry.name !== expected.name || entry.integrity !== expected.integrity) {
      throw new TypeError(`bootstrap attestation package ${String(position)} does not match bootstrap-index.json`)
    }
  }
  const normalized = Object.freeze({
    version: 1,
    registry: PUBLIC_NPM_REGISTRY,
    bootstrapVersion: BOOTSTRAP_VERSION,
    bootstrapTag: BOOTSTRAP_TAG,
    latestTagsPinnedToBootstrap: true,
    bootstrapIndexIntegrity: attestation.bootstrapIndexIntegrity,
    packages: Object.freeze(attestation.packages.map(entry => Object.freeze({
      name: entry.name,
      integrity: entry.integrity,
    }))),
  })
  if (canonicalBootstrapJson(normalized) !== readFileSync(attestationPath, 'utf8')) {
    throw new TypeError('bootstrap attestation is not canonical JSON')
  }
  return normalized
}

/** Inspect npm without credentials; print one safe next command or attest completion. */
export async function inspectBootstrapPublication({
  directory,
  repositoryRoot,
  requireComplete = false,
  attestationPath,
  releaseIndex,
  request = globalThis.fetch,
}) {
  if (typeof request !== 'function') throw new TypeError('bootstrap registry request function is unavailable')
  const root = realpathSync(resolve(directory))
  const index = verifyBootstrapDirectory(root, { repositoryRoot })
  const releases = releasePackages(releaseIndex)
  const states = []
  for (const entry of index.packages) {
    const metadata = await registryMetadata(entry.name, request)
    states.push(inspectPackage(metadata, entry, releases?.get(entry.name)))
  }
  const missing = states.filter(state => state.state === 'missing')
  if (missing.length > 0) {
    if (attestationPath !== undefined) throw new TypeError('bootstrap attestation cannot be written before all 13 packages are verified')
    if (requireComplete) throw new TypeError(`bootstrap registry is incomplete: ${String(missing.length)} package identities remain`)
    const next = index.packages.find(entry => entry.name === missing[0].name)
    return Object.freeze({
      complete: false,
      verified: states.length - missing.length,
      missing: missing.length,
      nextCommand: publicationCommand(root, next),
    })
  }
  const indexBytes = readFileSync(join(root, BOOTSTRAP_INDEX_FILENAME))
  const attestation = bootstrapAttestation(indexBytes, states)
  if (attestationPath !== undefined) {
    if (existsSync(attestationPath)) throw new TypeError(`bootstrap attestation already exists: ${attestationPath}`)
    writeFileSync(attestationPath, canonicalBootstrapJson(attestation), { flag: 'wx', mode: 0o644 })
  }
  return Object.freeze({ complete: true, verified: states.length, missing: 0, attestation })
}

function argumentsFrom(argv) {
  const flags = new Set()
  const values = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (key === '--require-complete') {
      if (flags.has(key)) throw new TypeError(`duplicate flag ${key}`)
      flags.add(key)
      continue
    }
    const value = argv[index + 1]
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--') || values.has(key)) {
      throw new TypeError('bootstrap-publication arguments are invalid')
    }
    values.set(key, value)
    index += 1
  }
  for (const key of values.keys()) {
    if (!['--directory', '--repository-root', '--attestation', '--release-index'].includes(key)) throw new TypeError(`unknown argument ${key}`)
  }
  return { flags, values }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const { flags, values } = argumentsFrom(process.argv.slice(2))
  const result = await inspectBootstrapPublication({
    directory: values.get('--directory'),
    repositoryRoot: values.get('--repository-root'),
    requireComplete: flags.has('--require-complete'),
    attestationPath: values.get('--attestation'),
    releaseIndex: values.get('--release-index'),
  })
  if (result.complete) {
    process.stdout.write(`all 13 inert bootstrap packages match npm; bootstrap is complete and latest is pinned to ${BOOTSTRAP_VERSION}\n`)
  } else {
    process.stdout.write(`bootstrap registry: ${String(result.verified)}/13 verified\n`)
    process.stdout.write('After separate authorization, run exactly this one command, then rerun this verifier:\n')
    process.stdout.write(`${result.nextCommand}\n`)
  }
}
