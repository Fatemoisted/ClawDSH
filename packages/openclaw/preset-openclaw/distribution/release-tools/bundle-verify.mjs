/** Closed-payload validation for the staged and packed ClawDSH distribution bundle. */

import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** Public npm identity of the assembled profile bundle. */
export const BUNDLE_NAME = '@clawdsh/dsh-bundle'
/** Release-candidate version shared by every ClawDSH publication member. */
export const BUNDLE_VERSION = '0.1.0-rc.1'
/** Required profile layer order consumed by the managed installer. */
export const PROFILE_BUNDLE_ORDER = Object.freeze([
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  BUNDLE_NAME,
])
/** Ten product capability packages carried as exact runtime dependencies. */
export const FEATURE_PACKAGES = Object.freeze([
  '@clawdsh/dsh-soul',
  '@clawdsh/dsh-embeddings',
  '@clawdsh/dsh-embeddings-ark',
  '@clawdsh/dsh-memory',
  '@clawdsh/dsh-skills-hub',
  '@clawdsh/dsh-automation',
  '@clawdsh/dsh-channel',
  '@clawdsh/dsh-channel-agent',
  '@clawdsh/dsh-channel-openclaw',
  '@clawdsh/dsh-activity',
])
/** Restricted messaging preset distributed as its own exact package. */
export const SAFE_PRESET_PACKAGE = '@clawdsh/dsh-preset-messaging-safe'
/** Harness invariant registry mounted with the Channel capability. */
export const INVARIANT_REGISTRY_PACKAGE = '@deepseek-ai/dsh-invariants'

const LEGACY_CHANNEL_PACKAGES = Object.freeze([
  '@clawdsh/dsh-channel-core',
  '@clawdsh/dsh-channel-feishu',
  '@clawdsh/dsh-channel-telegram',
])
const REQUIRED_PATCH_PACKAGES = Object.freeze([
  INVARIANT_REGISTRY_PACKAGE,
  '@clawdsh/dsh-soul/settings-host',
  '@clawdsh/dsh-activity',
  BUNDLE_NAME,
  '@clawdsh/dsh-channel',
  '@clawdsh/dsh-channel/invariant',
  '@clawdsh/dsh-channel-agent',
  '@clawdsh/dsh-channel-agent/invariant',
  '@clawdsh/dsh-channel-openclaw',
  '@clawdsh/dsh-channel-openclaw/invariant',
  '@clawdsh/dsh-memory',
  '@clawdsh/dsh-embeddings-ark',
  '@clawdsh/dsh-skills-hub',
  '@clawdsh/dsh-automation',
])
const REQUIRED_FILES = Object.freeze([
  'LICENSE',
  'assets.json',
  'cordis.patch.yml',
  'lib/index.d.mts',
  'lib/index.mjs',
  'presets/clawdsh/agent.cordis.yml',
  'presets/clawdsh/preset.yml',
  'presets/clawdsh/souls/assistant.md',
  'web/index.html',
  'channel/bridge/stable-v1/index.js',
  'channel/bridge/stable-v1/openclaw.plugin.json',
  'channel/bridge/stable-v1/package.json',
  'channel/locks/channels.production.json',
  'channel/locks/governance.production.json',
  'channel/locks/host.production.json',
  'channel/locks/runtime.production.json',
  'channel/locks/support.production.json',
  'channel/runtime/npm-shrinkwrap.json',
  'channel/runtime/package.json',
  'channel/LICENSE.openclaw',
  'channel/THIRD_PARTY_NOTICES.md',
])
const EXPECTED_PACKAGE_FILES = Object.freeze([
  'LICENSE',
  'assets.json',
  'cordis.patch.yml',
  'lib/index.mjs',
  'lib/index.d.mts',
  'web/**',
  'presets/**',
  'channel/**',
])
const PUBLIC_REGISTRY_HOST = 'registry.npmjs.org'
const REGISTRY_LIKE_HOST = /(?:^|\.)(?:registry|verdaccio|artifactory|npm)(?:\.|$)|^npm\.pkg\./i
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/g

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value
}

function string(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be a non-empty string`)
  return value
}

function json(buffer, label) {
  try {
    return JSON.parse(buffer.toString('utf8'))
  } catch {
    throw new TypeError(`${label} must contain valid JSON`)
  }
}

function equalList(actual, expected, label) {
  if (!Array.isArray(actual)
    || actual.length !== expected.length
    || actual.some((value, index) => value !== expected[index])) {
    throw new TypeError(`${label} must equal ${JSON.stringify(expected)}`)
  }
}

function safePayloadPath(value, label) {
  const path = string(value, label)
  if (isAbsolute(path) || path.includes('\\') || path.startsWith('/') || path.endsWith('/')) {
    throw new TypeError(`${label} must be a normalized relative file path`)
  }
  const normalized = posix.normalize(path)
  if (normalized !== path || normalized === '..' || normalized.startsWith('../')) {
    throw new TypeError(`${label} escapes the package root`)
  }
  return path
}

function integrity(bytes) {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`
}

function occurrence(text, needle) {
  return text.split(needle).length - 1
}

function inspectRegistryUrls(text, label) {
  for (const raw of text.match(URL_PATTERN) ?? []) {
    const token = raw.replace(/[),.;]+$/, '')
    let url
    try {
      url = new URL(token)
    } catch {
      continue
    }
    if (REGISTRY_LIKE_HOST.test(url.hostname) && url.hostname !== PUBLIC_REGISTRY_HOST) {
      throw new TypeError(`${label} contains non-public registry URL ${url.origin}`)
    }
  }
}

/**
 * Reject local dependency protocols and non-public registry configuration in JSON publication data.
 * @param value - JSON-compatible publication metadata.
 * @param label - Diagnostic identity for the supplied value.
 * @returns nothing after successful validation.
 */
export function assertPublicationJson(value, label = 'publication JSON') {
  const visit = (candidate, path) => {
    if (typeof candidate === 'string') {
      if (candidate.startsWith('workspace:') || candidate.startsWith('file:')) {
        throw new TypeError(`${label} contains forbidden dependency specifier at ${path}`)
      }
      inspectRegistryUrls(candidate, `${label}:${path}`)
      return
    }
    if (candidate === null || typeof candidate !== 'object') return
    if (Array.isArray(candidate)) {
      candidate.forEach((entry, index) => visit(entry, `${path}[${String(index)}]`))
      return
    }
    for (const [key, entry] of Object.entries(candidate)) {
      if (key === 'registry' && entry !== `https://${PUBLIC_REGISTRY_HOST}` && entry !== `https://${PUBLIC_REGISTRY_HOST}/`) {
        throw new TypeError(`${label} contains non-public registry configuration at ${path}.${key}`)
      }
      visit(entry, `${path}.${key}`)
    }
  }
  visit(value, '$')
}

function validatePackageManifest(value) {
  const manifest = object(value, 'bundle package.json')
  if (manifest.name !== BUNDLE_NAME || manifest.version !== BUNDLE_VERSION || manifest.license !== 'MIT') {
    throw new TypeError(`bundle package identity must be ${BUNDLE_NAME}@${BUNDLE_VERSION} with MIT license`)
  }
  if (Object.hasOwn(manifest, 'scripts')) throw new TypeError('staged bundle must not carry source build scripts')
  equalList(manifest.files, EXPECTED_PACKAGE_FILES, 'bundle package files')
  const dsh = object(manifest.dsh, 'bundle dsh metadata')
  const dshBundle = object(dsh.bundle, 'bundle dsh.bundle metadata')
  if (dshBundle.patch !== './cordis.patch.yml') throw new TypeError('bundle patch must be ./cordis.patch.yml')
  const clawdsh = object(manifest.clawdsh, 'bundle ClawDSH metadata')
  if (clawdsh.distributionVersion !== 1 || clawdsh.assetManifest !== './assets.json') {
    throw new TypeError('bundle ClawDSH metadata must declare distributionVersion 1 and ./assets.json')
  }
  const profile = object(clawdsh.profile, 'bundle ClawDSH profile metadata')
  if (profile.id !== 'clawdsh') throw new TypeError('bundle profile id must be clawdsh')
  equalList(profile.bundles, PROFILE_BUNDLE_ORDER, 'bundle profile order')
  const bundleVersions = object(profile.bundleVersions, 'bundle profile versions')
  const expectedBundleVersions = {
    '@deepseek-ai/dsh-base': '0.1.0-rc.6',
    '@deepseek-ai/dsh-web-app': '0.1.0-rc.6',
    [BUNDLE_NAME]: BUNDLE_VERSION,
  }
  if (Object.keys(bundleVersions).length !== PROFILE_BUNDLE_ORDER.length) {
    throw new TypeError('bundle profile versions must cover only the three ordered layers')
  }
  for (const name of PROFILE_BUNDLE_ORDER) {
    if (bundleVersions[name] !== expectedBundleVersions[name]) {
      throw new TypeError(`bundle profile version for ${name} is invalid`)
    }
  }
  const preset = object(profile.preset, 'bundle primary preset metadata')
  if (preset.id !== 'clawdsh' || preset.directory !== './presets/clawdsh') {
    throw new TypeError('bundle primary preset metadata is invalid')
  }
  const safePreset = object(profile.safePreset, 'bundle safe preset metadata')
  if (safePreset.id !== 'clawdsh-messaging-safe' || safePreset.package !== SAFE_PRESET_PACKAGE) {
    throw new TypeError('bundle safe preset metadata is invalid')
  }
  const dependencies = object(manifest.dependencies, 'bundle dependencies')
  for (const name of [...FEATURE_PACKAGES, SAFE_PRESET_PACKAGE]) {
    if (dependencies[name] !== BUNDLE_VERSION) {
      throw new TypeError(`bundle dependency ${name} must be exactly ${BUNDLE_VERSION}`)
    }
  }
  if (dependencies[INVARIANT_REGISTRY_PACKAGE] !== '0.1.0-rc.6') {
    throw new TypeError(`bundle dependency ${INVARIANT_REGISTRY_PACKAGE} must be exactly 0.1.0-rc.6`)
  }
  for (const name of LEGACY_CHANNEL_PACKAGES) {
    if (Object.hasOwn(dependencies, name)) throw new TypeError(`legacy dependency ${name} must not ship in the bundle`)
  }
  assertPublicationJson(manifest, 'bundle package.json')
  return manifest
}

function validateAssetManifest(value) {
  const manifest = object(value, 'bundle assets.json')
  if (manifest.schemaVersion !== 1 || manifest.packageName !== BUNDLE_NAME || manifest.packageVersion !== BUNDLE_VERSION) {
    throw new TypeError('bundle assets.json identity is invalid')
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new TypeError('bundle assets.json files must be non-empty')
  }
  let previous = ''
  const paths = new Set()
  for (const candidate of manifest.files) {
    const entry = object(candidate, 'bundle asset entry')
    const path = safePayloadPath(entry.path, 'bundle asset path')
    safePayloadPath(entry.source, `bundle asset ${path} source`)
    string(entry.role, `bundle asset ${path} role`)
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
      throw new TypeError(`bundle asset ${path} bytes must be a non-negative safe integer`)
    }
    if (typeof entry.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity)) {
      throw new TypeError(`bundle asset ${path} integrity must be canonical SHA-512 SRI`)
    }
    if (path <= previous || paths.has(path)) throw new TypeError('bundle asset paths must be sorted and unique')
    previous = path
    paths.add(path)
  }
  assertPublicationJson(manifest, 'bundle assets.json')
  return manifest
}

function validateTextPayload(path, bytes) {
  if (bytes.includes(0)) return
  const text = bytes.toString('utf8')
  inspectRegistryUrls(text, path)
  if (path.endsWith('.json')) assertPublicationJson(json(bytes, path), path)
  if (path.endsWith('.map')) throw new TypeError(`bundle publishes forbidden source map ${path}`)
}

function validateSemantics(manifest, read) {
  const patch = read('cordis.patch.yml').toString('utf8')
  if (patch.includes('@clawdsh/dsh-product-runtime')) {
    throw new TypeError('distribution patch must mount the bundle runtime, not the private build package')
  }
  for (const name of REQUIRED_PATCH_PACKAGES) {
    if (occurrence(patch, `name: '${name}'`) !== 1) throw new TypeError(`distribution patch must mount ${name} exactly once`)
  }

  const preset = read('presets/clawdsh/preset.yml').toString('utf8')
  if (!/^name: ClawDSH 模式$/m.test(preset)) throw new TypeError('primary preset must display ClawDSH 模式')

  const host = object(json(read('channel/locks/host.production.json'), 'production host lock'), 'production host lock')
  object(host.source, 'production host source lock')
  const hostNpm = object(host.npm, 'production host npm lock')
  if (hostNpm.status !== 'verified' || hostNpm.name !== 'openclaw'
    || typeof hostNpm.version !== 'string' || !String(hostNpm.integrity).startsWith('sha512-')) {
    throw new TypeError('production host npm artifact must be verified and integrity-locked')
  }
  const runtime = object(json(read('channel/runtime/package.json'), 'Channel runtime package.json'), 'Channel runtime package.json')
  const runtimeDependencies = object(runtime.dependencies, 'Channel runtime dependencies')
  if (runtimeDependencies.openclaw !== hostNpm.version) {
    throw new TypeError('Channel runtime must pin the production host version')
  }
  const runtimeLock = object(
    json(read('channel/runtime/npm-shrinkwrap.json'), 'Channel runtime shrinkwrap'),
    'Channel runtime shrinkwrap',
  )
  const lockRoot = object(object(runtimeLock.packages, 'Channel runtime shrinkwrap packages')[''], 'Channel runtime lock root')
  const lockDependencies = object(lockRoot.dependencies, 'Channel runtime lock dependencies')
  if (lockDependencies.openclaw !== hostNpm.version) {
    throw new TypeError('Channel runtime shrinkwrap must pin the production host version')
  }
  const bridge = object(json(read('channel/bridge/stable-v1/package.json'), 'stable bridge package.json'), 'stable bridge package.json')
  const bridgePeers = object(bridge.peerDependencies, 'stable bridge peerDependencies')
  if (bridgePeers.openclaw !== hostNpm.version) {
    throw new TypeError('stable bridge must pin the production host version')
  }
  const channel = object(object(manifest.clawdsh, 'bundle ClawDSH metadata').channel, 'bundle Channel metadata')
  const expectedChannelPaths = {
    hostLock: './channel/locks/host.production.json',
    catalog: './channel/locks/channels.production.json',
    support: './channel/locks/support.production.json',
    governance: './channel/locks/governance.production.json',
    runtimeManifest: './channel/runtime/package.json',
    runtimeLock: './channel/runtime/npm-shrinkwrap.json',
    runtimeIdentity: './channel/locks/runtime.production.json',
    bridge: './channel/bridge/stable-v1',
    notices: './channel/THIRD_PARTY_NOTICES.md',
  }
  if (channel.track !== 'production') throw new TypeError('bundle Channel track must be production')
  for (const [key, expected] of Object.entries(expectedChannelPaths)) {
    if (channel[key] !== expected) throw new TypeError(`bundle Channel ${key} must be ${expected}`)
  }
  for (const path of [
    'channel/locks/channels.production.json',
    'channel/locks/support.production.json',
    'channel/locks/governance.production.json',
  ]) {
    const catalog = object(json(read(path), path), path)
    if (catalog.track !== 'production') throw new TypeError(`${path} must describe the production track`)
  }
  const runtimeIdentity = object(
    json(read('channel/locks/runtime.production.json'), 'production runtime identity'),
    'production runtime identity',
  )
  const artifactUrl = typeof hostNpm.resolved === 'string'
    ? hostNpm.resolved
    : `https://registry.npmjs.org/openclaw/-/openclaw-${hostNpm.version}.tgz`
  const hostTree = object(host.tree, 'production host tree lock')
  const runtimeTree = object(runtimeIdentity.tree, 'production runtime host tree lock')
  if (runtimeIdentity.schemaVersion !== 1 || runtimeIdentity.track !== 'production'
    || runtimeIdentity.packageName !== hostNpm.name || runtimeIdentity.packageVersion !== hostNpm.version
    || runtimeIdentity.artifactUrl !== artifactUrl
    || runtimeIdentity.artifactSha512 !== Buffer.from(hostNpm.integrity.slice('sha512-'.length), 'base64').toString('hex')
    || runtimeTree.fileCount !== hostTree.fileCount
    || runtimeTree.sha512 !== Buffer.from(hostTree.integrity.slice('sha512-'.length), 'base64').toString('hex')
    || runtimeIdentity.runtimePackageLockSha512 !== createHash('sha512')
      .update(read('channel/runtime/npm-shrinkwrap.json')).digest('hex')
    || !Array.isArray(runtimeIdentity.runtimeTrees) || runtimeIdentity.runtimeTrees.length === 0) {
    throw new TypeError('production runtime identity must agree with the host and dependency locks')
  }
}

function validateClosedPayload(manifestValue, assetsValue, files, read) {
  const manifest = validatePackageManifest(manifestValue)
  const assets = validateAssetManifest(assetsValue)
  const declared = new Set(['package.json', 'assets.json'])
  for (const entry of assets.files) declared.add(entry.path)
  const actual = [...files].sort()
  const expected = [...declared].sort()
  equalList(actual, expected, 'bundle payload files')
  for (const path of REQUIRED_FILES) {
    if (!declared.has(path)) throw new TypeError(`bundle is missing required asset ${path}`)
  }
  for (const entry of assets.files) {
    const bytes = read(entry.path)
    if (bytes.byteLength !== entry.bytes || integrity(bytes) !== entry.integrity) {
      throw new TypeError(`bundle asset digest mismatch for ${entry.path}`)
    }
    validateTextPayload(entry.path, bytes)
  }
  validateSemantics(manifest, read)
  return { manifest, assets }
}

function walk(root, current = root, output = []) {
  for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = join(current, entry.name)
    const metadata = lstatSync(absolute)
    if (metadata.isSymbolicLink()) throw new TypeError(`bundle staging contains symbolic link ${relative(root, absolute)}`)
    if (metadata.isDirectory()) walk(root, absolute, output)
    else if (metadata.isFile()) output.push(relative(root, absolute).split(sep).join('/'))
    else throw new TypeError(`bundle staging contains non-file entry ${relative(root, absolute)}`)
  }
  return output
}

/**
 * Verify an assembled bundle directory before npm packing.
 * @param directory - Absolute or cwd-relative staged package directory.
 * @returns parsed, validated package and asset manifests.
 */
export function verifyStagedBundle(directory) {
  const root = resolve(directory)
  const files = walk(root)
  return validateClosedPayload(
    json(readFileSync(join(root, 'package.json')), 'bundle package.json'),
    json(readFileSync(join(root, 'assets.json')), 'bundle assets.json'),
    files,
    path => readFileSync(join(root, path)),
  )
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: options.binary === true ? null : 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.status !== 0) {
    const detail = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : result.stderr
    throw new Error(`${command} ${args.join(' ')} failed: ${String(detail).trim()}`)
  }
  return result.stdout
}

function tarMember(tarball, path) {
  const value = capture('tar', ['-xOzf', tarball, `package/${path}`], { binary: true })
  if (!Buffer.isBuffer(value)) throw new TypeError(`tar returned no bytes for ${path}`)
  return value
}

/**
 * Verify a real npm tarball against its embedded closed asset manifest.
 * @param tarballPath - Absolute or cwd-relative npm tarball path.
 * @returns parsed, validated package and asset manifests.
 */
export function verifyPackedBundle(tarballPath) {
  const tarball = resolve(tarballPath)
  const listing = String(capture('tar', ['-tzf', tarball])).split('\n').filter(Boolean)
  const verbose = String(capture('tar', ['-tvzf', tarball])).split('\n').filter(Boolean)
  for (const line of verbose) {
    const kind = line.trimStart()[0]
    if (kind !== '-' && kind !== 'd') throw new TypeError('bundle tarball contains a link or non-ordinary entry')
  }
  const files = []
  for (const member of listing) {
    if (!member.startsWith('package/')) throw new TypeError(`bundle tarball member escapes package/: ${member}`)
    const path = member.slice('package/'.length)
    if (path === '' || path.endsWith('/')) continue
    safePayloadPath(path, 'bundle tarball member')
    files.push(path)
  }
  return validateClosedPayload(
    json(tarMember(tarball, 'package.json'), 'packed bundle package.json'),
    json(tarMember(tarball, 'assets.json'), 'packed bundle assets.json'),
    files,
    path => tarMember(tarball, path),
  )
}

function cli() {
  const [mode, target, ...rest] = process.argv.slice(2)
  if (rest.length > 0 || (mode !== '--dir' && mode !== '--tarball') || target === undefined) {
    throw new TypeError('usage: bundle-verify.mjs (--dir <staged-directory> | --tarball <bundle.tgz>)')
  }
  if (mode === '--dir') verifyStagedBundle(target)
  else verifyPackedBundle(target)
  process.stdout.write(`verified ${resolve(target)}\n`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli()
