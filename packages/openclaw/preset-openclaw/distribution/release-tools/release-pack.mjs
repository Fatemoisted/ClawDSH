#!/usr/bin/env node
/** Build real npm tarballs in the one approved topological order. */

import { spawnSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RELEASE_PACKAGES, tarballFilename } from './release-contract.mjs'
import {
  canonicalReleaseIndex,
  verifyPackageTarball,
  verifyReleaseDirectory,
  verifySourcePackageSet,
} from './release-verify.mjs'

const TOOL_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const DEFAULT_REPOSITORY_ROOT = resolve(TOOL_DIRECTORY, '../../../../..')

function inside(root, path) {
  const relation = relative(root, path)
  return relation === '' || (relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation))
}

function defaultPack({ executable = 'pnpm' } = {}) {
  return ({ directory, output }) => {
    const result = spawnSync(executable, ['pack', '--out', output], {
      cwd: directory,
      encoding: 'utf8',
      env: { ...process.env, npm_config_ignore_scripts: 'true' },
      maxBuffer: 4 * 1024 * 1024,
    })
    if (result.error) throw result.error
    if (result.status !== 0) {
      throw new Error(`pnpm pack failed in ${directory}:\n${result.stderr || result.stdout}`)
    }
  }
}

/** Pack and immediately verify all 13 packages. The injected packer is test-only. */
export function packRelease({
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  outputDirectory,
  stagedBundleDirectory,
  pack = defaultPack(),
}) {
  if (!outputDirectory) throw new TypeError('release output directory is required')
  if (!stagedBundleDirectory) throw new TypeError('staged bundle directory is required')
  const repository = realpathSync(resolve(repositoryRoot))
  verifySourcePackageSet(repository)
  const output = resolve(outputDirectory)
  if (!inside(dirname(output), output)) throw new TypeError('release output directory is invalid')
  if (!existsSync(output)) mkdirSync(output, { recursive: true })
  if (!lstatSync(output).isDirectory() || lstatSync(output).isSymbolicLink()) {
    throw new TypeError('release output must be an ordinary directory')
  }
  if (readdirSync(output).length !== 0) throw new TypeError('release output directory must be empty')
  const stagedBundle = realpathSync(resolve(stagedBundleDirectory))

  for (const specification of RELEASE_PACKAGES) {
    const directory = specification.staged
      ? stagedBundle
      : realpathSync(resolve(repository, specification.directory))
    if (!specification.staged && !inside(repository, directory)) {
      throw new TypeError(`${specification.name} source escapes the repository`)
    }
    const destination = join(output, tarballFilename(specification.name))
    pack({ name: specification.name, directory, output: destination })
    if (!existsSync(destination)) throw new TypeError(`packer did not create ${destination}`)
    verifyPackageTarball(destination, specification.name)
  }
  const index = verifyReleaseDirectory(output)
  writeFileSync(join(output, 'release-index.json'), canonicalReleaseIndex(index), { flag: 'wx' })
  return index
}

function parseArguments(arguments_) {
  const values = new Map()
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index]
    const value = arguments_[index + 1]
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--') || values.has(key)) {
      throw new TypeError('release-pack arguments must be unique --name value pairs')
    }
    values.set(key, value)
  }
  const allowed = new Set(['--repository-root', '--output', '--bundle-directory', '--pnpm'])
  for (const key of values.keys()) if (!allowed.has(key)) throw new TypeError(`unknown argument ${key}`)
  return values
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const arguments_ = parseArguments(process.argv.slice(2))
  const index = packRelease({
    repositoryRoot: arguments_.get('--repository-root') ?? DEFAULT_REPOSITORY_ROOT,
    outputDirectory: arguments_.get('--output'),
    stagedBundleDirectory: arguments_.get('--bundle-directory'),
    pack: defaultPack({ executable: arguments_.get('--pnpm') ?? 'pnpm' }),
  })
  process.stdout.write(`packed and verified ${String(index.packages.length)} ClawDSH packages\n`)
}
