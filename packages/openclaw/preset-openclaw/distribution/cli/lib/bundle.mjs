/** Resolve and validate the exact ClawDSH distribution bundle used by the CLI. */

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import {
  BUNDLE_NAME,
  BUNDLE_VERSION,
  PRIMARY_PRESET_ID,
  PROFILE_BUNDLES,
  PROFILE_ID,
  SAFE_PRESET_ID,
} from './constants.mjs'
import { bytesIntegrity, readJson, safeRelative } from './files.mjs'

/** Bundle JSON is progressively validated before paths or identities are used. @typedef {Record<string, any>} BundleJson */

/** @typedef {{root: string, manifest: BundleJson, assets: BundleJson, assetManifestIntegrity: string, primaryPresetRoot: string, channelRoot: string}} InspectedBundle */

/** Resolve an installed package root through its exported package.json. */
/** @param {string} packageName @param {string | URL} [anchor] @returns {string} */
export function packageRoot(packageName, anchor = import.meta.url) {
  const require = createRequire(anchor)
  return dirname(require.resolve(`${packageName}/package.json`))
}

/** @param {unknown} value @param {string} label @returns {BundleJson} */
function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`)
  return value
}

/** @param {unknown} left @param {readonly unknown[]} right @returns {boolean} */
function sameList(left, right) {
  return Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index])
}

/** @param {string} root @param {BundleJson} assets */
function validateAssets(root, assets) {
  const expected = new Set(['package.json', 'assets.json'])
  let previous = ''
  for (const [index, candidate] of assets.files.entries()) {
    const entry = object(candidate, `bundle asset ${index}`)
    const path = safeRelative(entry.path, `bundle asset ${index} path`)
    safeRelative(entry.source, `bundle asset ${path} source`)
    if (path <= previous || expected.has(path)) throw new TypeError('bundle asset paths must be sorted and unique')
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0
      || typeof entry.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity)) {
      throw new TypeError(`bundle asset ${path} has invalid size or SHA-512 integrity`)
    }
    const absolute = join(root, path)
    const metadata = lstatSync(absolute)
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new TypeError(`bundle asset ${path} must be an ordinary file`)
    const bytes = readFileSync(absolute)
    if (bytes.byteLength !== entry.bytes || bytesIntegrity(bytes) !== entry.integrity) {
      throw new TypeError(`bundle asset digest mismatch for ${path}`)
    }
    expected.add(path)
    previous = path
  }
  /** @type {string[]} */
  const actual = []
  /** @param {string} directory @param {string} [prefix] */
  const visit = (directory, prefix = '') => {
    const rootMetadata = lstatSync(directory)
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) throw new TypeError('bundle payload contains an unsafe directory')
    for (const name of readdirSync(directory).sort()) {
      if (prefix === '' && name === 'node_modules') continue
      const logical = prefix === '' ? name : `${prefix}/${name}`
      const absolute = join(directory, name)
      const metadata = lstatSync(absolute)
      if (metadata.isSymbolicLink()) throw new TypeError(`bundle payload contains symbolic link ${logical}`)
      if (metadata.isDirectory()) visit(absolute, logical)
      else if (metadata.isFile()) actual.push(logical)
      else throw new TypeError(`bundle payload contains special file ${logical}`)
    }
  }
  visit(root)
  if (actual.length !== expected.size || actual.some(path => !expected.has(path))) {
    throw new TypeError('bundle payload contains missing or undeclared managed assets')
  }
}

/** Validate bundle identity and return its installer-owned paths. */
/** @param {string} root @returns {InspectedBundle} */
export function inspectBundle(root) {
  const manifest = object(readJson(join(root, 'package.json'), 'ClawDSH bundle package.json'), 'ClawDSH bundle package.json')
  if (manifest.name !== BUNDLE_NAME || manifest.version !== BUNDLE_VERSION) {
    throw new TypeError(`expected ${BUNDLE_NAME}@${BUNDLE_VERSION}`)
  }
  const clawdsh = object(manifest.clawdsh, 'bundle clawdsh metadata')
  if (clawdsh.distributionVersion !== 1 || clawdsh.assetManifest !== './assets.json') {
    throw new TypeError('bundle distribution metadata is incompatible')
  }
  const profile = object(clawdsh.profile, 'bundle profile metadata')
  if (profile.id !== PROFILE_ID || !sameList(profile.bundles, PROFILE_BUNDLES)) {
    throw new TypeError('bundle profile identity or layer order is incompatible')
  }
  const preset = object(profile.preset, 'bundle primary preset metadata')
  const safePreset = object(profile.safePreset, 'bundle safe preset metadata')
  if (preset.id !== PRIMARY_PRESET_ID || preset.directory !== './presets/clawdsh'
    || safePreset.id !== SAFE_PRESET_ID || safePreset.package !== '@clawdsh/dsh-preset-messaging-safe') {
    throw new TypeError('bundle preset metadata is incompatible')
  }
  const assetsPath = join(root, safeRelative(String(clawdsh.assetManifest).replace(/^\.\//, ''), 'bundle asset manifest'))
  const assetsBytes = readFileSync(assetsPath)
  const assets = object(JSON.parse(assetsBytes.toString('utf8')), 'bundle asset manifest')
  if (assets.schemaVersion !== 1 || assets.packageName !== BUNDLE_NAME || assets.packageVersion !== BUNDLE_VERSION
    || !Array.isArray(assets.files)) {
    throw new TypeError('bundle asset manifest identity is incompatible')
  }
  validateAssets(root, assets)
  const primaryPresetRoot = join(root, 'presets', PRIMARY_PRESET_ID)
  return {
    root,
    manifest,
    assets,
    assetManifestIntegrity: bytesIntegrity(assetsBytes),
    primaryPresetRoot,
    channelRoot: join(root, 'channel'),
  }
}

/** Resolve the safe preset package from the bundle's dependency graph. */
/** @param {string} bundleRoot @returns {string} */
export function resolveSafePresetRoot(bundleRoot) {
  return packageRoot('@clawdsh/dsh-preset-messaging-safe', join(bundleRoot, 'package.json'))
}
