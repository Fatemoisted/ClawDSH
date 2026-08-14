/**
 * Verify a release family's version baseline, and — when publishing — that the
 * run comes from the family's tag, that tag is on the release branch, and its
 * members are publishable.
 *
 * Publication happens only from GitHub Actions, so the tag and publishability
 * checks are gates on the workflow, not advisory local warnings
 * ([rationale](../../.agents/notes/implemented/process/2026-08-10-npm-release-sequences.md)).
 */

import { isIP } from 'node:net'
import { parseArgs } from 'node:util'
import { attempt, isEntry } from './process.ts'
import { releaseFamily, type ReleaseFamily, type ReleaseMember } from './families.ts'

/**
 * Assert every member may be published: npm refuses a `private` package.
 * @param members - the family's members.
 */
function verifyPublishable(members: readonly ReleaseMember[]): void {
  const priv = members.filter(member => member.manifest.private === true)
  if (priv.length > 0) {
    throw new Error(`publishing requires removing "private": true from:\n${priv.map(member => member.directory).join('\n')}`)
  }
}

/**
 * Assert the workflow runs from a tag this family publishes from, and that the
 * tag names a version the family actually carries.
 * @param family - the release family.
 * @param members - the family's members.
 * @param ref - the `GITHUB_REF` value.
 */
function verifyTag(family: ReleaseFamily, members: readonly ReleaseMember[], ref: string): void {
  const prefix = 'refs/tags/'
  if (!ref.startsWith(prefix)) {
    throw new Error(`publishing release family ${family.id} requires running from a ${family.tagPrefix}* tag, got ${ref || '(no ref)'}`)
  }
  const tag = ref.slice(prefix.length)
  if (!tag.startsWith(family.tagPrefix)) {
    throw new Error(`tag ${tag} does not belong to release family ${family.id} (expected ${family.tagPrefix}*)`)
  }
  const expected = members.map(member => family.tagFor(member))
  if (!expected.includes(tag)) {
    throw new Error(`tag ${tag} names no version this family carries; its members would tag as:\n${[...new Set(expected)].join('\n')}`)
  }
}

/**
 * Assert the tagged commit is contained in the family's protected release
 * branch. A full fetch is required so Git can see the remote-tracking branch.
 * @param family - the release family.
 * @param root - repository checkout holding `origin/<release branch>`.
 */
export function verifyReleaseBranch(family: ReleaseFamily, root = process.cwd()): void {
  const remoteBranch = `origin/${family.releaseBranch}`
  const result = attempt('git', ['merge-base', '--is-ancestor', 'HEAD', remoteBranch], { cwd: root })
  if (result.status === 0) return
  if (result.status === 1) {
    throw new Error(
      `publishing release family ${family.id} requires the tagged HEAD to be contained in ${remoteBranch}`,
    )
  }
  const detail = result.stderr.trim() || result.stdout.trim() || `git exited with ${String(result.status)}`
  throw new Error(`could not verify ${remoteBranch} ancestry for release family ${family.id}: ${detail}`)
}

/**
 * Fail closed unless a protected-environment registry value is an HTTPS
 * private endpoint. Credentials belong in the environment secret, never the
 * URL, and the public npm registry is deliberately not a valid target.
 * @param registry - registry URL supplied by the protected environment.
 */
export function verifyPrivateRegistryUrl(registry: string): void {
  if (registry.length === 0 || registry !== registry.trim()) {
    throw new Error('private registry URL must be non-empty and contain no surrounding whitespace')
  }

  let parsed: URL
  try {
    parsed = new URL(registry)
  } catch {
    throw new Error(`private registry URL is invalid: ${JSON.stringify(registry)}`)
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`private registry URL must use HTTPS, got ${parsed.protocol || '(no protocol)'}`)
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new Error('private registry URL must not embed credentials')
  }
  if (parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new Error('private registry URL must not contain a query or fragment')
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.+$/, '')
  const address = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  const validDnsName = hostname.length <= 253 && hostname.split('.').every(label => (
    label.length > 0
    && label.length <= 63
    && /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/u.test(label)
  ))
  if (isIP(address) === 0 && !validDnsName) {
    throw new Error(`private registry URL has an invalid hostname: ${JSON.stringify(parsed.hostname)}`)
  }
  if (hostname === 'registry.npmjs.org') {
    throw new Error('refusing to publish the private ClawDSH family to the public npm registry')
  }
}

/** Run the verification for the family named by `--family`. */
function main(): void {
  const { values } = parseArgs({
    options: {
      family: { type: 'string' },
      registry: { type: 'string' },
    },
    allowPositionals: false,
  })
  if (values.family === undefined) {
    throw new Error('usage: verify.ts --family <dsh|clawdsh|vendor> [--registry <private HTTPS URL>]')
  }

  const family = releaseFamily(values.family)
  const root = process.cwd()
  const members = family.members(root)
  family.verifyVersions(members)
  family.verifySynchronizedDependencyRanges(root, members)

  const publishing = process.env.RELEASE_PUBLISH === 'true'
  if (publishing) {
    verifyPublishable(members)
    verifyTag(family, members, process.env.GITHUB_REF ?? '')
    verifyReleaseBranch(family, root)
  }
  if (values.registry !== undefined) verifyPrivateRegistryUrl(values.registry)

  const versions = [...new Set(members.map(member => member.version))]
  const summary = versions.length === 1 ? versions[0] : `${String(versions.length)} versions`
  console.log(`release verify: family ${family.id}, ${String(members.length)} member(s), ${summary}${publishing ? ', publish gates passed' : ''}`)
}

if (isEntry(import.meta.url)) main()
