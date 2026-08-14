/**
 * Install packed tarballs into a throwaway consumer outside the repository and
 * drive the installed executable or importable library surfaces with plain
 * Node.
 *
 * Every tarball the installed tree needs comes from `--from`, so the only
 * registry traffic is for external dependencies. That matters beyond hermetic
 * verification: the harness packages declare the vendored framework as a peer,
 * those packages live in another release sequence, and this job must not depend
 * on the registry already carrying versions that match — one pull request may
 * bump both families before either publishes — so a dsh verification passes the
 * vendored family's pack output too, while publishing only its own
 * ([rationale](../../.agents/notes/implemented/process/2026-08-10-npm-release-sequences.md)).
 *
 * What this proves is that `files` selected a complete payload and that the
 * published dependency ranges resolve. A workspace link or a stale `lib/` in the
 * checkout cannot stand in for a missing file here.
 */

import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { releaseFamily, type ReleaseFamily, type ReleaseMember } from './families.ts'
import { capture, isEntry } from './process.ts'
import { packedIdentity } from './tarball.ts'

/** npm flags for an artifact-focused consumer install with no native build toolchain. */
export const PACKED_INSTALL_NPM_ARGS = [
  'install', '--no-audit', '--no-fund', '--package-lock=false',
  '--omit=optional', '--ignore-scripts',
] as const

/**
 * Environment for the installed artifact: no host Node hooks, no host DeepSeek
 * Harness home, and no ambient npm user agent that would confuse npm.
 * @param consumerRoot - the throwaway consumer directory.
 * @returns The child environment.
 */
function consumerEnvironment(consumerRoot: string): NodeJS.ProcessEnv {
  const environment = { ...process.env }
  delete environment.npm_config_user_agent
  delete environment.NPM_CONFIG_USER_AGENT
  delete environment.NODE_OPTIONS
  delete environment.NODE_PATH
  environment.DSH_HOME = resolve(consumerRoot, '.dsh')
  environment.DSH_AGENTS_HOME = resolve(consumerRoot, '.agents')
  environment.DSH_TELEMETRY_DISABLED = '1'
  return environment
}

/** Non-secret host variables a plain Node import probe may need cross-platform. */
const PROBE_ENV_ALLOWLIST = [
  'PATH', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'ComSpec', 'COMSPEC', 'WINDIR',
  'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'NO_COLOR', 'FORCE_COLOR',
] as const

/**
 * Build a credential-free environment for executing installed package code.
 * The install subprocess may need a registry read token; imported dependencies
 * never do, and must not inherit GitHub/ACTIONS or npm authentication state.
 */
function probeEnvironment(consumerRoot: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const key of PROBE_ENV_ALLOWLIST) {
    const value = process.env[key]
    if (value !== undefined) environment[key] = value
  }
  environment.DSH_HOME = resolve(consumerRoot, '.dsh')
  environment.DSH_AGENTS_HOME = resolve(consumerRoot, '.agents')
  environment.DSH_TELEMETRY_DISABLED = '1'
  // If imported code invokes npm config discovery, point it at an intentionally
  // blank file inside the permission boundary rather than the runner account.
  const userConfig = resolve(consumerRoot, '.npmrc-probe')
  writeFileSync(userConfig, '')
  environment.NPM_CONFIG_USERCONFIG = userConfig
  return environment
}

/** Node permission flags that confine installed-code probes to the consumer. */
function probePermissionArgs(consumerRoot: string): string[] {
  const canonicalRoot = realpathSync(consumerRoot)
  const dshHome = resolve(canonicalRoot, '.dsh')
  const agentsHome = resolve(canonicalRoot, '.agents')
  mkdirSync(dshHome, { recursive: true })
  mkdirSync(agentsHome, { recursive: true })
  return [
    '--permission',
    `--allow-fs-read=${canonicalRoot}`,
    `--allow-fs-write=${dshHome}`,
    `--allow-fs-write=${agentsHome}`,
  ]
}

/**
 * Every packed tarball in the given directories, as `file:` dependency entries.
 *
 * The directories are read by their contents rather than a pack order file: a
 * directory here can hold tarballs packed only to satisfy a cross-sequence
 * dependency, which no release order describes.
 * @param directories - absolute directories holding packed tarballs.
 * @returns Package name to tarball file URL, and the version each carries.
 */
function packedDependencies(directories: readonly string[]): Map<string, { url: string; version: string }> {
  const dependencies = new Map<string, { url: string; version: string }>()
  for (const directory of directories) {
    const tarballs = readdirSync(directory).filter(name => name.endsWith('.tgz')).sort()
    if (tarballs.length === 0) throw new Error(`${directory} holds no packed tarball`)
    for (const filename of tarballs) {
      const tarball = join(directory, filename)
      const { name, version } = packedIdentity(tarball)
      dependencies.set(name, { url: pathToFileURL(tarball).href, version })
    }
  }
  return dependencies
}

/**
 * Import probes for a family's installed library members.
 * @param family - release family defining the required subpaths.
 * @param members - family members installed from tarballs.
 * @returns Bare package specifiers in deterministic member/subpath order.
 */
export function installedImportSpecifiers(
  family: ReleaseFamily,
  members: readonly ReleaseMember[],
): string[] {
  return members.flatMap(member =>
    family.installedImportSubpaths.map(subpath => `${member.name}${subpath}`))
}

/**
 * Install every tarball and drive the selected family's installed probes.
 * @param familyId - release family identifier.
 * @param directories - packed directories, relative to `root` or absolute.
 * @param root - repository root whose manifests define the family members.
 */
export function verifyPackedInstall(
  familyId: string,
  directories: readonly string[],
  root = process.cwd(),
): void {
  const family = releaseFamily(familyId)
  const entry = family.installedEntry
  const importMembers = family.installedImportSubpaths.length === 0 ? [] : family.members(root)
  const importSpecifiers = installedImportSpecifiers(family, importMembers)
  if (entry === undefined && importSpecifiers.length === 0) {
    console.log(`release verify-packed-install: family ${family.id} defines no installed probes, nothing to drive`)
    return
  }

  const packed = packedDependencies(directories.map(directory => resolve(root, directory)))
  const expectedEntry = entry === undefined ? undefined : packed.get(entry.packageName)
  if (entry !== undefined && expectedEntry === undefined) {
    throw new Error(`${entry.packageName} is not among the packed tarballs`)
  }
  for (const member of importMembers) {
    const expected = packed.get(member.name)
    if (expected === undefined) throw new Error(`${member.name} is not among the packed tarballs`)
    if (expected.version !== member.version) {
      throw new Error(`${member.name} packed version ${expected.version}, expected ${member.version}`)
    }
  }

  const consumerRoot = mkdtempSync(join(tmpdir(), `dsh-packed-${family.id}-`))
  try {
    writeFileSync(join(consumerRoot, 'package.json'), `${JSON.stringify({
      name: `dsh-packed-install-${family.id}`,
      version: '0.0.0',
      private: true,
      dependencies: Object.fromEntries([...packed].map(([name, entryPacked]) => [name, entryPacked.url])),
    }, null, 2)}\n`)

    const installEnvironment = consumerEnvironment(consumerRoot)
    console.log(`release verify-packed-install: installing ${String(packed.size)} tarball(s) into ${consumerRoot}`)
    // Optional dependencies are omitted: the Landlock platform packages behind
    // them are released separately, and a consumer that cannot install them
    // must still start — which is what optional means here. Omitting optional
    // packages also omits third-party native prebuild helpers (for example
    // koffi's platform package), so lifecycle scripts are disabled for this
    // payload/import probe instead of forcing a source build toolchain. A normal
    // consumer install keeps both scripts and optional prebuilds enabled.
    capture('npm', PACKED_INSTALL_NPM_ARGS,
      { cwd: consumerRoot, env: installEnvironment })

    const environment = probeEnvironment(consumerRoot)
    const permissions = probePermissionArgs(consumerRoot)

    if (entry !== undefined && expectedEntry !== undefined) {
      const bin = join(consumerRoot, 'node_modules', ...entry.packageName.split('/'), entry.binPath)
      const version = capture(process.execPath, [...permissions, bin, '--version'], { cwd: consumerRoot, env: environment })
      if (version !== expectedEntry.version) {
        throw new Error(`installed ${entry.packageName} --version reported ${JSON.stringify(version)}, expected ${expectedEntry.version}`)
      }
      console.log(`release verify-packed-install: installed ${entry.packageName} reports ${version}`)
    }
    for (const specifier of importSpecifiers) {
      capture(process.execPath, [
        ...permissions,
        '--input-type=module',
        '--eval',
        `await import(${JSON.stringify(specifier)})`,
      ], { cwd: consumerRoot, env: environment })
      console.log(`release verify-packed-install: imported ${specifier}`)
    }
  } finally {
    rmSync(consumerRoot, { recursive: true, force: true })
  }
}

/** Install every tarball under `--from` and drive the `--family` probes. */
function main(): void {
  const { values } = parseArgs({
    options: { family: { type: 'string' }, from: { type: 'string', multiple: true } },
    allowPositionals: false,
  })
  if (values.family === undefined || values.from === undefined || values.from.length === 0) {
    throw new Error('usage: verify-packed-install.ts --family <dsh|clawdsh|vendor> --from <packed directory> [--from ...]')
  }
  verifyPackedInstall(values.family, values.from)
}

if (isEntry(import.meta.url)) main()
