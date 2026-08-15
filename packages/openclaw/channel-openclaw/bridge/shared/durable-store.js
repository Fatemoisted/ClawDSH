/** Crash-consistent keyed state fallback for an external OpenClaw bridge plugin. */

import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join } from 'node:path'

const STORE_VERSION = 1
const KEY_PATTERN = /^[a-f0-9]{64}$/
const NAMESPACE_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0

/**
 * Defer all OpenClaw state and filesystem access until the first state operation.
 * Official trusted installs use OpenClaw's state service. External pinned installs
 * use a private file-per-key store under the OpenClaw state directory.
 */
export function createLazySyncKeyedStore(api, options) {
  let store
  const current = () => {
    store ??= openStore(api, options)
    return store
  }
  return {
    register: (key, value, mutation) => current().register(key, value, mutation),
    registerIfAbsent: (key, value, mutation) => current().registerIfAbsent(key, value, mutation),
    update: (key, updateValue, mutation) => current().update?.(key, updateValue, mutation) ?? false,
    lookup: key => current().lookup(key),
    consume: key => current().consume(key),
    delete: key => current().delete(key),
    entries: () => current().entries(),
    clear: () => current().clear(),
  }
}

function openStore(api, options) {
  try {
    return api.runtime.state.openSyncKeyedStore(options)
  } catch (error) {
    if (!isUntrustedStateError(error)) throw error
  }
  const stateDir = api.runtime.state.resolveStateDir()
  if (typeof stateDir !== 'string' || !isAbsolute(stateDir) || stateDir.includes('\0')) {
    throw new Error('OpenClaw returned an invalid state directory for the ClawDSH bridge')
  }
  return new FileSyncKeyedStore(join(stateDir, 'clawdsh-bridge-state', options.namespace), options)
}

function isUntrustedStateError(error) {
  return error instanceof Error && error.message.includes('only available for trusted plugins')
}

class FileSyncKeyedStore {
  #directory
  #maxEntries

  constructor(directory, options) {
    if (!NAMESPACE_PATTERN.test(options.namespace)) throw new Error('invalid ClawDSH bridge state namespace')
    if (!Number.isSafeInteger(options.maxEntries) || options.maxEntries <= 0) {
      throw new Error('invalid ClawDSH bridge state entry limit')
    }
    if (options.overflowPolicy !== undefined && options.overflowPolicy !== 'reject-new') {
      throw new Error('ClawDSH bridge state only supports reject-new overflow')
    }
    if (options.defaultTtlMs !== undefined) throw new Error('ClawDSH bridge state does not support TTL')
    this.#directory = directory
    this.#maxEntries = options.maxEntries
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    chmodSync(directory, 0o700)
  }

  register(key, value, options) {
    rejectTtl(options)
    const existing = this.#read(key)
    if (existing === undefined) this.#assertCapacity()
    this.#replace(key, this.#record(key, value, existing?.createdAt))
  }

  registerIfAbsent(key, value, options) {
    rejectTtl(options)
    this.#validateKey(key)
    if (this.#exists(key)) return false
    this.#assertCapacity()
    const temporary = this.#writeTemporary(this.#record(key, value))
    try {
      linkSync(temporary, this.#path(key))
      unlinkSync(temporary)
      this.#syncDirectory()
      return true
    } catch (error) {
      unlinkIfPresent(temporary)
      if (isCode(error, 'EEXIST')) return false
      throw error
    }
  }

  update(key, updateValue, options) {
    rejectTtl(options)
    if (typeof updateValue !== 'function') throw new Error('ClawDSH bridge state update requires a function')
    const existing = this.#read(key)
    const next = updateValue(existing?.value)
    if (next === undefined) {
      if (existing === undefined) return false
      this.delete(key)
      return true
    }
    if (existing === undefined) this.#assertCapacity()
    this.#replace(key, this.#record(key, next, existing?.createdAt))
    return true
  }

  lookup(key) {
    return clone(this.#read(key)?.value)
  }

  consume(key) {
    const existing = this.#read(key)
    if (existing === undefined) return undefined
    if (!this.delete(key)) throw new Error('ClawDSH bridge state changed while consuming a key')
    return clone(existing.value)
  }

  delete(key) {
    this.#validateKey(key)
    const path = this.#path(key)
    let facts
    try {
      facts = lstatSync(path)
    } catch (error) {
      if (isCode(error, 'ENOENT')) return false
      throw error
    }
    if (!facts.isFile() || facts.isSymbolicLink()) throw new Error('ClawDSH bridge state entry is not a regular file')
    unlinkSync(path)
    this.#syncDirectory()
    return true
  }

  entries() {
    return this.#keys().map(key => {
      const record = this.#read(key)
      if (record === undefined) throw new Error('ClawDSH bridge state changed while listing entries')
      return { key, value: clone(record.value), createdAt: record.createdAt }
    })
  }

  clear() {
    for (const key of this.#keys()) this.delete(key)
  }

  #record(key, value, createdAt = Date.now()) {
    this.#validateKey(key)
    if (!Number.isSafeInteger(createdAt) || createdAt < 0) throw new Error('invalid ClawDSH bridge state timestamp')
    return { version: STORE_VERSION, key, createdAt, value: clone(value) }
  }

  #read(key) {
    this.#validateKey(key)
    const path = this.#path(key)
    let descriptor
    try {
      descriptor = openSync(path, constants.O_RDONLY | NO_FOLLOW)
    } catch (error) {
      if (isCode(error, 'ENOENT')) return undefined
      throw error
    }
    try {
      if (!fstatSync(descriptor).isFile()) throw new Error('ClawDSH bridge state entry is not a regular file')
      const parsed = JSON.parse(readFileSync(descriptor, 'utf8'))
      return validateRecord(parsed, key)
    } finally {
      closeSync(descriptor)
    }
  }

  #replace(key, record) {
    const temporary = this.#writeTemporary(record)
    try {
      renameSync(temporary, this.#path(key))
      this.#syncDirectory()
    } catch (error) {
      unlinkIfPresent(temporary)
      throw error
    }
  }

  #writeTemporary(record) {
    const path = join(this.#directory, `.${randomUUID()}.tmp`)
    const descriptor = openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW,
      0o600,
    )
    try {
      writeFileSync(descriptor, `${JSON.stringify(record)}\n`, 'utf8')
      fsyncSync(descriptor)
    } catch (error) {
      closeSync(descriptor)
      unlinkIfPresent(path)
      throw error
    }
    closeSync(descriptor)
    return path
  }

  #assertCapacity() {
    if (this.#keys().length >= this.#maxEntries) throw new Error('ClawDSH bridge state entry limit reached')
  }

  #exists(key) {
    this.#validateKey(key)
    try {
      const facts = lstatSync(this.#path(key))
      if (!facts.isFile() || facts.isSymbolicLink()) throw new Error('ClawDSH bridge state entry is not a regular file')
      return true
    } catch (error) {
      if (isCode(error, 'ENOENT')) return false
      throw error
    }
  }

  #keys() {
    return readdirSync(this.#directory)
      .filter(name => name.endsWith('.json'))
      .map(name => name.slice(0, -'.json'.length))
      .map(key => {
        this.#validateKey(key)
        return key
      })
      .sort()
  }

  #path(key) {
    this.#validateKey(key)
    return join(this.#directory, `${key}.json`)
  }

  #validateKey(key) {
    if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
      throw new Error('ClawDSH bridge state keys must be canonical SHA-256 digests')
    }
  }

  #syncDirectory() {
    const descriptor = openSync(this.#directory, constants.O_RDONLY)
    try {
      fsyncSync(descriptor)
    } finally {
      closeSync(descriptor)
    }
  }
}

function validateRecord(value, expectedKey) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('ClawDSH bridge state entry is not an object')
  }
  const keys = Object.keys(value).sort()
  if (JSON.stringify(keys) !== JSON.stringify(['createdAt', 'key', 'value', 'version'])) {
    throw new Error('ClawDSH bridge state entry has unexpected fields')
  }
  if (value.version !== STORE_VERSION || value.key !== expectedKey) {
    throw new Error('ClawDSH bridge state entry identity is invalid')
  }
  if (!Number.isSafeInteger(value.createdAt) || value.createdAt < 0) {
    throw new Error('ClawDSH bridge state entry timestamp is invalid')
  }
  return value
}

function clone(value) {
  if (value === undefined) return undefined
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error('ClawDSH bridge state value is not JSON serializable')
  return JSON.parse(encoded)
}

function rejectTtl(options) {
  if (options?.ttlMs !== undefined) throw new Error('ClawDSH bridge state does not support TTL')
}

function unlinkIfPresent(path) {
  try {
    unlinkSync(path)
  } catch (error) {
    if (!isCode(error, 'ENOENT')) throw error
  }
}

function isCode(error, code) {
  return error !== null && typeof error === 'object' && error.code === code
}
