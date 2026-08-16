/** Explicit acquisition, assembly, and verification of the locked production Gateway. */

import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { inspectNpmTarball } from './archive.mjs'
import { BUNDLE_VERSION, MARKER_FILENAME } from './constants.mjs'
import {
  bytesIntegrity,
  fileIntegrity,
  jsonIntegrity,
  ordinaryTreeDigest,
  privateDirectory,
  readJson,
  requireKind,
  writeJsonAtomic,
} from './files.mjs'
import { beginTransaction, commitTransaction, recoverTransactions } from './transaction.mjs'
import { readMarker } from './installer.mjs'

/** Parsed Channel manifests are narrowed by the owning validator before fields affect I/O. @typedef {Record<string, any>} ChannelJson */
/** @typedef {{value: ChannelJson, npm: ChannelJson, tree: ChannelJson, runtime: ChannelJson, artifactUrl: string}} ProductionLock */
/** @typedef {{home: string, channelRoot: string, acquire?: (url: string, destination: string) => Promise<void>, runtimeRunner?: (cwd: string) => void, now?: () => Date, out?: (message: string) => void, bridgeRoot?: string}} ChannelManagerOptions */

/** @param {unknown} value @param {string} label @returns {ChannelJson} */
function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`)
  return value
}

/** @returns {NodeJS.ProcessEnv} */
function scrubbedEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => {
    const upper = name.toUpperCase()
    return !upper.includes('KEY') && !upper.includes('SECRET') && !upper.includes('TOKEN')
      && !upper.includes('PASSWORD') && upper !== 'NODE_OPTIONS' && upper !== 'NODE_PATH'
  }))
}

/** Assemble the checked runtime with lifecycle scripts disabled. */
/** @param {string} cwd @returns {void} */
export function defaultRuntimeRunner(cwd) {
  const invocation = checkedRuntimeNpmInvocation()
  const outcome = spawnSync(invocation.command, invocation.args, {
    cwd,
    env: scrubbedEnvironment(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (outcome.status !== 0 || outcome.signal !== null) {
    throw new Error(`locked OpenClaw runtime assembly failed (exit ${String(outcome.status)}, signal ${String(outcome.signal)})`)
  }
}

/** Resolve the npm executable and arguments that reproduce the checked runtime tree. @returns {{command: string, args: string[]}} */
export function checkedRuntimeNpmInvocation() {
  return {
    command: 'npx',
    args: [
      '--yes', 'npm@10.9.7', 'ci', '--ignore-scripts', '--no-audit', '--no-fund',
      '--registry=https://registry.npmjs.org/',
    ],
  }
}

/** Download one immutable artifact without reflecting response bodies or headers. */
/** @param {string} url @param {string} destination @returns {Promise<void>} */
export async function defaultAcquire(url, destination) {
  const response = await fetch(url, { redirect: 'error', credentials: 'omit' })
  if (!response.ok || response.body === null) throw new Error(`locked OpenClaw artifact download failed with HTTP ${response.status}`)
  const body = /** @type {import('node:stream/web').ReadableStream<Uint8Array>} */ (response.body)
  await pipeline(Readable.fromWeb(body), createWriteStream(destination, { flags: 'wx', mode: 0o600 }))
}

/** @param {unknown} integrity @returns {string} */
function sha512HexFromSri(integrity) {
  if (typeof integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity)) {
    throw new TypeError('production OpenClaw artifact integrity is not canonical SHA-512 SRI')
  }
  return Buffer.from(integrity.slice('sha512-'.length), 'base64').toString('hex')
}

/** @param {string} path @returns {Promise<string>} */
async function sha512Hex(path) {
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

/** @param {string} channelRoot @returns {ProductionLock} */
function productionLock(channelRoot) {
  const value = object(readJson(join(channelRoot, 'locks', 'host.production.json'), 'production OpenClaw lock'), 'production OpenClaw lock')
  if (value.schemaVersion !== 1 || value.track !== 'production') throw new TypeError('OpenClaw host lock is not the production schema')
  const npm = object(value.npm, 'production OpenClaw npm lock')
  const tree = object(value.tree, 'production OpenClaw tree lock')
  if (npm.status !== 'verified' || npm.name !== 'openclaw' || typeof npm.version !== 'string'
    || !Number.isSafeInteger(tree.fileCount) || tree.fileCount <= 0 || typeof tree.integrity !== 'string') {
    throw new TypeError('production OpenClaw lock is incomplete')
  }
  sha512HexFromSri(npm.integrity)
  const artifactUrl = typeof npm.resolved === 'string'
    ? npm.resolved
    : `https://registry.npmjs.org/openclaw/-/openclaw-${npm.version}.tgz`
  const runtime = object(
    readJson(join(channelRoot, 'locks', 'runtime.production.json'), 'production OpenClaw runtime identity'),
    'production OpenClaw runtime identity',
  )
  const runtimeTree = object(runtime.tree, 'production OpenClaw runtime host tree')
  if (runtime.schemaVersion !== 1 || runtime.track !== 'production' || runtime.packageName !== npm.name
    || runtime.packageVersion !== npm.version || runtime.artifactUrl !== artifactUrl
    || runtime.artifactSha512 !== sha512HexFromSri(npm.integrity)
    || runtimeTree.fileCount !== tree.fileCount
    || runtimeTree.sha512 !== Buffer.from(tree.integrity.slice('sha512-'.length), 'base64').toString('hex')
    || typeof runtime.nodeEngine !== 'string' || !/^[a-f0-9]{128}$/.test(runtime.runtimePackageLockSha512)
    || !Array.isArray(runtime.runtimeTrees) || runtime.runtimeTrees.length === 0) {
    throw new TypeError('production OpenClaw runtime identity disagrees with the host lock')
  }
  return { value, npm, tree, runtime, artifactUrl }
}

/** @param {ChannelJson} expected @param {ChannelJson} actual @param {string} path */
function compareLockIdentity(expected, actual, path) {
  for (const key of ['version', 'resolved', 'integrity', 'link']) {
    if (expected[key] !== actual[key]) throw new Error(`installed runtime lock differs at ${path}`)
  }
  for (const key of ['os', 'cpu']) {
    const expectedValues = expected[key]
    const actualValues = actual[key]
    const equal = expectedValues === undefined && actualValues === undefined
      || Array.isArray(expectedValues) && Array.isArray(actualValues)
        && expectedValues.length === actualValues.length
        && expectedValues.every((value, index) => typeof value === 'string' && value === actualValues[index])
    if (!equal) throw new Error(`installed runtime lock differs at ${path}`)
  }
}

/** @param {string} root @param {string} candidate @returns {boolean} */
function inside(root, candidate) {
  const path = relative(root, candidate)
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}

/** @param {string} path @returns {string} */
function fileSha512Hex(path) {
  return createHash('sha512').update(readFileSync(path)).digest('hex')
}

/** @param {string} root @returns {{fileCount: number, sha512: string, integrity: string}} */
function packageTreeDigest(root) {
  const canonicalRoot = realpathSync(root)
  /** @type {string[]} */
  const files = []
  /** @param {string} directory */
  const visit = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      if (directory === canonicalRoot && name === 'node_modules') continue
      const path = join(directory, name)
      const metadata = lstatSync(path)
      if (metadata.isSymbolicLink()) throw new Error(`OpenClaw package tree contains symbolic link ${relative(canonicalRoot, path)}`)
      if (metadata.isDirectory()) visit(path)
      else if (metadata.isFile()) files.push(path)
      else throw new Error(`OpenClaw package tree contains special file ${relative(canonicalRoot, path)}`)
    }
  }
  visit(canonicalRoot)
  files.sort()
  const hash = createHash('sha512')
  for (const path of files) {
    const logical = relative(canonicalRoot, path).split(sep).join('/')
    const bytes = readFileSync(path)
    hash.update(logical)
    hash.update('\0')
    hash.update(String(bytes.byteLength))
    hash.update('\0')
    hash.update(createHash('sha512').update(bytes).digest())
  }
  const sha512 = hash.digest('hex')
  return {
    fileCount: files.length,
    sha512,
    integrity: `sha512-${Buffer.from(sha512, 'hex').toString('base64')}`,
  }
}

/** Hash the complete npm runtime with the Provider's file/link algorithm. */
/** @param {string} root @returns {{fileCount: number, sha512: string, integrity: string}} */
export function installedRuntimeTreeDigest(root) {
  const canonicalRoot = realpathSync(root)
  /** @type {Array<{kind: 'file' | 'link', logicalPath: string, targetPath?: string, size: number, sha512: string}>} */
  const entries = []
  /** @param {string} directory */
  const visit = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name)
      const logicalPath = relative(canonicalRoot, path).split(sep).join('/')
      const metadata = lstatSync(path)
      if (metadata.isSymbolicLink()) {
        const target = resolve(dirname(path), readlinkSync(path))
        if (!inside(canonicalRoot, target)) throw new Error(`OpenClaw runtime link escapes at ${logicalPath}`)
        const targetMetadata = lstatSync(target)
        if (!targetMetadata.isFile()) throw new Error(`OpenClaw runtime link does not target a file at ${logicalPath}`)
        entries.push({
          kind: 'link',
          logicalPath,
          targetPath: relative(canonicalRoot, realpathSync(target)).split(sep).join('/'),
          size: targetMetadata.size,
          sha512: fileSha512Hex(target),
        })
      } else if (metadata.isDirectory()) visit(path)
      else if (metadata.isFile()) entries.push({
        kind: 'file', logicalPath, size: metadata.size, sha512: fileSha512Hex(path),
      })
      else throw new Error(`OpenClaw runtime contains special entry ${logicalPath}`)
    }
  }
  visit(canonicalRoot)
  entries.sort((left, right) => left.logicalPath.localeCompare(right.logicalPath))
  const hash = createHash('sha512')
  let fileCount = 0
  for (const entry of entries) {
    hash.update(entry.kind)
    hash.update('\0')
    hash.update(entry.logicalPath)
    hash.update('\0')
    if (entry.kind === 'file') fileCount += 1
    else {
      if (entry.targetPath === undefined) throw new Error('OpenClaw runtime link target is missing')
      hash.update(entry.targetPath)
      hash.update('\0')
    }
    hash.update(String(entry.size))
    hash.update('\0')
    hash.update(Buffer.from(entry.sha512, 'hex'))
  }
  const sha512 = hash.digest('hex')
  return {
    fileCount,
    sha512,
    integrity: `sha512-${Buffer.from(sha512, 'hex').toString('base64')}`,
  }
}

/** @param {string} runtimeRoot @returns {Set<string>} */
function runtimePackagePaths(runtimeRoot) {
  /** @type {Set<string>} */
  const found = new Set()
  /** @param {string} modules */
  const visitModules = (modules) => {
    requireKind(modules, 'directory')
    for (const name of readdirSync(modules).sort()) {
      if (name === '.bin' || name === '.package-lock.json') continue
      const path = join(modules, name)
      const metadata = lstatSync(path)
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error(`runtime node_modules has unsafe entry ${path}`)
      if (name.startsWith('@')) {
        for (const child of readdirSync(path).sort()) addPackage(join(path, child))
      } else addPackage(path)
    }
  }
  /** @param {string} path */
  const addPackage = (path) => {
    requireKind(path, 'directory')
    const logical = relative(runtimeRoot, path).split(sep).join('/')
    found.add(logical)
    const nested = join(path, 'node_modules')
    if (existsSync(nested)) visitModules(nested)
  }
  visitModules(join(runtimeRoot, 'node_modules'))
  return found
}

/** @param {string} runtimeRoot @param {Buffer} expectedLockBytes @param {ProductionLock} lock */
function verifyRuntimeLocks(runtimeRoot, expectedLockBytes, lock) {
  const expectedLockSha512 = createHash('sha512').update(expectedLockBytes).digest('hex')
  if (expectedLockSha512 !== lock.runtime.runtimePackageLockSha512) {
    throw new Error('checked runtime lock digest differs from the production identity')
  }
  const visible = readFileSync(join(runtimeRoot, 'package-lock.json'))
  if (!visible.equals(expectedLockBytes)) throw new Error('deployed runtime lock differs from the checked bundle lock')
  const expected = object(JSON.parse(expectedLockBytes.toString('utf8')), 'checked runtime lock')
  const installed = object(readJson(join(runtimeRoot, 'node_modules', '.package-lock.json'), 'installed runtime lock'), 'installed runtime lock')
  if (expected.lockfileVersion !== 3 || installed.lockfileVersion !== 3) throw new Error('runtime locks must use lockfileVersion 3')
  const expectedPackages = object(expected.packages, 'checked runtime packages')
  const installedPackages = object(installed.packages, 'installed runtime packages')
  const discovered = runtimePackagePaths(runtimeRoot)
  for (const [path, candidate] of Object.entries(installedPackages)) {
    if (!path.startsWith('node_modules/') || path.includes('/../') || path.endsWith('/..')) {
      throw new Error(`installed runtime lock has unsafe package path ${path}`)
    }
    const actual = object(candidate, `installed runtime package ${path}`)
    const locked = object(expectedPackages[path], `checked runtime package ${path}`)
    compareLockIdentity(locked, actual, path)
    if (!discovered.delete(path)) throw new Error(`installed runtime package is absent: ${path}`)
    const manifest = readJson(join(runtimeRoot, path, 'package.json'), `installed runtime package ${path}`)
    if (manifest.version !== actual.version || typeof manifest.name !== 'string') {
      throw new Error(`installed runtime package metadata differs at ${path}`)
    }
  }
  if (discovered.size > 0) throw new Error(`runtime has an untracked package directory: ${[...discovered].sort()[0]}`)
  for (const [path, candidate] of Object.entries(expectedPackages)) {
    if (path === '') continue
    const locked = object(candidate, `checked runtime package ${path}`)
    if (locked.optional !== true && !Object.hasOwn(installedPackages, path)) {
      throw new Error(`required runtime package is missing: ${path}`)
    }
  }
  const availableTrees = /** @type {ChannelJson[]} */ (lock.runtime.runtimeTrees)
  const runtimeTrees = availableTrees.filter(candidate => candidate?.platform === process.platform
    && candidate?.architecture === process.arch)
  if (runtimeTrees.length !== 1) {
    throw new Error(`no unique locked OpenClaw runtime tree for ${process.platform}/${process.arch}`)
  }
  const runtimeTree = object(runtimeTrees[0], 'locked OpenClaw runtime tree')
  if (!Number.isSafeInteger(runtimeTree.fileCount) || runtimeTree.fileCount <= 0
    || !/^[a-f0-9]{128}$/.test(runtimeTree.sha512)) {
    throw new Error(`locked OpenClaw runtime tree for ${process.platform}/${process.arch} is invalid`)
  }
  const installedTree = installedRuntimeTreeDigest(runtimeRoot)
  if (installedTree.fileCount !== runtimeTree.fileCount || installedTree.sha512 !== runtimeTree.sha512) {
    throw new Error(`OpenClaw runtime tree differs from the ${process.platform}/${process.arch} lock`)
  }
  return installedTree
}

/** @param {string} runtimeRoot @param {ProductionLock} lock @returns {{hostRoot: string, hostTreeIntegrity: string}} */
function verifyHost(runtimeRoot, lock) {
  const hostRoot = join(runtimeRoot, 'node_modules', 'openclaw')
  const manifest = readJson(join(hostRoot, 'package.json'), 'installed OpenClaw package')
  if (manifest.name !== 'openclaw' || manifest.version !== lock.npm.version
    || manifest.engines?.node !== lock.runtime.nodeEngine) {
    throw new Error('installed OpenClaw name, version, or Node engine differs from the production lock')
  }
  const digest = packageTreeDigest(hostRoot)
  if (digest.fileCount !== lock.tree.fileCount || digest.integrity !== lock.tree.integrity
    || digest.fileCount !== lock.runtime.tree.fileCount || digest.sha512 !== lock.runtime.tree.sha512) {
    throw new Error('installed OpenClaw ordinary-file tree differs from the production lock')
  }
  return { hostRoot, hostTreeIntegrity: digest.integrity }
}

/** @param {string} runtimeRoot @param {string} hostTreeIntegrity @param {string} runtimeTreeIntegrity @returns {string} */
function runtimeIntegrity(runtimeRoot, hostTreeIntegrity, runtimeTreeIntegrity) {
  return jsonIntegrity({
    package: bytesIntegrity(readFileSync(join(runtimeRoot, 'package.json'))),
    lock: bytesIntegrity(readFileSync(join(runtimeRoot, 'package-lock.json'))),
    installedLock: bytesIntegrity(readFileSync(join(runtimeRoot, 'node_modules', '.package-lock.json'))),
    hostTreeIntegrity,
    runtimeTreeIntegrity,
  })
}

/** @param {string} home @returns {NodeJS.Require} */
function managedProfileRequire(home) {
  return createRequire(join(home, 'profiles', 'clawdsh', 'package.json'))
}

/** Refuse Channel management under a Node runtime the locked Gateway cannot execute. */
/** @param {string} home @param {string} engine @returns {void} */
function verifyCurrentNodeEngine(home, engine) {
  const profileRequire = managedProfileRequire(home)
  const providerManifest = profileRequire.resolve('@clawdsh/dsh-channel-openclaw/package.json')
  const providerRequire = createRequire(providerManifest)
  const semver = object(providerRequire('semver'), 'installed semver implementation')
  if (typeof semver.valid !== 'function' || typeof semver.satisfies !== 'function') {
    throw new TypeError('installed semver implementation is incomplete')
  }
  const version = semver.valid(process.version)
  if (version === null || semver.satisfies(version, engine) !== true) {
    throw new Error(`Node ${process.version} does not satisfy the locked OpenClaw engine ${engine}`)
  }
}

/** @param {string} home @param {string} channelRoot @returns {{root: string, integrity: string}} */
function resolveBridge(home, channelRoot) {
  const require = managedProfileRequire(home)
  const packageManifest = require.resolve('@clawdsh/dsh-channel-openclaw/package.json')
  const packageBridge = join(dirname(packageManifest), 'bridge')
  const bundledBridge = join(channelRoot, 'bridge')
  const packageStable = ordinaryTreeDigest(join(packageBridge, 'stable-v1'))
  const packageShared = ordinaryTreeDigest(join(packageBridge, 'shared'))
  const bundledStable = ordinaryTreeDigest(join(bundledBridge, 'stable-v1'))
  const bundledShared = ordinaryTreeDigest(join(bundledBridge, 'shared'))
  if (packageStable.fileCount !== bundledStable.fileCount || packageStable.integrity !== bundledStable.integrity
    || packageShared.fileCount !== bundledShared.fileCount || packageShared.integrity !== bundledShared.integrity) {
    throw new Error('installed OpenClaw bridge differs from the bundle-owned locked bridge')
  }
  const root = join(packageBridge, 'stable-v1')
  requireKind(root, 'directory')
  return {
    root: resolve(root),
    integrity: jsonIntegrity({ stable: packageStable, shared: packageShared }),
  }
}

/** Validate the complete fail-closed policy with the exact installed Provider implementation. */
/** @param {string} home @param {string} configPath @param {string} bridgeRoot @param {string} stateDir */
async function verifyManagedConfig(home, configPath, bridgeRoot, stateDir) {
  const require = managedProfileRequire(home)
  const providerEntry = require.resolve('@clawdsh/dsh-channel-openclaw')
  const provider = object(await import(pathToFileURL(providerEntry).href), 'installed Channel Provider module')
  if (typeof provider.verifyFailClosedConfig !== 'function') {
    throw new TypeError('installed Channel Provider does not expose fail-closed config verification')
  }
  await provider.verifyFailClosedConfig(configPath, bridgeRoot, stateDir, [])
}

/**
 * Upgrade only fields emitted by the previous managed-config template.
 * Every other JSON value, including platform credentials and Channel policy,
 * remains untouched and the strict Provider verifier still owns acceptance.
 * @param {unknown} value
 * @returns {ChannelJson | undefined}
 */
function upgradeLegacyManagedConfig(value) {
  const config = object(value, 'managed OpenClaw config')
  let upgraded = config
  let changed = false
  const models = config.models
  if (models !== null && typeof models === 'object' && !Array.isArray(models)) {
    const providers = models.providers
    if (providers !== null && typeof providers === 'object' && !Array.isArray(providers)) {
      const clawdsh = providers.clawdsh
      if (clawdsh !== null && typeof clawdsh === 'object' && !Array.isArray(clawdsh)
        && Array.isArray(clawdsh.models) && clawdsh.models.length === 1) {
        const model = clawdsh.models[0]
        if (model !== null && typeof model === 'object' && !Array.isArray(model)
          && Array.isArray(model.input) && model.input.length === 2
          && model.input[0] === 'text' && model.input[1] === 'image') {
          upgraded = {
            ...upgraded,
            models: {
              ...models,
              providers: {
                ...providers,
                clawdsh: { ...clawdsh, models: [{ ...model, input: ['text'] }] },
              },
            },
          }
          changed = true
        }
      }
    }
  }
  if (!Object.hasOwn(upgraded, 'session')) {
    upgraded = { ...upgraded, session: { dmScope: 'per-account-channel-peer' } }
    changed = true
  } else {
    const session = upgraded.session
    if (session !== null && typeof session === 'object' && !Array.isArray(session)
      && !Object.hasOwn(session, 'dmScope')) {
      upgraded = { ...upgraded, session: { ...session, dmScope: 'per-account-channel-peer' } }
      changed = true
    }
  }
  return changed ? upgraded : undefined
}

/** Verify an upgraded config inside its managed state tree, then move it into the transaction candidate. */
/** @param {string} home @param {string} stateDir @param {string} bridgeRoot @param {string} candidatePath @returns {Promise<boolean>} */
async function stageManagedConfigUpgrade(home, stateDir, bridgeRoot, candidatePath) {
  const configPath = join(stateDir, 'openclaw.json')
  const upgraded = upgradeLegacyManagedConfig(readJson(configPath, 'managed OpenClaw config'))
  if (upgraded === undefined) return false
  const verificationPath = join(
    stateDir,
    `.openclaw-upgrade-${String(process.pid)}-${randomBytes(8).toString('hex')}.json`,
  )
  try {
    writeJsonAtomic(verificationPath, upgraded)
    await verifyManagedConfig(home, verificationPath, bridgeRoot, stateDir)
    renameSync(verificationPath, candidatePath)
    return true
  } finally {
    if (existsSync(verificationPath)) unlinkSync(verificationPath)
  }
}

/** @param {string} stateDir @param {string} bridgeRoot @param {number} [gatewayPort] @returns {ChannelJson} */
function failClosedConfig(stateDir, bridgeRoot, gatewayPort = 18789) {
  return {
    models: {
      mode: 'replace',
      providers: {
        clawdsh: {
          baseUrl: 'http://127.0.0.1:9/v1',
          apiKey: 'clawdsh-local',
          auth: 'token',
          api: 'openai-responses',
          agentRuntime: { id: 'clawdsh' },
          models: [{
            id: 'local',
            name: 'ClawDSH local agent',
            api: 'openai-responses',
            reasoning: true,
            input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 200_000,
            maxTokens: 32_768,
            agentRuntime: { id: 'clawdsh' },
          }],
        },
      },
    },
    agents: {
      defaults: {
        workspace: join(stateDir, 'workspace'),
        model: { primary: 'clawdsh/local', fallbacks: [] },
        models: { 'clawdsh/local': { agentRuntime: { id: 'clawdsh' } } },
        elevatedDefault: 'off',
      },
      list: [],
    },
    plugins: {
      load: { paths: [bridgeRoot] },
      allow: ['clawdsh-bridge'],
      installs: {},
      entries: { 'clawdsh-bridge': { enabled: true } },
    },
    gateway: { mode: 'local', bind: 'loopback', port: gatewayPort, auth: { mode: 'none' } },
    session: { dmScope: 'per-account-channel-peer' },
    commands: {
      bash: false,
      config: false,
      mcp: false,
      plugins: false,
      debug: false,
      restart: false,
      nativeSkills: false,
      text: true,
      useAccessGroups: true,
    },
    tools: { elevated: { enabled: false } },
    channels: {},
  }
}

/** @param {string} home @returns {{root: string, artifact: string, runtime: string, state: string, config: string, staging: string}} */
function channelPaths(home) {
  const root = join(home, 'clawdsh', 'channel', 'openclaw')
  return {
    root,
    artifact: join(root, 'artifacts', 'openclaw.tgz'),
    runtime: join(root, 'runtime'),
    state: join(root, 'state'),
    config: join(root, 'state', 'openclaw.json'),
    staging: join(root, 'state', 'staging'),
  }
}

/** @param {ChannelJson} channel @returns {boolean} */
function isManagedChannelRecord(channel) {
  return channel.status === 'installed' && channel.track === 'production'
    && typeof channel.hostVersion === 'string'
    && typeof channel.artifactIntegrity === 'string' && /^sha512-[A-Za-z0-9+/]{86}==$/.test(channel.artifactIntegrity)
    && typeof channel.runtimeIntegrity === 'string' && /^sha512-[A-Za-z0-9+/]{86}==$/.test(channel.runtimeIntegrity)
    && typeof channel.bridgeIntegrity === 'string' && /^sha512-[A-Za-z0-9+/]{86}==$/.test(channel.bridgeIntegrity)
    && typeof channel.installedAt === 'string' && Number.isFinite(Date.parse(channel.installedAt))
}

/** @param {string} home @param {string} channelRoot */
async function diagnoseChannel(home, channelRoot) {
  const marker = readMarker(home)
  if (marker === undefined) throw new Error('ClawDSH is not initialized')
  if (marker.channel.status !== 'installed') return { ok: false, reason: 'not-installed', marker }
  const paths = channelPaths(home)
  const lock = productionLock(channelRoot)
  verifyCurrentNodeEngine(home, lock.runtime.nodeEngine)
  const artifactIntegrity = await fileIntegrity(paths.artifact)
  if (artifactIntegrity !== marker.channel.artifactIntegrity || artifactIntegrity !== lock.npm.integrity) {
    throw new Error('managed OpenClaw artifact digest differs')
  }
  await inspectNpmTarball(paths.artifact)
  const expectedLockBytes = readFileSync(join(channelRoot, 'runtime', 'npm-shrinkwrap.json'))
  const runtimeTree = verifyRuntimeLocks(paths.runtime, expectedLockBytes, lock)
  const host = verifyHost(paths.runtime, lock)
  const assembled = runtimeIntegrity(paths.runtime, host.hostTreeIntegrity, runtimeTree.integrity)
  if (assembled !== marker.channel.runtimeIntegrity) throw new Error('managed OpenClaw runtime digest differs')
  requireKind(paths.state, 'directory')
  requireKind(paths.staging, 'directory')
  requireKind(paths.config, 'file')
  const bridge = resolveBridge(home, channelRoot)
  if (bridge.integrity !== marker.channel.bridgeIntegrity) throw new Error('managed OpenClaw bridge digest differs')
  await verifyManagedConfig(home, paths.config, bridge.root, paths.state)
  return { ok: true, reason: 'healthy', marker, paths }
}

/** Create an explicit Channel installer with injectable network and process seams. */
/** @param {ChannelManagerOptions} options */
export function createChannelManager(options) {
  const home = resolve(options.home)
  const channelRoot = resolve(options.channelRoot)
  const acquire = options.acquire ?? defaultAcquire
  const runtimeRunner = options.runtimeRunner ?? defaultRuntimeRunner
  const now = options.now ?? (() => new Date())
  const out = options.out ?? (() => {})

  return {
    /** Download, validate, assemble, and atomically publish production Channel assets. */
    async install() {
      recoverTransactions(home)
      const marker = readMarker(home)
      if (marker === undefined) throw new Error('run clawdsh init before channel install')
      const managed = marker.channel.status === 'installed'
      if (managed && !isManagedChannelRecord(marker.channel)) {
        throw new Error('ClawDSH Channel marker is invalid and cannot authorize replacement')
      }
      if (managed) {
        let healthy = false
        try {
          healthy = (await diagnoseChannel(home, channelRoot)).ok
        } catch (error) {
          // A diagnosed Error identifies damaged installer-owned state that this command repairs below.
          if (!(error instanceof Error)) throw error
        }
        if (healthy) {
          out('ClawDSH Channel runtime is already installed.')
          return marker.channel
        }
      }
      const paths = channelPaths(home)
      if (!managed && (existsSync(paths.artifact) || existsSync(paths.runtime))) {
        throw new Error('refusing to take over unmarked OpenClaw artifact or runtime assets')
      }
      const lock = productionLock(channelRoot)
      verifyCurrentNodeEngine(home, lock.runtime.nodeEngine)
      const tx = beginTransaction(home, 'channel')
      const stagedArtifact = join(tx.candidateRoot, 'openclaw.tgz')
      await acquire(lock.artifactUrl, stagedArtifact)
      requireKind(stagedArtifact, 'file')
      chmodSync(stagedArtifact, 0o600)
      if (await sha512Hex(stagedArtifact) !== sha512HexFromSri(lock.npm.integrity)) {
        throw new Error('downloaded OpenClaw artifact SHA-512 differs from the production lock')
      }
      await inspectNpmTarball(stagedArtifact)

      const stagedRuntime = join(tx.candidateRoot, 'runtime')
      privateDirectory(stagedRuntime)
      copyFileSync(join(channelRoot, 'runtime', 'package.json'), join(stagedRuntime, 'package.json'))
      const expectedLockBytes = readFileSync(join(channelRoot, 'runtime', 'npm-shrinkwrap.json'))
      writeFileSync(join(stagedRuntime, 'package-lock.json'), expectedLockBytes, { mode: 0o600 })
      runtimeRunner(stagedRuntime)
      const runtimeTree = verifyRuntimeLocks(stagedRuntime, expectedLockBytes, lock)
      const host = verifyHost(stagedRuntime, lock)
      const assembledIntegrity = runtimeIntegrity(
        stagedRuntime,
        host.hostTreeIntegrity,
        runtimeTree.integrity,
      )

      privateDirectory(paths.state)
      privateDirectory(paths.staging)
      let publishConfig = false
      const bridge = options.bridgeRoot === undefined
        ? resolveBridge(home, channelRoot)
        : { root: resolve(options.bridgeRoot), integrity: ordinaryTreeDigest(options.bridgeRoot).integrity }
      if (!existsSync(paths.config)) {
        writeJsonAtomic(join(tx.candidateRoot, 'openclaw.json'), failClosedConfig(paths.state, bridge.root))
        publishConfig = true
      } else {
        requireKind(paths.config, 'file')
        const candidateConfig = join(tx.candidateRoot, 'openclaw.json')
        publishConfig = await stageManagedConfigUpgrade(home, paths.state, bridge.root, candidateConfig)
        if (!publishConfig) await verifyManagedConfig(home, paths.config, bridge.root, paths.state)
      }
      const nextMarker = {
        ...marker,
        channel: {
          status: 'installed',
          track: 'production',
          hostVersion: lock.npm.version,
          artifactIntegrity: lock.npm.integrity,
          runtimeIntegrity: assembledIntegrity,
          bridgeIntegrity: bridge.integrity,
          installedAt: now().toISOString(),
        },
      }
      writeJsonAtomic(join(tx.candidateRoot, 'marker.json'), nextMarker)
      /** @type {Array<{target: string, candidate: string, kind: 'file' | 'directory'}>} */
      const operations = [
        { target: 'clawdsh/channel/openclaw/artifacts/openclaw.tgz', candidate: 'openclaw.tgz', kind: 'file' },
        { target: 'clawdsh/channel/openclaw/runtime', candidate: 'runtime', kind: 'directory' },
      ]
      if (publishConfig) operations.push({
        target: 'clawdsh/channel/openclaw/state/openclaw.json', candidate: 'openclaw.json', kind: 'file',
      })
      operations.push({ target: MARKER_FILENAME, candidate: 'marker.json', kind: 'file' })
      commitTransaction(tx, operations)
      if (publishConfig) chmodSync(paths.config, 0o600)
      out('ClawDSH production Channel runtime installed; platform accounts remain unconfigured and disabled.')
      return nextMarker.channel
    },

    /** Verify managed Channel assets without selecting, returning, or logging OpenClaw credential fields. */
    async doctor() {
      recoverTransactions(home)
      const diagnosis = await diagnoseChannel(home, channelRoot)
      if (!diagnosis.ok) throw new Error('ClawDSH Channel runtime is not installed')
      out('ClawDSH production Channel runtime is healthy.')
      return diagnosis.marker.channel
    },
  }
}
