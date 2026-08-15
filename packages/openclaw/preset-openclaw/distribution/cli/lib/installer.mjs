/** Idempotent managed-profile and Agent-preset installation. */

import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  BUNDLE_NAME,
  BUNDLE_VERSION,
  CLI_VERSION,
  MARKER_FILENAME,
  MARKER_SCHEMA_VERSION,
  PRIMARY_PRESET_ID,
  PROFILE_BUNDLES,
  PROFILE_ID,
  SAFE_PRESET_ID,
} from './constants.mjs'
import { inspectBundle } from './bundle.mjs'
import {
  bytesIntegrity,
  copyOrdinaryTree,
  filenameTimestamp,
  homeDirectory,
  jsonIntegrity,
  ordinaryTreeDigest,
  privateDirectory,
  readJson,
  requireKind,
  writeJsonAtomic,
} from './files.mjs'
import { beginTransaction, commitTransaction, recoverTransactions } from './transaction.mjs'

const EMPTY_USER_PATCH = '# User-owned ClawDSH profile overrides. This file is never replaced by the ClawDSH installer.\n[]\n'
const PROFILE_WORKSPACE = 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n'
const PUBLIC_NPM_REGISTRY = 'https://registry.npmjs.org/'

/** Marker JSON is validated for installer identity before its managed fields are used. @typedef {Record<string, any>} MarkerJson */
/** @typedef {{home: string, bundleRoot: string, npmRunner?: (cwd: string) => void, now?: () => Date, out?: (message: string) => void, warn?: (message: string) => void}} InstallerOptions */

function profileManifest() {
  return {
    name: 'clawdsh-managed-profile',
    private: true,
    dependencies: {
      '@deepseek-ai/dsh-base': '0.1.0-rc.6',
      '@deepseek-ai/dsh-web-app': '0.1.0-rc.6',
      [BUNDLE_NAME]: BUNDLE_VERSION,
    },
    dsh: { profile: { bundles: [...PROFILE_BUNDLES] } },
  }
}

function scrubbedEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => {
    const upper = name.toUpperCase()
    return !upper.includes('KEY') && !upper.includes('SECRET') && !upper.includes('TOKEN')
      && !upper.includes('PASSWORD') && upper !== 'NODE_OPTIONS' && upper !== 'NODE_PATH'
  }))
}

/** Run npm with scripts disabled and no ambient credential variables. */
/** @param {string} cwd @param {typeof spawnSync} [run] @returns {void} */
export function defaultNpmRunner(cwd, run = spawnSync) {
  const outcome = run('npm', [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    '--legacy-peer-deps',
    `--registry=${PUBLIC_NPM_REGISTRY}`,
    `--@clawdsh:registry=${PUBLIC_NPM_REGISTRY}`,
    `--@deepseek-ai:registry=${PUBLIC_NPM_REGISTRY}`,
  ], { cwd, env: scrubbedEnvironment(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (outcome.status !== 0 || outcome.signal !== null) {
    throw new Error(`ClawDSH profile dependency installation failed (exit ${String(outcome.status)}, signal ${String(outcome.signal)})`)
  }
}

/** @param {string} home @returns {string} */
function markerPath(home) {
  return join(home, MARKER_FILENAME)
}

/** @param {unknown} value @returns {MarkerJson} */
function validateMarker(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('ClawDSH management marker is invalid')
  }
  const marker = /** @type {MarkerJson} */ (value)
  if (marker.schemaVersion !== MARKER_SCHEMA_VERSION || marker.profileId !== PROFILE_ID
    || marker.version === undefined || marker.bundle === null || typeof marker.bundle !== 'object'
    || Array.isArray(marker.bundle) || marker.presets === null || typeof marker.presets !== 'object'
    || Array.isArray(marker.presets) || marker.assets === null || typeof marker.assets !== 'object'
    || Array.isArray(marker.assets) || marker.channel === null || typeof marker.channel !== 'object'
    || Array.isArray(marker.channel)) {
    throw new TypeError('ClawDSH management marker is invalid')
  }
  return marker
}

/** Read the existing management marker without touching any product data. */
/** @param {string} home @returns {MarkerJson | undefined} */
export function readMarker(home) {
  const path = markerPath(home)
  return existsSync(path) ? validateMarker(readJson(path, 'ClawDSH management marker')) : undefined
}

/** @param {string} home @param {(message: string) => void} warn */
function legacyWarnings(home, warn) {
  for (const [label, path] of [
    ['profile', join(home, 'profiles', 'openclaw')],
    ['preset', join(home, '.agent-presets', 'openclaw')],
    ['messaging preset', join(home, '.agent-presets', 'openclaw-messaging-safe')],
  ]) {
    if (existsSync(path)) warn(`Warning: legacy OpenClaw ${label} remains at ${path}; ClawDSH will not modify or remove it.`)
  }
}

/** @param {string} path @returns {string} */
function presetDigest(path) {
  return ordinaryTreeDigest(path).integrity
}

/** @param {string} home @param {MarkerJson | undefined} marker @param {string} id @param {boolean} resetPreset @param {() => Date} now @param {(message: string) => void} warn */
function checkPresetMutation(home, marker, id, resetPreset, now, warn) {
  const target = join(home, '.agent-presets', id)
  if (!existsSync(target)) return
  requireKind(target, 'directory')
  const recorded = marker?.presets?.[id]
  if (typeof recorded !== 'string') {
    if (marker !== undefined) throw new Error(`ClawDSH marker has no recorded digest for managed preset ${id}`)
    if (!resetPreset) throw new Error(`refusing to take over unmarked preset ${target}`)
    const actual = presetDigest(target)
    const suffix = actual.replace(/^sha512-/, '').replace(/[^A-Za-z0-9]/g, '').slice(0, 12)
    const backup = join(home, '.agent-presets', `${id}.backup-${filenameTimestamp(now())}-${suffix}`)
    if (existsSync(backup)) throw new Error(`preset backup target already exists: ${backup}`)
    copyOrdinaryTree(target, backup)
    warn(`Backed up unmarked preset ${id} to ${backup}.`)
    return
  }
  const actual = presetDigest(target)
  if (actual === recorded) return
  if (!resetPreset) {
    throw new Error(`managed preset ${id} was modified; rerun init --reset-preset to back it up and restore the managed version`)
  }
  const suffix = actual.replace(/^sha512-/, '').replace(/[^A-Za-z0-9]/g, '').slice(0, 12)
  const backup = join(home, '.agent-presets', `${id}.backup-${filenameTimestamp(now())}-${suffix}`)
  if (existsSync(backup)) throw new Error(`preset backup target already exists: ${backup}`)
  copyOrdinaryTree(target, backup)
  warn(`Backed up modified preset ${id} to ${backup}.`)
}

/** @param {string} profileRoot @returns {ReturnType<typeof inspectBundle>} */
function inspectInstalledBundle(profileRoot) {
  const root = join(profileRoot, 'node_modules', '@clawdsh', 'dsh-bundle')
  return inspectBundle(root)
}

/** @param {string} profileRoot @returns {ReturnType<typeof inspectBundle>} */
function validateInstalledProfileLayers(profileRoot) {
  for (const [name, version] of [
    ['@deepseek-ai/dsh-base', '0.1.0-rc.6'],
    ['@deepseek-ai/dsh-web-app', '0.1.0-rc.6'],
  ]) {
    const manifest = readJson(join(profileRoot, 'node_modules', name, 'package.json'), `installed profile layer ${name}`)
    if (manifest.name !== name || manifest.version !== version) {
      throw new TypeError(`installed profile layer must be exactly ${name}@${version}`)
    }
  }
  return inspectInstalledBundle(profileRoot)
}

/** @param {string} profileRoot @returns {string} */
function validateInstalledSafePreset(profileRoot) {
  const root = join(profileRoot, 'node_modules', '@clawdsh', 'dsh-preset-messaging-safe')
  const manifest = readJson(join(root, 'package.json'), 'installed messaging-safe preset package')
  if (manifest.name !== '@clawdsh/dsh-preset-messaging-safe' || manifest.version !== BUNDLE_VERSION) {
    throw new TypeError('installed messaging-safe preset package identity is invalid')
  }
  for (const path of ['preset.yml', 'agent.cordis.yml', 'souls/assistant.md']) requireKind(join(root, path), 'file')
  return root
}

/** @param {ReturnType<typeof inspectBundle>} installedBundle @param {string} primaryDigest @param {string} safeDigest @param {string} profileDigest @param {MarkerJson | undefined} previous @returns {MarkerJson} */
function expectedMarker(installedBundle, primaryDigest, safeDigest, profileDigest, previous) {
  return {
    schemaVersion: MARKER_SCHEMA_VERSION,
    version: CLI_VERSION,
    profileId: PROFILE_ID,
    bundle: {
      name: BUNDLE_NAME,
      version: BUNDLE_VERSION,
      assetManifestIntegrity: installedBundle.assetManifestIntegrity,
    },
    assets: {
      'profiles/clawdsh/package.json': profileDigest,
      'profiles/clawdsh/node_modules/@clawdsh/dsh-bundle/assets.json': installedBundle.assetManifestIntegrity,
    },
    presets: {
      [PRIMARY_PRESET_ID]: primaryDigest,
      [SAFE_PRESET_ID]: safeDigest,
    },
    channel: previous?.channel ?? { status: 'not-installed', track: 'production' },
  }
}

/** @param {string} home @param {string | undefined} expectedBundleRoot @returns {{ok: boolean, errors: string[], marker: MarkerJson | undefined}} */
function doctorProfile(home, expectedBundleRoot) {
  /** @type {string[]} */
  const errors = []
  /** @type {MarkerJson | undefined} */
  let marker
  try {
    marker = readMarker(home)
    if (marker === undefined) errors.push('management marker is absent')
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }
  if (marker === undefined) return { ok: false, errors, marker: undefined }
  const profileRoot = join(home, 'profiles', PROFILE_ID)
  try {
    const manifest = readJson(join(profileRoot, 'package.json'), 'managed profile package.json')
    if (jsonIntegrity(manifest) !== marker.assets['profiles/clawdsh/package.json']) errors.push('managed profile manifest digest differs')
    const bundles = manifest?.dsh?.profile?.bundles
    if (!Array.isArray(bundles) || bundles.length !== PROFILE_BUNDLES.length
      || bundles.some((value, index) => value !== PROFILE_BUNDLES[index])) errors.push('managed profile bundle order differs')
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }
  try {
    const installed = validateInstalledProfileLayers(profileRoot)
    if (installed.assetManifestIntegrity !== marker.bundle.assetManifestIntegrity) errors.push('installed bundle asset digest differs')
    if (expectedBundleRoot !== undefined
      && inspectBundle(expectedBundleRoot).assetManifestIntegrity !== installed.assetManifestIntegrity) {
      errors.push('installed bundle differs from the CLI bundle')
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }
  for (const id of [PRIMARY_PRESET_ID, SAFE_PRESET_ID]) {
    try {
      const actual = presetDigest(join(home, '.agent-presets', id))
      if (actual !== marker.presets[id]) errors.push(`managed preset ${id} digest differs`)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  return { ok: errors.length === 0, errors, marker }
}

/** Create the managed installer with explicit I/O seams for keyless tests. */
/** @param {InstallerOptions} options */
export function createInstaller(options) {
  const home = resolve(options.home)
  const bundleRoot = resolve(options.bundleRoot)
  const npmRunner = options.npmRunner ?? defaultNpmRunner
  const now = options.now ?? (() => new Date())
  const out = options.out ?? (() => {})
  const warn = options.warn ?? (() => {})

  return {
    /** Install or upgrade the managed profile and presets without changing user data. */
    /** @param {{resetPreset?: boolean}} [initOptions] */
    init({ resetPreset = false } = {}) {
      homeDirectory(home)
      recoverTransactions(home)
      legacyWarnings(home, warn)
      const sourceBundle = inspectBundle(bundleRoot)
      const existingMarker = readMarker(home)
      const profileRoot = join(home, 'profiles', PROFILE_ID)
      if (existsSync(profileRoot) && existingMarker === undefined) {
        throw new Error(`refusing to take over unmarked profile ${profileRoot}`)
      }
      if (existingMarker !== undefined) {
        const diagnosis = doctorProfile(home, bundleRoot)
        if (diagnosis.ok && existingMarker.version === CLI_VERSION && !resetPreset) {
          out('ClawDSH is already initialized.')
          return existingMarker
        }
      }
      checkPresetMutation(home, existingMarker, PRIMARY_PRESET_ID, resetPreset, now, warn)
      checkPresetMutation(home, existingMarker, SAFE_PRESET_ID, resetPreset, now, warn)

      const tx = beginTransaction(home, 'init')
      const stagedProfile = join(tx.candidateRoot, 'profile')
      privateDirectory(stagedProfile)
      const manifest = profileManifest()
      writeJsonAtomic(join(stagedProfile, 'package.json'), manifest)
      writeFileSync(join(stagedProfile, 'cordis.patch.yml'), EMPTY_USER_PATCH, { mode: 0o600 })
      writeFileSync(join(stagedProfile, 'pnpm-workspace.yaml'), PROFILE_WORKSPACE, { mode: 0o600 })
      npmRunner(stagedProfile)
      requireKind(join(stagedProfile, 'node_modules'), 'directory')
      const installedBundle = validateInstalledProfileLayers(stagedProfile)
      if (installedBundle.assetManifestIntegrity !== sourceBundle.assetManifestIntegrity) {
        throw new Error('installed ClawDSH bundle differs from the exact CLI dependency')
      }
      const installedSafeRoot = validateInstalledSafePreset(stagedProfile)
      copyOrdinaryTree(installedBundle.primaryPresetRoot, join(tx.candidateRoot, 'primary-preset'))
      copyOrdinaryTree(installedSafeRoot, join(tx.candidateRoot, 'safe-preset'))
      const primaryDigest = presetDigest(join(tx.candidateRoot, 'primary-preset'))
      const safeDigest = presetDigest(join(tx.candidateRoot, 'safe-preset'))
      const profileDigest = jsonIntegrity(manifest)
      const marker = expectedMarker(installedBundle, primaryDigest, safeDigest, profileDigest, existingMarker)
      writeJsonAtomic(join(tx.candidateRoot, 'marker.json'), marker)

      /** @type {Array<{target: string, candidate: string, kind: 'file' | 'directory'}>} */
      const operations = []
      if (!existsSync(profileRoot)) {
        operations.push({ target: `profiles/${PROFILE_ID}`, candidate: 'profile', kind: 'directory' })
      } else {
        operations.push(
          { target: `profiles/${PROFILE_ID}/package.json`, candidate: 'profile/package.json', kind: 'file' },
          { target: `profiles/${PROFILE_ID}/node_modules`, candidate: 'profile/node_modules', kind: 'directory' },
        )
      }
      operations.push(
        { target: `.agent-presets/${PRIMARY_PRESET_ID}`, candidate: 'primary-preset', kind: 'directory' },
        { target: `.agent-presets/${SAFE_PRESET_ID}`, candidate: 'safe-preset', kind: 'directory' },
        { target: MARKER_FILENAME, candidate: 'marker.json', kind: 'file' },
      )
      commitTransaction(tx, operations)
      out('ClawDSH initialized.')
      return marker
    },

    /** Verify only installer-owned profile and preset data. */
    doctor() {
      recoverTransactions(home)
      const diagnosis = doctorProfile(home, bundleRoot)
      if (!diagnosis.ok) throw new Error(`ClawDSH doctor found managed installation problems: ${diagnosis.errors.join('; ')}`)
      out('ClawDSH managed profile and presets are healthy.')
      return diagnosis.marker
    },

    home,
    bundleRoot,
  }
}
