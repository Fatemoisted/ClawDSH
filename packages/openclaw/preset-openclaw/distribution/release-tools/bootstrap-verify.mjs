#!/usr/bin/env node
/** Verification for the closed thirteen-package inert npm bootstrap. */

import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BOOTSTRAP_INDEX_FILENAME,
  bootstrapManifest,
  bootstrapReadme,
  bootstrapSpecifications,
  bootstrapTarballFilename,
  canonicalBootstrapJson,
} from './bootstrap-contract.mjs'
import { BOOTSTRAP_TAG, BOOTSTRAP_VERSION } from './release-contract.mjs'
import { deterministicNpmTarball } from './bootstrap-tar.mjs'
import { readTarball } from './tar-reader.mjs'

const TOOL_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const DEFAULT_REPOSITORY_ROOT = resolve(TOOL_DIRECTORY, '../../../../..')

function ordinaryFile(path, label) {
  const metadata = lstatSync(path)
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw new TypeError(`${label} must be an ordinary file`)
  return path
}

function exactKeys(value, expected, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  const keys = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label} fields must equal ${wanted.join(', ')}`)
  }
}

function json(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new TypeError(`${label} must contain valid JSON`)
  }
}

function expectedLicense(repositoryRoot) {
  const repository = realpathSync(resolve(repositoryRoot))
  return readFileSync(ordinaryFile(join(repository, 'LICENSE'), 'repository LICENSE'))
}

/** Verify one bootstrap tarball contains only its exact inert metadata files. */
export function verifyBootstrapTarball(tarball, specification, licenseBytes) {
  ordinaryFile(tarball, `${specification.name} bootstrap tarball`)
  const entries = readTarball(tarball)
  const expectedNames = ['package', 'package/LICENSE', 'package/README.md', 'package/package.json']
  const names = entries.map(entry => entry.name).sort()
  if (names.length !== expectedNames.length || names.some((name, index) => name !== expectedNames[index])) {
    throw new TypeError(`${specification.name} bootstrap payload must contain only package.json, LICENSE, and README.md`)
  }
  const payload = new Map(entries.map(entry => [entry.name, entry]))
  if (payload.get('package')?.type !== 'directory' || payload.get('package')?.mode !== 0o755) {
    throw new TypeError('bootstrap package root must be a non-writable directory')
  }
  for (const name of expectedNames.slice(1)) {
    const entry = payload.get(name)
    if (entry?.type !== 'file' || entry.mode !== 0o644) {
      throw new TypeError(`${specification.name} bootstrap ${name} must be a non-executable ordinary file`)
    }
  }
  const manifestBytes = payload.get('package/package.json').bytes
  const manifest = json(manifestBytes, `${specification.name} bootstrap package.json`)
  exactKeys(
    manifest,
    ['name', 'version', 'description', 'license', 'repository', 'homepage', 'bugs', 'publishConfig'],
    `${specification.name} bootstrap package.json`,
  )
  const expectedManifest = Buffer.from(canonicalBootstrapJson(bootstrapManifest(specification)))
  if (!manifestBytes.equals(expectedManifest)) {
    throw new TypeError(`${specification.name} bootstrap package.json differs from the inert contract`)
  }
  if (!payload.get('package/LICENSE').bytes.equals(licenseBytes)) {
    throw new TypeError(`${specification.name} bootstrap LICENSE differs from the repository license`)
  }
  const readme = Buffer.from(bootstrapReadme(specification.name))
  if (!payload.get('package/README.md').bytes.equals(readme)) {
    throw new TypeError(`${specification.name} bootstrap README differs from the inert warning`)
  }
  const expectedArchive = deterministicNpmTarball([
    { path: 'package.json', bytes: expectedManifest },
    { path: 'LICENSE', bytes: licenseBytes },
    { path: 'README.md', bytes: readme },
  ])
  if (!readFileSync(tarball).equals(expectedArchive)) {
    throw new TypeError(`${specification.name} bootstrap tarball differs from the deterministic inert archive`)
  }
  return Object.freeze({ manifest, payload })
}

function indexEntry(tarball, specification, licenseBytes) {
  verifyBootstrapTarball(tarball, specification, licenseBytes)
  const bytes = readFileSync(tarball)
  return Object.freeze({
    name: specification.name,
    version: BOOTSTRAP_VERSION,
    filename: bootstrapTarballFilename(specification.name),
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    bytes: bytes.byteLength,
  })
}

function expectedArchiveNames() {
  return bootstrapSpecifications().map(specification => bootstrapTarballFilename(specification.name)).sort()
}

function assertDirectoryEntries(directory, includeIndex) {
  const expected = [...expectedArchiveNames(), ...(includeIndex ? [BOOTSTRAP_INDEX_FILENAME] : [])].sort()
  const actual = readdirSync(directory).sort()
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    throw new TypeError(`bootstrap directory must contain exactly 13 canonical tarballs${includeIndex ? ' and bootstrap-index.json' : ''}`)
  }
}

/** Build the canonical closed SHA-512 index from exactly thirteen tarballs. */
export function buildBootstrapIndex(directory, { repositoryRoot = DEFAULT_REPOSITORY_ROOT } = {}) {
  const root = realpathSync(resolve(directory))
  assertDirectoryEntries(root, false)
  const licenseBytes = expectedLicense(repositoryRoot)
  const packages = bootstrapSpecifications().map(specification => indexEntry(
    ordinaryFile(join(root, bootstrapTarballFilename(specification.name)), `${specification.name} bootstrap tarball`),
    specification,
    licenseBytes,
  ))
  return Object.freeze({
    version: 1,
    bootstrapVersion: BOOTSTRAP_VERSION,
    tag: BOOTSTRAP_TAG,
    packages: Object.freeze(packages),
  })
}

/** Parse and validate the canonical bootstrap index without requiring archives. */
export function parseBootstrapIndex(bytes) {
  const source = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  const index = json(source, 'bootstrap-index.json')
  exactKeys(index, ['version', 'bootstrapVersion', 'tag', 'packages'], 'bootstrap-index.json')
  if (index.version !== 1 || index.bootstrapVersion !== BOOTSTRAP_VERSION || index.tag !== BOOTSTRAP_TAG) {
    throw new TypeError('bootstrap-index.json identity is invalid')
  }
  if (!Array.isArray(index.packages) || index.packages.length !== bootstrapSpecifications().length) {
    throw new TypeError('bootstrap-index.json must contain exactly 13 packages')
  }
  for (const [position, specification] of bootstrapSpecifications().entries()) {
    const entry = index.packages[position]
    exactKeys(entry, ['name', 'version', 'filename', 'integrity', 'bytes'], `bootstrap package index ${String(position)}`)
    if (entry.name !== specification.name
      || entry.version !== BOOTSTRAP_VERSION
      || entry.filename !== bootstrapTarballFilename(specification.name)
      || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity)
      || !Number.isSafeInteger(entry.bytes)
      || entry.bytes <= 0) {
      throw new TypeError(`bootstrap package index ${String(position)} is invalid`)
    }
  }
  const normalized = Object.freeze({
    version: 1,
    bootstrapVersion: BOOTSTRAP_VERSION,
    tag: BOOTSTRAP_TAG,
    packages: Object.freeze(index.packages.map(entry => Object.freeze({
      name: entry.name,
      version: entry.version,
      filename: entry.filename,
      integrity: entry.integrity,
      bytes: entry.bytes,
    }))),
  })
  if (canonicalBootstrapJson(normalized) !== source.toString('utf8')) {
    throw new TypeError('bootstrap-index.json is not canonical JSON')
  }
  return normalized
}

/** Verify the complete closed bootstrap directory and checked SHA-512 index. */
export function verifyBootstrapDirectory(directory, { repositoryRoot = DEFAULT_REPOSITORY_ROOT } = {}) {
  const root = realpathSync(resolve(directory))
  assertDirectoryEntries(root, true)
  const indexPath = ordinaryFile(join(root, BOOTSTRAP_INDEX_FILENAME), 'bootstrap index')
  const checkedBytes = readFileSync(indexPath)
  const checked = parseBootstrapIndex(checkedBytes)
  const licenseBytes = expectedLicense(repositoryRoot)
  const packages = bootstrapSpecifications().map(specification => indexEntry(
    ordinaryFile(join(root, bootstrapTarballFilename(specification.name)), `${specification.name} bootstrap tarball`),
    specification,
    licenseBytes,
  ))
  const generated = Object.freeze({
    version: 1,
    bootstrapVersion: BOOTSTRAP_VERSION,
    tag: BOOTSTRAP_TAG,
    packages: Object.freeze(packages),
  })
  if (canonicalBootstrapJson(generated) !== checkedBytes.toString('utf8')) {
    throw new TypeError('bootstrap-index.json does not match the tarballs')
  }
  return checked
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const directory = process.argv[2]
  if (!directory || process.argv.length !== 3) throw new TypeError('usage: bootstrap-verify.mjs <bootstrap-directory>')
  const index = verifyBootstrapDirectory(directory)
  process.stdout.write(`verified ${String(index.packages.length)} inert ClawDSH bootstrap packages\n`)
}
