import assert from 'node:assert/strict'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { createInstaller } from '../lib/installer.mjs'
import { runCli } from '../lib/index.mjs'
import { beginTransaction } from '../lib/transaction.mjs'
import {
  inspectSourceInstallation,
  sourceMigrationInternals,
} from '../lib/source-migration.mjs'
import { createBundleFixture, fakeProfileNpmRunner, temporary, write } from './fixtures.mjs'

const ASSEMBLY_ROOT = resolve(import.meta.dirname, '../../..')
const PRIMARY_PRESET_SOURCE = ASSEMBLY_ROOT
const SAFE_PRESET_SOURCE = resolve(ASSEMBLY_ROOT, '../preset-clawdsh-messaging-safe')
const DEV_PATCH_SOURCE = join(ASSEMBLY_ROOT, 'profile/dev-bundle/cordis.patch.yml')
const PRESET_FILES = ['agent.cordis.yml', 'preset.yml', 'souls/assistant.md']

function copyPresetFiles(source, destination) {
  for (const logical of PRESET_FILES) write(destination, logical, readFileSync(join(source, logical)))
}

function createHistoricalSource(home, checkout) {
  write(home, 'profiles/clawdsh/package.json', `${JSON.stringify(sourceMigrationInternals.LEGACY_MANIFEST, null, 2)}\n`)
  const legacyPatch = readFileSync(DEV_PATCH_SOURCE, 'utf8').replace(
    /^.*\n/,
    '# ClawDSH「clawdsh」profile 层（复制到 $DSH_HOME/profiles/clawdsh/ 后生效）。\n',
  )
  write(home, 'profiles/clawdsh/cordis.patch.yml', legacyPatch)
  copyPresetFiles(PRIMARY_PRESET_SOURCE, join(home, '.agent-presets/clawdsh'))
  copyPresetFiles(SAFE_PRESET_SOURCE, join(home, '.agent-presets/clawdsh-messaging-safe'))
  for (const [logical, identity] of Object.entries(sourceMigrationInternals.LEGACY_LINKS)) {
    const target = join(checkout, identity.suffix)
    write(target, 'package.json', `${JSON.stringify({ name: identity.name, version: '0.1.0-rc.1' })}\n`)
    const link = join(home, logical)
    mkdirSync(dirname(link), { recursive: true })
    symlinkSync(target, link, 'dir')
  }
}

test('dry-run recognizes the closed historical layout without writing migration state', () => {
  const root = temporary()
  try {
    const home = join(root, 'home')
    createHistoricalSource(home, join(root, 'checkout'))
    const bundle = createBundleFixture(root)
    const messages = []
    const installer = createInstaller({
      home,
      bundleRoot: bundle,
      npmRunner: () => { throw new Error('dry-run must not install packages') },
      out: message => messages.push(message),
    })

    assert.deepEqual(installer.migrateSource(), { status: 'ready', modified: [] })
    assert.match(messages.join('\n'), /migrate source --apply/)
    assert.equal(existsSync(join(home, '.clawdsh.json')), false)
    assert.equal(existsSync(join(home, '.clawdsh-backups')), false)
    assert.equal(existsSync(join(home, '.clawdsh-staging')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('public CLI keeps dry-run lock-free and locks the apply operation', async () => {
  const root = temporary()
  try {
    const home = join(root, 'home')
    createHistoricalSource(home, join(root, 'checkout'))
    const bundle = createBundleFixture(root)
    const output = []
    assert.equal(await runCli(['migrate', 'source'], {
      home,
      bundleRoot: bundle,
      npmRunner: () => { throw new Error('dry-run must not install packages') },
      out: message => output.push(message),
    }), 0)
    assert.equal(existsSync(join(home, '.clawdsh-lock')), false)
    assert.match(output.join('\n'), /migrate source --apply/)

    assert.equal(await runCli(['migrate', 'source', '--apply'], {
      home,
      bundleRoot: bundle,
      npmRunner: fakeProfileNpmRunner(bundle, []),
      now: () => new Date('2026-08-17T12:34:56Z'),
      out: () => {},
    }), 0)
    assert.equal(existsSync(join(home, '.clawdsh-lock')), false)
    assert.equal(JSON.parse(readFileSync(join(home, '.clawdsh.json'), 'utf8')).schemaVersion, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ordinary init names the exact migration command for clean and modified source layouts', () => {
  const root = temporary()
  try {
    const home = join(root, 'home')
    createHistoricalSource(home, join(root, 'checkout'))
    const bundle = createBundleFixture(root)
    const installer = createInstaller({ home, bundleRoot: bundle, npmRunner: () => {} })
    assert.throws(
      () => installer.init(),
      /run `clawdsh migrate source --apply`$/,
    )
    writeFileSync(join(home, 'profiles/clawdsh/cordis.patch.yml'), '- id: modified\n')
    assert.throws(
      () => installer.init(),
      /run `clawdsh migrate source --apply --backup-modified`$/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('migration backs up source assets, removes only known links, and preserves product data', () => {
  const root = temporary()
  try {
    const home = join(root, 'home')
    createHistoricalSource(home, join(root, 'checkout'))
    const bundle = createBundleFixture(root)
    for (const path of [
      'settings.yaml',
      '.credentials.yaml',
      'memory/facts.md',
      'sessions/session.jsonl',
      'skills/local/SKILL.md',
      'clawdsh/channel/openclaw/state/openclaw.json',
    ]) write(home, path, `migration-canary:${path}\n`)
    const extraLinkTarget = join(root, 'extra-package')
    mkdirSync(extraLinkTarget)
    const extraLink = join(home, 'profiles/node_modules/@clawdsh/user-owned-extra')
    symlinkSync(extraLinkTarget, extraLink, 'dir')
    const calls = []
    const installer = createInstaller({
      home,
      bundleRoot: bundle,
      npmRunner: fakeProfileNpmRunner(bundle, calls),
      now: () => new Date('2026-08-17T12:34:56Z'),
    })

    const result = installer.migrateSource({ apply: true })

    assert.equal(result.status, 'migrated')
    assert.equal(calls.length, 1)
    assert.equal(lstatSync(result.backup).mode & 0o777, 0o700)
    assert.equal(readFileSync(join(result.backup, 'profile/cordis.patch.yml'), 'utf8').startsWith('# ClawDSH'), true)
    const backup = JSON.parse(readFileSync(join(result.backup, 'source-backup.json'), 'utf8'))
    assert.equal(backup.schemaVersion, 1)
    assert.equal(backup.links.length, 11)
    assert.deepEqual(backup.modified, [])
    assert.deepEqual(JSON.parse(readFileSync(join(home, '.clawdsh.json'), 'utf8')).schemaVersion, 1)
    assert.equal(
      readFileSync(join(home, 'profiles/clawdsh/cordis.patch.yml'), 'utf8'),
      '# User-owned ClawDSH profile overrides. This file is never replaced by the ClawDSH installer.\n[]\n',
    )
    for (const logical of Object.keys(sourceMigrationInternals.LEGACY_LINKS)) {
      assert.equal(existsSync(join(home, logical)), false)
    }
    assert.equal(lstatSync(extraLink).isSymbolicLink(), true)
    for (const path of [
      'settings.yaml',
      '.credentials.yaml',
      'memory/facts.md',
      'sessions/session.jsonl',
      'skills/local/SKILL.md',
      'clawdsh/channel/openclaw/state/openclaw.json',
    ]) assert.equal(readFileSync(join(home, path), 'utf8'), `migration-canary:${path}\n`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('modified source assets require explicit backup consent', () => {
  const root = temporary()
  try {
    const home = join(root, 'home')
    createHistoricalSource(home, join(root, 'checkout'))
    writeFileSync(join(home, 'profiles/clawdsh/cordis.patch.yml'), '- id: user-modified\n')
    writeFileSync(join(home, '.agent-presets/clawdsh/preset.yml'), 'name: User modified\n')
    const bundle = createBundleFixture(root)
    const installer = createInstaller({
      home,
      bundleRoot: bundle,
      npmRunner: fakeProfileNpmRunner(bundle, []),
      now: () => new Date('2026-08-17T12:34:56Z'),
    })

    const inspection = inspectSourceInstallation(home)
    assert.equal(inspection.kind, 'known')
    if (inspection.kind !== 'known') throw new Error('expected recognized source installation')
    assert.deepEqual(inspection.modified, ['profile cordis.patch.yml', 'preset clawdsh'])
    assert.throws(
      () => installer.migrateSource({ apply: true }),
      /--apply --backup-modified/,
    )
    assert.equal(readFileSync(join(home, 'profiles/clawdsh/cordis.patch.yml'), 'utf8'), '- id: user-modified\n')
    const migrated = installer.migrateSource({ apply: true, backupModified: true })
    assert.equal(readFileSync(join(migrated.backup, 'profile/cordis.patch.yml'), 'utf8'), '- id: user-modified\n')
    assert.equal(readFileSync(join(migrated.backup, 'presets/clawdsh/preset.yml'), 'utf8'), 'name: User modified\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('migration refuses source edits that arrive after backup while npm prepares the candidate', () => {
  const root = temporary()
  try {
    const home = join(root, 'home')
    createHistoricalSource(home, join(root, 'checkout'))
    const bundle = createBundleFixture(root)
    const patch = join(home, 'profiles/clawdsh/cordis.patch.yml')
    const originalPatch = readFileSync(patch, 'utf8')
    const populateCandidate = fakeProfileNpmRunner(bundle, [])
    const installer = createInstaller({
      home,
      bundleRoot: bundle,
      npmRunner(profile) {
        populateCandidate(profile)
        writeFileSync(patch, '- id: edit-during-candidate-install\n')
      },
      now: () => new Date('2026-08-17T12:34:56Z'),
    })

    assert.throws(
      () => installer.migrateSource({ apply: true }),
      /source assets changed after their migration backup/,
    )
    assert.equal(readFileSync(patch, 'utf8'), '- id: edit-during-candidate-install\n')
    assert.equal(existsSync(join(home, '.clawdsh.json')), false)
    const backupRoot = join(home, '.clawdsh-backups')
    const backup = join(backupRoot, readdirSync(backupRoot).at(0))
    assert.equal(readFileSync(join(backup, 'profile/cordis.patch.yml'), 'utf8'), originalPatch)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('manifest byte drift is classified as a modification even when its JSON identity is unchanged', () => {
  const root = temporary()
  try {
    const home = join(root, 'home')
    createHistoricalSource(home, join(root, 'checkout'))
    const manifest = join(home, 'profiles/clawdsh/package.json')
    writeFileSync(manifest, JSON.stringify(sourceMigrationInternals.LEGACY_MANIFEST))

    const inspection = inspectSourceInstallation(home)
    assert.equal(inspection.kind, 'known')
    if (inspection.kind !== 'known') throw new Error('expected recognized source installation')
    assert.deepEqual(inspection.modified, ['profile package.json'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('unknown source layouts fail closed without backups or marker writes', () => {
  const root = temporary()
  try {
    const home = join(root, 'home')
    write(home, 'profiles/clawdsh/package.json', '{}\n')
    const bundle = createBundleFixture(root)
    const installer = createInstaller({ home, bundleRoot: bundle, npmRunner: () => {} })
    assert.throws(() => installer.migrateSource(), /refusing unknown ClawDSH source layout/)
    assert.throws(() => installer.init(), /refusing to take over unmarked ClawDSH source assets/)
    assert.equal(existsSync(join(home, '.clawdsh.json')), false)
    assert.equal(existsSync(join(home, '.clawdsh-backups')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('migration refuses a backup parent symlink before publishing managed assets', () => {
  const root = temporary()
  try {
    const home = join(root, 'home')
    createHistoricalSource(home, join(root, 'checkout'))
    const outside = join(root, 'outside-backups')
    mkdirSync(outside)
    symlinkSync(outside, join(home, '.clawdsh-backups'), 'dir')
    const bundle = createBundleFixture(root)
    const installer = createInstaller({
      home,
      bundleRoot: bundle,
      npmRunner: fakeProfileNpmRunner(bundle, []),
      now: () => new Date('2026-08-17T12:34:56Z'),
    })

    assert.throws(() => installer.migrateSource({ apply: true }), /parent must be an ordinary directory/)
    assert.deepEqual(readdirSync(outside), [])
    assert.equal(existsSync(join(home, '.clawdsh.json')), false)
    assert.equal(inspectSourceInstallation(home).kind, 'known')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('apply recovers an interrupted marker-last migration before classifying source ownership', () => {
  const root = temporary()
  try {
    const home = join(root, 'home')
    createHistoricalSource(home, join(root, 'checkout'))
    const tx = beginTransaction(home, 'interrupted-source-migration')
    write(tx.candidateRoot, 'profile/package.json', '{"name":"managed-candidate"}\n')
    write(tx.candidateRoot, 'marker.json', '{"candidate":true}\n')
    write(tx.transaction, 'journal.json', `${JSON.stringify({
      schemaVersion: 1,
      state: 'publishing',
      markerIndex: 1,
      operations: [
        {
          target: 'profiles/clawdsh',
          candidate: 'profile',
          backup: '000-directory',
          kind: 'directory',
          action: 'replace',
        },
        {
          target: '.clawdsh.json',
          candidate: 'marker.json',
          backup: '001-file',
          kind: 'file',
          action: 'replace',
        },
      ],
    }, null, 2)}\n`)
    renameSync(join(home, 'profiles/clawdsh'), join(tx.backupRoot, '000-directory'))
    renameSync(join(tx.candidateRoot, 'profile'), join(home, 'profiles/clawdsh'))
    const bundle = createBundleFixture(root)
    const installer = createInstaller({
      home,
      bundleRoot: bundle,
      npmRunner: fakeProfileNpmRunner(bundle, []),
      now: () => new Date('2026-08-17T12:34:56Z'),
    })

    const result = installer.migrateSource({ apply: true })
    assert.equal(result.status, 'migrated')
    assert.equal(existsSync(tx.transaction), false)
    assert.equal(JSON.parse(readFileSync(join(home, '.clawdsh.json'), 'utf8')).schemaVersion, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
