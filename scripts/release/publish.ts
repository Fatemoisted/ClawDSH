/**
 * Publish one packed release family from the tarballs the pack step produced.
 *
 * Publication is decided per package against the registry, never from a list of
 * "what this release includes": a version the registry lacks is published, a
 * version whose published tarball has the same integrity is skipped, and a
 * version whose published tarball differs fails the run — that last case means
 * the content changed without a version bump
 * ([rationale](../../.agents/notes/implemented/process/2026-08-10-npm-release-sequences.md)).
 *
 * Skipping on identical integrity is what makes re-running the publish step over
 * the same artifact safe.
 */

import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { releaseFamily, tarballName, type ReleaseFamily } from './families.ts'
import { attempt, isEntry } from './process.ts'
import { packedIdentity, readPublishOrder, tarballFiles } from './tarball.ts'

/**
 * Registry codes that answer a write which did not settle, rather than a
 * rejection of what was sent. `E409 Failed to save packument` is the one this
 * sequence actually hits: publishing several packages in a row can outrun the
 * registry's own processing. A rejected payload (`E403` over an existing
 * version, a malformed manifest) never clears on a retry and must surface.
 */
const TRANSIENT_PUBLISH_CODES = ['E409', 'E429', 'E500', 'E502', 'E503', 'E504', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'] as const

/** How many times one tarball's publish is attempted before the run fails. */
const PUBLISH_ATTEMPTS = 4

/**
 * Shortest gap between two publishes, and the first retry backoff.
 *
 * The registry needs a moment to commit a packument before the next write; back
 * to back publishes are what produce `E409`.
 */
const PUBLISH_SPACING_MS = 2_000

/** What the registry knows about one version. */
type RegistryState =
  | { readonly kind: 'absent' }
  | { readonly kind: 'present'; readonly integrity: string }

/** One artifact proven to be the exact checkout-defined family member. */
export interface VerifiedPublishArtifact {
  readonly filename: string
  readonly name: string
  readonly version: string
}

/** Render one deterministic list for a fail-loud artifact-set diagnostic. */
function renderList(values: readonly string[]): string {
  return values.length === 0 ? '(none)' : values.join(', ')
}

/** Whether two ordered string lists are exactly equal. */
function sameSequence(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/**
 * Bind a downloaded pack directory back to the family declared by this
 * checkout. Publication must never trust an order file on its own: every
 * expected member must appear exactly once, no extra tarball may ride along,
 * and each archive must still carry the expected identity and payload policy.
 * @param family - checkout-defined release family.
 * @param directory - absolute pack artifact directory.
 * @param root - checkout root used to discover current family members.
 * @returns Verified artifacts in dependency-safe publish order.
 */
export function verifyPackedFamilyArtifacts(
  family: ReleaseFamily,
  directory: string,
  root = process.cwd(),
): VerifiedPublishArtifact[] {
  const members = family.publishOrder(family.members(root))
  family.verifyVersions(members)
  family.verifySynchronizedDependencyRanges(root, members)
  const expected = members.map(member => ({
    filename: tarballName(member),
    name: member.name,
    version: member.version,
    member,
  }))
  const expectedFiles = expected.map(artifact => artifact.filename)
  const order = readPublishOrder(directory)
  if (!sameSequence(order, expectedFiles)) {
    throw new Error(
      `release publish: artifact order does not exactly match family ${family.id}`
      + `\n  expected: ${renderList(expectedFiles)}\n  actual:   ${renderList(order)}`,
    )
  }
  const present = readdirSync(directory).filter(filename => filename.endsWith('.tgz')).sort()
  const sortedExpected = [...expectedFiles].sort()
  if (!sameSequence(present, sortedExpected)) {
    throw new Error(
      `release publish: tarball set does not exactly match family ${family.id}`
      + `\n  expected: ${renderList(sortedExpected)}\n  actual:   ${renderList(present)}`,
    )
  }
  return expected.map(({ filename, name, version, member }) => {
    const tarball = join(directory, filename)
    if (!lstatSync(tarball).isFile()) throw new Error(`release publish: ${filename} is not a regular file`)
    const identity = packedIdentity(tarball)
    if (identity.name !== name || identity.version !== version) {
      throw new Error(
        `release publish: ${filename} declares ${identity.name}@${identity.version}, expected ${name}@${version}`,
      )
    }
    family.validatePayload(member, tarballFiles(tarball))
    return { filename, name, version }
  })
}

/**
 * Whether a failed publish is worth another attempt.
 * @param output - combined npm output.
 * @returns True when the registry reported a write it did not commit.
 */
function isTransientFailure(output: string): boolean {
  return TRANSIENT_PUBLISH_CODES.some(code => output.includes(`code ${code}`))
}

/**
 * The subresource integrity string npm records for a tarball.
 * @param tarball - absolute tarball path.
 * @returns A `sha512-<base64>` string.
 */
function integrityOf(tarball: string): string {
  return `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`
}

/**
 * Ask the registry whether a version exists, and with what integrity.
 * @param name - package name.
 * @param version - package version.
 * @returns The registry state for that version.
 */
function registryState(name: string, version: string): RegistryState {
  const result = attempt('npm', ['view', `${name}@${version}`, 'dist.integrity', '--json'])
  if (result.status !== 0) {
    const output = `${result.stdout}${result.stderr}`
    if (output.includes('E404') || output.includes('404 Not Found')) return { kind: 'absent' }
    throw new Error(`npm view ${name}@${version} failed:\n${output}`)
  }
  const parsed: unknown = JSON.parse(result.stdout)
  if (typeof parsed !== 'string' || parsed === '') {
    throw new Error(`registry reported no dist.integrity for ${name}@${version}`)
  }
  return { kind: 'present', integrity: parsed }
}

/**
 * Publish one tarball, retrying a registry write that did not settle.
 *
 * Every retry re-reads the registry first, because `E409` can answer a write
 * that landed anyway: republishing a version that now exists fails permanently,
 * so the same integrity appearing under the failed attempt counts as success.
 * @param tarball - absolute tarball path.
 * @param name - package name the tarball declares.
 * @param version - package version the tarball declares.
 */
async function publishTarball(tarball: string, name: string, version: string): Promise<void> {
  // A prerelease version never takes the latest dist-tag.
  const tagArgs = version.includes('-') ? ['--tag', 'next'] : []
  for (let tries = 1; tries <= PUBLISH_ATTEMPTS; tries += 1) {
    // No --access: the sequences do not share one access level, so a
    // command-line flag could not serve both and would override the manifest
    // that does. Each packed manifest decides, and
    // check-workspace-constraints holds every manifest to its sequence's level.
    const result = attempt('npm', ['publish', tarball, ...tagArgs])
    const output = `${result.stdout}${result.stderr}`
    if (result.status === 0) return

    const settled = registryState(name, version)
    if (settled.kind === 'present' && settled.integrity === integrityOf(tarball)) {
      console.log(`release publish: ${name}@${version} landed despite a reported failure, continuing`)
      return
    }
    if (tries === PUBLISH_ATTEMPTS || !isTransientFailure(output)) {
      throw new Error(`npm publish ${name}@${version} failed:\n${output}`)
    }
    const backoff = PUBLISH_SPACING_MS * 2 ** (tries - 1)
    console.log(
      `release publish: ${name}@${version} hit a transient registry failure`
      + ` (attempt ${String(tries)} of ${String(PUBLISH_ATTEMPTS)}), retrying in ${String(backoff)}ms`,
    )
    await sleep(backoff)
  }
}

/** Publish the family named by `--family` from the directory named by `--from`. */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { family: { type: 'string' }, from: { type: 'string' } },
    allowPositionals: false,
  })
  if (values.family === undefined || values.from === undefined) {
    throw new Error('usage: publish.ts --family <dsh|clawdsh|vendor> --from <packed directory>')
  }

  const family = releaseFamily(values.family)
  const directory = resolve(process.cwd(), values.from)
  const artifacts = verifyPackedFamilyArtifacts(family, directory)

  let published = 0
  let skipped = 0
  for (const { filename, name, version } of artifacts) {
    const tarball = join(directory, filename)
    const state = registryState(name, version)
    if (state.kind === 'present') {
      const local = integrityOf(tarball)
      if (state.integrity !== local) {
        throw new Error(
          `${name}@${version} is already published with different content`
          + `\n  registry: ${state.integrity}\n  packed:   ${local}`
          + '\nBump the version, or investigate why the build is not reproducible.',
        )
      }
      console.log(`release publish: ${name}@${version} already published, skipping`)
      skipped += 1
      continue
    }
    // Space out the writes: the gap belongs between publishes, so a run that
    // only skips does not wait at all.
    if (published > 0) await sleep(PUBLISH_SPACING_MS)
    await publishTarball(tarball, name, version)
    console.log(`release publish: ${name}@${version} published`)
    published += 1
  }

  console.log(`release publish: family ${family.id}, ${String(published)} published, ${String(skipped)} already present`)
}

if (isEntry(import.meta.url)) await main()
