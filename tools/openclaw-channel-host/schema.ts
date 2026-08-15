import parseSpdx from 'spdx-expression-parse'

/** Machine-readable contracts for the pinned OpenClaw channel-host artifacts. */

/** Current JSON format version for every host lock, channel, support, and governance catalog. */
export const SCHEMA_VERSION = 1

/** Aggregate algorithm used for an extracted production host tree. */
export const TREE_ALGORITHM = 'sha512-path-size-content-v1' as const

/** Ordered distance from host-owned implementation to external package. */
export const CHANNEL_STATUSES = ['core', 'bundled', 'repo-official', 'external'] as const

/** Evidence strength for an npm package reference. */
export const EVIDENCE_STATUSES = ['verified', 'cataloged'] as const

/** Ordered support levels exposed by the machine-readable channel support catalogs. */
export const SUPPORT_STATUSES = ['cataloged', 'installable', 'certified', 'enabled'] as const

/** Review outcomes that gate external channel installation. */
export const GOVERNANCE_REVIEW_STATUSES = ['pending-review', 'approved', 'blocked'] as const

/** Release tracks represented by the checked-in artifacts. */
export const TRACKS = ['production', 'canary'] as const

/** Distribution ownership assigned to one channel. */
export type ChannelStatus = (typeof CHANNEL_STATUSES)[number]

/** Whether npm version and integrity values were independently verified. */
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number]

/** Deployment-readiness level for one channel on one locked host track. */
export type SupportStatus = (typeof SUPPORT_STATUSES)[number]

/** Recorded legal, platform-policy, or security review outcome. */
export type GovernanceReviewStatus = (typeof GOVERNANCE_REVIEW_STATUSES)[number]

/** Stable deployment or approved development snapshot. */
export type Track = (typeof TRACKS)[number]

/** Exact npm evidence, or a catalog entry with unverified values set to null. */
export interface NpmEvidence {
  status: EvidenceStatus
  name: string | null
  version: string | null
  integrity: string | null
}

/** Aggregate identity of every ordinary file in an extracted host package. */
export interface HostTreeSummary {
  algorithm: typeof TREE_ALGORITHM
  fileCount: number
  integrity: string
}

/** Verified GitHub source archive identity for a pinned commit. */
export interface SourceArchiveEvidence {
  url: string
  byteLength: number
  integrity: string
}

/** Source, package, and catalog identity for one OpenClaw host track. */
export interface HostLock {
  schemaVersion: number
  track: Track
  source: {
    repository: string
    ref: string
    tagObject: string | null
    commit: string
    manifestVersion: string
    observedAt: string
    archive: SourceArchiveEvidence | null
  }
  npm: NpmEvidence
  tree: HostTreeSummary | null
  channelCatalog: string
}

/** One user-facing chat channel and its source and npm provenance. */
export interface ChannelRecord {
  id: string
  label: string
  docsPath: string
  status: ChannelStatus
  source: {
    path: string | null
    packageName: string | null
    manifestVersion: string | null
  }
  npm: NpmEvidence
}

/** Sorted user-facing channel inventory for one host lock. */
export interface ChannelCatalog {
  schemaVersion: number
  track: Track
  hostCommit: string
  sourceRef: string
  observedAt: string
  expectedCount: number
  channels: ChannelRecord[]
}

/** Reproducible evidence that a real platform account passed a live smoke test. */
export interface ChannelCertification {
  testedAt: string
  evidence: string
}

/** Evidence that a locked channel has documented configuration and automated assembly checks. */
export interface ChannelInstallabilityEvidence {
  configuration: string
  capabilityProbe: string
  contractTest: string
}

/** Reproducible evidence that a certified channel is selected by a deployment. */
export interface ChannelEnablement {
  deployment: string
  evidence: string
}

/** One channel's support level, opt-in policy, and evidence. */
export interface ChannelSupportRecord {
  id: string
  status: SupportStatus
  optIn: boolean
  installability: ChannelInstallabilityEvidence | null
  certifications: ChannelCertification[]
  enablements: ChannelEnablement[]
}

/** Support projection for every channel in one locked host catalog. */
export interface ChannelSupportCatalog {
  schemaVersion: number
  track: Track
  hostCommit: string
  sourceCatalog: string
  observedAt: string
  expectedCount: number
  channels: ChannelSupportRecord[]
}

/** Evidence and disposition for one external-channel governance subject. */
export interface ExternalChannelReview {
  status: GovernanceReviewStatus
  evidence: string[]
}

/** License declaration plus its independent review disposition. */
export interface ExternalChannelLicenseReview extends ExternalChannelReview {
  declaredSpdx: string | null
}

/** Exact package identity and unresolved governance work for one external channel. */
export interface ExternalChannelGovernanceRecord {
  id: string
  packageName: string
  version: string
  integrity: string
  license: ExternalChannelLicenseReview
  platformTerms: ExternalChannelReview
  security: ExternalChannelReview
}

/** Governance projection for every external package in one locked host track. */
export interface ExternalChannelGovernanceCatalog {
  schemaVersion: number
  track: Track
  hostCommit: string
  sourceCatalog: string
  observedAt: string
  expectedCount: number
  channels: ExternalChannelGovernanceRecord[]
}

/** Complete production and canary lock set consumed by the verifier. */
export interface ArtifactSet {
  productionLock: HostLock
  canaryLock: HostLock
  productionCatalog: ChannelCatalog
  canaryCatalog: ChannelCatalog
  productionSupport: ChannelSupportCatalog
  canarySupport: ChannelSupportCatalog
  productionGovernance: ExternalChannelGovernanceCatalog
  canaryGovernance: ExternalChannelGovernanceCatalog
}

/** Untrusted JSON values loaded from the eight channel-host artifact files. */
export interface RawArtifactSet {
  productionLock: unknown
  canaryLock: unknown
  productionCatalog: unknown
  canaryCatalog: unknown
  productionSupport: unknown
  canarySupport: unknown
  productionGovernance: unknown
  canaryGovernance: unknown
}

type UnknownRecord = Record<string, unknown>

const EXPECTED_COUNTS: Record<Track, number> = {
  production: 27,
  canary: 31,
}

const EXPECTED_STATUS_COUNTS: Record<Track, Record<ChannelStatus, number>> = {
  production: {
    core: 1,
    bundled: 2,
    'repo-official': 21,
    external: 3,
  },
  canary: {
    core: 1,
    bundled: 2,
    'repo-official': 23,
    external: 5,
  },
}

const STATUS_RANK: Record<ChannelStatus, number> = {
  core: 0,
  bundled: 1,
  'repo-official': 2,
  external: 3,
}

const SUPPORT_STATUS_RANK: Record<SupportStatus, number> = {
  cataloged: 0,
  installable: 1,
  certified: 2,
  enabled: 3,
}

const APPROVED_HOST_IDENTITIES = {
  production: {
    ref: 'v2026.7.1-2',
    tagObject: 'be8b8a9e8838f832e4fa47cde8bea0a33aec71ba',
    commit: '0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c',
    manifestVersion: '2026.7.1',
    npmVersion: '2026.7.1-2',
  },
  canary: {
    ref: 'main',
    tagObject: null,
    commit: 'f1ced37ce5df8c7bc7f3b46c579e5ce181feaae0',
    manifestVersion: '2026.8.1',
    observedAt: '2026-08-15T08:18:37Z',
  },
} as const

const APPROVED_CANARY_ARCHIVE = {
  url: 'https://github.com/openclaw/openclaw/archive/f1ced37ce5df8c7bc7f3b46c579e5ce181feaae0.tar.gz',
  byteLength: 100754581,
  integrity: 'sha512-PEjiTam3vygesQ22Pr0DF51CEqF6d9eCaxhzHxgyOkwKAIWJgoJO1ooskLPMakolKmP6J797QkG5aIyM4B/hRQ==',
} as const

const SHA_PATTERN = /^[0-9a-f]{40}$/
const VERSION_PATTERN = /^\d{4}\.\d+\.\d+$/
const CHANNEL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function expectObject(
  value: unknown,
  path: string,
  keys: readonly string[],
  errors: string[],
): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    errors.push(`${path}: expected object`)
    return {}
  }
  const record = value as UnknownRecord
  for (const key of keys) {
    if (!Object.hasOwn(record, key)) errors.push(`${path}.${key}: missing required field`)
  }
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) errors.push(`${path}.${key}: unknown field`)
  }
  return record
}

function expectString(value: unknown, path: string, errors: string[]): string {
  if (typeof value !== 'string' || value.length === 0) {
    errors.push(`${path}: expected non-empty string`)
    return ''
  }
  return value
}

function expectNullableString(value: unknown, path: string, errors: string[]): string | null {
  if (value === null) return null
  return expectString(value, path, errors)
}

function expectInteger(value: unknown, path: string, errors: string[]): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    errors.push(`${path}: expected safe integer`)
    return 0
  }
  return value
}

function expectBoolean(value: unknown, path: string, errors: string[]): boolean {
  if (typeof value !== 'boolean') {
    errors.push(`${path}: expected boolean`)
    return false
  }
  return value
}

function expectLiteral<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
  errors: string[],
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    errors.push(`${path}: expected one of ${allowed.join(', ')}`)
    return allowed[0] as T
  }
  return value as T
}

/**
 * Tests whether a string is a canonical SHA-512 Subresource Integrity value.
 *
 * @param value Candidate integrity value.
 * @returns Whether the value contains exactly one canonical 64-byte SHA-512 digest.
 */
export function isSha512Sri(value: string): boolean {
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(value)) return false
  const encoded = value.slice('sha512-'.length)
  const digest = Buffer.from(encoded, 'base64')
  return digest.byteLength === 64 && digest.toString('base64') === encoded
}

function parseNpmEvidence(value: unknown, path: string, errors: string[]): NpmEvidence {
  const record = expectObject(value, path, ['status', 'name', 'version', 'integrity'], errors)
  const status = expectLiteral(record.status, `${path}.status`, EVIDENCE_STATUSES, errors)
  const name = expectNullableString(record.name, `${path}.name`, errors)
  const version = expectNullableString(record.version, `${path}.version`, errors)
  const integrity = expectNullableString(record.integrity, `${path}.integrity`, errors)

  if (status === 'verified') {
    if (name === null) errors.push(`${path}.name: verified npm evidence requires a package name`)
    if (version === null) errors.push(`${path}.version: verified npm evidence requires a version`)
    if (integrity === null) errors.push(`${path}.integrity: verified npm evidence requires an SRI`)
  } else {
    if (version !== null) errors.push(`${path}.version: cataloged npm evidence must use null`)
    if (integrity !== null) errors.push(`${path}.integrity: cataloged npm evidence must use null`)
  }
  if (integrity !== null && !isSha512Sri(integrity)) {
    errors.push(`${path}.integrity: expected canonical sha512 SRI`)
  }
  return { status, name, version, integrity }
}

function parseTree(value: unknown, path: string, errors: string[]): HostTreeSummary | null {
  if (value === null) return null
  const record = expectObject(value, path, ['algorithm', 'fileCount', 'integrity'], errors)
  const algorithm = expectLiteral(record.algorithm, `${path}.algorithm`, [TREE_ALGORITHM], errors)
  const fileCount = expectInteger(record.fileCount, `${path}.fileCount`, errors)
  const integrity = expectString(record.integrity, `${path}.integrity`, errors)
  if (fileCount <= 0) errors.push(`${path}.fileCount: expected a positive integer`)
  if (integrity.length > 0 && !isSha512Sri(integrity)) {
    errors.push(`${path}.integrity: expected canonical sha512 SRI`)
  }
  return { algorithm, fileCount, integrity }
}

function parseSourceArchive(
  value: unknown,
  path: string,
  errors: string[],
): SourceArchiveEvidence | null {
  if (value === null) return null
  const record = expectObject(value, path, ['url', 'byteLength', 'integrity'], errors)
  const url = expectString(record.url, `${path}.url`, errors)
  const byteLength = expectInteger(record.byteLength, `${path}.byteLength`, errors)
  const integrity = expectString(record.integrity, `${path}.integrity`, errors)
  if (!url.startsWith('https://github.com/openclaw/openclaw/archive/')) {
    errors.push(`${path}.url: expected OpenClaw GitHub source archive URL`)
  }
  if (byteLength <= 0) errors.push(`${path}.byteLength: expected a positive integer`)
  if (integrity.length > 0 && !isSha512Sri(integrity)) {
    errors.push(`${path}.integrity: expected canonical sha512 SRI`)
  }
  return { url, byteLength, integrity }
}

function parseHostLock(value: unknown, path: string, errors: string[]): HostLock {
  const record = expectObject(
    value,
    path,
    ['schemaVersion', 'track', 'source', 'npm', 'tree', 'channelCatalog'],
    errors,
  )
  const sourceRecord = expectObject(
    record.source,
    `${path}.source`,
    ['repository', 'ref', 'tagObject', 'commit', 'manifestVersion', 'observedAt', 'archive'],
    errors,
  )
  const source = {
    repository: expectString(sourceRecord.repository, `${path}.source.repository`, errors),
    ref: expectString(sourceRecord.ref, `${path}.source.ref`, errors),
    tagObject: expectNullableString(sourceRecord.tagObject, `${path}.source.tagObject`, errors),
    commit: expectString(sourceRecord.commit, `${path}.source.commit`, errors),
    manifestVersion: expectString(
      sourceRecord.manifestVersion,
      `${path}.source.manifestVersion`,
      errors,
    ),
    observedAt: expectString(sourceRecord.observedAt, `${path}.source.observedAt`, errors),
    archive: parseSourceArchive(sourceRecord.archive, `${path}.source.archive`, errors),
  }
  if (!SHA_PATTERN.test(source.commit)) errors.push(`${path}.source.commit: expected 40 lowercase hex characters`)
  if (source.tagObject !== null && !SHA_PATTERN.test(source.tagObject)) {
    errors.push(`${path}.source.tagObject: expected 40 lowercase hex characters or null`)
  }
  if (!VERSION_PATTERN.test(source.manifestVersion)) {
    errors.push(`${path}.source.manifestVersion: expected YYYY.M.D numeric version`)
  }
  if (!isIsoTimestamp(source.observedAt)) errors.push(`${path}.source.observedAt: expected UTC ISO timestamp`)

  return {
    schemaVersion: expectInteger(record.schemaVersion, `${path}.schemaVersion`, errors),
    track: expectLiteral(record.track, `${path}.track`, TRACKS, errors),
    source,
    npm: parseNpmEvidence(record.npm, `${path}.npm`, errors),
    tree: parseTree(record.tree, `${path}.tree`, errors),
    channelCatalog: expectString(record.channelCatalog, `${path}.channelCatalog`, errors),
  }
}

function parseChannel(value: unknown, path: string, errors: string[]): ChannelRecord {
  const record = expectObject(value, path, ['id', 'label', 'docsPath', 'status', 'source', 'npm'], errors)
  const sourceRecord = expectObject(
    record.source,
    `${path}.source`,
    ['path', 'packageName', 'manifestVersion'],
    errors,
  )
  const id = expectString(record.id, `${path}.id`, errors)
  const docsPath = expectString(record.docsPath, `${path}.docsPath`, errors)
  const source = {
    path: expectNullableString(sourceRecord.path, `${path}.source.path`, errors),
    packageName: expectNullableString(sourceRecord.packageName, `${path}.source.packageName`, errors),
    manifestVersion: expectNullableString(
      sourceRecord.manifestVersion,
      `${path}.source.manifestVersion`,
      errors,
    ),
  }
  if (!CHANNEL_ID_PATTERN.test(id)) errors.push(`${path}.id: expected lowercase kebab-case channel id`)
  if (!docsPath.startsWith('/')) errors.push(`${path}.docsPath: expected an absolute documentation route`)
  if (
    source.path !== null
    && (source.path.startsWith('/') || source.path.includes('\\') || source.path.split('/').includes('..'))
  ) {
    errors.push(`${path}.source.path: expected a relative POSIX repository path`)
  }
  if (source.manifestVersion !== null && !VERSION_PATTERN.test(source.manifestVersion)) {
    errors.push(`${path}.source.manifestVersion: expected YYYY.M.D numeric version or null`)
  }
  return {
    id,
    label: expectString(record.label, `${path}.label`, errors),
    docsPath,
    status: expectLiteral(record.status, `${path}.status`, CHANNEL_STATUSES, errors),
    source,
    npm: parseNpmEvidence(record.npm, `${path}.npm`, errors),
  }
}

function parseCatalog(value: unknown, path: string, errors: string[]): ChannelCatalog {
  const record = expectObject(
    value,
    path,
    ['schemaVersion', 'track', 'hostCommit', 'sourceRef', 'observedAt', 'expectedCount', 'channels'],
    errors,
  )
  const rawChannels = record.channels
  if (!Array.isArray(rawChannels)) errors.push(`${path}.channels: expected array`)
  const channels = Array.isArray(rawChannels)
    ? rawChannels.map((channel, index) => parseChannel(channel, `${path}.channels[${index}]`, errors))
    : []
  const hostCommit = expectString(record.hostCommit, `${path}.hostCommit`, errors)
  const observedAt = expectString(record.observedAt, `${path}.observedAt`, errors)
  if (!SHA_PATTERN.test(hostCommit)) errors.push(`${path}.hostCommit: expected 40 lowercase hex characters`)
  if (!isIsoTimestamp(observedAt)) errors.push(`${path}.observedAt: expected UTC ISO timestamp`)
  return {
    schemaVersion: expectInteger(record.schemaVersion, `${path}.schemaVersion`, errors),
    track: expectLiteral(record.track, `${path}.track`, TRACKS, errors),
    hostCommit,
    sourceRef: expectString(record.sourceRef, `${path}.sourceRef`, errors),
    observedAt,
    expectedCount: expectInteger(record.expectedCount, `${path}.expectedCount`, errors),
    channels,
  }
}

function expectEvidenceReference(value: unknown, path: string, errors: string[]): string {
  const reference = expectString(value, path, errors)
  const isRelativeRepositoryPath = reference.length > 0
    && !reference.startsWith('/')
    && !reference.includes('\\')
    && reference.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..')
    && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(reference)
  if (!isHttpsEvidenceUrl(reference) && !isRelativeRepositoryPath) {
    errors.push(`${path}: expected a valid HTTPS URL with a hostname or relative POSIX repository file path`)
  }
  return reference
}

function isHttpsEvidenceUrl(reference: string): boolean {
  if (reference.trim() !== reference) return false
  if (!/^https:\/\/[^/?#]+(?:[/?#]|$)/i.test(reference)) return false
  try {
    const parsed = new URL(reference)
    return parsed.protocol === 'https:'
      && parsed.hostname.length > 0
      && parsed.username.length === 0
      && parsed.password.length === 0
  } catch {
    return false
  }
}

function parseCertification(
  value: unknown,
  path: string,
  errors: string[],
): ChannelCertification {
  const record = expectObject(value, path, ['testedAt', 'evidence'], errors)
  const testedAt = expectString(record.testedAt, `${path}.testedAt`, errors)
  if (!isIsoTimestamp(testedAt)) errors.push(`${path}.testedAt: expected UTC ISO timestamp`)
  return {
    testedAt,
    evidence: expectEvidenceReference(record.evidence, `${path}.evidence`, errors),
  }
}

function parseInstallability(
  value: unknown,
  path: string,
  errors: string[],
): ChannelInstallabilityEvidence | null {
  if (value === null) return null
  const record = expectObject(
    value,
    path,
    ['configuration', 'capabilityProbe', 'contractTest'],
    errors,
  )
  return {
    configuration: expectEvidenceReference(record.configuration, `${path}.configuration`, errors),
    capabilityProbe: expectEvidenceReference(record.capabilityProbe, `${path}.capabilityProbe`, errors),
    contractTest: expectEvidenceReference(record.contractTest, `${path}.contractTest`, errors),
  }
}

function parseEnablement(value: unknown, path: string, errors: string[]): ChannelEnablement {
  const record = expectObject(value, path, ['deployment', 'evidence'], errors)
  return {
    deployment: expectString(record.deployment, `${path}.deployment`, errors),
    evidence: expectEvidenceReference(record.evidence, `${path}.evidence`, errors),
  }
}

function parseSupportRecord(
  value: unknown,
  path: string,
  errors: string[],
): ChannelSupportRecord {
  const record = expectObject(
    value,
    path,
    ['id', 'status', 'optIn', 'installability', 'certifications', 'enablements'],
    errors,
  )
  const certifications = record.certifications
  const enablements = record.enablements
  if (!Array.isArray(certifications)) errors.push(`${path}.certifications: expected array`)
  if (!Array.isArray(enablements)) errors.push(`${path}.enablements: expected array`)
  const id = expectString(record.id, `${path}.id`, errors)
  if (!CHANNEL_ID_PATTERN.test(id)) errors.push(`${path}.id: expected lowercase kebab-case channel id`)
  return {
    id,
    status: expectLiteral(record.status, `${path}.status`, SUPPORT_STATUSES, errors),
    optIn: expectBoolean(record.optIn, `${path}.optIn`, errors),
    installability: parseInstallability(record.installability, `${path}.installability`, errors),
    certifications: Array.isArray(certifications)
      ? certifications.map((entry, index) => parseCertification(entry, `${path}.certifications[${index}]`, errors))
      : [],
    enablements: Array.isArray(enablements)
      ? enablements.map((entry, index) => parseEnablement(entry, `${path}.enablements[${index}]`, errors))
      : [],
  }
}

function parseSupportCatalog(
  value: unknown,
  path: string,
  errors: string[],
): ChannelSupportCatalog {
  const record = expectObject(
    value,
    path,
    ['schemaVersion', 'track', 'hostCommit', 'sourceCatalog', 'observedAt', 'expectedCount', 'channels'],
    errors,
  )
  const rawChannels = record.channels
  if (!Array.isArray(rawChannels)) errors.push(`${path}.channels: expected array`)
  const hostCommit = expectString(record.hostCommit, `${path}.hostCommit`, errors)
  const observedAt = expectString(record.observedAt, `${path}.observedAt`, errors)
  if (!SHA_PATTERN.test(hostCommit)) errors.push(`${path}.hostCommit: expected 40 lowercase hex characters`)
  if (!isIsoTimestamp(observedAt)) errors.push(`${path}.observedAt: expected UTC ISO timestamp`)
  return {
    schemaVersion: expectInteger(record.schemaVersion, `${path}.schemaVersion`, errors),
    track: expectLiteral(record.track, `${path}.track`, TRACKS, errors),
    hostCommit,
    sourceCatalog: expectString(record.sourceCatalog, `${path}.sourceCatalog`, errors),
    observedAt,
    expectedCount: expectInteger(record.expectedCount, `${path}.expectedCount`, errors),
    channels: Array.isArray(rawChannels)
      ? rawChannels.map((entry, index) => parseSupportRecord(entry, `${path}.channels[${index}]`, errors))
      : [],
  }
}

function parseReview(
  value: unknown,
  path: string,
  errors: string[],
): ExternalChannelReview {
  const record = expectObject(value, path, ['status', 'evidence'], errors)
  const evidence = record.evidence
  if (!Array.isArray(evidence)) errors.push(`${path}.evidence: expected array`)
  const parsedEvidence = Array.isArray(evidence)
    ? evidence.map((entry, index) => expectEvidenceReference(entry, `${path}.evidence[${index}]`, errors))
    : []
  const status = expectLiteral(
    record.status,
    `${path}.status`,
    GOVERNANCE_REVIEW_STATUSES,
    errors,
  )
  if (status !== 'pending-review' && parsedEvidence.length === 0) {
    errors.push(`${path}.evidence: ${status} requires review evidence`)
  }
  return { status, evidence: parsedEvidence }
}

function parseGovernanceRecord(
  value: unknown,
  path: string,
  errors: string[],
): ExternalChannelGovernanceRecord {
  const record = expectObject(
    value,
    path,
    ['id', 'packageName', 'version', 'integrity', 'license', 'platformTerms', 'security'],
    errors,
  )
  const id = expectString(record.id, `${path}.id`, errors)
  if (!CHANNEL_ID_PATTERN.test(id)) errors.push(`${path}.id: expected lowercase kebab-case channel id`)
  const integrity = expectString(record.integrity, `${path}.integrity`, errors)
  if (integrity.length > 0 && !isSha512Sri(integrity)) {
    errors.push(`${path}.integrity: expected canonical sha512 SRI`)
  }
  const licenseRecord = expectObject(
    record.license,
    `${path}.license`,
    ['declaredSpdx', 'status', 'evidence'],
    errors,
  )
  const declaredSpdx = expectNullableString(
    licenseRecord.declaredSpdx,
    `${path}.license.declaredSpdx`,
    errors,
  )
  if (declaredSpdx !== null && !isSpdxExpression(declaredSpdx)) {
    errors.push(`${path}.license.declaredSpdx: expected an SPDX expression or null`)
  }
  const license = parseReview(
    { status: licenseRecord.status, evidence: licenseRecord.evidence },
    `${path}.license`,
    errors,
  )
  return {
    id,
    packageName: expectString(record.packageName, `${path}.packageName`, errors),
    version: expectString(record.version, `${path}.version`, errors),
    integrity,
    license: { ...license, declaredSpdx },
    platformTerms: parseReview(record.platformTerms, `${path}.platformTerms`, errors),
    security: parseReview(record.security, `${path}.security`, errors),
  }
}

function isSpdxExpression(value: string): boolean {
  try {
    parseSpdx(value)
    return true
  } catch {
    return false
  }
}

function parseGovernanceCatalog(
  value: unknown,
  path: string,
  errors: string[],
): ExternalChannelGovernanceCatalog {
  const record = expectObject(
    value,
    path,
    ['schemaVersion', 'track', 'hostCommit', 'sourceCatalog', 'observedAt', 'expectedCount', 'channels'],
    errors,
  )
  const rawChannels = record.channels
  if (!Array.isArray(rawChannels)) errors.push(`${path}.channels: expected array`)
  const hostCommit = expectString(record.hostCommit, `${path}.hostCommit`, errors)
  const observedAt = expectString(record.observedAt, `${path}.observedAt`, errors)
  if (!SHA_PATTERN.test(hostCommit)) errors.push(`${path}.hostCommit: expected 40 lowercase hex characters`)
  if (!isIsoTimestamp(observedAt)) errors.push(`${path}.observedAt: expected UTC ISO timestamp`)
  return {
    schemaVersion: expectInteger(record.schemaVersion, `${path}.schemaVersion`, errors),
    track: expectLiteral(record.track, `${path}.track`, TRACKS, errors),
    hostCommit,
    sourceCatalog: expectString(record.sourceCatalog, `${path}.sourceCatalog`, errors),
    observedAt,
    expectedCount: expectInteger(record.expectedCount, `${path}.expectedCount`, errors),
    channels: Array.isArray(rawChannels)
      ? rawChannels.map((entry, index) => parseGovernanceRecord(entry, `${path}.channels[${index}]`, errors))
      : [],
  }
}

function isIsoTimestamp(value: string): boolean {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return false
  const normalized = new Date(timestamp).toISOString().replace('.000Z', 'Z')
  return normalized === value
}

function compareNumericVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

function validateHostTracks(production: HostLock, canary: HostLock, errors: string[]): void {
  for (const [path, lock, track] of [
    ['productionLock', production, 'production'],
    ['canaryLock', canary, 'canary'],
  ] as const) {
    if (lock.schemaVersion !== SCHEMA_VERSION) {
      errors.push(`${path}.schemaVersion: expected ${SCHEMA_VERSION}`)
    }
    if (lock.track !== track) errors.push(`${path}.track: expected ${track}`)
    if (lock.source.repository !== 'https://github.com/openclaw/openclaw.git') {
      errors.push(`${path}.source.repository: unexpected repository`)
    }
    if (lock.npm.name !== 'openclaw') errors.push(`${path}.npm.name: expected openclaw`)
  }

  for (const [field, expected] of Object.entries(APPROVED_HOST_IDENTITIES.production)) {
    const actual = field === 'npmVersion'
      ? production.npm.version
      : production.source[field as keyof typeof production.source]
    if (actual !== expected) errors.push(`productionLock.${field}: expected approved value ${expected}`)
  }
  for (const [field, expected] of Object.entries(APPROVED_HOST_IDENTITIES.canary)) {
    const actual = canary.source[field as keyof typeof canary.source]
    if (actual !== expected) errors.push(`canaryLock.${field}: expected approved value ${String(expected)}`)
  }
  if (production.source.archive !== null) {
    errors.push('productionLock.source.archive: expected null because npm and tree evidence own production')
  }
  if (canary.source.archive === null) {
    errors.push('canaryLock.source.archive: approved source archive evidence is required')
  } else {
    for (const [field, expected] of Object.entries(APPROVED_CANARY_ARCHIVE)) {
      if (canary.source.archive[field as keyof SourceArchiveEvidence] !== expected) {
        errors.push(`canaryLock.source.archive.${field}: expected approved value ${expected}`)
      }
    }
  }

  if (production.npm.status !== 'verified' || production.npm.version === null) {
    errors.push('productionLock.npm: production host requires verified npm evidence')
  } else {
    if (production.source.ref !== `v${production.npm.version}`) {
      errors.push('productionLock.source.ref: expected the verified npm version tag')
    }
    if (production.npm.version.split('-')[0] !== production.source.manifestVersion) {
      errors.push('productionLock.npm.version: base version must match source manifestVersion')
    }
  }
  if (production.source.tagObject === null) {
    errors.push('productionLock.source.tagObject: production tag object is required')
  }
  if (production.tree === null) errors.push('productionLock.tree: production tree summary is required')
  if (production.channelCatalog !== 'channels.production.json') {
    errors.push('productionLock.channelCatalog: expected channels.production.json')
  }

  if (canary.source.ref !== 'main') errors.push('canaryLock.source.ref: expected main')
  if (canary.source.tagObject !== null) errors.push('canaryLock.source.tagObject: expected null')
  if (canary.npm.status !== 'cataloged' || canary.npm.version !== null || canary.npm.integrity !== null) {
    errors.push('canaryLock.npm: canary must not claim a verified npm artifact')
  }
  if (canary.tree !== null) errors.push('canaryLock.tree: expected null without a verified npm artifact')
  if (canary.channelCatalog !== 'channels.canary.json') {
    errors.push('canaryLock.channelCatalog: expected channels.canary.json')
  }
  if (compareNumericVersions(canary.source.manifestVersion, production.source.manifestVersion) < 0) {
    errors.push('host versions: canary manifestVersion must not precede production')
  }
}

function validateChannelSource(
  channel: ChannelRecord,
  track: Track,
  hostManifestVersion: string,
  path: string,
  errors: string[],
): void {
  const sourceValues = [channel.source.path, channel.source.packageName, channel.source.manifestVersion]
  const sourceIsEmpty = sourceValues.every(value => value === null)
  const sourceIsComplete = sourceValues.every(value => value !== null)

  switch (channel.status) {
    case 'core': {
      if (!sourceIsEmpty) errors.push(`${path}.source: core channel source package fields must be null`)
      if (
        channel.npm.status !== 'cataloged'
        || channel.npm.name !== null
        || channel.npm.version !== null
        || channel.npm.integrity !== null
      ) {
        errors.push(`${path}.npm: core channel must use empty cataloged npm evidence`)
      }
      break
    }
    case 'bundled': {
      if (!sourceIsComplete) errors.push(`${path}.source: bundled channel source package fields are required`)
      if (channel.source.manifestVersion !== hostManifestVersion) {
        errors.push(`${path}.source.manifestVersion: expected host manifest version`)
      }
      if (
        channel.npm.status !== 'cataloged'
        || channel.npm.name !== null
        || channel.npm.version !== null
        || channel.npm.integrity !== null
      ) {
        errors.push(`${path}.npm: bundled channel must use empty cataloged npm evidence`)
      }
      break
    }
    case 'repo-official': {
      if (!sourceIsComplete) errors.push(`${path}.source: repo-official source package fields are required`)
      if (channel.source.manifestVersion !== hostManifestVersion) {
        errors.push(`${path}.source.manifestVersion: expected host manifest version`)
      }
      if (track === 'production') {
        if (channel.npm.status !== 'verified') {
          errors.push(`${path}.npm.status: production repo-official package must be verified`)
        }
        if (channel.npm.name !== channel.source.packageName) {
          errors.push(`${path}.npm.name: expected source package name`)
        }
        if (channel.npm.version !== channel.source.manifestVersion) {
          errors.push(`${path}.npm.version: expected source manifest version`)
        }
      } else {
        if (
          channel.npm.status !== 'cataloged'
          || channel.npm.name !== channel.source.packageName
          || channel.npm.version !== null
          || channel.npm.integrity !== null
        ) {
          errors.push(`${path}.npm: canary repo-official package must use named cataloged evidence`)
        }
      }
      break
    }
    case 'external': {
      if (!sourceIsEmpty) errors.push(`${path}.source: external source package fields must be null`)
      if (channel.npm.status !== 'verified') {
        errors.push(`${path}.npm.status: external package must be verified`)
      }
      break
    }
  }
}

function validateCatalog(
  catalog: ChannelCatalog,
  lock: HostLock,
  track: Track,
  errors: string[],
): void {
  const path = `${track}Catalog`
  const expectedCount = EXPECTED_COUNTS[track]
  if (catalog.schemaVersion !== SCHEMA_VERSION) errors.push(`${path}.schemaVersion: expected ${SCHEMA_VERSION}`)
  if (catalog.track !== track) errors.push(`${path}.track: expected ${track}`)
  if (catalog.hostCommit !== lock.source.commit) errors.push(`${path}.hostCommit: must match host lock`)
  if (catalog.sourceRef !== lock.source.ref) errors.push(`${path}.sourceRef: must match host lock`)
  if (catalog.observedAt !== lock.source.observedAt) errors.push(`${path}.observedAt: must match host lock`)
  if (catalog.expectedCount !== expectedCount) errors.push(`${path}.expectedCount: expected ${expectedCount}`)
  if (catalog.channels.length !== expectedCount) errors.push(`${path}.channels: expected ${expectedCount} entries`)

  const ids = catalog.channels.map(channel => channel.id)
  const sortedIds = [...ids].sort()
  if (ids.some((id, index) => id !== sortedIds[index])) errors.push(`${path}.channels: entries must be sorted by id`)

  for (const [field, values] of [
    ['id', catalog.channels.map(channel => channel.id)],
    ['label', catalog.channels.map(channel => channel.label)],
    ['npm.name', catalog.channels.map(channel => channel.npm.name).filter(name => name !== null)],
  ] as const) {
    const seen = new Set<string>()
    for (const value of values) {
      if (seen.has(value)) errors.push(`${path}.channels: duplicate ${field} ${value}`)
      seen.add(value)
    }
  }

  const statusCounts = Object.fromEntries(CHANNEL_STATUSES.map(status => [status, 0])) as Record<
    ChannelStatus,
    number
  >
  for (const [index, channel] of catalog.channels.entries()) {
    statusCounts[channel.status] += 1
    validateChannelSource(
      channel,
      track,
      lock.source.manifestVersion,
      `${path}.channels[${index}]`,
      errors,
    )
  }
  for (const status of CHANNEL_STATUSES) {
    const expected = EXPECTED_STATUS_COUNTS[track][status]
    if (statusCounts[status] !== expected) {
      errors.push(`${path}.channels: expected ${expected} ${status} entries, got ${statusCounts[status]}`)
    }
  }
}

function channelHasExactInstallArtifacts(lock: HostLock, channel: ChannelRecord): boolean {
  if (lock.npm.status !== 'verified' || lock.tree === null) return false
  if (channel.status === 'core' || channel.status === 'bundled') return true
  return channel.npm.status === 'verified'
}

function validateGovernanceCatalog(
  governance: ExternalChannelGovernanceCatalog,
  catalog: ChannelCatalog,
  lock: HostLock,
  track: Track,
  errors: string[],
): void {
  const path = `${track}Governance`
  const externalChannels = catalog.channels.filter(channel => channel.status === 'external')
  const expectedCount = EXPECTED_STATUS_COUNTS[track].external
  if (governance.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`${path}.schemaVersion: expected ${SCHEMA_VERSION}`)
  }
  if (governance.track !== track) errors.push(`${path}.track: expected ${track}`)
  if (governance.hostCommit !== lock.source.commit) errors.push(`${path}.hostCommit: must match host lock`)
  if (governance.sourceCatalog !== lock.channelCatalog) {
    errors.push(`${path}.sourceCatalog: must match host lock channelCatalog`)
  }
  if (governance.observedAt !== lock.source.observedAt) {
    errors.push(`${path}.observedAt: must match host lock`)
  }
  if (governance.expectedCount !== expectedCount) {
    errors.push(`${path}.expectedCount: expected ${expectedCount}`)
  }
  if (governance.channels.length !== expectedCount) {
    errors.push(`${path}.channels: expected ${expectedCount} entries`)
  }

  const externalById = new Map(externalChannels.map(channel => [channel.id, channel]))
  const ids = governance.channels.map(channel => channel.id)
  const sortedIds = [...ids].sort()
  if (ids.some((id, index) => id !== sortedIds[index])) {
    errors.push(`${path}.channels: entries must be sorted by id`)
  }
  const seen = new Set<string>()
  for (const [index, record] of governance.channels.entries()) {
    const recordPath = `${path}.channels[${index}]`
    if (seen.has(record.id)) errors.push(`${path}.channels: duplicate id ${record.id}`)
    seen.add(record.id)
    const channel = externalById.get(record.id)
    if (channel === undefined) {
      errors.push(`${recordPath}.id: not an external channel in ${lock.channelCatalog}`)
      continue
    }
    if (record.packageName !== channel.npm.name) {
      errors.push(`${recordPath}.packageName: must match channel npm evidence`)
    }
    if (record.version !== channel.npm.version) {
      errors.push(`${recordPath}.version: must match channel npm evidence`)
    }
    if (record.integrity !== channel.npm.integrity) {
      errors.push(`${recordPath}.integrity: must match channel npm evidence`)
    }
  }
  for (const channel of externalChannels) {
    if (!seen.has(channel.id)) errors.push(`${path}.channels: missing external channel ${channel.id}`)
  }
}

function governanceApproved(record: ExternalChannelGovernanceRecord | undefined): boolean {
  return record !== undefined
    && record.license.status === 'approved'
    && record.platformTerms.status === 'approved'
    && record.security.status === 'approved'
}

function validateSupportCatalog(
  support: ChannelSupportCatalog,
  catalog: ChannelCatalog,
  governance: ExternalChannelGovernanceCatalog,
  lock: HostLock,
  track: Track,
  errors: string[],
): void {
  const path = `${track}Support`
  const expectedCount = EXPECTED_COUNTS[track]
  if (support.schemaVersion !== SCHEMA_VERSION) errors.push(`${path}.schemaVersion: expected ${SCHEMA_VERSION}`)
  if (support.track !== track) errors.push(`${path}.track: expected ${track}`)
  if (support.hostCommit !== lock.source.commit) errors.push(`${path}.hostCommit: must match host lock`)
  if (support.sourceCatalog !== lock.channelCatalog) {
    errors.push(`${path}.sourceCatalog: must match host lock channelCatalog`)
  }
  if (support.observedAt !== lock.source.observedAt) errors.push(`${path}.observedAt: must match host lock`)
  if (support.expectedCount !== expectedCount) errors.push(`${path}.expectedCount: expected ${expectedCount}`)
  if (support.channels.length !== expectedCount) {
    errors.push(`${path}.channels: expected ${expectedCount} entries`)
  }

  const catalogById = new Map(catalog.channels.map(channel => [channel.id, channel]))
  const governanceById = new Map(governance.channels.map(channel => [channel.id, channel]))
  const ids = support.channels.map(channel => channel.id)
  const sortedIds = [...ids].sort()
  if (ids.some((id, index) => id !== sortedIds[index])) {
    errors.push(`${path}.channels: entries must be sorted by id`)
  }
  const seen = new Set<string>()
  for (const [index, supportChannel] of support.channels.entries()) {
    const channelPath = `${path}.channels[${index}]`
    if (seen.has(supportChannel.id)) {
      errors.push(`${path}.channels: duplicate id ${supportChannel.id}`)
    }
    seen.add(supportChannel.id)
    const sourceChannel = catalogById.get(supportChannel.id)
    if (sourceChannel === undefined) {
      errors.push(`${channelPath}.id: absent from ${lock.channelCatalog}`)
      continue
    }

    const expectedOptIn = sourceChannel.status === 'external'
    if (supportChannel.optIn !== expectedOptIn) {
      errors.push(`${channelPath}.optIn: expected ${String(expectedOptIn)} for ${sourceChannel.status} channel`)
    }
    if (
      SUPPORT_STATUS_RANK[supportChannel.status] >= SUPPORT_STATUS_RANK.installable
      && !channelHasExactInstallArtifacts(lock, sourceChannel)
    ) {
      errors.push(`${channelPath}.status: ${supportChannel.status} requires exact install artifacts`)
    }
    if (
      sourceChannel.status === 'external'
      && SUPPORT_STATUS_RANK[supportChannel.status] >= SUPPORT_STATUS_RANK.installable
      && !governanceApproved(governanceById.get(supportChannel.id))
    ) {
      errors.push(
        `${channelPath}.status: external ${supportChannel.status} requires approved license, platform-terms, and security reviews`,
      )
    }

    const isInstallable = SUPPORT_STATUS_RANK[supportChannel.status] >= SUPPORT_STATUS_RANK.installable
    if (isInstallable && supportChannel.installability === null) {
      errors.push(`${channelPath}.installability: ${supportChannel.status} requires assembly evidence`)
    }
    if (!isInstallable && supportChannel.installability !== null) {
      errors.push(`${channelPath}.installability: cataloged must not claim assembly evidence`)
    }

    const isCertified = SUPPORT_STATUS_RANK[supportChannel.status] >= SUPPORT_STATUS_RANK.certified
    if (isCertified && supportChannel.certifications.length === 0) {
      errors.push(`${channelPath}.certifications: ${supportChannel.status} requires live smoke evidence`)
    }
    if (!isCertified && supportChannel.certifications.length > 0) {
      errors.push(`${channelPath}.certifications: ${supportChannel.status} must not claim live smoke evidence`)
    }

    const isEnabled = supportChannel.status === 'enabled'
    if (isEnabled && supportChannel.enablements.length === 0) {
      errors.push(`${channelPath}.enablements: enabled requires deployment evidence`)
    }
    if (!isEnabled && supportChannel.enablements.length > 0) {
      errors.push(`${channelPath}.enablements: ${supportChannel.status} must not claim deployment evidence`)
    }
  }

  for (const sourceChannel of catalog.channels) {
    if (!seen.has(sourceChannel.id)) {
      errors.push(`${path}.channels: missing channel ${sourceChannel.id}`)
    }
  }
}

function validateMonotonicity(
  production: ChannelCatalog,
  canary: ChannelCatalog,
  errors: string[],
): void {
  const canaryById = new Map(canary.channels.map(channel => [channel.id, channel]))
  for (const productionChannel of production.channels) {
    const canaryChannel = canaryById.get(productionChannel.id)
    if (canaryChannel === undefined) {
      errors.push(`catalog monotonicity: canary is missing production channel ${productionChannel.id}`)
      continue
    }
    if (STATUS_RANK[canaryChannel.status] < STATUS_RANK[productionChannel.status]) {
      errors.push(
        `status monotonicity: ${productionChannel.id} moved from ${productionChannel.status} to ${canaryChannel.status}`,
      )
    }
  }
}

/**
 * Parses and validates the host locks and their channel, support, and governance catalogs without network access.
 *
 * @param values Raw JSON values for the production and canary artifacts.
 * @returns Every schema or cross-artifact violation; an empty array means the set is valid.
 */
export function validateArtifactSet(values: RawArtifactSet): string[] {
  const errors: string[] = []
  const productionLock = parseHostLock(values.productionLock, 'productionLock', errors)
  const canaryLock = parseHostLock(values.canaryLock, 'canaryLock', errors)
  const productionCatalog = parseCatalog(values.productionCatalog, 'productionCatalog', errors)
  const canaryCatalog = parseCatalog(values.canaryCatalog, 'canaryCatalog', errors)
  const productionSupport = parseSupportCatalog(values.productionSupport, 'productionSupport', errors)
  const canarySupport = parseSupportCatalog(values.canarySupport, 'canarySupport', errors)
  const productionGovernance = parseGovernanceCatalog(
    values.productionGovernance,
    'productionGovernance',
    errors,
  )
  const canaryGovernance = parseGovernanceCatalog(
    values.canaryGovernance,
    'canaryGovernance',
    errors,
  )
  if (errors.length > 0) return errors

  validateHostTracks(productionLock, canaryLock, errors)
  validateCatalog(productionCatalog, productionLock, 'production', errors)
  validateCatalog(canaryCatalog, canaryLock, 'canary', errors)
  validateGovernanceCatalog(
    productionGovernance,
    productionCatalog,
    productionLock,
    'production',
    errors,
  )
  validateGovernanceCatalog(canaryGovernance, canaryCatalog, canaryLock, 'canary', errors)
  validateSupportCatalog(
    productionSupport,
    productionCatalog,
    productionGovernance,
    productionLock,
    'production',
    errors,
  )
  validateSupportCatalog(
    canarySupport,
    canaryCatalog,
    canaryGovernance,
    canaryLock,
    'canary',
    errors,
  )
  validateMonotonicity(productionCatalog, canaryCatalog, errors)
  return errors
}
