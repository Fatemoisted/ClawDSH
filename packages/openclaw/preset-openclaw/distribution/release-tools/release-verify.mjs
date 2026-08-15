/** Verification of the exact 13-package public ClawDSH publication set. */

import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs'
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DSH_VERSION,
  LEGACY_PACKAGE_NAMES,
  RELEASE_PACKAGE_NAMES,
  RELEASE_PACKAGES,
  RELEASE_VERSION,
  isReleasePackage,
  tarballFilename,
} from './release-contract.mjs'
import { readTarball } from './tar-reader.mjs'

const DEPENDENCY_FIELDS = Object.freeze([
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
  'devDependencies',
])
const INSTALL_DEPENDENCY_FIELDS = Object.freeze(['dependencies', 'optionalDependencies', 'peerDependencies'])
const AUTOMATIC_NPM_FILE = /^(?:package\.json|readme(?:[.-].*)?|licen[cs]e(?:[.-].*)?|notice(?:[.-].*)?|changes(?:[.-].*)?|changelog(?:[.-].*)?|history(?:[.-].*)?)$/i
const REGISTRY_HOST = /(?:^|\.)(?:registry|verdaccio|artifactory|npm)(?:\.|$)|^npm\.pkg\./i
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/g

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value
}

function json(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new TypeError(`${label} must contain valid JSON`)
  }
}

function inside(root, path) {
  const relation = relative(root, path)
  return relation === '' || (relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation))
}

function ordinaryFile(path, label) {
  const metadata = lstatSync(path)
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw new TypeError(`${label} must be an ordinary file`)
  return path
}

function packageNameFromPath(name) {
  return name.replace(/^@/, '').replace('/', '-')
}

function privateRegistryUrls(text, label) {
  for (const raw of text.match(URL_PATTERN) ?? []) {
    const token = raw.replace(/[),.;]+$/, '')
    let url
    try {
      url = new URL(token)
    } catch {
      continue
    }
    if (url.username || url.password) {
      throw new TypeError(`${label} contains credentials in a URL`)
    }
    if (REGISTRY_HOST.test(url.hostname)
      && (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' || url.port !== '')) {
      throw new TypeError(`${label} contains private registry URL ${url.origin}`)
    }
  }
}

function scanPublicationValue(value, label, path = '$') {
  if (typeof value === 'string') {
    if (value.startsWith('workspace:') || value.startsWith('file:')) {
      throw new TypeError(`${label} contains forbidden dependency specifier at ${path}`)
    }
    privateRegistryUrls(value, `${label}:${path}`)
    return
  }
  if (value === null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanPublicationValue(entry, label, `${path}[${String(index)}]`))
    return
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'registry' && entry !== 'https://registry.npmjs.org' && entry !== 'https://registry.npmjs.org/') {
      throw new TypeError(`${label} contains non-public registry configuration at ${path}.${key}`)
    }
    scanPublicationValue(entry, label, `${path}.${key}`)
  }
}

function normalizedDeclaration(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\') || isAbsolute(value)) {
    throw new TypeError(`${label} must be a relative publication path`)
  }
  const withoutPrefix = value.replace(/^\.\//, '').replace(/\/$/, '')
  const normalized = posix.normalize(withoutPrefix)
  if (normalized !== withoutPrefix || normalized === '..' || normalized.startsWith('../')) {
    throw new TypeError(`${label} escapes the package root`)
  }
  return normalized
}

function globExpression(pattern) {
  let expression = '^'
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]
    if (character === '*' && pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') {
        expression += '(?:.*/)?'
        index += 2
      } else {
        expression += '.*'
        index += 1
      }
    } else if (character === '*') expression += '[^/]*'
    else if (character === '?') expression += '[^/]'
    else expression += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
  }
  return new RegExp(`${expression}$`)
}

function publicationMatcher(declaration) {
  const path = normalizedDeclaration(declaration, 'package files entry')
  if (!path.includes('*') && !path.includes('?')) {
    return candidate => candidate === path || candidate.startsWith(`${path}/`)
  }
  const expression = globExpression(path)
  return candidate => expression.test(candidate)
}

function exportedTargets(exportsValue, targets = []) {
  if (typeof exportsValue === 'string') {
    if (exportsValue.startsWith('./')) targets.push(exportsValue.slice(2))
    return targets
  }
  if (exportsValue === null || typeof exportsValue !== 'object') return targets
  for (const value of Object.values(exportsValue)) exportedTargets(value, targets)
  return targets
}

function dependencyMap(manifest, fields = DEPENDENCY_FIELDS) {
  const values = new Map()
  for (const field of fields) {
    const dependencies = manifest[field]
    if (dependencies === undefined) continue
    for (const [name, version] of Object.entries(object(dependencies, `package ${field}`))) {
      const previous = values.get(name)
      if (previous !== undefined && previous !== version) {
        throw new TypeError(`${manifest.name} declares conflicting versions for ${name}`)
      }
      values.set(name, version)
    }
  }
  return values
}

function validateInternalDependencies(manifest) {
  const dependencies = dependencyMap(manifest)
  for (const [name, version] of dependencies) {
    if (!name.startsWith('@clawdsh/')) continue
    if (LEGACY_PACKAGE_NAMES.includes(name)) throw new TypeError(`${manifest.name} depends on legacy package ${name}`)
    if (!isReleasePackage(name)) throw new TypeError(`${manifest.name} depends on unpublished package ${name}`)
    if (version !== RELEASE_VERSION) {
      throw new TypeError(`${manifest.name} dependency ${name} must be exactly ${RELEASE_VERSION}`)
    }
  }
  if (manifest.name === '@clawdsh/cli') {
    const runtime = object(manifest.dependencies, 'CLI dependencies')
    if (runtime['@clawdsh/dsh-bundle'] !== RELEASE_VERSION) {
      throw new TypeError(`CLI must depend on @clawdsh/dsh-bundle@${RELEASE_VERSION}`)
    }
    if (runtime['@deepseek-ai/dsh'] !== DSH_VERSION) {
      throw new TypeError(`CLI must depend on @deepseek-ai/dsh@${DSH_VERSION}`)
    }
  }
}

function validateManifest(manifest, expectedName) {
  if (manifest.name !== expectedName || manifest.version !== RELEASE_VERSION) {
    throw new TypeError(`tarball identity must be ${expectedName}@${RELEASE_VERSION}`)
  }
  if (manifest.private === true || manifest.license !== 'MIT') {
    throw new TypeError(`${expectedName} must be a public MIT package`)
  }
  const publishConfig = object(manifest.publishConfig, `${expectedName} publishConfig`)
  if (publishConfig.access !== 'public' || Object.hasOwn(publishConfig, 'registry')) {
    throw new TypeError(`${expectedName} publishConfig must declare only public access, not a registry`)
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new TypeError(`${expectedName} must declare a non-empty files allowlist`)
  }
  if (expectedName === '@clawdsh/dsh-channel-openclaw'
    && (manifest.files.includes('bridge/**') || manifest.files.includes('runtime/**'))) {
    throw new TypeError('@clawdsh/dsh-channel-openclaw files must expose only the production bridge and runtime locks')
  }
  scanPublicationValue(manifest, `${expectedName} package.json`)
  validateInternalDependencies(manifest)
  return manifest
}

function verifyPayload(entries, manifest, expectedName) {
  const payload = new Map()
  for (const entry of entries) {
    if (entry.name === 'package' && entry.type === 'directory') continue
    if (!entry.name.startsWith('package/')) throw new TypeError(`${expectedName} tarball entry is outside package/`)
    const name = entry.name.slice('package/'.length)
    if (name === '') continue
    if (payload.has(name)) throw new TypeError(`${expectedName} repeats payload path ${name}`)
    payload.set(name, entry)
  }
  const packageEntry = payload.get('package.json')
  if (packageEntry?.type !== 'file') throw new TypeError(`${expectedName} tarball has no package.json`)
  const matchers = manifest.files.map(publicationMatcher)
  for (const [name, entry] of payload) {
    if (entry.type !== 'file') continue
    if (expectedName === '@clawdsh/dsh-channel-openclaw'
      && ((name.startsWith('bridge/')
        && !name.startsWith('bridge/stable-v1/')
        && !name.startsWith('bridge/shared/'))
        || (name.startsWith('runtime/')
          && name !== 'runtime/package.json'
          && name !== 'runtime/package-lock.json'))) {
      throw new TypeError(`@clawdsh/dsh-channel-openclaw contains forbidden development payload ${name}`)
    }
    if (!AUTOMATIC_NPM_FILE.test(name) && !matchers.some(matches => matches(name))) {
      throw new TypeError(`${expectedName} contains undeclared file ${name}`)
    }
    privateRegistryUrls(entry.bytes.toString('latin1'), `${expectedName}:${name}`)
    if (!entry.bytes.includes(0)) {
      if (/(?:^|\/)(?:package|package-lock|npm-shrinkwrap)\.json$/.test(name)) {
        scanPublicationValue(json(entry.bytes, `${expectedName}:${name}`), `${expectedName}:${name}`)
      }
    }
  }
  for (const declaration of manifest.files) {
    const matches = publicationMatcher(declaration)
    if (![...payload].some(([name, entry]) => entry.type === 'file' && matches(name))) {
      throw new TypeError(`${expectedName} files declaration ${declaration} matches no packed file`)
    }
  }
  const license = payload.get('LICENSE')
  if (license?.type !== 'file' || !/MIT License/.test(license.bytes.toString('utf8'))) {
    throw new TypeError(`${expectedName} must include its primary MIT LICENSE`)
  }
  if (expectedName === '@clawdsh/dsh-channel-openclaw') {
    for (const name of ['LICENSE.openclaw', 'THIRD_PARTY_NOTICES.md']) {
      if (payload.get(name)?.type !== 'file') {
        throw new TypeError(`@clawdsh/dsh-channel-openclaw must include ${name}`)
      }
    }
  }
  for (const target of [manifest.main, manifest.types, ...exportedTargets(manifest.exports)]) {
    if (typeof target !== 'string') continue
    const normalized = normalizedDeclaration(target, `${expectedName} export target`)
    const matches = publicationMatcher(normalized)
    if (![...payload].some(([name, entry]) => entry.type === 'file' && matches(name))) {
      throw new TypeError(`${expectedName} export target ${target} is absent from the tarball`)
    }
  }
  if (expectedName === '@clawdsh/cli') {
    const bin = typeof manifest.bin === 'string' ? manifest.bin : object(manifest.bin, 'CLI bin').clawdsh
    const normalized = normalizedDeclaration(bin, 'CLI bin')
    const entry = payload.get(normalized)
    if (entry?.type !== 'file' || (entry.mode & 0o111) === 0) {
      throw new TypeError('CLI bin must be a packed executable file')
    }
  }
  return payload
}

/** Verify one real npm tarball and return its parsed publication metadata. */
export function verifyPackageTarball(tarball, expectedName) {
  if (!isReleasePackage(expectedName)) throw new TypeError(`unexpected release package ${expectedName}`)
  ordinaryFile(tarball, `${expectedName} tarball`)
  const entries = readTarball(tarball)
  const packageEntry = entries.find(entry => entry.name === 'package/package.json' && entry.type === 'file')
  if (!packageEntry) throw new TypeError(`${expectedName} tarball has no package.json`)
  const manifest = validateManifest(json(packageEntry.bytes, `${expectedName} package.json`), expectedName)
  const payload = verifyPayload(entries, manifest, expectedName)
  return Object.freeze({ manifest, payload })
}

function visitManifests(root, directory, results) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'lib') continue
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new TypeError(`package discovery found symbolic link ${relative(root, path)}`)
    if (entry.isDirectory()) visitManifests(root, path, results)
    else if (entry.isFile() && entry.name === 'package.json') results.push(path)
  }
}

/** Reject missing, duplicate, misplaced, or additional public @clawdsh packages. */
export function verifySourcePackageSet(repositoryRoot) {
  const repository = realpathSync(resolve(repositoryRoot))
  const openclaw = resolve(repository, 'packages/openclaw')
  if (!inside(repository, openclaw)) throw new TypeError('OpenClaw package root escapes the repository')
  const manifests = []
  visitManifests(repository, openclaw, manifests)
  const discovered = new Map()
  for (const path of manifests) {
    const manifest = json(readFileSync(path), relative(repository, path))
    if (typeof manifest.name !== 'string' || !manifest.name.startsWith('@clawdsh/') || manifest.private === true) continue
    if (discovered.has(manifest.name)) throw new TypeError(`duplicate public package ${manifest.name}`)
    discovered.set(manifest.name, relative(repository, dirname(path)).split(sep).join('/'))
  }
  const expected = new Map(RELEASE_PACKAGES.map(entry => [entry.name, entry.directory]))
  for (const name of RELEASE_PACKAGE_NAMES) {
    if (!discovered.has(name)) throw new TypeError(`missing public package ${name}`)
    if (discovered.get(name) !== expected.get(name)) {
      throw new TypeError(`public package ${name} is at ${discovered.get(name)}, expected ${expected.get(name)}`)
    }
  }
  for (const name of discovered.keys()) {
    if (!expected.has(name)) throw new TypeError(`unexpected public package ${name}`)
  }
  return discovered
}

function validateTopology(manifests) {
  const positions = new Map(RELEASE_PACKAGE_NAMES.map((name, index) => [name, index]))
  for (const manifest of manifests.values()) {
    const dependencies = dependencyMap(manifest, INSTALL_DEPENDENCY_FIELDS)
    for (const name of dependencies.keys()) {
      if (!isReleasePackage(name)) continue
      if (positions.get(name) >= positions.get(manifest.name)) {
        throw new TypeError(`release order places ${manifest.name} before dependency ${name}`)
      }
    }
  }
}

/** Verify an output directory contains exactly one valid tarball for every public package. */
export function verifyReleaseDirectory(directory) {
  const root = realpathSync(resolve(directory))
  const archiveNames = readdirSync(root).filter(name => name.endsWith('.tgz')).sort()
  const expectedArchiveNames = RELEASE_PACKAGE_NAMES.map(name => tarballFilename(name)).sort()
  if (archiveNames.length !== expectedArchiveNames.length
    || archiveNames.some((name, index) => name !== expectedArchiveNames[index])) {
    throw new TypeError('release directory must contain exactly the 13 canonical tarballs')
  }
  const manifests = new Map()
  const packages = []
  for (const name of RELEASE_PACKAGE_NAMES) {
    const filename = tarballFilename(name)
    const path = ordinaryFile(join(root, filename), `${name} tarball`)
    const verified = verifyPackageTarball(path, name)
    if (manifests.has(verified.manifest.name)) throw new TypeError(`duplicate tarball package ${verified.manifest.name}`)
    manifests.set(name, verified.manifest)
    const bytes = readFileSync(path)
    packages.push(Object.freeze({
      name,
      version: RELEASE_VERSION,
      filename,
      integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
      bytes: bytes.byteLength,
    }))
  }
  validateTopology(manifests)
  return Object.freeze({ version: 1, releaseVersion: RELEASE_VERSION, packages: Object.freeze(packages) })
}

/** Write-compatible canonical JSON for release-index.json. */
export function canonicalReleaseIndex(index) {
  return `${JSON.stringify(index, null, 2)}\n`
}

/** Verify the checked release index agrees byte-for-byte with the tarballs. */
export function verifyReleaseIndex(directory) {
  const generated = verifyReleaseDirectory(directory)
  const path = join(directory, 'release-index.json')
  if (!existsSync(path)) throw new TypeError('release-index.json is missing')
  const checked = readFileSync(ordinaryFile(path, 'release index'), 'utf8')
  if (checked !== canonicalReleaseIndex(generated)) throw new TypeError('release-index.json does not match the tarballs')
  return generated
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const directory = process.argv[2]
  if (!directory) throw new TypeError('usage: release-verify.mjs <release-directory>')
  const result = verifyReleaseIndex(directory)
  process.stdout.write(`verified ${String(result.packages.length)} ClawDSH tarballs\n`)
}
