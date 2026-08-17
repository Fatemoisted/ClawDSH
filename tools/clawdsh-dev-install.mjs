/** Install the source-development profile without taking ownership of user configuration. */

import { createHash, randomBytes } from 'node:crypto'
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  bytesIntegrity,
  copyOrdinaryTree,
  entryExists,
  filenameTimestamp,
  ordinaryTreeDigest,
  privateDirectory,
  readJson,
  removeManagedEntry,
  requireKind,
  requireOrdinaryParents,
  writeJsonAtomic,
} from '../packages/openclaw/preset-openclaw/distribution/cli/lib/files.mjs'
import { acquireManagementLock } from '../packages/openclaw/preset-openclaw/distribution/cli/lib/transaction.mjs'

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PROFILE_SOURCE = join(REPOSITORY_ROOT, 'packages/openclaw/preset-openclaw/profile')
const DEV_BUNDLE_SOURCE = join(PROFILE_SOURCE, 'dev-bundle')
const PRIMARY_PRESET_SOURCE = join(REPOSITORY_ROOT, 'packages/openclaw/preset-openclaw')
const SAFE_PRESET_SOURCE = join(REPOSITORY_ROOT, 'packages/openclaw/preset-clawdsh-messaging-safe')
const DEV_MARKER = '.clawdsh-dev.json'
const PUBLIC_MARKER = '.clawdsh.json'
const PROFILE_ID = 'clawdsh'
const PRIMARY_PRESET_ID = 'clawdsh'
const SAFE_PRESET_ID = 'clawdsh-messaging-safe'
const PRESET_FILES = ['agent.cordis.yml', 'preset.yml', 'souls/assistant.md']
const INTEGRITY_PATTERN = /^sha512-[A-Za-z0-9+/]{86}==$/
const PACKAGE_LINKS = {
  'dsh-activity': 'activity',
  'dsh-automation': 'automation',
  'dsh-channel': 'channel',
  'dsh-channel-agent': 'channel-agent',
  'dsh-channel-openclaw': 'channel-openclaw',
  'dsh-embeddings': 'embeddings',
  'dsh-embeddings-ark': 'embeddings-ark',
  'dsh-memory': 'memory',
  'dsh-skills-hub': 'skills-hub',
  'dsh-soul': 'soul',
}

/** @typedef {{schemaVersion: 1, profileId: 'clawdsh', repositoryRoot: string, profile: {packageIntegrity: string}, bundle: {name: '@clawdsh/dsh-dev-bundle', patchIntegrity: string}, links: Record<string, string>, presets: Record<string, string>}} DevMarker */

function selectedHome() {
  const configured = process.env.CLAWDSH_DEV_HOME?.trim()
  const selected = configured === undefined || configured === '' ? join(homedir(), '.clawdsh-dev') : configured
  if (selected === '~') return homedir()
  if (selected.startsWith('~/') || selected.startsWith('~\\')) return resolve(homedir(), selected.slice(2))
  return resolve(selected)
}

/** @param {string} root @returns {string} */
function selectedPresetDigest(root) {
  const aggregate = createHash('sha512')
  for (const logical of [...PRESET_FILES].sort()) {
    const path = join(root, logical)
    requireKind(path, 'file')
    const bytes = readFileSync(path)
    aggregate.update(logical)
    aggregate.update('\0')
    aggregate.update(String(bytes.byteLength))
    aggregate.update('\0')
    aggregate.update(createHash('sha512').update(bytes).digest())
  }
  return `sha512-${aggregate.digest('base64')}`
}

/** @param {string} source @param {string} destination */
function copyPreset(source, destination) {
  privateDirectory(destination)
  for (const logical of PRESET_FILES) {
    const target = join(destination, logical)
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
    writeFileSync(target, readFileSync(join(source, logical)), { mode: 0o600 })
  }
}

/** @param {unknown} value @returns {DevMarker} */
function validateMarker(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('ClawDSH development marker is invalid')
  }
  const marker = /** @type {Record<string, any>} */ (value)
  if (marker.schemaVersion !== 1 || marker.profileId !== PROFILE_ID
    || typeof marker.repositoryRoot !== 'string' || !isAbsolute(marker.repositoryRoot)
    || marker.profile === null || typeof marker.profile !== 'object' || Array.isArray(marker.profile)
    || typeof marker.profile.packageIntegrity !== 'string'
    || !INTEGRITY_PATTERN.test(marker.profile.packageIntegrity)
    || marker.bundle === null || typeof marker.bundle !== 'object' || Array.isArray(marker.bundle)
    || marker.bundle.name !== '@clawdsh/dsh-dev-bundle'
    || typeof marker.bundle.patchIntegrity !== 'string'
    || !INTEGRITY_PATTERN.test(marker.bundle.patchIntegrity)
    || marker.links === null || typeof marker.links !== 'object' || Array.isArray(marker.links)
    || marker.presets === null || typeof marker.presets !== 'object' || Array.isArray(marker.presets)
    || typeof marker.presets[PRIMARY_PRESET_ID] !== 'string'
    || !INTEGRITY_PATTERN.test(marker.presets[PRIMARY_PRESET_ID])
    || typeof marker.presets[SAFE_PRESET_ID] !== 'string'
    || !INTEGRITY_PATTERN.test(marker.presets[SAFE_PRESET_ID])) {
    throw new TypeError('ClawDSH development marker is invalid')
  }
  const expectedLinkKeys = Object.keys(sourceLinks()).sort()
  if (Object.keys(marker.links).sort().join('\0') !== expectedLinkKeys.join('\0')
    || Object.values(marker.links).some(target => typeof target !== 'string' || !isAbsolute(target))) {
    throw new TypeError('ClawDSH development marker link inventory is invalid')
  }
  return /** @type {DevMarker} */ (marker)
}

function sourceLinks() {
  /** @type {Record<string, string>} */
  const links = {}
  for (const [packageName, directory] of Object.entries(PACKAGE_LINKS)) {
    links[`profiles/node_modules/@clawdsh/${packageName}`] = realpathSync(
      join(REPOSITORY_ROOT, 'packages/openclaw', directory),
    )
  }
  links['profiles/node_modules/@clawdsh/dsh-product-runtime'] = realpathSync(
    join(REPOSITORY_ROOT, 'packages/openclaw/preset-openclaw/product-shell/runtime'),
  )
  links['profiles/node_modules/@clawdsh/dsh-dev-bundle'] = realpathSync(DEV_BUNDLE_SOURCE)
  return Object.fromEntries(Object.entries(links).sort(([left], [right]) => left.localeCompare(right)))
}

function sourceMarker() {
  const profileBytes = readFileSync(join(PROFILE_SOURCE, 'package.template.json'))
  const patchBytes = readFileSync(join(DEV_BUNDLE_SOURCE, 'cordis.patch.yml'))
  return /** @type {DevMarker} */ ({
    schemaVersion: 1,
    profileId: PROFILE_ID,
    repositoryRoot: realpathSync(REPOSITORY_ROOT),
    profile: { packageIntegrity: bytesIntegrity(profileBytes) },
    bundle: {
      name: '@clawdsh/dsh-dev-bundle',
      patchIntegrity: bytesIntegrity(patchBytes),
    },
    links: sourceLinks(),
    presets: {
      [PRIMARY_PRESET_ID]: selectedPresetDigest(PRIMARY_PRESET_SOURCE),
      [SAFE_PRESET_ID]: selectedPresetDigest(SAFE_PRESET_SOURCE),
    },
  })
}

/** @param {string} home @param {DevMarker} marker */
function modifiedAssets(home, marker) {
  /** @type {string[]} */
  const modified = []
  const packagePath = join(home, 'profiles', PROFILE_ID, 'package.json')
  try {
    requireKind(packagePath, 'file')
    if (bytesIntegrity(readFileSync(packagePath)) !== marker.profile.packageIntegrity) modified.push('profile package.json')
  } catch {
    modified.push('profile package.json')
  }
  const patchPath = join(home, 'profiles', PROFILE_ID, 'cordis.patch.yml')
  try {
    requireKind(patchPath, 'file')
  } catch {
    modified.push('user profile patch filesystem type')
  }
  for (const [logical, expectedTarget] of Object.entries(marker.links)) {
    const target = join(home, logical)
    try {
      const metadata = lstatSync(target)
      if (!metadata.isSymbolicLink() || realpathSync(target) !== expectedTarget) modified.push(logical)
    } catch {
      modified.push(logical)
    }
  }
  for (const id of [PRIMARY_PRESET_ID, SAFE_PRESET_ID]) {
    try {
      if (ordinaryTreeDigest(join(home, '.agent-presets', id)).integrity !== marker.presets[id]) {
        modified.push(`preset ${id}`)
      }
    } catch {
      modified.push(`preset ${id}`)
    }
  }
  return modified
}

/** @param {string} home @param {DevMarker} marker @param {string[]} modified @returns {string} */
function backUpModified(home, marker, modified) {
  const digest = createHash('sha512').update(JSON.stringify({ marker, modified })).digest('hex').slice(0, 12)
  const backupLogical = `.clawdsh-dev-backups/source-${filenameTimestamp()}-${digest}`
  const backupRoot = join(home, backupLogical)
  if (entryExists(backupRoot)) throw new Error(`development backup target already exists: ${backupRoot}`)
  requireOrdinaryParents(home, backupLogical, 'ClawDSH development backup')
  privateDirectory(backupRoot)
  try {
    const profile = join(home, 'profiles', PROFILE_ID)
    if (entryExists(profile)) copyOrdinaryTree(profile, join(backupRoot, 'profile'))
    for (const id of [PRIMARY_PRESET_ID, SAFE_PRESET_ID]) {
      const preset = join(home, '.agent-presets', id)
      if (entryExists(preset)) copyOrdinaryTree(preset, join(backupRoot, 'presets', id))
    }
    const links = Object.keys(marker.links).map(logical => {
      const path = join(home, logical)
      if (!entryExists(path)) return { path: logical, kind: 'absent' }
      const metadata = lstatSync(path)
      if (metadata.isSymbolicLink()) return { path: logical, kind: 'symlink', target: readlinkSync(path) }
      if (metadata.isDirectory() || metadata.isFile()) {
        const backup = `link-assets/${logical}`
        copyOrdinaryTree(path, join(backupRoot, backup))
        return { path: logical, kind: metadata.isDirectory() ? 'directory' : 'file', backup }
      }
      throw new Error(`refusing to back up special development link replacement: ${path}`)
    })
    writeJsonAtomic(join(backupRoot, 'links.json'), {
      schemaVersion: 1,
      links,
      modified,
    })
    return backupRoot
  } catch (error) {
    removeManagedEntry(backupRoot)
    throw error
  }
}

/** @param {string} home @param {DevMarker} nextMarker @param {DevMarker | undefined} previousMarker */
function publish(home, nextMarker, previousMarker) {
  const transaction = join(home, `.clawdsh-dev-staging-${process.pid}-${randomBytes(8).toString('hex')}`)
  const candidates = join(transaction, 'candidate')
  const backups = join(transaction, 'backup')
  privateDirectory(candidates)
  privateDirectory(backups)
  /** @type {Array<{logical: string, candidate: string, expected: 'file' | 'directory' | 'symlink'}>} */
  const operations = []
  const profileRoot = join(home, 'profiles', PROFILE_ID)
  if (previousMarker === undefined) {
    const stagedProfile = join(candidates, 'profile')
    privateDirectory(stagedProfile)
    writeFileSync(join(stagedProfile, 'package.json'), readFileSync(join(PROFILE_SOURCE, 'package.template.json')), { mode: 0o600 })
    writeFileSync(join(stagedProfile, 'cordis.patch.yml'), readFileSync(join(PROFILE_SOURCE, 'cordis.patch.yml')), { mode: 0o600 })
    operations.push({ logical: `profiles/${PROFILE_ID}`, candidate: 'profile', expected: 'directory' })
  } else {
    writeFileSync(join(candidates, 'profile-package.json'), readFileSync(join(PROFILE_SOURCE, 'package.template.json')), { mode: 0o600 })
    operations.push({
      logical: `profiles/${PROFILE_ID}/package.json`,
      candidate: 'profile-package.json',
      expected: 'file',
    })
  }
  copyPreset(PRIMARY_PRESET_SOURCE, join(candidates, 'primary-preset'))
  copyPreset(SAFE_PRESET_SOURCE, join(candidates, 'safe-preset'))
  operations.push(
    { logical: `.agent-presets/${PRIMARY_PRESET_ID}`, candidate: 'primary-preset', expected: 'directory' },
    { logical: `.agent-presets/${SAFE_PRESET_ID}`, candidate: 'safe-preset', expected: 'directory' },
  )
  let linkIndex = 0
  for (const [logical, target] of Object.entries(nextMarker.links)) {
    const candidate = `link-${String(linkIndex).padStart(2, '0')}`
    symlinkSync(target, join(candidates, candidate), 'dir')
    operations.push({ logical, candidate, expected: 'symlink' })
    linkIndex += 1
  }
  writeJsonAtomic(join(candidates, 'marker.json'), nextMarker)
  operations.push({ logical: DEV_MARKER, candidate: 'marker.json', expected: 'file' })

  /** @type {Array<{target: string, backup: string, hadTarget: boolean}>} */
  const published = []
  try {
    for (const [index, operation] of operations.entries()) {
      requireOrdinaryParents(home, operation.logical, 'ClawDSH development target')
      const target = join(home, operation.logical)
      const candidate = join(candidates, operation.candidate)
      const backup = join(backups, String(index).padStart(3, '0'))
      const hadTarget = entryExists(target)
      if (hadTarget) renameSync(target, backup)
      published.push({ target, backup, hadTarget })
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
      renameSync(candidate, target)
    }
  } catch (error) {
    for (const item of [...published].reverse()) {
      if (entryExists(item.target)) removeManagedEntry(item.target)
      if (item.hadTarget && entryExists(item.backup)) renameSync(item.backup, item.target)
    }
    removeManagedEntry(transaction)
    throw error
  }
  removeManagedEntry(transaction)
  chmodSync(profileRoot, 0o700)
}

/** @param {string} home */
function warnForLegacyOpenClaw(home) {
  for (const [label, logical] of [
    ['profile', 'profiles/openclaw'],
    ['agent preset', '.agent-presets/openclaw'],
    ['restricted preset', '.agent-presets/openclaw-messaging-safe'],
  ]) {
    const path = join(home, logical)
    if (entryExists(path)) process.stderr.write(`Warning: legacy OpenClaw ${label} remains at ${path}; the source installer will not modify it.\n`)
  }
}

/** Refresh one locked development home. */
/** @param {string} home @param {boolean} backupModified */
function refresh(home, backupModified) {
  if (entryExists(join(home, PUBLIC_MARKER))) {
    throw new Error(`refusing to use public managed home ${home}; choose a separate CLAWDSH_DEV_HOME`)
  }
  warnForLegacyOpenClaw(home)
  const nextMarker = sourceMarker()
  /** @type {DevMarker | undefined} */
  let previousMarker
  const markerPath = join(home, DEV_MARKER)
  if (entryExists(markerPath)) previousMarker = validateMarker(readJson(markerPath, 'ClawDSH development marker'))
  const ownershipTargets = [
    join(home, 'profiles', PROFILE_ID),
    join(home, '.agent-presets', PRIMARY_PRESET_ID),
    join(home, '.agent-presets', SAFE_PRESET_ID),
    ...Object.keys(nextMarker.links).map(logical => join(home, logical)),
  ]
  if (previousMarker === undefined && ownershipTargets.some(entryExists)) {
    throw new Error(`refusing to take over unmarked ClawDSH development assets in ${home}`)
  }
  const modified = previousMarker === undefined ? [] : modifiedAssets(home, previousMarker)
  if (modified.length > 0 && !backupModified) {
    throw new Error(`development-managed assets were modified (${modified.join(', ')}); rerun with --backup-modified to back them up before refresh`)
  }
  if (modified.length > 0) {
    if (previousMarker === undefined) throw new Error('modified development assets have no ownership marker')
    const backup = backUpModified(home, previousMarker, modified)
    process.stderr.write(`Backed up modified development assets to ${backup}.\n`)
  }
  publish(home, nextMarker, previousMarker)
  process.stdout.write(`ClawDSH source profile refreshed in ${home}.\n`)
}

function main() {
  const args = process.argv.slice(2)
  const backupModified = args.length === 1 && args[0] === '--backup-modified'
  if (args.length > 0 && !backupModified) throw new TypeError('usage: tools/link-clawdsh.sh [--backup-modified]')
  const home = selectedHome()
  if (!entryExists(home)) mkdirSync(home, { recursive: true, mode: 0o700 })
  requireKind(home, 'directory')
  const releaseLock = acquireManagementLock(home)
  try {
    refresh(home, backupModified)
  } finally {
    releaseLock()
  }
}

try {
  main()
} catch (error) {
  process.stderr.write(`link-clawdsh: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
