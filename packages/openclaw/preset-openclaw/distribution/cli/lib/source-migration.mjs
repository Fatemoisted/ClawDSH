/** Closed recognition and owner-only backup of the historical source-linked installation. */

import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readlinkSync, realpathSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
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
} from './files.mjs'
import { MARKER_FILENAME, PRIMARY_PRESET_ID, PROFILE_ID, SAFE_PRESET_ID } from './constants.mjs'

const DEV_MARKER_FILENAME = '.clawdsh-dev.json'
const BACKUP_SCHEMA_VERSION = 1
// These identities and digests close takeover to the final unmarked source
// installer layout. Recognized content drift still requires explicit backup.
const LEGACY_MANIFEST = {
  name: 'clawdsh',
  private: true,
  dsh: {
    profile: {
      bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
    },
  },
}
const LEGACY_MANIFEST_INTEGRITY = 'sha512-pSyNpiaaUxDlydEq1zZz0C2g1oiicvkuUOK3QbPx4qGdukjQluPWy6pd8cz2mQcQz1TVnaZe3H2RM+gSfFEX6g=='
const LEGACY_PATCH_INTEGRITIES = new Set([
  'sha512-T4/q/7vp/KmKrINUInyGIc7cQc8cuOkncCpNZJnv4xS84/4OPdVj/USxJJGvQZTKdJX43RzwPsRRSK6PD91+UQ==',
])
const LEGACY_PRESET_INTEGRITIES = {
  [PRIMARY_PRESET_ID]: new Set([
    'sha512-6j1TlDujMmUwakIvGxLNqdZuhLRFrsxuqGN0+fuHp+28UBUdWne7FMUUW3xg4xOpRuCMz8yT5NK5cfrPMBlp5w==',
  ]),
  [SAFE_PRESET_ID]: new Set([
    'sha512-I9w8krpCxljoCeYAmttg6H8iSQoPnD156nBBsPkBN9yX0aaPSQh4d52SAmR7QVoTg5Vy7DjTcX1A+tjLIR433A==',
  ]),
}
const LEGACY_LINKS = {
  'profiles/node_modules/@clawdsh/dsh-activity': {
    name: '@clawdsh/dsh-activity',
    suffix: 'packages/openclaw/activity',
  },
  'profiles/node_modules/@clawdsh/dsh-automation': {
    name: '@clawdsh/dsh-automation',
    suffix: 'packages/openclaw/automation',
  },
  'profiles/node_modules/@clawdsh/dsh-channel': {
    name: '@clawdsh/dsh-channel',
    suffix: 'packages/openclaw/channel',
  },
  'profiles/node_modules/@clawdsh/dsh-channel-agent': {
    name: '@clawdsh/dsh-channel-agent',
    suffix: 'packages/openclaw/channel-agent',
  },
  'profiles/node_modules/@clawdsh/dsh-channel-openclaw': {
    name: '@clawdsh/dsh-channel-openclaw',
    suffix: 'packages/openclaw/channel-openclaw',
  },
  'profiles/node_modules/@clawdsh/dsh-embeddings': {
    name: '@clawdsh/dsh-embeddings',
    suffix: 'packages/openclaw/embeddings',
  },
  'profiles/node_modules/@clawdsh/dsh-embeddings-ark': {
    name: '@clawdsh/dsh-embeddings-ark',
    suffix: 'packages/openclaw/embeddings-ark',
  },
  'profiles/node_modules/@clawdsh/dsh-memory': {
    name: '@clawdsh/dsh-memory',
    suffix: 'packages/openclaw/memory',
  },
  'profiles/node_modules/@clawdsh/dsh-product-runtime': {
    name: '@clawdsh/dsh-product-runtime',
    suffix: 'packages/openclaw/preset-openclaw/product-shell/runtime',
  },
  'profiles/node_modules/@clawdsh/dsh-skills-hub': {
    name: '@clawdsh/dsh-skills-hub',
    suffix: 'packages/openclaw/skills-hub',
  },
  'profiles/node_modules/@clawdsh/dsh-soul': {
    name: '@clawdsh/dsh-soul',
    suffix: 'packages/openclaw/soul',
  },
}

/** Return whether profile or flat source links require explicit migration classification. */
/** @param {string} home @returns {boolean} */
export function hasSourceInstallationFootprint(home) {
  return entryExists(join(home, 'profiles', PROFILE_ID))
    || Object.keys(LEGACY_LINKS).some(path => entryExists(join(home, path)))
}

/** @typedef {{logical: string, target: string, resolvedTarget: string, packageName: string}} LegacyLink */
/** @typedef {{kind: 'known', modified: string[], links: LegacyLink[], profileRoot: string, presetRoots: Record<string, string>, evidenceIntegrity: string} | {kind: 'none'} | {kind: 'unknown', reason: string}} SourceInspection */

/** @param {unknown} value @returns {value is Record<string, any>} */
function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** @param {unknown} manifest */
function hasLegacyManifestIdentity(manifest) {
  return record(manifest) && manifest.name === 'clawdsh' && manifest.private === true
    && record(manifest.dsh) && record(manifest.dsh.profile)
    && Array.isArray(manifest.dsh.profile.bundles)
    && manifest.dsh.profile.bundles.length === 2
    && manifest.dsh.profile.bundles[0] === '@deepseek-ai/dsh-base'
    && manifest.dsh.profile.bundles[1] === '@deepseek-ai/dsh-web-app'
}

/** @param {string} target @param {string} suffix @returns {string | undefined} */
function repositoryRootFor(target, suffix) {
  const parts = suffix.split('/')
  let root = target
  for (const _part of parts) root = dirname(root)
  return resolve(root, suffix) === target ? root : undefined
}

/** Inspect only historical installer-owned paths; no product data or credential file is opened. */
/** @param {string} home @returns {SourceInspection} */
export function inspectSourceInstallation(home) {
  if (entryExists(join(home, MARKER_FILENAME))) return { kind: 'unknown', reason: 'a public management marker already exists' }
  if (entryExists(join(home, DEV_MARKER_FILENAME))) return { kind: 'unknown', reason: 'a source-development marker already exists' }
  const profileRoot = join(home, 'profiles', PROFILE_ID)
  const presetRoots = {
    [PRIMARY_PRESET_ID]: join(home, '.agent-presets', PRIMARY_PRESET_ID),
    [SAFE_PRESET_ID]: join(home, '.agent-presets', SAFE_PRESET_ID),
  }
  const ownershipPaths = [profileRoot, ...Object.values(presetRoots), ...Object.keys(LEGACY_LINKS).map(path => join(home, path))]
  if (!ownershipPaths.some(entryExists)) return { kind: 'none' }
  if (!ownershipPaths.every(entryExists)) return { kind: 'unknown', reason: 'the historical source asset set is incomplete' }

  try {
    requireOrdinaryParents(home, `profiles/${PROFILE_ID}/package.json`, 'historical source profile')
    requireOrdinaryParents(home, `.agent-presets/${PRIMARY_PRESET_ID}/preset.yml`, 'historical source preset')
    requireOrdinaryParents(home, `.agent-presets/${SAFE_PRESET_ID}/preset.yml`, 'historical source preset')
    for (const logical of Object.keys(LEGACY_LINKS)) {
      requireOrdinaryParents(home, logical, 'historical source link')
    }
    requireKind(profileRoot, 'directory')
    for (const root of Object.values(presetRoots)) requireKind(root, 'directory')
    const manifestPath = join(profileRoot, 'package.json')
    const manifestBytes = readFileSync(manifestPath)
    const manifest = readJson(manifestPath, 'historical source profile package.json')
    if (!hasLegacyManifestIdentity(manifest)) {
      return { kind: 'unknown', reason: 'the profile package identity is not a known ClawDSH source layout' }
    }
    requireKind(join(profileRoot, 'cordis.patch.yml'), 'file')
    /** @type {string[]} */
    const modified = []
    const manifestIntegrity = bytesIntegrity(manifestBytes)
    if (manifestIntegrity !== LEGACY_MANIFEST_INTEGRITY) modified.push('profile package.json')
    const patchIntegrity = bytesIntegrity(readFileSync(join(profileRoot, 'cordis.patch.yml')))
    if (!LEGACY_PATCH_INTEGRITIES.has(patchIntegrity)) modified.push('profile cordis.patch.yml')
    const profileEntries = readdirSync(profileRoot).sort()
    if (profileEntries.join('\0') !== 'cordis.patch.yml\0package.json') modified.push('additional profile entries')
    const profileTreeIntegrity = ordinaryTreeDigest(profileRoot).integrity
    const primaryPresetIntegrity = ordinaryTreeDigest(presetRoots[PRIMARY_PRESET_ID]).integrity
    const safePresetIntegrity = ordinaryTreeDigest(presetRoots[SAFE_PRESET_ID]).integrity
    const presetIntegrities = {
      [PRIMARY_PRESET_ID]: primaryPresetIntegrity,
      [SAFE_PRESET_ID]: safePresetIntegrity,
    }
    if (!LEGACY_PRESET_INTEGRITIES[PRIMARY_PRESET_ID].has(primaryPresetIntegrity)) {
      modified.push(`preset ${PRIMARY_PRESET_ID}`)
    }
    if (!LEGACY_PRESET_INTEGRITIES[SAFE_PRESET_ID].has(safePresetIntegrity)) {
      modified.push(`preset ${SAFE_PRESET_ID}`)
    }

    /** @type {LegacyLink[]} */
    const links = []
    let repositoryRoot
    for (const [logical, identity] of Object.entries(LEGACY_LINKS)) {
      const path = join(home, logical)
      const metadata = lstatSync(path)
      if (!metadata.isSymbolicLink()) {
        return { kind: 'unknown', reason: `historical source link is not a symbolic link: ${logical}` }
      }
      const resolvedTarget = realpathSync(path)
      const manifest = readJson(join(resolvedTarget, 'package.json'), `historical source package ${identity.name}`)
      if (manifest.name !== identity.name || manifest.version !== '0.1.0-rc.1') {
        return { kind: 'unknown', reason: `historical source package identity differs: ${identity.name}` }
      }
      const candidateRoot = repositoryRootFor(resolvedTarget, identity.suffix)
      if (candidateRoot === undefined || (repositoryRoot !== undefined && candidateRoot !== repositoryRoot)) {
        return { kind: 'unknown', reason: 'historical source links do not resolve into one ClawDSH checkout' }
      }
      repositoryRoot = candidateRoot
      links.push({ logical, target: readlinkSync(path), resolvedTarget, packageName: identity.name })
    }
    const evidence = {
      manifest: manifestIntegrity,
      profileTree: profileTreeIntegrity,
      patch: patchIntegrity,
      presets: presetIntegrities,
      links: links.map(({ logical, target, resolvedTarget, packageName }) => ({
        logical,
        target,
        resolvedTarget,
        packageName,
      })),
    }
    return {
      kind: 'known',
      modified,
      links,
      profileRoot,
      presetRoots,
      evidenceIntegrity: bytesIntegrity(Buffer.from(`${JSON.stringify(evidence)}\n`)),
    }
  } catch (error) {
    return { kind: 'unknown', reason: error instanceof Error ? error.message : String(error) }
  }
}

/** Persist a complete owner-only backup of every historical source-owned asset. */
/** @param {string} home @param {Extract<SourceInspection, {kind: 'known'}>} inspection @param {Date} now @returns {string} */
export function backUpSourceInstallation(home, inspection, now) {
  const suffix = createHash('sha512').update(inspection.evidenceIntegrity).digest('hex').slice(0, 12)
  const backupLogical = `.clawdsh-backups/source-${filenameTimestamp(now)}-${suffix}`
  const backupRoot = join(home, backupLogical)
  if (entryExists(backupRoot)) throw new Error(`source migration backup target already exists: ${backupRoot}`)
  try {
    requireOrdinaryParents(home, backupLogical, 'source migration backup')
    privateDirectory(backupRoot)
    copyOrdinaryTree(inspection.profileRoot, join(backupRoot, 'profile'))
    for (const [id, root] of Object.entries(inspection.presetRoots)) {
      copyOrdinaryTree(root, join(backupRoot, 'presets', id))
    }
    writeJsonAtomic(join(backupRoot, 'source-backup.json'), {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      profileId: PROFILE_ID,
      createdAt: now.toISOString(),
      evidenceIntegrity: inspection.evidenceIntegrity,
      modified: inspection.modified,
      links: inspection.links.map(link => ({
        path: link.logical,
        target: link.target,
        resolvedTarget: link.resolvedTarget,
        packageName: link.packageName,
      })),
    })
    return backupRoot
  } catch (error) {
    if (entryExists(backupRoot)) removeManagedEntry(backupRoot)
    throw error
  }
}

/** Fixed symlinks removed by the marker-last public-install transaction. */
/** @param {Extract<SourceInspection, {kind: 'known'}>} inspection */
export function sourceLinkRemovalOperations(inspection) {
  return inspection.links.map(link => ({ target: link.logical, kind: /** @type {const} */ ('symlink'), action: /** @type {const} */ ('remove') }))
}

/** Closed historical identities used by the package's migration fixtures. */
export const sourceMigrationInternals = {
  LEGACY_LINKS,
  LEGACY_MANIFEST,
  LEGACY_PATCH_INTEGRITIES,
  LEGACY_PRESET_INTEGRITIES,
}
