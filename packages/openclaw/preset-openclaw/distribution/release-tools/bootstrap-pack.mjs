#!/usr/bin/env node
/** Deterministically generate the reviewed inert package-name bootstrap set. */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BOOTSTRAP_INDEX_FILENAME,
  bootstrapManifest,
  bootstrapReadme,
  bootstrapSpecifications,
  bootstrapTarballFilename,
  canonicalBootstrapJson,
} from './bootstrap-contract.mjs'
import { deterministicNpmTarball } from './bootstrap-tar.mjs'
import { buildBootstrapIndex, verifyBootstrapDirectory } from './bootstrap-verify.mjs'

const TOOL_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const DEFAULT_REPOSITORY_ROOT = resolve(TOOL_DIRECTORY, '../../../../..')

/** Generate all thirteen inert tarballs and their closed SHA-512 index. */
export function packBootstrap({ repositoryRoot = DEFAULT_REPOSITORY_ROOT, outputDirectory }) {
  if (!outputDirectory) throw new TypeError('bootstrap output directory is required')
  const repository = realpathSync(resolve(repositoryRoot))
  const output = resolve(outputDirectory)
  if (existsSync(output)) throw new TypeError(`bootstrap output already exists: ${output}`)
  const parent = dirname(output)
  if (!existsSync(parent) || !lstatSync(parent).isDirectory() || lstatSync(parent).isSymbolicLink()) {
    throw new TypeError('bootstrap output parent must be an ordinary directory')
  }
  const licensePath = resolve(repository, 'LICENSE')
  const licenseMetadata = lstatSync(licensePath)
  if (licenseMetadata.isSymbolicLink() || !licenseMetadata.isFile()) {
    throw new TypeError('repository LICENSE must be an ordinary file')
  }
  const license = readFileSync(licensePath)
  mkdirSync(output)
  for (const specification of bootstrapSpecifications()) {
    const manifest = Buffer.from(canonicalBootstrapJson(bootstrapManifest(specification)))
    const readme = Buffer.from(bootstrapReadme(specification.name))
    const archive = deterministicNpmTarball([
      { path: 'package.json', bytes: manifest },
      { path: 'LICENSE', bytes: license },
      { path: 'README.md', bytes: readme },
    ])
    writeFileSync(resolve(output, bootstrapTarballFilename(specification.name)), archive, { flag: 'wx', mode: 0o644 })
  }
  const index = buildBootstrapIndex(output, { repositoryRoot: repository })
  writeFileSync(resolve(output, BOOTSTRAP_INDEX_FILENAME), canonicalBootstrapJson(index), { flag: 'wx', mode: 0o644 })
  return verifyBootstrapDirectory(output, { repositoryRoot: repository })
}

function argumentsFrom(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--') || values.has(key)) {
      throw new TypeError('bootstrap-pack arguments must be unique --name value pairs')
    }
    values.set(key, value)
  }
  for (const key of values.keys()) {
    if (key !== '--repository-root' && key !== '--output') throw new TypeError(`unknown argument ${key}`)
  }
  return values
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const arguments_ = argumentsFrom(process.argv.slice(2))
  const index = packBootstrap({
    repositoryRoot: arguments_.get('--repository-root') ?? DEFAULT_REPOSITORY_ROOT,
    outputDirectory: arguments_.get('--output'),
  })
  process.stdout.write(`generated ${String(index.packages.length)} deterministic inert bootstrap tarballs\n`)
}
