import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { BOOTSTRAP_INDEX_FILENAME, canonicalBootstrapJson } from './bootstrap-contract.mjs'
import { packBootstrap } from './bootstrap-pack.mjs'
import { bootstrapAttestation } from './bootstrap-publication.mjs'
import { runCleanInstallSmoke, verifyClawdshBrowser, verifyClawdshPage } from './clean-install-smoke.mjs'
import { assertReleaseReadiness } from './release-readiness.mjs'
import { createReleaseFixture, packedRelease } from './release-fixture.mjs'
import { writeTemporaryRegistryConfig } from './temporary-registry-config.mjs'
import { writeTemporaryRegistryUser } from './temporary-registry-user.mjs'

function createBootstrapEvidence(fixture) {
  const directory = join(fixture.temporary, 'bootstrap')
  const index = packBootstrap({ repositoryRoot: fixture.repository, outputDirectory: directory })
  const indexPath = join(directory, BOOTSTRAP_INDEX_FILENAME)
  const attestationPath = join(fixture.temporary, 'bootstrap-attestation.json')
  const states = index.packages.map(entry => ({
    name: entry.name,
    state: 'verified',
    integrity: entry.integrity,
  }))
  writeFileSync(attestationPath, canonicalBootstrapJson(bootstrapAttestation(readFileSync(indexPath), states)))
  return { bootstrapIndex: indexPath, bootstrapAttestation: attestationPath }
}

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
    const bootstrapEvidence = createBootstrapEvidence(fixture)
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
    assert.equal(result.browserRuntimeVerified, true)
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
      ...bootstrapEvidence,
      releaseIndex: join(releaseDirectory, 'release-index.json'),
      smokeAttestation: attestationPath,
    }).publish, true)
    assert.throws(() => assertReleaseReadiness({
      publishRequested: true,
      githubRef: 'refs/heads/clawdsh',
      repositoryPrivate: true,
      confirmations,
      ...bootstrapEvidence,
      releaseIndex: join(releaseDirectory, 'release-index.json'),
      smokeAttestation: attestationPath,
    }), /repository is private/)
    assert.throws(() => assertReleaseReadiness({
      publishRequested: true,
      githubRef: 'refs/heads/feature',
      repositoryPrivate: false,
      confirmations,
      ...bootstrapEvidence,
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
      ...bootstrapEvidence,
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

test('product-page probe requires identity, executable assets, manifest, and icons', async () => {
  const requests = []
  await verifyClawdshPage('http://127.0.0.1:43123/clawdsh/', {
    attempts: 1,
    intervalMs: 0,
    async browserProbe() {},
    async request(url, options) {
      requests.push({ url, options })
      const pathname = new URL(url).pathname
      const fixtures = {
        '/clawdsh/': {
          type: 'text/html; charset=utf-8',
          body: '<!doctype html><title>ClawDSH</title><link rel="icon" href="/clawdsh/favicon.svg"><link rel="manifest" href="/clawdsh/manifest.webmanifest"><link rel="stylesheet" href="/clawdsh/assets/app.css"><div id="clawdsh-root"></div><script type="module" src="/clawdsh/assets/app.js"></script>',
        },
        '/clawdsh/favicon.svg': { type: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
        '/clawdsh/manifest.webmanifest': {
          type: 'application/manifest+json',
          body: JSON.stringify({
            name: 'ClawDSH',
            start_url: '/clawdsh/',
            scope: '/clawdsh/',
            icons: [{ src: '/clawdsh/favicon.svg', type: 'image/svg+xml' }],
          }),
        },
        '/clawdsh/assets/app.css': { type: 'text/css', body: ':root { color: #071a2b; }' },
        '/clawdsh/assets/app.js': { type: 'text/javascript', body: 'globalThis.__CLAWDSH__ = true' },
      }
      const fixture = fixtures[pathname]
      assert.ok(fixture, `unexpected product asset request ${pathname}`)
      return {
        status: 200,
        headers: { get(name) { return name.toLowerCase() === 'content-type' ? fixture.type : null } },
        async text() { return fixture.body },
      }
    },
  })
  assert.equal(requests.length, 5)
  assert.equal(requests[0].url, 'http://127.0.0.1:43123/clawdsh/')
  assert.equal(requests[0].options.redirect, 'error')

  await assert.rejects(() => verifyClawdshPage('http://127.0.0.1:43123/clawdsh/', {
    attempts: 1,
    intervalMs: 0,
    async browserProbe() {},
    async request() {
      return { status: 200, async text() { return '<title>Another product</title>' } }
    },
  }), /without the ClawDSH product identity markers/)
  await assert.rejects(() => verifyClawdshPage('http://127.0.0.1:43123/clawdsh/', {
    attempts: 1,
    intervalMs: 0,
    async browserProbe() {},
    async request(url) {
      if (new URL(url).pathname === '/clawdsh/') {
        return {
          status: 200,
          async text() {
            return '<title>ClawDSH</title><link rel="icon" href="/clawdsh/favicon.svg"><link rel="manifest" href="/clawdsh/manifest.webmanifest"><link rel="stylesheet" href="/clawdsh/missing.css"><div id="clawdsh-root"></div><script src="/clawdsh/app.js"></script>'
          },
        }
      }
      return { status: 404, headers: { get() { return 'text/plain' } }, async text() { return 'missing' } }
    },
  }), /ClawDSH script returned HTTP 404/)
  await assert.rejects(() => verifyClawdshPage('https://example.com/clawdsh/', {
    attempts: 1,
    intervalMs: 0,
    async request() {
      throw new Error('must not request a non-loopback URL')
    },
  }), /loopback/)
})

test('browser probe executes the native shell and rejects runtime errors', async () => {
  const listeners = new Map()
  const waitFor = []
  const closed = []
  const page = {
    on(name, listener) { listeners.set(name, listener) },
    async goto(url) { assert.equal(url, 'http://127.0.0.1:43123/clawdsh/') },
    locator(selector) {
      waitFor.push(selector)
      return { async waitFor() {} }
    },
    async waitForTimeout() {},
  }
  const loadPlaywright = () => ({
    chromium: {
      async launch() {
        return {
          async newPage() { return page },
          async close() { closed.push(true) },
        }
      },
    },
  })
  await verifyClawdshBrowser('http://127.0.0.1:43123/clawdsh/', { loadPlaywright })
  assert.deepEqual(waitFor, [
    '[data-clawdsh-shell] [data-native-app]',
    '[data-clawdsh-harness-advanced]',
  ])
  assert.equal(closed.length, 1)

  listeners.get('pageerror')(new Error('dynamic chunk crashed'))
  await assert.rejects(
    () => verifyClawdshBrowser('http://127.0.0.1:43123/clawdsh/', {
      loadPlaywright: () => ({
        chromium: {
          async launch() {
            return {
              async newPage() {
                return {
                  ...page,
                  on(name, listener) {
                    if (name === 'pageerror') listener(new Error('dynamic chunk crashed'))
                  },
                }
              },
              async close() {},
            }
          },
        },
      }),
    }),
    /pageerror/,
  )
})

test('readiness rejects stale smoke evidence and registry config publishes only the ClawDSH scope', async () => {
  const fixture = createReleaseFixture()
  try {
    const releaseDirectory = packedRelease(fixture)
    const bootstrapEvidence = createBootstrapEvidence(fixture)
    const index = readFileSync(join(releaseDirectory, 'release-index.json'))
    const attestation = join(fixture.temporary, 'attestation.json')
    writeFileSync(attestation, JSON.stringify({
      version: 2,
      releaseVersion: '0.1.0-rc.1',
      dshVersion: '0.1.0-rc.6',
      cliStarted: true,
      productPageVerified: true,
      browserRuntimeVerified: true,
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
      ...bootstrapEvidence,
      releaseIndex: join(releaseDirectory, 'release-index.json'),
      smokeAttestation: attestation,
    }), /does not match/)

    const staleBootstrapAttestation = join(fixture.temporary, 'stale-bootstrap-attestation.json')
    const bootstrap = JSON.parse(readFileSync(bootstrapEvidence.bootstrapAttestation, 'utf8'))
    bootstrap.bootstrapIndexIntegrity += 'stale'
    writeFileSync(staleBootstrapAttestation, canonicalBootstrapJson(bootstrap))
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
      bootstrapIndex: bootstrapEvidence.bootstrapIndex,
      bootstrapAttestation: staleBootstrapAttestation,
      releaseIndex: join(releaseDirectory, 'release-index.json'),
      smokeAttestation: attestation,
    }), /bootstrap attestation identity is invalid/)

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
