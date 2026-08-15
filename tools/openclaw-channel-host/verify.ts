import { lstatSync, readFileSync, realpathSync, type Stats } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  type ArtifactSet,
  type RawArtifactSet,
  validateArtifactSet,
} from './schema.ts'
import { verifyHostTree } from './tree.ts'

const DEFAULT_ARTIFACT_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const DEFAULT_REPOSITORY_ROOT = resolve(DEFAULT_ARTIFACT_DIRECTORY, '../..')

/** Optional paths used by the offline artifact check. */
export interface CheckOptions {
  /** Directory containing the eight lock and catalog JSON files. */
  artifactDirectory?: string
  /** Extracted production OpenClaw package root to verify. */
  hostRoot?: string
  /** ClawDSH checkout root used to resolve repository-relative evidence. */
  repoRoot?: string
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

/**
 * Loads the eight checked-in lock, channel, support, and governance JSON files from one directory.
 *
 * @param artifactDirectory Directory containing the eight canonical JSON artifacts.
 * @returns Untrusted parsed values; callers must validate them before relying on any field.
 */
export function loadArtifactSet(artifactDirectory = DEFAULT_ARTIFACT_DIRECTORY): RawArtifactSet {
  return {
    productionLock: readJson(resolve(artifactDirectory, 'host.production.json')),
    canaryLock: readJson(resolve(artifactDirectory, 'host.canary.json')),
    productionCatalog: readJson(resolve(artifactDirectory, 'channels.production.json')),
    canaryCatalog: readJson(resolve(artifactDirectory, 'channels.canary.json')),
    productionSupport: readJson(resolve(artifactDirectory, 'support.production.json')),
    canarySupport: readJson(resolve(artifactDirectory, 'support.canary.json')),
    productionGovernance: readJson(resolve(artifactDirectory, 'governance.production.json')),
    canaryGovernance: readJson(resolve(artifactDirectory, 'governance.canary.json')),
  }
}

interface EvidenceReference {
  path: string
  reference: string
}

function collectEvidenceReferences(artifacts: ArtifactSet): EvidenceReference[] {
  const references: EvidenceReference[] = []
  for (const [track, support] of [
    ['production', artifacts.productionSupport],
    ['canary', artifacts.canarySupport],
  ] as const) {
    for (const [channelIndex, channel] of support.channels.entries()) {
      const channelPath = `${track}Support.channels[${channelIndex}]`
      if (channel.installability !== null) {
        for (const field of ['configuration', 'capabilityProbe', 'contractTest'] as const) {
          references.push({
            path: `${channelPath}.installability.${field}`,
            reference: channel.installability[field],
          })
        }
      }
      for (const [index, certification] of channel.certifications.entries()) {
        references.push({
          path: `${channelPath}.certifications[${index}].evidence`,
          reference: certification.evidence,
        })
      }
      for (const [index, enablement] of channel.enablements.entries()) {
        references.push({
          path: `${channelPath}.enablements[${index}].evidence`,
          reference: enablement.evidence,
        })
      }
    }
  }
  for (const [track, governance] of [
    ['production', artifacts.productionGovernance],
    ['canary', artifacts.canaryGovernance],
  ] as const) {
    for (const [channelIndex, channel] of governance.channels.entries()) {
      const channelPath = `${track}Governance.channels[${channelIndex}]`
      for (const field of ['license', 'platformTerms', 'security'] as const) {
        for (const [index, reference] of channel[field].evidence.entries()) {
          references.push({
            path: `${channelPath}.${field}.evidence[${index}]`,
            reference,
          })
        }
      }
    }
  }
  return references
}

function pathIsWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate)
  return pathFromRoot === ''
    || (!isAbsolute(pathFromRoot) && pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`))
}

function verifyRepositoryEvidence(artifacts: ArtifactSet, repositoryRoot: string): string[] {
  const references = collectEvidenceReferences(artifacts).filter(
    ({ reference }) => !/^https:\/\//i.test(reference),
  )
  if (references.length === 0) return []

  let canonicalRoot: string
  try {
    canonicalRoot = realpathSync(repositoryRoot)
  } catch (error) {
    return [`evidence repository root: ${error instanceof Error ? error.message : String(error)}`]
  }
  if (!lstatSync(canonicalRoot).isDirectory()) {
    return [`evidence repository root: expected directory ${repositoryRoot}`]
  }

  const errors: string[] = []
  for (const { path, reference } of references) {
    const candidate = resolve(canonicalRoot, reference)
    if (!pathIsWithin(canonicalRoot, candidate)) {
      errors.push(`${path}: repository evidence path escapes the repository root: ${reference}`)
      continue
    }

    let entry: Stats
    try {
      entry = lstatSync(candidate)
    } catch (error) {
      errors.push(
        `${path}: repository evidence file is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      )
      continue
    }
    if (!entry.isFile()) {
      errors.push(`${path}: repository evidence must be an ordinary file: ${reference}`)
      continue
    }

    let canonicalEvidence: string
    try {
      canonicalEvidence = realpathSync(candidate)
    } catch (error) {
      errors.push(
        `${path}: repository evidence file is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      )
      continue
    }
    if (!pathIsWithin(canonicalRoot, canonicalEvidence)) {
      errors.push(`${path}: repository evidence resolves outside the repository root: ${reference}`)
    }
  }
  return errors
}

/**
 * Validates the checked-in artifacts, repository-local evidence, and optionally an extracted production host tree.
 *
 * @param options Artifact directory, evidence repository root, and optional extracted host package root.
 * @returns Every validation failure; this function performs no network requests.
 */
export function checkArtifacts(options: CheckOptions = {}): string[] {
  const rawArtifacts = loadArtifactSet(options.artifactDirectory)
  const errors = validateArtifactSet(rawArtifacts)
  if (errors.length > 0) return errors

  // validateArtifactSet exhaustively validates every durable JSON field before this local assertion.
  const artifacts = rawArtifacts as ArtifactSet
  errors.push(
    ...verifyRepositoryEvidence(
      artifacts,
      resolve(options.repoRoot ?? DEFAULT_REPOSITORY_ROOT),
    ),
  )
  if (options.hostRoot === undefined) return errors
  if (artifacts.productionLock.tree === null) {
    return [...errors, 'productionLock.tree: production tree summary is required for --host-root']
  }
  return [...errors, ...verifyHostTree(options.hostRoot, artifacts.productionLock.tree)]
}

/**
 * Parses the deliberately small offline CLI.
 *
 * @param arguments_ Command-line arguments after the script path.
 * @returns Check options when `--check` is present.
 */
export function parseArguments(arguments_: string[]): CheckOptions {
  let check = false
  let hostRoot: string | undefined
  let repoRoot: string | undefined
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--check') {
      check = true
      continue
    }
    if (argument === '--host-root') {
      const value = arguments_[index + 1]
      if (value === undefined || value.startsWith('--')) throw new Error('--host-root requires a path')
      hostRoot = value
      index += 1
      continue
    }
    if (argument === '--repo-root') {
      const value = arguments_[index + 1]
      if (value === undefined || value.startsWith('--')) throw new Error('--repo-root requires a path')
      repoRoot = value
      index += 1
      continue
    }
    throw new Error(`unknown argument: ${argument}`)
  }
  if (!check) throw new Error('expected --check')
  return {
    ...(hostRoot === undefined ? {} : { hostRoot }),
    ...(repoRoot === undefined ? {} : { repoRoot }),
  }
}

function main(): void {
  const options = parseArguments(process.argv.slice(2))
  const errors = checkArtifacts(options)
  if (errors.length > 0) throw new Error(errors.join('\n'))
  const suffix = options.hostRoot === undefined ? '' : ' and production host tree'
  process.stdout.write(`OpenClaw channel-host artifacts${suffix} verified.\n`)
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && pathToFileURL(resolve(invokedPath)).href === import.meta.url) {
  try {
    main()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`openclaw-channel-host: ${message}\n`)
    process.exitCode = 1
  }
}
