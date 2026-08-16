import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { auditSecretHistory } from './secret-history-audit.mjs'

function git(repository, ...arguments_) {
  return execFileSync('git', arguments_, { cwd: repository, encoding: 'utf8' }).trim()
}

function commit(repository, message) {
  git(repository, 'add', '--all')
  git(repository, 'commit', '-m', message)
  return git(repository, 'rev-parse', 'HEAD')
}

function encryptedPrivateKeyMarker() {
  return ['-----BEGIN ENCRYPTED PRIVATE ', 'KEY-----'].join('')
}

function repositoryFixture() {
  const temporary = mkdtempSync(join(tmpdir(), 'clawdsh-secret-history-'))
  const repository = join(temporary, 'repository')
  mkdirSync(repository)
  git(repository, 'init', '--initial-branch=master')
  git(repository, 'config', 'user.name', 'ClawDSH test')
  git(repository, 'config', 'user.email', 'test@clawdsh.invalid')
  writeFileSync(join(repository, 'upstream.txt'), 'upstream baseline\n')
  const base = commit(repository, 'upstream baseline')
  return { temporary, repository, base }
}

test('secret-history audit scans only introduced ClawDSH blobs', () => {
  const fixture = repositoryFixture()
  try {
    const empty = auditSecretHistory({ repositoryRoot: fixture.repository, base: fixture.base })
    assert.equal(empty.commits, 0)
    assert.equal(empty.blobs, 0)
    assert.equal(empty.findings.length, 0)

    writeFileSync(
      join(fixture.repository, 'safe.txt'),
      'API_KEY=placeholder\nsk-your-placeholder-value-that-must-not-trigger-this-audit\n',
    )
    commit(fixture.repository, 'safe ClawDSH change')
    const result = auditSecretHistory({ repositoryRoot: fixture.repository, base: fixture.base })
    assert.equal(result.commits, 1)
    assert.equal(result.findings.length, 0)
    assert.ok(result.blobs >= 1)
  } finally {
    rmSync(fixture.temporary, { recursive: true, force: true })
  }
})

test('secret-history audit fixtures do not trip the release gate when committed', () => {
  const source = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  assert.equal(source.includes(encryptedPrivateKeyMarker()), false)
  const fixture = repositoryFixture()
  try {
    writeFileSync(join(fixture.repository, 'secret-history-audit.test.mjs'), source)
    commit(fixture.repository, 'candidate secret-audit tests')

    const result = auditSecretHistory({ repositoryRoot: fixture.repository, base: fixture.base })
    assert.deepEqual(result.findings, [])
  } finally {
    rmSync(fixture.temporary, { recursive: true, force: true })
  }
})

test('secret-history audit detects a secret that a later commit deleted without revealing it', () => {
  const fixture = repositoryFixture()
  try {
    const secret = `${'github'}${'_pat_'}${'A'.repeat(70)}`
    const assignedSecret = `sk-${'0123456789abcdef'.repeat(3)}`
    const bareGenericSecret = `sk-${'0a1B2c3D4e5F6g7H'.repeat(3)}`
    const bareProjectSecret = `sk-proj-${'aB3dE5fG7hJ9kL2mN4pQ6rS8tV0wX1yZ'.repeat(2)}`
    writeFileSync(join(fixture.repository, 'temporary-secret.txt'), `${secret}\n`)
    writeFileSync(join(fixture.repository, 'temporary-env.txt'), `DEEPSEEK_API_KEY=${assignedSecret}\n`)
    writeFileSync(
      join(fixture.repository, 'temporary-provider-key.txt'),
      `${bareGenericSecret}\n${bareProjectSecret}\n`,
    )
    writeFileSync(join(fixture.repository, 'temporary-private-key.txt'), `${encryptedPrivateKeyMarker()}\n`)
    commit(fixture.repository, 'accidentally add credential')
    rmSync(join(fixture.repository, 'temporary-secret.txt'))
    rmSync(join(fixture.repository, 'temporary-env.txt'))
    rmSync(join(fixture.repository, 'temporary-provider-key.txt'))
    rmSync(join(fixture.repository, 'temporary-private-key.txt'))
    commit(fixture.repository, 'delete credential')
    const result = auditSecretHistory({ repositoryRoot: fixture.repository, base: fixture.base })
    assert.ok(result.findings.some(finding => (
      finding.rule === 'github-token' && finding.path === 'temporary-secret.txt'
    )))
    assert.ok(result.findings.some(finding => (
      finding.rule === 'credential-assignment' && finding.path === 'temporary-env.txt'
    )))
    assert.ok(result.findings.some(finding => (
      finding.rule === 'provider-api-key' && finding.path === 'temporary-provider-key.txt'
    )))
    assert.ok(result.findings.some(finding => (
      finding.rule === 'private-key' && finding.path === 'temporary-private-key.txt'
    )))
    assert.doesNotMatch(JSON.stringify(result), new RegExp(secret))
    assert.doesNotMatch(JSON.stringify(result), new RegExp(assignedSecret))
    assert.doesNotMatch(JSON.stringify(result), new RegExp(bareGenericSecret))
    assert.doesNotMatch(JSON.stringify(result), new RegExp(bareProjectSecret))
  } finally {
    rmSync(fixture.temporary, { recursive: true, force: true })
  }
})

test('secret-history audit preserves sensitive aliases for the same deleted blob', () => {
  const fixture = repositoryFixture()
  try {
    const shared = 'same benign placeholder bytes\n'
    writeFileSync(join(fixture.repository, 'safe.txt'), shared)
    writeFileSync(join(fixture.repository, '.env'), shared)
    commit(fixture.repository, 'add two aliases for one blob')
    rmSync(join(fixture.repository, 'safe.txt'))
    rmSync(join(fixture.repository, '.env'))
    commit(fixture.repository, 'delete both aliases')

    const result = auditSecretHistory({ repositoryRoot: fixture.repository, base: fixture.base })
    assert.ok(result.findings.some(finding => (
      finding.rule === 'sensitive-path' && finding.path === '.env'
    )))
    assert.equal(result.findings.some(finding => (
      finding.rule === 'sensitive-path' && finding.path === 'safe.txt'
    )), false)
  } finally {
    rmSync(fixture.temporary, { recursive: true, force: true })
  }
})
