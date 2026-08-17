import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { HELP, parseArgs } from '../lib/args.mjs'
import { resolveHome, runCli } from '../lib/index.mjs'
import { createBundleFixture, fakeProfileNpmRunner, temporary } from './fixtures.mjs'

test('parses the fixed command surface and forwards only web bind flags verbatim', () => {
  assert.deepEqual(parseArgs([]), { mode: 'init-start', profile: 'clawdsh', forwarded: [] })
  assert.deepEqual(parseArgs(['start', '--profile', 'custom', '--host=127.0.0.1', '--port', '8080', '--trusted-host', 'x']), {
    mode: 'start',
    profile: 'custom',
    forwarded: ['--host=127.0.0.1', '--port', '8080', '--trusted-host', 'x'],
  })
  assert.deepEqual(parseArgs(['init', '--reset-preset']), { mode: 'init', resetPreset: true })
  assert.deepEqual(parseArgs(['migrate', 'source']), {
    mode: 'migrate-source', apply: false, backupModified: false,
  })
  assert.deepEqual(parseArgs(['migrate', 'source', '--apply']), {
    mode: 'migrate-source', apply: true, backupModified: false,
  })
  assert.deepEqual(parseArgs(['migrate', 'source', '--backup-modified', '--apply']), {
    mode: 'migrate-source', apply: true, backupModified: true,
  })
  assert.deepEqual(parseArgs(['channel', 'install']), { mode: 'channel-install' })
  assert.deepEqual(parseArgs(['channel', 'doctor']), { mode: 'channel-doctor' })
  assert.throws(() => parseArgs(['start', '--patch', 'escape.yml']), /unknown ClawDSH option/)
  assert.throws(() => parseArgs(['start', '--profile', '../escape']), /invalid name/)
  assert.throws(() => parseArgs(['--port', '1', '--port', '2']), /only once/)
  assert.throws(() => parseArgs(['migrate', 'source', '--backup-modified']), /requires --apply/)
  assert.throws(() => parseArgs(['migrate', 'source', '--apply', '--apply']), /usage: clawdsh migrate source/)
  assert.match(HELP, /clawdsh migrate source \[--apply \[--backup-modified\]\]/)
})

test('resolves DSH_HOME with the same blank and tilde semantics as dsh', () => {
  assert.equal(resolveHome({ DSH_HOME: '' }), join(homedir(), '.dsh'))
  assert.equal(resolveHome({ DSH_HOME: '   ' }), join(homedir(), '.dsh'))
  assert.equal(resolveHome({ DSH_HOME: '~' }), homedir())
  assert.equal(resolveHome({ DSH_HOME: '~/clawdsh-home' }), join(homedir(), 'clawdsh-home'))
})

test('no-argument launch initializes managed ClawDSH before invoking exact dsh arguments', async () => {
  const root = temporary()
  try {
    const home = join(root, 'home')
    const bundleRoot = createBundleFixture(root)
    const npmCalls = []
    const dshCalls = []
    const exit = await runCli(['--host', '127.0.0.1', '--trusted-host=local.test'], {
      home,
      bundleRoot,
      npmRunner: fakeProfileNpmRunner(bundleRoot, npmCalls),
      dshBinary: '/exact/deepseek/dsh/lib/bin.js',
      dshRunner: invocation => {
        dshCalls.push(invocation)
        return 7
      },
      out: () => {},
      warn: () => {},
    })
    assert.equal(exit, 7)
    assert.equal(npmCalls.length, 1)
    assert.deepEqual(dshCalls, [{
      binary: '/exact/deepseek/dsh/lib/bin.js',
      profile: 'clawdsh',
      forwarded: ['--host', '127.0.0.1', '--trusted-host=local.test'],
      home,
    }])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('custom start never initializes or takes ownership of that profile', async () => {
  const root = temporary()
  try {
    const home = join(root, 'home')
    const bundleRoot = createBundleFixture(root)
    let npmCalled = false
    let launched
    const exit = await runCli(['start', '--profile', 'custom', '--port=9000'], {
      home,
      bundleRoot,
      npmRunner: () => { npmCalled = true },
      dshBinary: '/exact/dsh.js',
      dshRunner: invocation => {
        launched = invocation
        return 0
      },
      out: () => {},
    })
    assert.equal(exit, 0)
    assert.equal(npmCalled, false)
    assert.equal(launched.profile, 'custom')
    assert.deepEqual(launched.forwarded, ['--port=9000'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
