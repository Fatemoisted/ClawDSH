import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { stageBundle } from './bundle-stage.mjs'
import {
  assertPublicationJson,
  BUNDLE_NAME,
  BUNDLE_VERSION,
  PROFILE_BUNDLE_ORDER,
  verifyPackedBundle,
  verifyStagedBundle,
} from './bundle-verify.mjs'

const OLD = new Date('2026-01-01T00:00:00.000Z')
const NEW = new Date('2026-01-01T00:01:00.000Z')

function sha512(bytes) {
  return createHash('sha512').update(bytes).digest()
}

function sri(bytes) {
  return `sha512-${sha512(bytes).toString('base64')}`
}

function write(root, path, value) {
  const absolute = join(root, path)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, value)
  return absolute
}

function fixture() {
  const temporary = mkdtempSync(join(tmpdir(), 'clawdsh-bundle-test-'))
  const repository = join(temporary, 'repository')
  mkdirSync(repository)
  write(repository, 'LICENSE', 'MIT fixture\n')
  for (const [name, directory] of [
    ['@clawdsh/dsh-soul', 'soul'],
    ['@clawdsh/dsh-embeddings', 'embeddings'],
    ['@clawdsh/dsh-embeddings-ark', 'embeddings-ark'],
    ['@clawdsh/dsh-memory', 'memory'],
    ['@clawdsh/dsh-skills-hub', 'skills-hub'],
    ['@clawdsh/dsh-automation', 'automation'],
    ['@clawdsh/dsh-channel', 'channel'],
    ['@clawdsh/dsh-channel-agent', 'channel-agent'],
    ['@clawdsh/dsh-channel-openclaw', 'channel-openclaw'],
    ['@clawdsh/dsh-activity', 'activity'],
    ['@clawdsh/dsh-preset-messaging-safe', 'preset-clawdsh-messaging-safe'],
  ]) {
    write(repository, `packages/openclaw/${directory}/package.json`, JSON.stringify({
      name,
      version: BUNDLE_VERSION,
      publishConfig: { access: 'public' },
    }))
  }
  write(repository, 'packages/openclaw/preset-openclaw/profile/cordis.patch.yml', `
- insert:
    - id: soul
      name: '@clawdsh/dsh-soul/settings-host'
    - id: activity
      name: '@clawdsh/dsh-activity'
    - id: runtime
      name: '@clawdsh/dsh-product-runtime'
    - id: channel
      name: '@clawdsh/dsh-channel'
    - id: channel-agent
      name: '@clawdsh/dsh-channel-agent'
    - id: channel-openclaw
      name: '@clawdsh/dsh-channel-openclaw'
    - id: memory
      name: '@clawdsh/dsh-memory'
    - id: embeddings
      name: '@clawdsh/dsh-embeddings-ark'
    - id: skills
      name: '@clawdsh/dsh-skills-hub'
    - id: automation
      name: '@clawdsh/dsh-automation'
`)
  write(repository, 'packages/openclaw/preset-openclaw/agent.cordis.yml', '- id: soul\n')
  write(repository, 'packages/openclaw/preset-openclaw/preset.yml', 'name: ClawDSH 模式\n')
  write(repository, 'packages/openclaw/preset-openclaw/souls/assistant.md', 'You are ClawDSH.\n')

  const runtimeRoot = 'packages/openclaw/preset-openclaw/product-shell/runtime'
  const browserRoot = 'packages/openclaw/preset-openclaw/product-shell/browser'
  const sharedRoot = 'packages/openclaw/preset-openclaw/product-shell/shared'
  const inputs = [
    write(repository, `${runtimeRoot}/src/index.ts`, 'export default function runtime() {}\n'),
    write(repository, `${runtimeRoot}/package.json`, '{"main":"lib/index.mjs","types":"lib/index.d.mts"}\n'),
    write(repository, `${runtimeRoot}/tsdown.config.ts`, 'export default {}\n'),
    write(repository, `${runtimeRoot}/tsconfig.json`, '{}\n'),
    write(repository, `${sharedRoot}/src/protocol.ts`, 'export const version = 1\n'),
    write(repository, `${browserRoot}/src/main.tsx`, 'export const app = true\n'),
    write(repository, `${browserRoot}/index.html`, '<div id="root"></div>\n'),
    write(repository, `${browserRoot}/package.json`, '{"private":true}\n'),
    write(repository, `${browserRoot}/vite.config.ts`, 'export default {}\n'),
    write(repository, `${browserRoot}/tsconfig.json`, '{}\n'),
  ]
  const outputs = [
    write(repository, `${runtimeRoot}/lib/index.mjs`, 'export default function apply() {}\n'),
    write(repository, `${runtimeRoot}/lib/index.d.mts`, 'export default function apply(): void\n'),
    write(repository, `${runtimeRoot}/web/index.html`, '<link rel="stylesheet" href="/clawdsh/assets/app.css"><script src="/clawdsh/assets/app.js"></script>\n'),
    write(repository, `${runtimeRoot}/web/assets/app.js`, 'globalThis.__CLAWDSH__ = true\n'),
    write(repository, `${runtimeRoot}/web/assets/app.css`, ':root { color: black; }\n'),
    write(repository, `${runtimeRoot}/web/assets/app.js.map`, '{"version":3}\n'),
  ]
  for (const path of inputs) utimesSync(path, OLD, OLD)
  for (const path of outputs) utimesSync(path, NEW, NEW)

  const hostVersion = '2026.7.1-2'
  const artifactUrl = `https://registry.npmjs.org/openclaw/-/openclaw-${hostVersion}.tgz`
  const artifactDigest = sha512(Buffer.from('fixture OpenClaw artifact'))
  const hostTreeDigest = sha512(Buffer.from('fixture OpenClaw host tree'))
  write(repository, 'tools/openclaw-channel-host/host.production.json', JSON.stringify({
    schemaVersion: 1,
    track: 'production',
    source: { repository: 'https://github.com/openclaw/openclaw.git' },
    npm: {
      status: 'verified',
      name: 'openclaw',
      version: hostVersion,
      resolved: artifactUrl,
      integrity: `sha512-${artifactDigest.toString('base64')}`,
    },
    tree: {
      algorithm: 'sha512-path-size-content-v1',
      fileCount: 1,
      integrity: `sha512-${hostTreeDigest.toString('base64')}`,
    },
  }))
  for (const name of ['channels', 'support', 'governance']) {
    write(repository, `tools/openclaw-channel-host/${name}.production.json`, JSON.stringify({
      schemaVersion: 1,
      track: 'production',
      channels: [],
    }))
  }
  write(repository, 'packages/openclaw/channel-openclaw/runtime/package.json', JSON.stringify({
    name: 'clawdsh-openclaw-runtime',
    private: true,
    dependencies: { openclaw: hostVersion },
  }))
  const runtimeLock = JSON.stringify({
    name: 'clawdsh-openclaw-runtime',
    lockfileVersion: 3,
    packages: { '': { dependencies: { openclaw: hostVersion } } },
  })
  write(repository, 'packages/openclaw/channel-openclaw/runtime/package-lock.json', runtimeLock)
  write(repository, 'packages/openclaw/channel-openclaw/runtime/production-lock.json', JSON.stringify({
    schemaVersion: 1,
    track: 'production',
    packageName: 'openclaw',
    packageVersion: hostVersion,
    nodeEngine: '>=24',
    artifactUrl,
    artifactSha512: artifactDigest.toString('hex'),
    runtimePackageLockSha512: sha512(Buffer.from(runtimeLock)).toString('hex'),
    tree: { fileCount: 1, sha512: hostTreeDigest.toString('hex') },
    runtimeTrees: [{
      platform: 'darwin',
      architecture: 'arm64',
      fileCount: 1,
      sha512: sha512(Buffer.from('fixture runtime tree')).toString('hex'),
    }],
  }))
  write(repository, 'packages/openclaw/channel-openclaw/bridge/stable-v1/package.json', JSON.stringify({
    name: '@clawdsh/openclaw-bridge-stable-v1',
    private: true,
    peerDependencies: { openclaw: hostVersion },
  }))
  write(repository, 'packages/openclaw/channel-openclaw/bridge/stable-v1/index.js', 'export default {}\n')
  write(repository, 'packages/openclaw/channel-openclaw/bridge/stable-v1/openclaw.plugin.json', '{"id":"clawdsh-bridge"}\n')
  write(repository, 'packages/openclaw/channel-openclaw/bridge/shared/protocol-v1.js', 'export const version = 1\n')
  write(repository, 'packages/openclaw/channel-openclaw/LICENSE.openclaw', 'OpenClaw fixture license\n')
  write(repository, 'packages/openclaw/channel-openclaw/THIRD_PARTY_NOTICES.md', '# Notices\n')
  return { temporary, repository }
}

function cleanup(temporary) {
  rmSync(temporary, { recursive: true, force: true })
}

test('stages a deterministic closed bundle from built output', () => {
  const { temporary, repository } = fixture()
  try {
    const first = join(temporary, 'first')
    const second = join(temporary, 'second')
    stageBundle({ repositoryRoot: repository, outputDirectory: first })
    stageBundle({ repositoryRoot: repository, outputDirectory: second })
    const verified = verifyStagedBundle(first)

    assert.equal(verified.manifest.name, BUNDLE_NAME)
    assert.equal(verified.manifest.version, BUNDLE_VERSION)
    assert.deepEqual(verified.manifest.clawdsh.profile.bundles, PROFILE_BUNDLE_ORDER)
    assert.equal(verified.manifest.dependencies['@clawdsh/dsh-activity'], BUNDLE_VERSION)
    assert.deepEqual(readFileSync(join(first, 'assets.json')), readFileSync(join(second, 'assets.json')))
    assert.match(readFileSync(join(first, 'cordis.patch.yml'), 'utf8'), /name: '@clawdsh\/dsh-bundle'/)
    assert.throws(() => readFileSync(join(first, 'web/assets/app.js.map')), /ENOENT/)
  } finally {
    cleanup(temporary)
  }
})

test('packs and verifies the real npm tarball payload', () => {
  const { temporary, repository } = fixture()
  try {
    const staged = join(temporary, 'staged')
    const packed = join(temporary, 'packed')
    const cache = join(temporary, 'npm-cache')
    mkdirSync(packed)
    stageBundle({ repositoryRoot: repository, outputDirectory: staged })
    const output = execFileSync('npm', [
      'pack', staged,
      '--json',
      '--ignore-scripts',
      '--pack-destination', packed,
      '--cache', cache,
    ], { encoding: 'utf8' })
    const result = JSON.parse(output)
    const tarball = join(packed, result[0].filename)
    const verified = verifyPackedBundle(tarball)

    assert.equal(verified.manifest.name, BUNDLE_NAME)
    assert.ok(verified.assets.files.some(entry => entry.path === 'channel/runtime/npm-shrinkwrap.json'))
    assert.ok(verified.assets.files.every(entry => !entry.path.endsWith('.map')))
  } finally {
    cleanup(temporary)
  }
})

test('rejects source symlinks before they can enter staging', {
  skip: process.platform === 'win32',
}, () => {
  const { temporary, repository } = fixture()
  try {
    const shared = join(repository, 'packages/openclaw/channel-openclaw/bridge/shared')
    symlinkSync('protocol-v1.js', join(shared, 'linked.js'))
    assert.throws(
      () => stageBundle({ repositoryRoot: repository, outputDirectory: join(temporary, 'staged') }),
      /symbolic link/,
    )
  } finally {
    cleanup(temporary)
  }
})

test('rejects local dependency protocols, private registries, and undeclared files', () => {
  assert.throws(
    () => assertPublicationJson({ dependencies: { bad: 'workspace:0.1.0-rc.1' } }),
    /forbidden dependency specifier/,
  )
  assert.throws(
    () => assertPublicationJson({ dependencies: { bad: 'file:..\/bad.tgz' } }),
    /forbidden dependency specifier/,
  )
  assert.throws(
    () => assertPublicationJson({ publishConfig: { registry: 'https://npm.example.internal/' } }),
    /non-public registry/,
  )
  assert.throws(
    () => assertPublicationJson({ resolved: 'https://npm.example.internal/package.tgz' }),
    /non-public registry/,
  )

  const { temporary, repository } = fixture()
  try {
    const staged = join(temporary, 'staged')
    stageBundle({ repositoryRoot: repository, outputDirectory: staged })
    write(staged, 'undeclared.txt', 'not in assets.json\n')
    assert.throws(() => verifyStagedBundle(staged), /bundle payload files/)
  } finally {
    cleanup(temporary)
  }
})

test('refuses stale product-shell artifacts instead of manufacturing replacements', () => {
  const { temporary, repository } = fixture()
  try {
    const source = join(repository, 'packages/openclaw/preset-openclaw/product-shell/runtime/src/index.ts')
    utimesSync(source, new Date(NEW.getTime() + 60_000), new Date(NEW.getTime() + 60_000))
    assert.throws(
      () => stageBundle({ repositoryRoot: repository, outputDirectory: join(temporary, 'staged') }),
      /build is stale/,
    )
  } finally {
    cleanup(temporary)
  }
})
