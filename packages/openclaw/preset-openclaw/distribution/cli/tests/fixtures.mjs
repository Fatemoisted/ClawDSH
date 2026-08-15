import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  lstatSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { installedRuntimeTreeDigest } from '../lib/channel.mjs'
import { bytesIntegrity, copyOrdinaryTree, ordinaryTreeDigest } from '../lib/files.mjs'

export function temporary() {
  return mkdtempSync(join(tmpdir(), 'clawdsh-cli-test-'))
}

export function write(root, path, value, mode = 0o600) {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, value, { mode })
  return target
}

function bundleManifest() {
  return {
    name: '@clawdsh/dsh-bundle',
    version: '0.1.0-rc.1',
    clawdsh: {
      distributionVersion: 1,
      assetManifest: './assets.json',
      profile: {
        id: 'clawdsh',
        bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@clawdsh/dsh-bundle'],
        preset: { id: 'clawdsh', directory: './presets/clawdsh' },
        safePreset: {
          id: 'clawdsh-messaging-safe',
          package: '@clawdsh/dsh-preset-messaging-safe',
        },
      },
    },
  }
}

export function createBundleFixture(root) {
  const bundle = join(root, 'bundle')
  write(bundle, 'package.json', `${JSON.stringify(bundleManifest(), null, 2)}\n`)
  const payloads = {
    'lib/index.mjs': 'export default function apply() {}\n',
    'presets/clawdsh/preset.yml': 'name: ClawDSH 模式\n',
    'presets/clawdsh/agent.cordis.yml': '- id: soul\n',
    'presets/clawdsh/souls/assistant.md': 'You are ClawDSH.\n',
    'web/assets/app.js': 'globalThis.__CLAWDSH__ = true\n',
  }
  for (const [path, bytes] of Object.entries(payloads)) write(bundle, path, bytes)
  const assets = {
    schemaVersion: 1,
    packageName: '@clawdsh/dsh-bundle',
    packageVersion: '0.1.0-rc.1',
    files: Object.entries(payloads).sort(([left], [right]) => left.localeCompare(right)).map(([path, bytes]) => ({
      path,
      source: `fixture/${path}`,
      role: 'fixture',
      bytes: Buffer.byteLength(bytes),
      integrity: bytesIntegrity(Buffer.from(bytes)),
    })),
  }
  write(bundle, 'assets.json', `${JSON.stringify(assets, null, 2)}\n`)
  return bundle
}

function refreshBundleAssets(bundle) {
  const paths = []
  const visit = (directory, prefix = '') => {
    for (const name of readdirSync(directory).sort()) {
      if (prefix === '' && (name === 'package.json' || name === 'assets.json')) continue
      const logical = prefix === '' ? name : `${prefix}/${name}`
      const absolute = join(directory, name)
      if (lstatSync(absolute).isDirectory()) visit(absolute, logical)
      else paths.push(logical)
    }
  }
  visit(bundle)
  const files = paths.sort().map(path => {
    const bytes = readFileSync(join(bundle, path))
    return {
      path,
      source: `fixture/${path}`,
      role: 'fixture',
      bytes: bytes.byteLength,
      integrity: bytesIntegrity(bytes),
    }
  })
  writeFileSync(join(bundle, 'assets.json'), `${JSON.stringify({
    schemaVersion: 1,
    packageName: '@clawdsh/dsh-bundle',
    packageVersion: '0.1.0-rc.1',
    files,
  }, null, 2)}\n`)
}

export function fakeProfileNpmRunner(bundleRoot, calls) {
  return profile => {
    calls.push(profile)
    const modules = join(profile, 'node_modules')
    copyOrdinaryTree(bundleRoot, join(modules, '@clawdsh', 'dsh-bundle'))
    const safe = join(modules, '@clawdsh', 'dsh-preset-messaging-safe')
    write(safe, 'package.json', `${JSON.stringify({
      name: '@clawdsh/dsh-preset-messaging-safe', version: '0.1.0-rc.1',
    })}\n`)
    write(safe, 'preset.yml', 'name: ClawDSH Messaging Safe\n')
    write(safe, 'agent.cordis.yml', '- id: soul\n')
    write(safe, 'souls/assistant.md', 'Restricted.\n')
    for (const [name, version] of [
      ['@deepseek-ai/dsh-base', '0.1.0-rc.6'],
      ['@deepseek-ai/dsh-web-app', '0.1.0-rc.6'],
    ]) write(modules, `${name}/package.json`, `${JSON.stringify({ name, version })}\n`)
    write(modules, '@clawdsh/dsh-channel-openclaw/package.json', JSON.stringify({
      name: '@clawdsh/dsh-channel-openclaw',
      version: '0.1.0-rc.1',
      type: 'module',
      exports: { '.': './index.js', './package.json': './package.json' },
    }))
    write(modules, '@clawdsh/dsh-channel-openclaw/index.js', `
import { readFile, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
export async function verifyFailClosedConfig(path, bridgeRoot, stateDir) {
  const config = JSON.parse(await readFile(path, 'utf8'))
  const providers = config.models?.providers
  const defaults = config.agents?.defaults
  const plugins = config.plugins
  const commands = config.commands
  if (config.models?.mode !== 'replace' || providers === null || typeof providers !== 'object'
    || Object.keys(providers).join() !== 'clawdsh'
    || providers.clawdsh?.agentRuntime?.id !== 'clawdsh'
    || !Array.isArray(providers.clawdsh?.models) || providers.clawdsh.models.length !== 1
    || providers.clawdsh.models[0]?.id !== 'local'
    || defaults?.workspace !== resolve(stateDir, 'workspace')
    || defaults?.model?.primary !== 'clawdsh/local'
    || !Array.isArray(defaults?.model?.fallbacks) || defaults.model.fallbacks.length !== 0
    || defaults?.elevatedDefault !== 'off'
    || config.gateway?.mode !== 'local' || config.gateway?.bind !== 'loopback'
    || commands?.bash !== false || commands?.config !== false || commands?.mcp !== false
    || commands?.plugins !== false || commands?.debug !== false || commands?.restart !== false
    || commands?.nativeSkills !== false || commands?.text !== true || commands?.useAccessGroups !== true
    || config.tools?.elevated?.enabled !== false
    || !Array.isArray(plugins?.allow) || plugins.allow.join() !== 'clawdsh-bridge'
    || Object.keys(plugins?.installs ?? {}).length !== 0
    || plugins?.entries?.['clawdsh-bridge']?.enabled !== true
    || !Array.isArray(plugins?.load?.paths) || plugins.load.paths.length !== 1
    || await realpath(plugins.load.paths[0]) !== await realpath(bridgeRoot)) {
    throw new Error('fixture Provider rejected the fail-closed config policy')
  }
}
`)
    const semverSource = realpathSync(new URL('../../../../channel-openclaw/node_modules/semver/', import.meta.url))
    copyOrdinaryTree(semverSource, join(modules, '@clawdsh', 'dsh-channel-openclaw', 'node_modules', 'semver'))
    if (existsSync(join(bundleRoot, 'channel'))) {
      copyOrdinaryTree(
        join(bundleRoot, 'channel', 'bridge'),
        join(modules, '@clawdsh', 'dsh-channel-openclaw', 'bridge'),
      )
    } else {
      write(modules, '@clawdsh/dsh-channel-openclaw/bridge/stable-v1/package.json', '{}\n')
    }
  }
}

function tarOctal(value, length) {
  return `${value.toString(8).padStart(length - 1, '0')}\0`
}

function tarHeader(name, size, type = '0', linkName = '') {
  const header = Buffer.alloc(512)
  header.write(name, 0, 100, 'utf8')
  header.write(tarOctal(0o644, 8), 100, 8, 'ascii')
  header.write(tarOctal(0, 8), 108, 8, 'ascii')
  header.write(tarOctal(0, 8), 116, 8, 'ascii')
  header.write(tarOctal(size, 12), 124, 12, 'ascii')
  header.write(tarOctal(0, 12), 136, 12, 'ascii')
  header.fill(0x20, 148, 156)
  header.write(type, 156, 1, 'ascii')
  header.write(linkName, 157, 100, 'utf8')
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')
  const sum = header.reduce((total, byte) => total + byte, 0)
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
  return header
}

export function tarGzip(entries) {
  const blocks = []
  for (const entry of entries) {
    const bytes = Buffer.isBuffer(entry.body) ? entry.body : Buffer.from(entry.body ?? '')
    blocks.push(tarHeader(entry.name, bytes.length, entry.type ?? '0', entry.linkName ?? ''), bytes)
    const padding = (512 - (bytes.length % 512)) % 512
    if (padding > 0) blocks.push(Buffer.alloc(padding))
  }
  blocks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(blocks))
}

export function createChannelFixture(bundleRoot) {
  const nodeEngine = `>=${process.versions.node}`
  const hostFiles = {
    'package.json': `${JSON.stringify({
      name: 'openclaw',
      version: '2026.7.1-2',
      engines: { node: nodeEngine },
    })}\n`,
    'openclaw.mjs': 'export {}\n',
  }
  const artifact = tarGzip(Object.entries(hostFiles).map(([path, body]) => ({
    name: `package/${path}`,
    body,
  })))
  const scratch = join(bundleRoot, '..', '.host-scratch')
  for (const [path, body] of Object.entries(hostFiles)) write(scratch, path, body)
  const hostTree = ordinaryTreeDigest(scratch)
  const hostLock = {
    schemaVersion: 1,
    track: 'production',
    source: { repository: 'https://github.com/openclaw/openclaw.git', archive: null },
    npm: {
      status: 'verified',
      name: 'openclaw',
      version: '2026.7.1-2',
      integrity: bytesIntegrity(artifact),
      resolved: 'https://registry.npmjs.org/openclaw/-/openclaw-2026.7.1-2.tgz',
    },
    tree: {
      algorithm: 'sha512-path-size-content-v1',
      fileCount: hostTree.fileCount,
      integrity: hostTree.integrity,
    },
  }
  write(bundleRoot, 'channel/locks/host.production.json', `${JSON.stringify(hostLock, null, 2)}\n`)
  const runtimeManifest = {
    name: 'clawdsh-openclaw-runtime',
    version: '0.0.0',
    private: true,
    dependencies: { openclaw: '2026.7.1-2' },
  }
  const packageEntry = {
    version: '2026.7.1-2',
    resolved: hostLock.npm.resolved,
    integrity: hostLock.npm.integrity,
  }
  const nativePackageEntry = {
    version: '1.0.0',
    resolved: 'https://registry.npmjs.org/openclaw-native-fixture/-/openclaw-native-fixture-1.0.0.tgz',
    integrity: 'sha512-fixture',
    optional: true,
    os: ['darwin', 'linux'],
    cpu: ['arm64', 'x64'],
  }
  const runtimeLock = {
    name: 'clawdsh-openclaw-runtime',
    version: '0.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: 'clawdsh-openclaw-runtime', version: '0.0.0', dependencies: { openclaw: '2026.7.1-2' } },
      'node_modules/openclaw': packageEntry,
      'node_modules/openclaw-native-fixture': nativePackageEntry,
    },
  }
  const runtimeManifestBytes = `${JSON.stringify(runtimeManifest, null, 2)}\n`
  const runtimeLockBytes = `${JSON.stringify(runtimeLock, null, 2)}\n`
  write(bundleRoot, 'channel/runtime/package.json', runtimeManifestBytes)
  write(bundleRoot, 'channel/runtime/npm-shrinkwrap.json', runtimeLockBytes)
  const runtimeScratch = join(bundleRoot, '..', '.runtime-scratch')
  write(runtimeScratch, 'package.json', runtimeManifestBytes)
  write(runtimeScratch, 'package-lock.json', runtimeLockBytes)
  for (const [path, body] of Object.entries(hostFiles)) write(runtimeScratch, `node_modules/openclaw/${path}`, body)
  write(runtimeScratch, 'node_modules/openclaw-native-fixture/package.json', `${JSON.stringify({
    name: 'openclaw-native-fixture', version: '1.0.0',
  })}\n`)
  write(runtimeScratch, 'node_modules/.package-lock.json', `${JSON.stringify({
    name: 'clawdsh-openclaw-runtime',
    version: '0.0.0',
    lockfileVersion: 3,
    packages: {
      'node_modules/openclaw': packageEntry,
      'node_modules/openclaw-native-fixture': nativePackageEntry,
    },
  }, null, 2)}\n`)
  const runtimeTree = installedRuntimeTreeDigest(runtimeScratch)
  write(bundleRoot, 'channel/locks/runtime.production.json', `${JSON.stringify({
    schemaVersion: 1,
    track: 'production',
    packageName: 'openclaw',
    packageVersion: '2026.7.1-2',
    nodeEngine,
    artifactUrl: hostLock.npm.resolved,
    artifactSha512: Buffer.from(hostLock.npm.integrity.slice('sha512-'.length), 'base64').toString('hex'),
    runtimePackageLockSha512: createHash('sha512').update(runtimeLockBytes).digest('hex'),
    tree: {
      fileCount: hostTree.fileCount,
      sha512: Buffer.from(hostTree.integrity.slice('sha512-'.length), 'base64').toString('hex'),
    },
    runtimeTrees: [{
      platform: process.platform,
      architecture: process.arch,
      fileCount: runtimeTree.fileCount,
      sha512: runtimeTree.sha512,
    }],
  }, null, 2)}\n`)
  write(bundleRoot, 'channel/bridge/stable-v1/package.json', '{}\n')
  write(bundleRoot, 'channel/bridge/stable-v1/index.js', 'export default {}\n')
  write(bundleRoot, 'channel/bridge/shared/protocol-v1.js', 'export const version = 1\n')
  refreshBundleAssets(bundleRoot)
  return { artifact, hostFiles, runtimeLock, nodeEngine }
}

export function fakeRuntimeRunner(fixture, calls) {
  return runtime => {
    calls.push(runtime)
    const host = join(runtime, 'node_modules', 'openclaw')
    for (const [path, body] of Object.entries(fixture.hostFiles)) write(host, path, body)
    write(runtime, 'node_modules/openclaw-native-fixture/package.json', `${JSON.stringify({
      name: 'openclaw-native-fixture', version: '1.0.0',
    })}\n`)
    write(runtime, 'node_modules/.package-lock.json', `${JSON.stringify({
      name: 'clawdsh-openclaw-runtime',
      version: '0.0.0',
      lockfileVersion: 3,
      packages: {
        'node_modules/openclaw': fixture.runtimeLock.packages['node_modules/openclaw'],
        'node_modules/openclaw-native-fixture': fixture.runtimeLock.packages['node_modules/openclaw-native-fixture'],
      },
    }, null, 2)}\n`)
  }
}

export function copyArtifact(artifact, calls) {
  return async (_url, destination) => {
    calls.push(destination)
    writeFileSync(destination, artifact, { flag: 'wx', mode: 0o600 })
  }
}

export function cloneFile(source, destination) {
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(source, destination)
}

export function integrity(path) {
  return `sha512-${createHash('sha512').update(readFileSync(path)).digest('base64')}`
}
