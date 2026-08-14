/**
 * The independent publish sequences this repository releases from. This
 * module owns `dsh`, `clawdsh`, and `vendor`; the native sequence is managed
 * separately. Each family carries its own version baseline, tag naming, and
 * publish set, so releasing one never republishes another
 * ([rationale](../../.agents/notes/implemented/process/2026-08-10-npm-release-sequences.md)).
 *
 * The family dimension lives here only. A new sequence adds a subclass and a
 * `releaseFamilies()` entry; nothing else in the release scripts branches on it.
 */

import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { validateTarballPayload } from '../publication-payload.ts'

/** Dependency sections that constrain publish order: a consumer must publish after its dependency. */
const ORDER_SECTIONS = ['dependencies', 'optionalDependencies'] as const

/** The workspace root manifest, which is never a release member. */
const WORKSPACE_ROOT_PACKAGE = '@deepseek-ai/dsh-root'

/** One publishable package of a release family. */
export interface ReleaseMember {
  /** Repository-relative package directory, for example `packages/core/session`. */
  readonly directory: string
  /** Package name from its manifest. */
  readonly name: string
  /** Package version from its manifest. */
  readonly version: string
  /** The parsed manifest, for payload policy and publication checks. */
  readonly manifest: Readonly<Record<string, unknown>>
}

/** One dependency range outside the publish set that follows a family's shared version. */
export interface PlannedDependencyRange {
  /** Repository-relative manifest path. */
  readonly manifestPath: string
  /** Release member named by the dependency. */
  readonly packageName: string
  /** Range the manifest currently carries. */
  readonly from: string
  /** Range required by the target family version. */
  readonly to: string
}

/**
 * Read and parse a JSON file.
 * @param path - absolute file path.
 * @returns The parsed object.
 */
function readManifest(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${path} is not a JSON object`)
  }
  return parsed as Record<string, unknown>
}

/**
 * Read a required string field.
 * @param manifest - parsed manifest.
 * @param field - field name.
 * @param context - manifest path for the error message.
 * @returns The field value.
 */
function requireString(manifest: Record<string, unknown>, field: string, context: string): string {
  const value = manifest[field]
  if (typeof value !== 'string' || value === '') throw new Error(`${context} must declare a string ${field}`)
  return value
}

/** The executable a family's installed artifacts are driven through. */
export interface InstalledEntry {
  /** Package that carries the executable. */
  readonly packageName: string
  /** Path to the executable inside that package. */
  readonly binPath: string
}

/** How a release bump advances a family's manifests. */
export type ReleaseVersioning = 'shared-with-root' | 'shared' | 'per-package'

/** A release sequence: its members, its version baseline, and its tag naming. */
export abstract class ReleaseFamily {
  /** Workflow-facing identifier, also the `--family` argument. */
  abstract readonly id: string

  /** Glob patterns, relative to the repository root, that select this family's manifests. */
  abstract readonly patterns: readonly string[]

  /** Git tag prefix this family publishes from. */
  abstract readonly tagPrefix: string

  /** Whether members share a version, and whether the workspace root shares it too. */
  abstract readonly versioning: ReleaseVersioning

  /** Branch a completed bump must merge to before its release tag is created. */
  readonly releaseBranch: string = 'master'

  /** Package-name prefix every selected manifest must use. */
  protected abstract readonly packageNamePrefix: string

  /** Non-published manifests whose dependency ranges follow every family member. */
  protected readonly synchronizedDependencyManifests: readonly string[] = []

  /**
   * Decide whether a path selected by {@link patterns} belongs to this family.
   * @param _manifestPath - normalized repository-relative manifest path.
   * @returns Whether the manifest is a member.
   */
  protected includesManifest(_manifestPath: string): boolean {
    return true
  }

  /**
   * Discover this family's members.
   * @param root - repository root.
   * @returns Members sorted by directory, with names validated and deduplicated.
   */
  members(root: string): ReleaseMember[] {
    const manifestPaths = globSync([...this.patterns], { cwd: root })
      .map(manifestPath => manifestPath.replaceAll('\\', '/'))
      .filter(manifestPath => this.includesManifest(manifestPath))
      .sort()
    if (manifestPaths.length === 0) throw new Error(`release family ${this.id} matched no manifests`)

    const members: ReleaseMember[] = []
    const seen = new Set<string>()
    for (const manifestPath of manifestPaths) {
      const manifest = readManifest(resolve(root, manifestPath))
      const name = requireString(manifest, 'name', manifestPath)
      const version = requireString(manifest, 'version', manifestPath)
      if (name === WORKSPACE_ROOT_PACKAGE) throw new Error(`${manifestPath} selected the workspace root`)
      if (!name.startsWith(this.packageNamePrefix)) {
        throw new Error(`${manifestPath} must name a ${this.packageNamePrefix} package`)
      }
      if (seen.has(name)) throw new Error(`${name} appears twice in release family ${this.id}`)
      seen.add(name)
      members.push({
        directory: manifestPath.slice(0, manifestPath.length - '/package.json'.length),
        name,
        version,
        manifest,
      })
    }
    return members
  }

  /**
   * Order members so every package publishes after the family members it depends on.
   * @param members - this family's members.
   * @returns The same members in publish order; ties break by name for determinism.
   */
  publishOrder(members: readonly ReleaseMember[]): ReleaseMember[] {
    const byName = new Map(members.map(member => [member.name, member]))
    const ordered: ReleaseMember[] = []
    const placed = new Set<string>()
    const visiting = new Set<string>()

    const visit = (member: ReleaseMember, path: readonly string[]): void => {
      if (placed.has(member.name)) return
      if (visiting.has(member.name)) {
        throw new Error(`dependency cycle in release family ${this.id}: ${[...path, member.name].join(' -> ')}`)
      }
      visiting.add(member.name)
      for (const dependency of this.orderEdges(member, byName)) {
        visit(dependency, [...path, member.name])
      }
      visiting.delete(member.name)
      placed.add(member.name)
      ordered.push(member)
    }

    for (const member of [...members].sort((left, right) => left.name.localeCompare(right.name))) {
      visit(member, [])
    }
    return ordered
  }

  /**
   * The family members one member depends on at runtime.
   * @param member - the dependent member.
   * @param byName - every family member by package name.
   * @returns Dependencies inside this family, sorted by name.
   */
  private orderEdges(member: ReleaseMember, byName: ReadonlyMap<string, ReleaseMember>): ReleaseMember[] {
    const edges: ReleaseMember[] = []
    for (const section of ORDER_SECTIONS) {
      const dependencies = member.manifest[section]
      if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)) continue
      for (const name of Object.keys(dependencies)) {
        const dependency = byName.get(name)
        if (dependency !== undefined && dependency.name !== member.name) edges.push(dependency)
      }
    }
    return edges.sort((left, right) => left.name.localeCompare(right.name))
  }

  /**
   * Assert this family's version baseline holds across its members.
   * @param members - this family's members.
   */
  abstract verifyVersions(members: readonly ReleaseMember[]): void

  /**
   * Plan dependency ranges in non-published consumers that follow this family.
   * @param root - repository root.
   * @param members - every family member the consumer must depend on.
   * @param version - target shared family version.
   * @returns Every dependency range to rewrite.
   */
  planSynchronizedDependencyRanges(
    root: string,
    members: readonly ReleaseMember[],
    version: string,
  ): PlannedDependencyRange[] {
    const planned: PlannedDependencyRange[] = []
    const to = `^${version}`
    for (const manifestPath of this.synchronizedDependencyManifests) {
      const manifest = readManifest(resolve(root, manifestPath))
      const dependencies = manifest.dependencies
      if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
        throw new Error(`${manifestPath} must declare dependencies for release family ${this.id}`)
      }
      const ranges = dependencies as Record<string, unknown>
      for (const member of members) {
        const from = ranges[member.name]
        if (typeof from !== 'string') {
          throw new Error(`${manifestPath} must depend on release member ${member.name}`)
        }
        planned.push({ manifestPath, packageName: member.name, from, to })
      }
    }
    return planned
  }

  /**
   * Require every synchronized consumer range to select the current family version.
   * @param root - repository root.
   * @param members - members whose already-verified version is current.
   */
  verifySynchronizedDependencyRanges(root: string, members: readonly ReleaseMember[]): void {
    const [first] = members
    if (first === undefined) throw new Error(`release family ${this.id} has no members`)
    const mismatches = this.planSynchronizedDependencyRanges(root, members, first.version)
      .filter(entry => entry.from !== entry.to)
    if (mismatches.length === 0) return
    const detail = mismatches
      .map(entry => `${entry.manifestPath}: ${entry.packageName} is ${entry.from}, expected ${entry.to}`)
      .join('\n')
    throw new Error(`release family ${this.id} has stale synchronized dependency ranges:\n${detail}`)
  }

  /**
   * The tag prefix a member's versions are tagged under. Every tag for that
   * member starts with it, which is how the last published version is found.
   * @param member - the member being published.
   * @returns The prefix, ending in `-v`.
   */
  abstract tagPrefixFor(member: ReleaseMember): string

  /**
   * The tag a member publishes from.
   * @param member - the member being published.
   * @returns The full tag name, without `refs/tags/`.
   */
  tagFor(member: ReleaseMember): string {
    return `${this.tagPrefixFor(member)}${member.version}`
  }

  /**
   * Check what a member's packed tarball carries.
   * @param member - the packed member.
   * @param files - every path inside its tarball.
   */
  abstract validatePayload(member: ReleaseMember, files: readonly string[]): void

  /**
   * The executable that proves this family's artifacts install and run, or
   * `undefined` for a family that publishes no executable.
   */
  abstract readonly installedEntry: InstalledEntry | undefined

  /**
   * Package subpaths every installed family member must expose to plain Node.
   * An empty string names the package's main export.
   */
  abstract readonly installedImportSubpaths: readonly string[]
}

/** `packages/*` and `apps/*`: one shared version across the whole family. */
class DshFamily extends ReleaseFamily {
  readonly id = 'dsh'
  readonly patterns = ['packages/*/*/package.json', 'apps/*/package.json'] as const
  readonly tagPrefix = 'dsh-v'
  readonly versioning = 'shared-with-root'
  protected readonly packageNamePrefix = '@deepseek-ai/'

  /** Keep the separately versioned ClawDSH packages out of the upstream family. */
  protected override includesManifest(manifestPath: string): boolean {
    return !manifestPath.startsWith('packages/openclaw/')
  }

  /**
   * Require one version across the family, the way a single tag can name it.
   * @param members - this family's members.
   */
  verifyVersions(members: readonly ReleaseMember[]): void {
    const versions = new Set(members.map(member => member.version))
    if (versions.size !== 1) {
      const detail = members.map(member => `${member.directory}: ${member.version}`).join('\n')
      throw new Error(`dsh release members must share one version:\n${detail}`)
    }
  }

  /**
   * The single family prefix: every member shares one version, so one tag names it.
   * @returns `dsh-v`.
   */
  tagPrefixFor(): string {
    return this.tagPrefix
  }

  /**
   * Reject source and declaration-map members, the repository's publication policy.
   * @param member - the packed member.
   * @param files - every path inside its tarball.
   */
  validatePayload(member: ReleaseMember, files: readonly string[]): void {
    validateTarballPayload(files, member.name)
  }

  readonly installedEntry = { packageName: '@deepseek-ai/dsh', binPath: 'lib/bin.js' }
  readonly installedImportSubpaths = []
}

/** `packages/openclaw/*`: one shared version on the downstream ClawDSH line. */
class ClawdshFamily extends ReleaseFamily {
  readonly id = 'clawdsh'
  readonly patterns = ['packages/openclaw/*/package.json'] as const
  readonly tagPrefix = 'clawdsh-v'
  readonly versioning = 'shared'
  override readonly releaseBranch = 'clawdsh'
  protected readonly packageNamePrefix = '@clawdsh/dsh-'
  protected override readonly synchronizedDependencyManifests = [
    'tools/openclaw-preset-openclaw/profile/package.json',
  ] as const

  /** Require one version so a single ClawDSH tag names the complete family. */
  verifyVersions(members: readonly ReleaseMember[]): void {
    const versions = new Set(members.map(member => member.version))
    if (versions.size !== 1) {
      const detail = members.map(member => `${member.directory}: ${member.version}`).join('\n')
      throw new Error(`clawdsh release members must share one version:\n${detail}`)
    }
  }

  /** The single prefix shared by every ClawDSH member. */
  tagPrefixFor(): string {
    return this.tagPrefix
  }

  /** Apply the same compiled-output payload policy as the upstream dsh family. */
  validatePayload(member: ReleaseMember, files: readonly string[]): void {
    validateTarballPayload(files, member.name)
  }

  /** ClawDSH currently publishes libraries rather than an executable. */
  readonly installedEntry = undefined

  /** Import both public runtime surfaces from every installed ClawDSH package. */
  readonly installedImportSubpaths = ['', '/invariant']
}

/** `vendor/*`: every package keeps its own version line, so every package has its own tag. */
class VendorFamily extends ReleaseFamily {
  readonly id = 'vendor'
  readonly patterns = ['vendor/*/package.json'] as const
  readonly tagPrefix = 'vendor-'
  readonly versioning = 'per-package'
  protected readonly packageNamePrefix = '@deepseek-ai/'

  /**
   * Accept independent versions; only reject a version this repository cannot publish.
   * @param members - this family's members.
   */
  verifyVersions(members: readonly ReleaseMember[]): void {
    for (const member of members) {
      if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(member.version)) {
        throw new Error(`${member.directory} has an unpublishable version: ${member.version}`)
      }
    }
  }

  /**
   * A prefix per member, because one vendor release can carry several versions.
   * @param member - the member being published.
   * @returns `vendor-<unscoped name>-v`.
   */
  tagPrefixFor(member: ReleaseMember): string {
    return `${this.tagPrefix}${member.name.replace('@deepseek-ai/', '')}-v`
  }

  /**
   * Require the payload the vendored manifest declares, including upstream's
   * `src` tree and declaration maps.
   *
   * The harness policy that rejects both does not apply here: these manifests
   * export `./src/*` for source navigation, so dropping `src` would publish a
   * package whose export map points at absent files. What must hold instead is
   * that every path the manifest selects is present, which `files` already
   * decides and `pnpm pack` already enforces.
   * @param member - the packed member.
   * @param files - every path inside its tarball.
   */
  validatePayload(member: ReleaseMember, files: readonly string[]): void {
    if (files.length === 0) throw new Error(`${member.name} packed an empty tarball`)
  }

  /** No installed-entry probe: these are libraries a consumer imports, with no executable. */
  readonly installedEntry = undefined
  readonly installedImportSubpaths = []
}

/** Every release family this module owns, in workflow order. */
function releaseFamilies(): readonly ReleaseFamily[] {
  return [new DshFamily(), new ClawdshFamily(), new VendorFamily()]
}

/**
 * Resolve a family by its `--family` identifier.
 * @param id - family identifier.
 * @returns The family.
 */
export function releaseFamily(id: string): ReleaseFamily {
  const family = releaseFamilies().find(candidate => candidate.id === id)
  if (family === undefined) {
    const known = releaseFamilies().map(candidate => candidate.id).join(', ')
    throw new Error(`unknown release family ${id}; expected one of ${known}`)
  }
  return family
}

/**
 * The npm tarball filename `pnpm pack` writes for a member.
 * @param member - the packed member.
 * @returns The tarball filename.
 */
export function tarballName(member: ReleaseMember): string {
  const unscoped = member.name.startsWith('@') ? member.name.slice(1).replace('/', '-') : member.name
  return `${unscoped}-${member.version}.tgz`
}
