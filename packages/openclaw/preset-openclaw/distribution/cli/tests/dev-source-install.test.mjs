import assert from 'node:assert/strict'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { temporary, write } from './fixtures.mjs'

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../../../../..')
const LINK_SCRIPT = join(REPOSITORY_ROOT, 'tools/link-clawdsh.sh')
const RUN_SCRIPT = join(REPOSITORY_ROOT, 'tools/run-clawdsh-dev.sh')

function runLink(home, publicHome, args = []) {
  return spawnSync(LINK_SCRIPT, args, {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAWDSH_DEV_HOME: home,
      DSH_HOME: publicHome,
    },
  })
}

test('source installer isolates its home and preserves the user profile patch', () => {
  const root = temporary()
  try {
    const home = join(root, 'dev-home')
    const publicHome = join(root, 'public-home')
    write(publicHome, '.clawdsh.json', '{"public":true}\n')

    const first = runLink(home, publicHome)
    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`)
    const marker = JSON.parse(readFileSync(join(home, '.clawdsh-dev.json'), 'utf8'))
    assert.equal(marker.schemaVersion, 1)
    assert.equal(marker.profileId, 'clawdsh')
    assert.equal(marker.bundle.name, '@clawdsh/dsh-dev-bundle')
    assert.equal(Object.keys(marker.links).length, 12)
    assert.deepEqual(Object.keys(marker.presets).sort(), ['clawdsh', 'clawdsh-messaging-safe'])
    const profile = JSON.parse(readFileSync(join(home, 'profiles/clawdsh/package.json'), 'utf8'))
    assert.deepEqual(profile.dsh.profile.bundles, [
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      '@clawdsh/dsh-dev-bundle',
    ])
    assert.equal(lstatSync(join(home, 'profiles/node_modules/@clawdsh/dsh-dev-bundle')).isSymbolicLink(), true)
    assert.equal(lstatSync(join(home, 'profiles/node_modules/@clawdsh/dsh-embeddings')).isSymbolicLink(), true)
    const patch = join(home, 'profiles/clawdsh/cordis.patch.yml')
    writeFileSync(patch, '- id: user-owned\n')

    const second = runLink(home, publicHome)
    assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`)
    assert.equal(readFileSync(patch, 'utf8'), '- id: user-owned\n')
    assert.equal(existsSync(join(publicHome, 'profiles/clawdsh')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('source installer refuses modified managed presets until explicit owner-only backup', () => {
  const root = temporary()
  try {
    const home = join(root, 'dev-home')
    const first = runLink(home, join(root, 'unused-public'))
    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`)
    const preset = join(home, '.agent-presets/clawdsh/preset.yml')
    writeFileSync(preset, 'name: User modified\n')
    const replacedLink = join(home, 'profiles/node_modules/@clawdsh/dsh-activity')
    unlinkSync(replacedLink)
    mkdirSync(replacedLink)
    write(replacedLink, 'user-owned.txt', 'link replacement\n')

    const refused = runLink(home, join(root, 'unused-public'))
    assert.equal(refused.status, 1)
    assert.match(refused.stderr, /--backup-modified/)
    assert.equal(readFileSync(preset, 'utf8'), 'name: User modified\n')

    const refreshed = runLink(home, join(root, 'unused-public'), ['--backup-modified'])
    assert.equal(refreshed.status, 0, `${refreshed.stdout}\n${refreshed.stderr}`)
    assert.match(refreshed.stderr, /Backed up modified development assets/)
    assert.notEqual(readFileSync(preset, 'utf8'), 'name: User modified\n')
    const backupRoot = join(home, '.clawdsh-dev-backups')
    const backup = join(backupRoot, readdirSync(backupRoot).at(0))
    assert.equal(lstatSync(backup).mode & 0o777, 0o700)
    assert.equal(readFileSync(join(backup, 'presets/clawdsh/preset.yml'), 'utf8'), 'name: User modified\n')
    const linkBackup = JSON.parse(readFileSync(join(backup, 'links.json'), 'utf8'))
    assert.equal(linkBackup.schemaVersion, 1)
    assert.deepEqual(
      linkBackup.links.find(link => link.path.endsWith('/dsh-activity')),
      {
        path: 'profiles/node_modules/@clawdsh/dsh-activity',
        kind: 'directory',
        backup: 'link-assets/profiles/node_modules/@clawdsh/dsh-activity',
      },
    )
    assert.equal(
      readFileSync(join(backup, 'link-assets/profiles/node_modules/@clawdsh/dsh-activity/user-owned.txt'), 'utf8'),
      'link replacement\n',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('source installer refuses public markers and unmarked same-name assets', () => {
  const root = temporary()
  try {
    const publicHome = join(root, 'public-home')
    write(publicHome, '.clawdsh.json', '{"schemaVersion":1}\n')
    const publicResult = runLink(publicHome, join(root, 'ignored'))
    assert.equal(publicResult.status, 1)
    assert.match(publicResult.stderr, /refusing to use public managed home/)

    const unknownHome = join(root, 'unknown-home')
    write(unknownHome, 'profiles/clawdsh/cordis.patch.yml', '- id: unknown\n')
    const unknownResult = runLink(unknownHome, join(root, 'ignored'))
    assert.equal(unknownResult.status, 1)
    assert.match(unknownResult.stderr, /refusing to take over unmarked ClawDSH development assets/)
    assert.equal(readFileSync(join(unknownHome, 'profiles/clawdsh/cordis.patch.yml'), 'utf8'), '- id: unknown\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('source installer lock excludes a concurrent refresh before it can inspect or publish assets', () => {
  const root = temporary()
  try {
    const home = join(root, 'dev-home')
    write(home, '.clawdsh-lock/owner.json', `${JSON.stringify({
      schemaVersion: 1,
      pid: process.pid,
      token: 'a'.repeat(32),
      createdAt: '2026-08-17T12:34:56.000Z',
    }, null, 2)}\n`)

    const result = runLink(home, join(root, 'unused-public'))

    assert.equal(result.status, 1)
    assert.match(result.stderr, /another ClawDSH management command is running/)
    assert.equal(existsSync(join(home, '.clawdsh-dev.json')), false)
    assert.equal(existsSync(join(home, 'profiles/clawdsh')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('source wrapper boots through the repository tsconfig while preserving an external caller directory', () => {
  const root = temporary()
  try {
    const caller = join(root, 'caller')
    mkdirSync(caller)
    const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => {
      const upper = name.toUpperCase()
      return !upper.includes('KEY') && !upper.includes('SECRET') && !upper.includes('TOKEN')
        && !upper.includes('PASSWORD') && upper !== 'DSH_HOME' && upper !== 'CLAWDSH_DEV_HOME'
    }))
    const result = spawnSync(RUN_SCRIPT, ['--dump-config'], {
      cwd: caller,
      encoding: 'utf8',
      env: {
        ...environment,
        CLAWDSH_DEV_HOME: 'dev-home',
        DSH_HOME: join(root, 'public-home-must-remain-unused'),
      },
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /@clawdsh\/dsh-product-runtime/)
    assert.equal(existsSync(join(caller, 'dev-home/.clawdsh-dev.json')), true)
    assert.equal(existsSync(join(root, 'public-home-must-remain-unused')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
