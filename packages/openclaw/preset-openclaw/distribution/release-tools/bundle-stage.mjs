/** Deterministic staging from checked-in sources and genuine product-shell build output. */

import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BUNDLE_NAME,
  BUNDLE_VERSION,
  FEATURE_PACKAGES,
  SAFE_PRESET_PACKAGE,
  verifyStagedBundle,
} from './bundle-verify.mjs'

const TOOL_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const DEFAULT_REPOSITORY_ROOT = resolve(TOOL_DIRECTORY, '../../../../..')
const DEFAULT_TEMPLATE = resolve(TOOL_DIRECTORY, '../bundle/package.json')
const DEVELOPMENT_RUNTIME = "name: '@clawdsh/dsh-product-runtime'"
const DISTRIBUTION_RUNTIME = `name: '${BUNDLE_NAME}'`

const RELEASE_PACKAGE_DIRECTORIES = Object.freeze([
  ['@clawdsh/dsh-soul', 'packages/openclaw/soul'],
  ['@clawdsh/dsh-embeddings', 'packages/openclaw/embeddings'],
  ['@clawdsh/dsh-embeddings-ark', 'packages/openclaw/embeddings-ark'],
  ['@clawdsh/dsh-memory', 'packages/openclaw/memory'],
  ['@clawdsh/dsh-skills-hub', 'packages/openclaw/skills-hub'],
  ['@clawdsh/dsh-automation', 'packages/openclaw/automation'],
  ['@clawdsh/dsh-channel', 'packages/openclaw/channel'],
  ['@clawdsh/dsh-channel-agent', 'packages/openclaw/channel-agent'],
  ['@clawdsh/dsh-channel-openclaw', 'packages/openclaw/channel-openclaw'],
  ['@clawdsh/dsh-activity', 'packages/openclaw/activity'],
  ['@clawdsh/dsh-preset-messaging-safe', 'packages/openclaw/preset-clawdsh-messaging-safe'],
])

const FILE_ASSETS = Object.freeze([
  ['LICENSE', 'LICENSE', 'license'],
  ['packages/openclaw/preset-openclaw/agent.cordis.yml', 'presets/clawdsh/agent.cordis.yml', 'primary-preset'],
  ['packages/openclaw/preset-openclaw/preset.yml', 'presets/clawdsh/preset.yml', 'primary-preset'],
  ['tools/openclaw-channel-host/host.production.json', 'channel/locks/host.production.json', 'channel-lock'],
  ['tools/openclaw-channel-host/channels.production.json', 'channel/locks/channels.production.json', 'channel-lock'],
  ['tools/openclaw-channel-host/support.production.json', 'channel/locks/support.production.json', 'channel-lock'],
  ['tools/openclaw-channel-host/governance.production.json', 'channel/locks/governance.production.json', 'channel-lock'],
  ['packages/openclaw/channel-openclaw/runtime/package.json', 'channel/runtime/package.json', 'channel-runtime-lock'],
  ['packages/openclaw/channel-openclaw/runtime/package-lock.json', 'channel/runtime/npm-shrinkwrap.json', 'channel-runtime-lock'],
  ['packages/openclaw/channel-openclaw/runtime/production-lock.json', 'channel/locks/runtime.production.json', 'channel-runtime-lock'],
  ['packages/openclaw/channel-openclaw/LICENSE.openclaw', 'channel/LICENSE.openclaw', 'channel-notice'],
  ['packages/openclaw/channel-openclaw/THIRD_PARTY_NOTICES.md', 'channel/THIRD_PARTY_NOTICES.md', 'channel-notice'],
  ['packages/openclaw/preset-openclaw/product-shell/runtime/lib/index.mjs', 'lib/index.mjs', 'control-runtime'],
  ['packages/openclaw/preset-openclaw/product-shell/runtime/lib/index.d.mts', 'lib/index.d.mts', 'control-runtime'],
])

const TREE_ASSETS = Object.freeze([
  ['packages/openclaw/preset-openclaw/souls', 'presets/clawdsh/souls', 'primary-preset'],
  ['packages/openclaw/preset-openclaw/product-shell/runtime/web', 'web', 'product-gui'],
  ['packages/openclaw/channel-openclaw/bridge/stable-v1', 'channel/bridge/stable-v1', 'channel-bridge'],
  ['packages/openclaw/channel-openclaw/bridge/shared', 'channel/bridge/shared', 'channel-bridge'],
])

const RUNTIME_BUILD_INPUTS = Object.freeze([
  'packages/openclaw/preset-openclaw/product-shell/runtime/src',
  'packages/openclaw/preset-openclaw/product-shell/shared/src',
  'packages/openclaw/preset-openclaw/product-shell/runtime/package.json',
  'packages/openclaw/preset-openclaw/product-shell/runtime/tsdown.config.ts',
  'packages/openclaw/preset-openclaw/product-shell/runtime/tsconfig.json',
])
const BROWSER_BUILD_INPUTS = Object.freeze([
  'packages/openclaw/preset-openclaw/product-shell/browser/src',
  'packages/openclaw/preset-openclaw/product-shell/shared/src',
  'packages/openclaw/preset-openclaw/product-shell/browser/index.html',
  'packages/openclaw/preset-openclaw/product-shell/browser/package.json',
  'packages/openclaw/preset-openclaw/product-shell/browser/vite.config.ts',
  'packages/openclaw/preset-openclaw/product-shell/browser/tsconfig.json',
])

function count(text, needle) {
  return text.split(needle).length - 1
}

function safeRelative(path, label) {
  if (isAbsolute(path) || path.includes('\\') || path.endsWith('/')) {
    throw new TypeError(`${label} must be a normalized relative path`)
  }
  const normalized = posix.normalize(path)
  if (normalized !== path || normalized === '..' || normalized.startsWith('../')) {
    throw new TypeError(`${label} escapes its root`)
  }
  return path
}

function inside(root, path) {
  const relation = relative(root, path)
  return relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation))
}

function ordinarySource(repositoryRoot, sourcePath) {
  const relativePath = safeRelative(sourcePath, 'bundle source')
  const lexical = resolve(repositoryRoot, relativePath)
  if (!inside(repositoryRoot, lexical)) throw new TypeError(`bundle source escapes repository: ${relativePath}`)
  const metadata = lstatSync(lexical)
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new TypeError(`bundle source must be an ordinary file: ${relativePath}`)
  }
  const physical = realpathSync(lexical)
  if (!inside(realpathSync(repositoryRoot), physical)) {
    throw new TypeError(`bundle source resolves outside repository: ${relativePath}`)
  }
  return lexical
}

function sourceFiles(repositoryRoot, sourcePath) {
  const relativePath = safeRelative(sourcePath, 'bundle source tree')
  const root = resolve(repositoryRoot, relativePath)
  const physicalRepository = realpathSync(repositoryRoot)
  const files = []
  const visit = (directory) => {
    const metadata = lstatSync(directory)
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new TypeError(`bundle source tree must contain only ordinary directories: ${relative(repositoryRoot, directory)}`)
    }
    if (!inside(physicalRepository, realpathSync(directory))) {
      throw new TypeError(`bundle source tree resolves outside repository: ${relative(repositoryRoot, directory)}`)
    }
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = join(directory, entry.name)
      const entryMetadata = lstatSync(absolute)
      if (entryMetadata.isSymbolicLink()) {
        throw new TypeError(`bundle source tree contains symbolic link: ${relative(repositoryRoot, absolute)}`)
      }
      if (entryMetadata.isDirectory()) visit(absolute)
      else if (entryMetadata.isFile()) files.push(absolute)
      else throw new TypeError(`bundle source tree contains non-file entry: ${relative(repositoryRoot, absolute)}`)
    }
  }
  visit(root)
  return { root, files }
}

function newestInput(repositoryRoot, inputs) {
  let newest = 0
  for (const input of inputs) {
    const absolute = resolve(repositoryRoot, input)
    const metadata = lstatSync(absolute)
    if (metadata.isSymbolicLink()) throw new TypeError(`build input must not be a symbolic link: ${input}`)
    if (metadata.isFile()) newest = Math.max(newest, metadata.mtimeMs)
    else {
      const tree = sourceFiles(repositoryRoot, input)
      for (const file of tree.files) newest = Math.max(newest, statSync(file).mtimeMs)
    }
  }
  return newest
}

function assertFreshBuild(repositoryRoot) {
  const runtimeEntry = ordinarySource(
    repositoryRoot,
    'packages/openclaw/preset-openclaw/product-shell/runtime/lib/index.mjs',
  )
  const runtimeTypes = ordinarySource(
    repositoryRoot,
    'packages/openclaw/preset-openclaw/product-shell/runtime/lib/index.d.mts',
  )
  const browserIndex = ordinarySource(
    repositoryRoot,
    'packages/openclaw/preset-openclaw/product-shell/runtime/web/index.html',
  )
  const runtimeManifest = JSON.parse(readFileSync(
    ordinarySource(repositoryRoot, 'packages/openclaw/preset-openclaw/product-shell/runtime/package.json'),
    'utf8',
  ))
  if (runtimeManifest.main !== 'lib/index.mjs' || runtimeManifest.types !== 'lib/index.d.mts') {
    throw new TypeError('product runtime build manifest no longer matches the bundle staging contract')
  }
  const runtimeInput = newestInput(repositoryRoot, RUNTIME_BUILD_INPUTS)
  if (statSync(runtimeEntry).mtimeMs < runtimeInput || statSync(runtimeTypes).mtimeMs < runtimeInput) {
    throw new TypeError('product runtime build is stale; build the nested product shell before staging')
  }
  if (statSync(browserIndex).mtimeMs < newestInput(repositoryRoot, BROWSER_BUILD_INPUTS)) {
    throw new TypeError('product browser build is stale; build the nested product shell before staging')
  }
  const web = sourceFiles(repositoryRoot, 'packages/openclaw/preset-openclaw/product-shell/runtime/web').files
  if (!web.some(file => file.endsWith('.js')) || !web.some(file => file.endsWith('.css'))) {
    throw new TypeError('product browser build must contain emitted JavaScript and CSS')
  }
}

function assertReleasePackageVersions(repositoryRoot) {
  for (const [name, directory] of RELEASE_PACKAGE_DIRECTORIES) {
    const manifest = JSON.parse(readFileSync(ordinarySource(repositoryRoot, `${directory}/package.json`), 'utf8'))
    if (manifest.name !== name || manifest.version !== BUNDLE_VERSION) {
      throw new TypeError(`${directory}/package.json must declare ${name}@${BUNDLE_VERSION}`)
    }
    if (manifest.private === true || manifest.publishConfig?.access !== 'public') {
      throw new TypeError(`${name} must be configured for public package staging`)
    }
  }
}

function canonicalAsset(source, destination, role, bytes) {
  return {
    path: destination,
    source,
    role,
    bytes: bytes.byteLength,
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  }
}

function packedManifest(template) {
  const manifest = JSON.parse(template.toString('utf8'))
  const dependencies = manifest.dependencies
  if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
    throw new TypeError('bundle package template dependencies must be an object')
  }
  for (const name of [...FEATURE_PACKAGES, SAFE_PRESET_PACKAGE]) {
    if (dependencies[name] !== `workspace:${BUNDLE_VERSION}`) {
      throw new TypeError(`bundle source dependency ${name} must use workspace:${BUNDLE_VERSION}`)
    }
    dependencies[name] = BUNDLE_VERSION
  }
  if (manifest.scripts?.prepack !== 'node ../release-tools/bundle-prepack-guard.mjs') {
    throw new TypeError('bundle source package must retain its direct-pack guard')
  }
  delete manifest.scripts
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
}

/**
 * Assemble one immutable candidate directory from repository assets and built GUI output.
 * @param options - Repository, new output directory, and optional package template.
 * @returns output directory and its generated asset manifest.
 */
export function stageBundle({ repositoryRoot, outputDirectory, templateManifest = DEFAULT_TEMPLATE }) {
  const repository = realpathSync(resolve(repositoryRoot))
  const output = resolve(outputDirectory)
  if (existsSync(output)) throw new TypeError(`bundle staging output already exists: ${output}`)
  const outputParent = dirname(output)
  if (!existsSync(outputParent) || !lstatSync(outputParent).isDirectory()) {
    throw new TypeError(`bundle staging parent must already exist: ${outputParent}`)
  }
  const template = resolve(templateManifest)
  if (!lstatSync(template).isFile() || lstatSync(template).isSymbolicLink()) {
    throw new TypeError('bundle package template must be an ordinary file')
  }
  assertReleasePackageVersions(repository)
  assertFreshBuild(repository)
  mkdirSync(output)
  const assets = []

  const publish = (source, destination, role, bytes) => {
    const targetPath = safeRelative(destination, 'bundle destination')
    const target = resolve(output, targetPath)
    if (!inside(output, target)) throw new TypeError(`bundle destination escapes output: ${targetPath}`)
    if (existsSync(target)) throw new TypeError(`bundle destination is duplicated: ${targetPath}`)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, bytes)
    assets.push(canonicalAsset(source, targetPath, role, bytes))
  }

  writeFileSync(join(output, 'package.json'), packedManifest(readFileSync(template)))

  const profileSource = 'packages/openclaw/preset-openclaw/profile/cordis.patch.yml'
  const profileBytes = readFileSync(ordinarySource(repository, profileSource))
  const profileText = profileBytes.toString('utf8')
  const developmentCount = count(profileText, DEVELOPMENT_RUNTIME)
  const distributionCount = count(profileText, DISTRIBUTION_RUNTIME)
  if (!((developmentCount === 1 && distributionCount === 0)
    || (developmentCount === 0 && distributionCount === 1))) {
    throw new TypeError('profile patch must mount exactly one recognized ClawDSH product runtime')
  }
  publish(
    profileSource,
    'cordis.patch.yml',
    'profile-patch',
    Buffer.from(developmentCount === 1 ? profileText.replace(DEVELOPMENT_RUNTIME, DISTRIBUTION_RUNTIME) : profileText),
  )

  for (const [source, destination, role] of FILE_ASSETS) {
    publish(source, destination, role, readFileSync(ordinarySource(repository, source)))
  }

  for (const [source, destination, role] of TREE_ASSETS) {
    const tree = sourceFiles(repository, source)
    for (const file of tree.files) {
      const treePath = relative(tree.root, file).split(sep).join('/')
      if (role === 'product-gui' && treePath.endsWith('.map')) continue
      const sourcePath = relative(repository, file).split(sep).join('/')
      publish(sourcePath, posix.join(destination, treePath), role, readFileSync(file))
    }
  }

  assets.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  const assetManifest = {
    schemaVersion: 1,
    packageName: BUNDLE_NAME,
    packageVersion: BUNDLE_VERSION,
    files: assets,
  }
  writeFileSync(join(output, 'assets.json'), `${JSON.stringify(assetManifest, null, 2)}\n`)
  verifyStagedBundle(output)
  return { outputDirectory: output, assetManifest }
}

function argumentsFrom(argv) {
  let repositoryRoot = DEFAULT_REPOSITORY_ROOT
  let outputDirectory
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index]
    const value = argv[index + 1]
    if (value === undefined) throw new TypeError(`${String(option)} requires a value`)
    if (option === '--repo-root') repositoryRoot = value
    else if (option === '--out') outputDirectory = value
    else throw new TypeError(`unknown bundle staging option ${String(option)}`)
  }
  if (outputDirectory === undefined) {
    throw new TypeError('usage: bundle-stage.mjs [--repo-root <repository>] --out <new-directory>')
  }
  return { repositoryRoot, outputDirectory }
}

function cli() {
  const result = stageBundle(argumentsFrom(process.argv.slice(2)))
  process.stdout.write(`${result.outputDirectory}\n`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli()
