import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { inspectNpmTarball } from '../lib/archive.mjs'
import { createChannelManager } from '../lib/channel.mjs'
import { createInstaller } from '../lib/installer.mjs'
import {
  copyArtifact,
  createBundleFixture,
  createChannelFixture,
  fakeProfileNpmRunner,
  fakeRuntimeRunner,
  tarGzip,
  temporary,
  write,
} from './fixtures.mjs'

function setup() {
  const root = temporary()
  const home = join(root, 'home')
  const bundleRoot = createBundleFixture(root)
  const channelFixture = createChannelFixture(bundleRoot)
  createInstaller({
    home,
    bundleRoot,
    npmRunner: fakeProfileNpmRunner(bundleRoot, []),
  }).init()
  return { root, home, bundleRoot, channelFixture }
}

test('explicit Channel install verifies and publishes production assets idempotently', async () => {
  const fixture = setup()
  try {
    const acquireCalls = []
    const runtimeCalls = []
    const output = []
    const manager = createChannelManager({
      home: fixture.home,
      channelRoot: join(fixture.bundleRoot, 'channel'),
      acquire: copyArtifact(fixture.channelFixture.artifact, acquireCalls),
      runtimeRunner: fakeRuntimeRunner(fixture.channelFixture, runtimeCalls),
      now: () => new Date('2026-08-15T10:00:00Z'),
      out: message => output.push(message),
    })
    const installed = await manager.install()
    assert.deepEqual(installed, {
      status: 'installed',
      track: 'production',
      hostVersion: '2026.7.1-2',
      artifactIntegrity: installed.artifactIntegrity,
      runtimeIntegrity: installed.runtimeIntegrity,
      bridgeIntegrity: installed.bridgeIntegrity,
      installedAt: '2026-08-15T10:00:00.000Z',
    })
    assert.equal(acquireCalls.length, 1)
    assert.equal(runtimeCalls.length, 1)
    const config = JSON.parse(readFileSync(join(fixture.home, 'clawdsh/channel/openclaw/state/openclaw.json')))
    assert.equal(config.channels instanceof Object, true)
    assert.equal(config.session.dmScope, 'per-account-channel-peer')
    assert.deepEqual(config.models.providers.clawdsh.models[0].input, ['text'])
    await manager.doctor()
    const markerBefore = readFileSync(join(fixture.home, '.clawdsh.json'))
    await manager.install()
    assert.equal(acquireCalls.length, 1)
    assert.equal(runtimeCalls.length, 1)
    assert.deepEqual(readFileSync(join(fixture.home, '.clawdsh.json')), markerBefore)
    assert.match(output.at(-1), /already installed/)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('Channel runtime lock compares optional platform arrays by value', async () => {
  const fixture = setup()
  try {
    const packagePath = 'node_modules/openclaw-native-fixture'
    const manager = createChannelManager({
      home: fixture.home,
      channelRoot: join(fixture.bundleRoot, 'channel'),
      acquire: copyArtifact(fixture.channelFixture.artifact, []),
      runtimeRunner: fakeRuntimeRunner(fixture.channelFixture, []),
    })
    await manager.install()
    await manager.doctor()

    const installedLock = join(fixture.home, 'clawdsh/channel/openclaw/runtime/node_modules/.package-lock.json')
    const changed = JSON.parse(readFileSync(installedLock, 'utf8'))
    changed.packages[packagePath].cpu = ['x64', 'arm64']
    writeFileSync(installedLock, `${JSON.stringify(changed, null, 2)}\n`)
    await assert.rejects(manager.doctor(), /installed runtime lock differs/)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('Channel install repairs marked damage and validates a preserved config before publishing', async () => {
  const fixture = setup()
  try {
    const acquireCalls = []
    const manager = createChannelManager({
      home: fixture.home,
      channelRoot: join(fixture.bundleRoot, 'channel'),
      acquire: copyArtifact(fixture.channelFixture.artifact, acquireCalls),
      runtimeRunner: fakeRuntimeRunner(fixture.channelFixture, []),
    })
    await manager.install()
    writeFileSync(join(fixture.home, 'clawdsh/channel/openclaw/artifacts/openclaw.tgz'), 'damaged\n')
    await manager.install()
    assert.equal(acquireCalls.length, 2)
    await manager.doctor()

    const other = setup()
    try {
      const config = join(other.home, 'clawdsh/channel/openclaw/state/openclaw.json')
      write(other.home, 'clawdsh/channel/openclaw/state/openclaw.json', `${JSON.stringify({
        plugins: { load: { paths: [join(other.bundleRoot, 'channel/bridge/shared')] } },
      })}\n`)
      const rejected = createChannelManager({
        home: other.home,
        channelRoot: join(other.bundleRoot, 'channel'),
        acquire: copyArtifact(other.channelFixture.artifact, []),
        runtimeRunner: fakeRuntimeRunner(other.channelFixture, []),
      })
      await assert.rejects(rejected.install(), /rejected the fail-closed config policy/)
      assert.equal(existsSync(config), true)
      assert.equal(existsSync(join(other.home, 'clawdsh/channel/openclaw/runtime')), false)
      assert.equal(JSON.parse(readFileSync(join(other.home, '.clawdsh.json'))).channel.status, 'not-installed')
    } finally {
      rmSync(other.root, { recursive: true, force: true })
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('Channel install atomically upgrades the prior managed config without changing Channel credentials', async () => {
  const fixture = setup()
  try {
    const acquireCalls = []
    const runtimeCalls = []
    const manager = createChannelManager({
      home: fixture.home,
      channelRoot: join(fixture.bundleRoot, 'channel'),
      acquire: copyArtifact(fixture.channelFixture.artifact, acquireCalls),
      runtimeRunner: fakeRuntimeRunner(fixture.channelFixture, runtimeCalls),
    })
    await manager.install()
    const configPath = join(fixture.home, 'clawdsh/channel/openclaw/state/openclaw.json')
    const legacy = JSON.parse(readFileSync(configPath, 'utf8'))
    legacy.models.providers.clawdsh.models[0].input = ['text', 'image']
    delete legacy.session
    legacy.channels.telegram = {
      enabled: false,
      botToken: 'preserved-channel-credential-canary-9917',
    }
    const expected = structuredClone(legacy)
    expected.models.providers.clawdsh.models[0].input = ['text']
    expected.session = { dmScope: 'per-account-channel-peer' }
    writeFileSync(configPath, `${JSON.stringify(legacy, null, 2)}\n`)

    await manager.install()

    assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), expected)
    assert.equal(acquireCalls.length, 2)
    assert.equal(runtimeCalls.length, 2)
    await manager.doctor()
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('Channel config upgrade leaves the live file untouched when strict verification still fails', async () => {
  const fixture = setup()
  try {
    const manager = createChannelManager({
      home: fixture.home,
      channelRoot: join(fixture.bundleRoot, 'channel'),
      acquire: copyArtifact(fixture.channelFixture.artifact, []),
      runtimeRunner: fakeRuntimeRunner(fixture.channelFixture, []),
    })
    await manager.install()
    const stateDir = join(fixture.home, 'clawdsh/channel/openclaw/state')
    const configPath = join(stateDir, 'openclaw.json')
    const legacy = JSON.parse(readFileSync(configPath, 'utf8'))
    legacy.models.providers.clawdsh.models[0].input = ['text', 'image']
    delete legacy.session
    legacy.agents.defaults.model.fallbacks = ['must-remain-invalid']
    const before = `${JSON.stringify(legacy, null, 2)}\n`
    writeFileSync(configPath, before)

    await assert.rejects(manager.install(), /rejected the fail-closed config policy/)

    assert.equal(readFileSync(configPath, 'utf8'), before)
    assert.equal(readdirSync(stateDir).some(name => name.startsWith('.openclaw-upgrade-')), false)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('Channel management rejects an incompatible Node before acquisition', async () => {
  const fixture = setup()
  try {
    const runtimeIdentityPath = join(fixture.bundleRoot, 'channel/locks/runtime.production.json')
    const runtimeIdentity = JSON.parse(readFileSync(runtimeIdentityPath, 'utf8'))
    runtimeIdentity.nodeEngine = '>=999.0.0'
    writeFileSync(runtimeIdentityPath, `${JSON.stringify(runtimeIdentity, null, 2)}\n`)
    const acquireCalls = []
    const runtimeCalls = []
    const manager = createChannelManager({
      home: fixture.home,
      channelRoot: join(fixture.bundleRoot, 'channel'),
      acquire: copyArtifact(fixture.channelFixture.artifact, acquireCalls),
      runtimeRunner: fakeRuntimeRunner(fixture.channelFixture, runtimeCalls),
    })
    await assert.rejects(manager.install(), /does not satisfy the locked OpenClaw engine/)
    assert.equal(acquireCalls.length, 0)
    assert.equal(runtimeCalls.length, 0)
    assert.equal(existsSync(join(fixture.home, 'clawdsh/channel/openclaw/runtime')), false)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('Channel doctor applies the Provider fail-closed policy without emitting channel credentials', async () => {
  const fixture = setup()
  try {
    const messages = []
    const manager = createChannelManager({
      home: fixture.home,
      channelRoot: join(fixture.bundleRoot, 'channel'),
      acquire: copyArtifact(fixture.channelFixture.artifact, []),
      runtimeRunner: fakeRuntimeRunner(fixture.channelFixture, []),
      out: message => messages.push(message),
    })
    await manager.install()
    const configPath = join(fixture.home, 'clawdsh/channel/openclaw/state/openclaw.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    config.agents.defaults.model.fallbacks = ['credential-canary-fallback-9917']
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
    await assert.rejects(manager.doctor(), /rejected the fail-closed config policy/)
    assert.ok(messages.every(message => !message.includes('credential-canary-fallback-9917')))
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('Channel install refuses a wrong hash and unsafe tar entries before runtime assembly', async () => {
  const fixture = setup()
  try {
    const runtimeCalls = []
    const wrong = createChannelManager({
      home: fixture.home,
      channelRoot: join(fixture.bundleRoot, 'channel'),
      acquire: async (_url, destination) => writeFileSync(destination, Buffer.from('not the locked artifact')),
      runtimeRunner: fakeRuntimeRunner(fixture.channelFixture, runtimeCalls),
    })
    await assert.rejects(wrong.install(), /SHA-512 differs/)
    assert.equal(runtimeCalls.length, 0)

    const badTar = tarGzip([{ name: 'package/../../escape', body: 'bad' }])
    const badTarPath = write(fixture.root, 'bad.tgz', badTar)
    await assert.rejects(inspectNpmTarball(badTarPath), /escapes the archive root/)
    const linkTar = tarGzip([{ name: 'package/link', type: '2', linkName: '../../escape' }])
    const linkTarPath = write(fixture.root, 'link.tgz', linkTar)
    await assert.rejects(inspectNpmTarball(linkTarPath), /link target|forbidden link/)
    const hardlinkTar = tarGzip([{ name: 'package/hard', type: '1', linkName: 'package/file' }])
    const hardlinkTarPath = write(fixture.root, 'hardlink.tgz', hardlinkTar)
    await assert.rejects(inspectNpmTarball(hardlinkTarPath), /link target|forbidden link/)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('doctor neither selects nor emits OpenClaw credential canaries', async () => {
  const fixture = setup()
  try {
    const messages = []
    const manager = createChannelManager({
      home: fixture.home,
      channelRoot: join(fixture.bundleRoot, 'channel'),
      acquire: copyArtifact(fixture.channelFixture.artifact, []),
      runtimeRunner: fakeRuntimeRunner(fixture.channelFixture, []),
      out: message => messages.push(message),
    })
    await manager.install()
    const configPath = join(fixture.home, 'clawdsh/channel/openclaw/state/openclaw.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    config.channels = {
      telegram: {
        enabled: false,
        botToken: 'channel-credential-canary-9917',
      },
    }
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
    await manager.doctor()
    assert.ok(messages.every(message => !message.includes('channel-credential-canary-9917')))
    assert.match(readFileSync(configPath, 'utf8'), /channel-credential-canary-9917/)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})
