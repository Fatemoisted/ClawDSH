/** Recoverable publication of a bounded set of managed assets. */

import { randomBytes } from 'node:crypto'
import { lstatSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  isInside,
  entryExists,
  homeDirectory,
  privateDirectory,
  readJson,
  removeManagedEntry,
  requireKind,
  requireOrdinaryParents,
  safeRelative,
  writeJsonAtomic,
} from './files.mjs'

const STAGING_DIRECTORY = '.clawdsh-staging'
const JOURNAL_FILENAME = 'journal.json'
const MANAGEMENT_LOCK_DIRECTORY = '.clawdsh-lock'
const MANAGEMENT_LOCK_OWNER = 'owner.json'
const INCOMPLETE_LOCK_GRACE_MS = 30_000
const MANAGED_TARGET_KINDS = new Map([
  ['profiles/clawdsh', 'directory'],
  ['profiles/clawdsh/package.json', 'file'],
  ['profiles/clawdsh/node_modules', 'directory'],
  ['.agent-presets/clawdsh', 'directory'],
  ['.agent-presets/clawdsh-messaging-safe', 'directory'],
  ['clawdsh/channel/openclaw/artifacts/openclaw.tgz', 'file'],
  ['clawdsh/channel/openclaw/runtime', 'directory'],
  ['clawdsh/channel/openclaw/state/openclaw.json', 'file'],
  ['.clawdsh.json', 'file'],
])

/** @param {number} pid @returns {boolean} */
function processIsAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false
    if (error instanceof Error && 'code' in error && error.code === 'EPERM') return true
    throw error
  }
}

/** @param {string} lockRoot @returns {void} */
function removeStaleLock(lockRoot) {
  const quarantine = `${lockRoot}.stale-${process.pid}-${randomBytes(8).toString('hex')}`
  renameSync(lockRoot, quarantine)
  removeManagedEntry(quarantine)
}

/**
 * Hold the single ClawDSH management lock until the returned disposer runs.
 * A dead owner's complete lock is reclaimed; an incomplete fresh lock fails closed.
 */
/** @param {string} home @param {{now?: () => number, incompleteGraceMs?: number}} [options] @returns {() => void} */
export function acquireManagementLock(home, options = {}) {
  homeDirectory(home)
  const now = options.now ?? Date.now
  const incompleteGraceMs = options.incompleteGraceMs ?? INCOMPLETE_LOCK_GRACE_MS
  if (!Number.isSafeInteger(incompleteGraceMs) || incompleteGraceMs < 0) {
    throw new TypeError('management lock grace period must be a non-negative safe integer')
  }
  const lockRoot = join(home, MANAGEMENT_LOCK_DIRECTORY)
  const ownerPath = join(lockRoot, MANAGEMENT_LOCK_OWNER)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      mkdirSync(lockRoot, { mode: 0o700 })
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
      const metadata = lstatSync(lockRoot)
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        throw new Error(`ClawDSH management lock is not an ordinary directory: ${lockRoot}`)
      }
      if (!entryExists(ownerPath)) {
        if (now() - metadata.mtimeMs < incompleteGraceMs) {
          throw new Error('another ClawDSH management command is acquiring the installer lock')
        }
        removeStaleLock(lockRoot)
        continue
      }
      const owner = readJson(ownerPath, 'ClawDSH management lock owner')
      if (owner === null || typeof owner !== 'object' || Array.isArray(owner)
        || owner.schemaVersion !== 1 || !Number.isSafeInteger(owner.pid) || owner.pid <= 0
        || typeof owner.token !== 'string' || !/^[a-f0-9]{32}$/.test(owner.token)
        || typeof owner.createdAt !== 'string') {
        throw new TypeError('ClawDSH management lock owner is invalid')
      }
      if (processIsAlive(owner.pid)) {
        throw new Error(`another ClawDSH management command is running with process ${String(owner.pid)}`)
      }
      removeStaleLock(lockRoot)
      continue
    }

    const token = randomBytes(16).toString('hex')
    try {
      writeJsonAtomic(ownerPath, {
        schemaVersion: 1,
        pid: process.pid,
        token,
        createdAt: new Date(now()).toISOString(),
      })
    } catch (error) {
      removeManagedEntry(lockRoot)
      throw error
    }
    let released = false
    return () => {
      if (released) return
      const owner = readJson(ownerPath, 'ClawDSH management lock owner')
      if (owner === null || typeof owner !== 'object' || Array.isArray(owner)
        || owner.pid !== process.pid || owner.token !== token) {
        throw new Error('ClawDSH management lock ownership changed before release')
      }
      const releaseRoot = `${lockRoot}.release-${process.pid}-${randomBytes(8).toString('hex')}`
      renameSync(lockRoot, releaseRoot)
      removeManagedEntry(releaseRoot)
      released = true
    }
  }
  throw new Error('could not acquire the ClawDSH management lock after stale-owner recovery')
}

/** Transaction journals are narrowed before any recorded path is used. @typedef {Record<string, any>} JournalJson */
/** @typedef {'file' | 'directory'} OperationKind */
/** @typedef {{target: string, candidate: string, backup: string, kind: OperationKind}} JournalOperation */
/** @typedef {{target: string, candidate: string, kind: OperationKind}} RequestedOperation */
/** @typedef {{home: string, transaction: string, candidateRoot: string, backupRoot: string}} ManagedTransaction */
/** @typedef {JournalOperation & {paths: {target: string, candidate: string, backup: string}, transaction: string}} ValidatedOperation */

/** @param {string} home @param {string} transaction @param {string} candidateRoot @param {string} backupRoot @param {JournalJson} value @param {number} index @returns {ValidatedOperation} */
function validatedOperation(home, transaction, candidateRoot, backupRoot, value, index) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`transaction operation ${index} must be an object`)
  }
  const target = safeRelative(value.target, `transaction operation ${index} target`)
  const candidate = safeRelative(value.candidate, `transaction operation ${index} candidate`)
  const backup = safeRelative(value.backup, `transaction operation ${index} backup`)
  const kind = value.kind
  if (kind !== 'file' && kind !== 'directory') throw new TypeError(`transaction operation ${index} has invalid kind`)
  if (MANAGED_TARGET_KINDS.get(target) !== kind) {
    throw new TypeError(`transaction operation ${index} is not an allowed managed target`)
  }
  const paths = {
    target: resolve(home, target),
    candidate: resolve(candidateRoot, candidate),
    backup: resolve(backupRoot, backup),
  }
  if (!isInside(home, paths.target) || paths.target === resolve(home)
    || !isInside(candidateRoot, paths.candidate) || paths.candidate === candidateRoot
    || !isInside(backupRoot, paths.backup) || paths.backup === backupRoot) {
    throw new TypeError(`transaction operation ${index} escapes its managed root`)
  }
  requireOrdinaryParents(home, target, `transaction operation ${index} target`)
  requireOrdinaryParents(candidateRoot, candidate, `transaction operation ${index} candidate`)
  requireOrdinaryParents(backupRoot, backup, `transaction operation ${index} backup`)
  return { target, candidate, backup, kind, paths, transaction }
}

/** @param {ValidatedOperation[]} operations */
function requireUniqueOperations(operations) {
  const groups = /** @type {Array<[string, string[]]>} */ ([
    ['targets', operations.map(operation => operation.target)],
    ['candidates', operations.map(operation => operation.candidate)],
    ['backups', operations.map(operation => operation.backup)],
  ])
  for (const [label, values] of groups) {
    if (new Set(values).size !== values.length) throw new TypeError(`transaction operation ${label} must be unique`)
  }
}

/** @param {string} home @param {string} transaction @returns {{operations: ValidatedOperation[], markerIndex: number}} */
function readJournal(home, transaction) {
  const journal = readJson(join(transaction, JOURNAL_FILENAME), 'ClawDSH transaction journal')
  if (journal === null || typeof journal !== 'object' || Array.isArray(journal)
    || journal.schemaVersion !== 1 || journal.state !== 'publishing'
    || !Array.isArray(journal.operations) || journal.operations.length === 0
    || !Number.isSafeInteger(journal.markerIndex)) {
    throw new TypeError('ClawDSH transaction journal is invalid')
  }
  const candidateRoot = join(transaction, 'candidate')
  const backupRoot = join(transaction, 'backup')
  requireKind(candidateRoot, 'directory')
  requireKind(backupRoot, 'directory')
  const journalOperations = /** @type {JournalJson[]} */ (journal.operations)
  const operations = journalOperations.map((value, index) => (
    validatedOperation(home, transaction, candidateRoot, backupRoot, value, index)
  ))
  requireUniqueOperations(operations)
  if (journal.markerIndex !== operations.length - 1 || operations.at(-1)?.target !== '.clawdsh.json') {
    throw new TypeError('ClawDSH transaction marker must be the final operation')
  }
  return { operations, markerIndex: journal.markerIndex }
}

/** @param {string} home @param {string} transaction @returns {'discarded' | 'committed' | 'rolled-back'} */
function recoverTransaction(home, transaction) {
  const journalPath = join(transaction, JOURNAL_FILENAME)
  if (!entryExists(journalPath)) {
    removeManagedEntry(transaction)
    return 'discarded'
  }
  const { operations, markerIndex } = readJournal(home, transaction)
  const marker = operations[markerIndex]
  if (marker === undefined) throw new TypeError('ClawDSH transaction marker is missing')
  if (!entryExists(marker.paths.candidate) && entryExists(marker.paths.target)) {
    requireKind(marker.paths.target, 'file')
    removeManagedEntry(transaction)
    return 'committed'
  }
  for (const operation of [...operations].reverse()) {
    const candidateMoved = !entryExists(operation.paths.candidate)
    if (entryExists(operation.paths.backup)) {
      requireKind(operation.paths.backup, operation.kind === 'file' ? 'file' : 'directory')
      if (entryExists(operation.paths.target)) {
        requireKind(operation.paths.target, operation.kind === 'file' ? 'file' : 'directory')
        removeManagedEntry(operation.paths.target)
      }
      mkdirSync(dirname(operation.paths.target), { recursive: true })
      requireOrdinaryParents(home, operation.target, 'transaction recovery target')
      renameSync(operation.paths.backup, operation.paths.target)
    } else if (candidateMoved && entryExists(operation.paths.target)) {
      requireKind(operation.paths.target, operation.kind === 'file' ? 'file' : 'directory')
      removeManagedEntry(operation.paths.target)
    }
  }
  removeManagedEntry(transaction)
  return 'rolled-back'
}

/** Recover every abandoned installer transaction beneath one Harness home. */
/** @param {string} home @returns {Array<'discarded' | 'committed' | 'rolled-back'>} */
export function recoverTransactions(home) {
  if (!entryExists(home)) return []
  homeDirectory(home)
  for (const target of MANAGED_TARGET_KINDS.keys()) {
    requireOrdinaryParents(home, target, 'ClawDSH managed target')
  }
  const root = join(home, STAGING_DIRECTORY)
  if (!entryExists(root)) return []
  const metadata = lstatSync(root)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`ClawDSH staging root is not an ordinary directory: ${root}`)
  }
  /** @type {Array<'discarded' | 'committed' | 'rolled-back'>} */
  const outcomes = []
  for (const name of readdirSync(root).sort()) {
    safeRelative(name, 'transaction directory name')
    const transaction = join(root, name)
    const entry = lstatSync(transaction)
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error(`ClawDSH staging entry is not an ordinary directory: ${transaction}`)
    }
    outcomes.push(recoverTransaction(home, transaction))
  }
  return outcomes
}

/** Create an empty private candidate transaction after recovering older work. */
/** @param {string} home @param {string} label @returns {ManagedTransaction} */
export function beginTransaction(home, label) {
  homeDirectory(home)
  recoverTransactions(home)
  const stagingRoot = join(home, STAGING_DIRECTORY)
  privateDirectory(stagingRoot)
  const safeLabel = label.replace(/[^a-z0-9-]/gi, '-').slice(0, 32) || 'managed'
  const transaction = join(stagingRoot, `${safeLabel}-${process.pid}-${randomBytes(8).toString('hex')}`)
  privateDirectory(transaction)
  const candidateRoot = join(transaction, 'candidate')
  const backupRoot = join(transaction, 'backup')
  privateDirectory(candidateRoot)
  privateDirectory(backupRoot)
  return { home: resolve(home), transaction, candidateRoot, backupRoot }
}

/** Atomically publish candidates and move the marker last; failures roll back. */
/** @param {ManagedTransaction} tx @param {RequestedOperation[]} requested @returns {void} */
export function commitTransaction(tx, requested) {
  if (!Array.isArray(requested) || requested.length === 0) throw new TypeError('transaction needs managed operations')
  const operations = requested.map((operation, index) => {
    const target = safeRelative(operation.target, `operation ${index} target`)
    const candidate = safeRelative(operation.candidate, `operation ${index} candidate`)
    const kind = operation.kind
    if (kind !== 'file' && kind !== 'directory') throw new TypeError(`operation ${index} has invalid kind`)
    return { target, candidate, backup: `${String(index).padStart(3, '0')}-${kind}`, kind }
  })
  if (operations.at(-1)?.target !== '.clawdsh.json') {
    throw new TypeError('the managed marker must be published last')
  }
  const validated = operations.map((operation, index) => (
    validatedOperation(tx.home, tx.transaction, tx.candidateRoot, tx.backupRoot, operation, index)
  ))
  requireUniqueOperations(validated)
  for (const operation of validated) {
    requireKind(join(tx.candidateRoot, operation.candidate), operation.kind === 'file' ? 'file' : 'directory')
    if (entryExists(operation.paths.target)) {
      requireKind(operation.paths.target, operation.kind === 'file' ? 'file' : 'directory')
    }
  }
  writeJsonAtomic(join(tx.transaction, JOURNAL_FILENAME), {
    schemaVersion: 1,
    state: 'publishing',
    markerIndex: operations.length - 1,
    operations,
  })
  try {
    for (const operation of operations) {
      const target = join(tx.home, operation.target)
      const candidate = join(tx.candidateRoot, operation.candidate)
      const backup = join(tx.backupRoot, operation.backup)
      mkdirSync(dirname(target), { recursive: true })
      requireOrdinaryParents(tx.home, operation.target, 'transaction target')
      if (entryExists(target)) {
        requireKind(target, operation.kind === 'file' ? 'file' : 'directory')
        renameSync(target, backup)
      }
      renameSync(candidate, target)
    }
    removeManagedEntry(tx.transaction)
  } catch (error) {
    recoverTransaction(tx.home, tx.transaction)
    throw error
  }
}
