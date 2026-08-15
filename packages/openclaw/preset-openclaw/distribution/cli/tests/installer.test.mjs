import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { createInstaller, defaultNpmRunner, readMarker } from '../lib/installer.mjs'
import { createBundleFixture, fakeProfileNpmRunner, temporary, write } from './fixtures.mjs'

test('default profile install pins public registries for every managed package scope', () => {
  let invocation
  defaultNpmRunner('/managed-profile', (command, args, options) => {
    invocation = { command, args, options }
    return { status: 0, signal: null }
  })
  assert.equal(invocation.command, 'npm')
  assert.deepEqual(invocation.args.slice(-3), [
    '--registry=https://registry.npmjs.org/',
    '--@clawdsh:registry=https://registry.npmjs.org/',
    '--@deepseek-ai:registry=https://registry.npmjs.org/',
  ])
  assert.equal(invocation.options.cwd, '/managed-profile')
})

test('installs exact profile layers and remains idempotent while preserving user data', () => {
  const root = temporary()
  try {
    const home = join(root, 'home')
    const bundle = createBundleFixture(root)
    const calls = []
    const messages = []
    const installer = createInstaller({
      home,
      bundleRoot: bundle,
      npmRunner: fakeProfileNpmRunner(bundle, calls),
      out: message => messages.push(message),
    })
    installer.init()
    const profile = JSON.parse(readFileSync(join(home, 'profiles/clawdsh/package.json'), 'utf8'))
    assert.deepEqual(profile.dependencies, {
      '@deepseek-ai/dsh-base': '0.1.0-rc.6',
      '@deepseek-ai/dsh-web-app': '0.1.0-rc.6',
      '@clawdsh/dsh-bundle': '0.1.0-rc.1',
    })
    assert.deepEqual(profile.dsh.profile.bundles, [
      '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@clawdsh/dsh-bundle',
    ])
    for (const layer of ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@clawdsh/dsh-bundle']) {
      assert.ok(existsSync(join(home, 'profiles/clawdsh/node_modules', layer, 'package.json')))
    }
    writeFileSync(join(home, 'profiles/clawdsh/cordis.patch.yml'), '- id: user-owned\n')
    for (const path of ['settings.yaml', '.credentials.yaml', 'memory/facts.md', 'skills/local/SKILL.md']) {
      write(home, path, `preserve-${path}\n`)
    }
    const firstMarker = readFileSync(join(home, '.clawdsh.json'))
    installer.init()
    assert.equal(calls.length, 1)
    assert.deepEqual(readFileSync(join(home, '.clawdsh.json')), firstMarker)
    assert.equal(readFileSync(join(home, 'profiles/clawdsh/cordis.patch.yml'), 'utf8'), '- id: user-owned\n')
    assert.equal(readFileSync(join(home, '.credentials.yaml'), 'utf8'), 'preserve-.credentials.yaml\n')
    assert.match(messages.at(-1), /already initialized/)
    installer.doctor()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('refuses modified presets, then backs them up before explicit reset', () => {
  const root = temporary()
  try {
    const home = join(root, 'home')
    const bundle = createBundleFixture(root)
    const calls = []
    const warnings = []
    const dates = [new Date('2026-08-15T12:34:56Z')]
    const installer = createInstaller({
      home,
      bundleRoot: bundle,
      npmRunner: fakeProfileNpmRunner(bundle, calls),
      now: () => dates[0],
      warn: message => warnings.push(message),
    })
    installer.init()
    const preset = join(home, '.agent-presets/clawdsh/preset.yml')
    writeFileSync(preset, 'name: User changed this\n')
    assert.throws(() => installer.init(), /was modified.*--reset-preset/)
    installer.init({ resetPreset: true })
    assert.equal(readFileSync(preset, 'utf8'), 'name: ClawDSH 模式\n')
    const backup = warnings.find(message => message.includes('clawdsh.backup-'))
    assert.match(backup, /20260815T123456Z/)
    const backupPath = backup.match(/to (.+)\.$/)[1]
    assert.equal(readFileSync(join(backupPath, 'preset.yml'), 'utf8'), 'name: User changed this\n')
    assert.equal(calls.length, 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('refuses an unmarked same-name preset until explicit backup and reset', () => {
  const root = temporary()
  try {
    const home = join(root, 'home')
    const bundle = createBundleFixture(root)
    const preset = write(home, '.agent-presets/clawdsh/preset.yml', 'name: User-owned preset\n')
    const warnings = []
    const installer = createInstaller({
      home,
      bundleRoot: bundle,
      npmRunner: fakeProfileNpmRunner(bundle, []),
      now: () => new Date('2026-08-15T12:34:56Z'),
      warn: message => warnings.push(message),
    })
    assert.throws(() => installer.init(), /refusing to take over unmarked preset/)
    installer.init({ resetPreset: true })
    assert.equal(readFileSync(preset, 'utf8'), 'name: ClawDSH 模式\n')
    const backup = warnings.find(message => message.includes('clawdsh.backup-'))
    const backupPath = backup.match(/to (.+)\.$/)[1]
    assert.equal(readFileSync(join(backupPath, 'preset.yml'), 'utf8'), 'name: User-owned preset\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('refuses takeover of an unmarked same-name profile and only warns for legacy assets', () => {
  const root = temporary()
  try {
    const home = join(root, 'home')
    const bundle = createBundleFixture(root)
    mkdirSync(join(home, 'profiles/clawdsh'), { recursive: true })
    write(home, 'profiles/clawdsh/package.json', '{}\n')
    const installer = createInstaller({ home, bundleRoot: bundle, npmRunner: () => {} })
    assert.throws(() => installer.init(), /refusing to take over unmarked profile/)

    rmSync(join(home, 'profiles/clawdsh'), { recursive: true })
    mkdirSync(join(home, 'profiles/openclaw'), { recursive: true })
    const warnings = []
    createInstaller({
      home,
      bundleRoot: bundle,
      npmRunner: fakeProfileNpmRunner(bundle, []),
      warn: message => warnings.push(message),
    }).init()
    assert.ok(warnings.some(message => /legacy OpenClaw profile/.test(message)))
    assert.ok(existsSync(join(home, 'profiles/openclaw')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('refuses a preset parent symlink before reset can back up outside DSH_HOME', () => {
  const root = temporary()
  try {
    const home = join(root, 'home')
    const outside = join(root, 'outside-presets')
    const bundle = createBundleFixture(root)
    mkdirSync(home, { recursive: true })
    mkdirSync(outside)
    write(outside, 'clawdsh/preset.yml', 'name: Outside preset\n')
    symlinkSync(outside, join(home, '.agent-presets'), 'dir')
    const installer = createInstaller({
      home,
      bundleRoot: bundle,
      npmRunner: fakeProfileNpmRunner(bundle, []),
    })
    assert.throws(() => installer.init({ resetPreset: true }), /parent must be an ordinary directory/)
    assert.deepEqual(readdirSync(outside), ['clawdsh'])
    assert.equal(readFileSync(join(outside, 'clawdsh/preset.yml'), 'utf8'), 'name: Outside preset\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('doctor reports managed damage without reading unrelated credential files', () => {
  const root = temporary()
  try {
    const home = join(root, 'home')
    const bundle = createBundleFixture(root)
    const installer = createInstaller({
      home,
      bundleRoot: bundle,
      npmRunner: fakeProfileNpmRunner(bundle, []),
    })
    installer.init()
    write(home, '.credentials.yaml', 'credential-doctor-canary-7731\n')
    writeFileSync(join(home, '.agent-presets/clawdsh/preset.yml'), 'damaged\n')
    assert.throws(
      () => installer.doctor(),
      error => !String(error).includes('credential-doctor-canary-7731') && /preset clawdsh digest differs/.test(String(error)),
    )
    assert.equal(readMarker(home).channel.status, 'not-installed')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('doctor verifies every bundle-declared runtime and web asset', () => {
  const root = temporary()
  try {
    const home = join(root, 'home')
    const bundle = createBundleFixture(root)
    const installer = createInstaller({
      home,
      bundleRoot: bundle,
      npmRunner: fakeProfileNpmRunner(bundle, []),
    })
    installer.init()
    const installed = join(home, 'profiles/clawdsh/node_modules/@clawdsh/dsh-bundle')
    writeFileSync(join(installed, 'web/assets/app.js'), 'globalThis.__CLAWDSH__ = false\n')
    assert.throws(() => installer.doctor(), /bundle asset digest mismatch.*web\/assets\/app\.js/)
    writeFileSync(join(installed, 'web/assets/app.js'), 'globalThis.__CLAWDSH__ = true\n')
    writeFileSync(join(installed, 'lib/index.mjs'), 'export default undefined\n')
    assert.throws(() => installer.doctor(), /bundle asset digest mismatch.*lib\/index\.mjs/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('doctor rejects a changed exact DSH profile layer', () => {
  const root = temporary()
  try {
    const home = join(root, 'home')
    const bundle = createBundleFixture(root)
    const installer = createInstaller({
      home,
      bundleRoot: bundle,
      npmRunner: fakeProfileNpmRunner(bundle, []),
    })
    installer.init()
    const base = join(home, 'profiles/clawdsh/node_modules/@deepseek-ai/dsh-base/package.json')
    writeFileSync(base, `${JSON.stringify({ name: '@deepseek-ai/dsh-base', version: '0.1.0-rc.5' })}\n`)
    assert.throws(() => installer.doctor(), /dsh-base@0\.1\.0-rc\.6/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
