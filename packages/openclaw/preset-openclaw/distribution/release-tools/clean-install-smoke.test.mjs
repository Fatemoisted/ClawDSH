import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { runCleanInstallSmoke, verifyClawdshPage } from './clean-install-smoke.mjs'
import { assertReleaseReadiness } from './release-readiness.mjs'
import { createReleaseFixture, packedRelease } from './release-fixture.mjs'
import { writeTemporaryRegistryConfig } from './temporary-registry-config.mjs'
import { writeTemporaryRegistryUser } from './temporary-registry-user.mjs'

function installFixture(root) {
  const cli = join(root, 'node_modules/@clawdsh/cli')
  const dsh = join(root, 'node_modules/@deepseek-ai/dsh')
  const bundle = join(root, 'node_modules/@clawdsh/dsh-bundle')
  for (const directory of [cli, dsh, bundle]) mkdirSync(directory, { recursive: true })
  writeFileSync(join(cli, 'package.json'), JSON.stringify({
    name: '@clawdsh/cli',
    version: '0.1.0-rc.1',
    bin: { clawdsh: './lib/cli.mjs' },
    dependencies: {
      '@clawdsh/dsh-bundle': '0.1.0-rc.1',
      '@deepseek-ai/dsh': '0.1.0-rc.6',
    },
  }))
  mkdirSync(join(cli, 'lib'))
  writeFileSync(join(cli, 'lib/cli.mjs'), '#!/usr/bin/env node\n', { mode: 0o755 })
  writeFileSync(join(cli, 'lib/index.mjs'), `
export async function runCli(argv, options) {
  if (JSON.stringify(argv) !== '["init"]') throw new Error('unexpected init arguments')
  if (process.env.CLAWDSH_TEST_API_KEY !== undefined
    || process.env.GOOGLE_APPLICATION_CREDENTIALS !== undefined
    || process.env.HTTPS_PROXY !== undefined) throw new Error('ambient credential reached init')
  if (options.home !== process.env.DSH_HOME) throw new Error('init did not use the isolated DSH home')
  if (typeof options.npmRunner !== 'function') throw new Error('init has no isolated npm runner')
  return 0
}
`)
  chmodSync(join(cli, 'lib/cli.mjs'), 0o755)
  writeFileSync(join(dsh, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.0-rc.6' }))
  writeFileSync(join(bundle, 'package.json'), JSON.stringify({ name: '@clawdsh/dsh-bundle', version: '0.1.0-rc.1' }))
}

test('clean-install smoke uses an isolated credential-free DSH home and records locked rc.6 startup', async () => {
  const fixture = createReleaseFixture()
  const previousEnvironment = {
    CLAWDSH_TEST_API_KEY: process.env.CLAWDSH_TEST_API_KEY,
    CLAWDSH_TEST_KEY: process.env.CLAWDSH_TEST_KEY,
    GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    HTTPS_PROXY: process.env.HTTPS_PROXY,
  }
  process.env.CLAWDSH_TEST_API_KEY = 'must-not-cross'
  process.env.CLAWDSH_TEST_KEY = 'must-not-cross'
  process.env.GOOGLE_APPLICATION_CREDENTIALS = '/must/not/cross.json'
  process.env.HTTPS_PROXY = 'https://username:password@proxy.invalid/'
  try {
    const releaseDirectory = packedRelease(fixture)
    const workDirectory = join(fixture.temporary, 'clean-install')
    const attestationPath = join(fixture.temporary, 'smoke-attestation.json')
    const calls = []
    const pageProbes = []
    const runner = {
      async run(command, arguments_, options) {
        calls.push({ kind: 'run', command, arguments_, options })
        assert.equal(options.env.CLAWDSH_TEST_API_KEY, undefined)
        assert.equal(options.env.CLAWDSH_TEST_KEY, undefined)
        assert.equal(options.env.GOOGLE_APPLICATION_CREDENTIALS, undefined)
        assert.equal(options.env.HTTPS_PROXY, undefined)
        assert.match(options.env.DSH_HOME, /clean-install\/dsh-home$/)
        assert.match(options.env.TMPDIR, /clean-install\/tmp$/)
        if (command === 'npm') installFixture(options.cwd)
        else {
          assert.equal(command, process.execPath)
          assert.match(arguments_[0], /clean-install-smoke-init\.mjs$/)
          assert.deepEqual(arguments_.slice(1, 3), [
            '--cli-module',
            join(options.cwd, 'node_modules/@clawdsh/cli/lib/index.mjs'),
          ])
          assert.deepEqual(arguments_.slice(3), [
            '--bundle-root',
            join(options.cwd, 'node_modules/@clawdsh/dsh-bundle'),
          ])
          execFileSync(command, arguments_, {
            cwd: options.cwd,
            env: options.env,
            stdio: ['ignore', 'pipe', 'pipe'],
          })
        }
        return { output: '', code: 0 }
      },
      async start(command, arguments_, options) {
        calls.push({ kind: 'start', command, arguments_, options })
        assert.equal(options.env.CLAWDSH_TEST_API_KEY, undefined)
        assert.match(arguments_[0], /clean-install\/node_modules\/@clawdsh\/cli\/lib\/cli\.mjs$/)
        assert.deepEqual(arguments_.slice(1), ['start', '--host', '127.0.0.1', '--port', '0'])
        await options.readyProbe('http://127.0.0.1:43123/clawdsh/')
        return { output: 'ClawDSH: http://127.0.0.1:43123/clawdsh/\n', code: null, signal: 'SIGTERM' }
      },
    }
    const result = await runCleanInstallSmoke({
      releaseDirectory,
      registry: 'http://127.0.0.1:4873/',
      workDirectory,
      attestationPath,
      runner,
      async pageProbe(url) {
        pageProbes.push(url)
      },
    })
    assert.equal(result.dshVersion, '0.1.0-rc.6')
    assert.equal(result.cliStarted, true)
    assert.equal(result.productPageVerified, true)
    assert.equal(calls.filter(call => call.kind === 'run').length, 2)
    assert.equal(calls.filter(call => call.kind === 'start').length, 1)
    assert.deepEqual(pageProbes, ['http://127.0.0.1:43123/clawdsh/'])
    assert.deepEqual(JSON.parse(readFileSync(attestationPath, 'utf8')), result)

    const confirmations = {
      scopeOwnershipConfirmed: true,
      trustedPublishingConfirmed: true,
      publicRepositoryApproved: true,
      rc6CompatibilityConfirmed: true,
    }
    assert.equal(assertReleaseReadiness({
      publishRequested: true,
      githubRef: 'refs/heads/clawdsh',
      repositoryPrivate: false,
      confirmations,
      releaseIndex: join(releaseDirectory, 'release-index.json'),
      smokeAttestation: attestationPath,
    }).publish, true)
    assert.throws(() => assertReleaseReadiness({
      publishRequested: true,
      githubRef: 'refs/heads/clawdsh',
      repositoryPrivate: true,
      confirmations,
      releaseIndex: join(releaseDirectory, 'release-index.json'),
      smokeAttestation: attestationPath,
    }), /repository is private/)
    assert.throws(() => assertReleaseReadiness({
      publishRequested: true,
      githubRef: 'refs/heads/feature',
      repositoryPrivate: false,
      confirmations,
      releaseIndex: join(releaseDirectory, 'release-index.json'),
      smokeAttestation: attestationPath,
    }), /restricted to refs\/heads\/clawdsh/)
    const logOnlyAttestation = join(fixture.temporary, 'log-only-attestation.json')
    const logOnly = { ...result }
    delete logOnly.productPageVerified
    writeFileSync(logOnlyAttestation, JSON.stringify(logOnly))
    assert.throws(() => assertReleaseReadiness({
      publishRequested: true,
      githubRef: 'refs/heads/clawdsh',
      repositoryPrivate: false,
      confirmations,
      releaseIndex: join(releaseDirectory, 'release-index.json'),
      smokeAttestation: logOnlyAttestation,
    }), /does not prove the locked CLI\/DSH product page/)
    assert.deepEqual(assertReleaseReadiness({ publishRequested: false }), { publish: false })
  } finally {
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    fixture.cleanup()
  }
})

test('product-page probe requires HTTP 200 and both ClawDSH identity markers', async () => {
  const requests = []
  await verifyClawdshPage('http://127.0.0.1:43123/clawdsh/', {
    attempts: 1,
    intervalMs: 0,
    async request(url, options) {
      requests.push({ url, options })
      return {
        status: 200,
        async text() {
          return '<!doctype html><title>ClawDSH</title><div id="clawdsh-root"></div>'
        },
      }
    },
  })
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, 'http://127.0.0.1:43123/clawdsh/')
  assert.equal(requests[0].options.redirect, 'error')

  await assert.rejects(() => verifyClawdshPage('http://127.0.0.1:43123/clawdsh/', {
    attempts: 1,
    intervalMs: 0,
    async request() {
      return { status: 200, async text() { return '<title>Another product</title>' } }
    },
  }), /without the ClawDSH product identity markers/)
  await assert.rejects(() => verifyClawdshPage('https://example.com/clawdsh/', {
    attempts: 1,
    intervalMs: 0,
    async request() {
      throw new Error('must not request a non-loopback URL')
    },
  }), /loopback/)
})

test('readiness rejects stale smoke evidence and registry config publishes only the ClawDSH scope', async () => {
  const fixture = createReleaseFixture()
  try {
    const releaseDirectory = packedRelease(fixture)
    const index = readFileSync(join(releaseDirectory, 'release-index.json'))
    const attestation = join(fixture.temporary, 'attestation.json')
    writeFileSync(attestation, JSON.stringify({
      version: 1,
      releaseVersion: '0.1.0-rc.1',
      dshVersion: '0.1.0-rc.6',
      cliStarted: true,
      productPageVerified: true,
      releaseIndexIntegrity: `sha512-${createHash('sha512').update(index).digest('base64')}stale`,
    }))
    assert.throws(() => assertReleaseReadiness({
      publishRequested: true,
      githubRef: 'refs/heads/clawdsh',
      repositoryPrivate: false,
      confirmations: {
        scopeOwnershipConfirmed: true,
        trustedPublishingConfirmed: true,
        publicRepositoryApproved: true,
        rc6CompatibilityConfirmed: true,
      },
      releaseIndex: join(releaseDirectory, 'release-index.json'),
      smokeAttestation: attestation,
    }), /does not match/)

    const configPath = join(fixture.temporary, 'verdaccio.json')
    writeTemporaryRegistryConfig({
      output: configPath,
      stateDirectory: join(fixture.temporary, 'registry-state'),
    })
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    assert.equal(config.uplinks.npmjs.url, 'https://registry.npmjs.org/')
    assert.equal(config.packages['@clawdsh/*'].publish, '$all')
    assert.equal(config.packages['@*/*'].publish, '$authenticated')
    assert.equal(config.packages['**'].publish, '$authenticated')

    const userconfig = join(fixture.temporary, 'local.npmrc')
    let requested
    await writeTemporaryRegistryUser({
      registry: 'http://127.0.0.1:4873/',
      output: userconfig,
      async request(url, options) {
        requested = { url: String(url), options }
        return { ok: true, status: 201, async json() { return { token: 'local-test-token-1234567890' } } }
      },
    })
    assert.match(requested.url, /^http:\/\/127\.0\.0\.1:4873\/-\/user\/org\.couchdb\.user:/)
    assert.equal(requested.options.method, 'PUT')
    assert.match(readFileSync(userconfig, 'utf8'), /^\/\/127\.0\.0\.1:4873\/:_authToken=local-test-token-1234567890\n$/)
    assert.doesNotMatch(JSON.stringify(requested), /local-test-token-1234567890/)
  } finally {
    fixture.cleanup()
  }
})
