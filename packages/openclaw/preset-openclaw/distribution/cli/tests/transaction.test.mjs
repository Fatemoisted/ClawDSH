import assert from 'node:assert/strict'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  acquireManagementLock,
  beginTransaction,
  commitTransaction,
  recoverTransactions,
} from '../lib/transaction.mjs'
import { temporary, write } from './fixtures.mjs'

test('startup recovery rolls back a publication interrupted before the marker', () => {
  const root = temporary()
  try {
    const home = join(root, 'home')
    const tx = beginTransaction(home, 'crash')
    const target = write(home, 'profiles/clawdsh/package.json', 'old\n')
    const candidate = write(tx.candidateRoot, 'profile.json', 'new\n')
    write(tx.candidateRoot, 'marker.json', '{}\n')
    const backup = join(tx.backupRoot, '000-file')
    const journal = {
      schemaVersion: 1,
      state: 'publishing',
      markerIndex: 1,
      operations: [
        { target: 'profiles/clawdsh/package.json', candidate: 'profile.json', backup: '000-file', kind: 'file' },
        { target: '.clawdsh.json', candidate: 'marker.json', backup: '001-file', kind: 'file' },
      ],
    }
    write(tx.transaction, 'journal.json', `${JSON.stringify(journal, null, 2)}\n`)
    renameSync(target, backup)
    renameSync(candidate, target)
    assert.deepEqual(recoverTransactions(home), ['rolled-back'])
    assert.equal(readFileSync(target, 'utf8'), 'old\n')
    assert.equal(existsSync(tx.transaction), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('startup recovery keeps a transaction whose marker was published last', () => {
  const root = temporary()
  try {
    const home = join(root, 'home')
    const tx = beginTransaction(home, 'committed')
    const candidate = write(tx.candidateRoot, 'marker.json', '{"committed":true}\n')
    write(tx.transaction, 'journal.json', `${JSON.stringify({
      schemaVersion: 1,
      state: 'publishing',
      markerIndex: 0,
      operations: [{ target: '.clawdsh.json', candidate: 'marker.json', backup: '000-file', kind: 'file' }],
    }, null, 2)}\n`)
    renameSync(candidate, join(home, '.clawdsh.json'))
    assert.deepEqual(recoverTransactions(home), ['committed'])
    assert.deepEqual(JSON.parse(readFileSync(join(home, '.clawdsh.json'))), { committed: true })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('management lock excludes a concurrent command and can be acquired again after release', () => {
  const root = temporary()
  try {
    const home = join(root, 'home')
    const release = acquireManagementLock(home)
    assert.throws(() => acquireManagementLock(home), /another ClawDSH management command is running/)
    release()
    const releaseAgain = acquireManagementLock(home)
    releaseAgain()
    assert.equal(existsSync(join(home, '.clawdsh-lock')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('management lock reclaims an incomplete abandoned acquisition after its grace period', () => {
  const root = temporary()
  try {
    const home = join(root, 'home')
    mkdirSync(join(home, '.clawdsh-lock'), { recursive: true })
    const release = acquireManagementLock(home, { now: () => Date.now() + 1_000, incompleteGraceMs: 0 })
    release()
    assert.equal(existsSync(join(home, '.clawdsh-lock')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('transaction rejects unmanaged targets before publishing any candidate', () => {
  const root = temporary()
  try {
    const home = join(root, 'home')
    const tx = beginTransaction(home, 'allowlist')
    write(tx.candidateRoot, 'credential.json', 'replacement\n')
    write(tx.candidateRoot, 'marker.json', '{}\n')
    assert.throws(() => commitTransaction(tx, [
      { target: '.credentials.yaml', candidate: 'credential.json', kind: 'file' },
      { target: '.clawdsh.json', candidate: 'marker.json', kind: 'file' },
    ]), /not an allowed managed target/)
    assert.equal(existsSync(join(home, '.credentials.yaml')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('transaction rejects a symbolic-link parent that would publish outside DSH_HOME', () => {
  const root = temporary()
  try {
    const home = join(root, 'home')
    const outside = join(root, 'outside')
    const tx = beginTransaction(home, 'parent-link')
    mkdirSync(join(tx.candidateRoot, 'profile'))
    write(tx.candidateRoot, 'profile/package.json', '{}\n')
    write(tx.candidateRoot, 'marker.json', '{}\n')
    mkdirSync(outside)
    symlinkSync(outside, join(home, 'profiles'), 'dir')
    assert.throws(() => commitTransaction(tx, [
      { target: 'profiles/clawdsh', candidate: 'profile', kind: 'directory' },
      { target: '.clawdsh.json', candidate: 'marker.json', kind: 'file' },
    ]), /parent must be an ordinary directory/)
    assert.equal(existsSync(join(outside, 'clawdsh')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('transaction treats a dangling symbolic link as an existing unsafe target', () => {
  const root = temporary()
  try {
    const home = join(root, 'home')
    const tx = beginTransaction(home, 'dangling-target')
    write(tx.candidateRoot, 'profile.json', '{"managed":true}\n')
    write(tx.candidateRoot, 'marker.json', '{}\n')
    const target = join(home, 'profiles/clawdsh/package.json')
    mkdirSync(join(home, 'profiles/clawdsh'), { recursive: true })
    symlinkSync('missing-package.json', target)
    assert.throws(() => commitTransaction(tx, [
      { target: 'profiles/clawdsh/package.json', candidate: 'profile.json', kind: 'file' },
      { target: '.clawdsh.json', candidate: 'marker.json', kind: 'file' },
    ]), /unsafe filesystem type/)
    assert.equal(lstatSync(target).isSymbolicLink(), true)
    assert.equal(readlinkSync(target), 'missing-package.json')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
