/** Streaming safety inspection for the locked gzip-compressed npm tarball. */

import { createReadStream } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { isAbsolute, posix } from 'node:path'

const BLOCK = 512
const MAX_METADATA_BYTES = 64 * 1024

/** @param {Buffer} block @param {number} start @param {number} length @returns {string} */
function textField(block, start, length) {
  const bytes = block.subarray(start, start + length)
  const end = bytes.indexOf(0)
  return bytes.subarray(0, end === -1 ? bytes.length : end).toString('utf8')
}

/** @param {Buffer} block @param {number} start @param {number} length @param {string} label @returns {number} */
function octalField(block, start, length, label) {
  const raw = textField(block, start, length).trim()
  if (!/^[0-7]+$/.test(raw)) throw new TypeError(`OpenClaw tar ${label} is not canonical octal`)
  const value = Number.parseInt(raw, 8)
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`OpenClaw tar ${label} exceeds safe integer range`)
  return value
}

/** @param {Buffer} block */
function validateChecksum(block) {
  const expected = octalField(block, 148, 8, 'checksum')
  let actual = 0
  for (let index = 0; index < block.length; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : block[index]
  }
  if (actual !== expected) throw new TypeError('OpenClaw tar header checksum is invalid')
}

/** Validate one tar member path without permitting platform-dependent spelling. */
/** @param {string} raw @param {string} [label] @returns {string} */
export function safeArchivePath(raw, label = 'OpenClaw tar member') {
  if (typeof raw !== 'string' || raw === '' || raw.includes('\0') || raw.includes('\\')
    || isAbsolute(raw) || /^[A-Za-z]:/.test(raw)) {
    throw new TypeError(`${label} has an unsafe path`)
  }
  const stripped = raw.endsWith('/') ? raw.slice(0, -1) : raw
  if (stripped === '' || posix.normalize(stripped) !== stripped || stripped === '..' || stripped.startsWith('../')) {
    throw new TypeError(`${label} escapes the archive root`)
  }
  if (stripped !== 'package' && !stripped.startsWith('package/')) {
    throw new TypeError(`${label} must stay beneath package/`)
  }
  return stripped
}

/** @param {Buffer} bytes @returns {Map<string, string>} */
function parsePax(bytes) {
  const fields = new Map()
  let offset = 0
  while (offset < bytes.length) {
    const space = bytes.indexOf(0x20, offset)
    if (space === -1) throw new TypeError('OpenClaw tar PAX record has no length separator')
    const lengthText = bytes.subarray(offset, space).toString('ascii')
    if (!/^[1-9][0-9]*$/.test(lengthText)) throw new TypeError('OpenClaw tar PAX record length is invalid')
    const length = Number.parseInt(lengthText, 10)
    const end = offset + length
    if (!Number.isSafeInteger(length) || end > bytes.length || bytes[end - 1] !== 0x0a) {
      throw new TypeError('OpenClaw tar PAX record is truncated')
    }
    const record = bytes.subarray(space + 1, end - 1).toString('utf8')
    const equals = record.indexOf('=')
    if (equals <= 0) throw new TypeError('OpenClaw tar PAX record has no key')
    fields.set(record.slice(0, equals), record.slice(equals + 1))
    offset = end
  }
  return fields
}

/** Inspect every archive header and reject links, special files, and path escape forms. */
/** @param {string} path @returns {Promise<{entries: number}>} */
export async function inspectNpmTarball(path) {
  const stream = createReadStream(path).pipe(createGunzip())
  let pending = Buffer.alloc(0)
  let bodyRemaining = 0
  let paddingRemaining = 0
  /** @type {Buffer[]} */
  let bodyChunks = []
  let bodyBytes = 0
  /** @type {'x' | 'L' | undefined} */
  let bodyType
  /** @type {string | undefined} */
  let nextPath
  let zeroBlocks = 0
  let entries = 0

  const finishBody = () => {
    if (bodyType === undefined) return
    const bytes = Buffer.concat(bodyChunks, bodyBytes)
    if (bodyType === 'x') {
      const fields = parsePax(bytes)
      if (fields.has('linkpath') || [...fields.keys()].some(key => key.startsWith('GNU.sparse.'))) {
        throw new TypeError('OpenClaw tar PAX metadata requests a link or sparse file')
      }
      const pathOverride = fields.get('path')
      if (pathOverride !== undefined) nextPath = safeArchivePath(pathOverride, 'OpenClaw tar PAX path')
    } else if (bodyType === 'L') {
      const value = bytes.toString('utf8').replace(/[\0\n]+$/, '')
      nextPath = safeArchivePath(value, 'OpenClaw tar GNU long path')
    }
    bodyChunks = []
    bodyBytes = 0
    bodyType = undefined
  }

  for await (const chunk of stream) {
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk])
    while (pending.length > 0) {
      if (bodyRemaining > 0) {
        const take = Math.min(bodyRemaining, pending.length)
        if (bodyType !== undefined) {
          bodyChunks.push(pending.subarray(0, take))
          bodyBytes += take
        }
        pending = pending.subarray(take)
        bodyRemaining -= take
        if (bodyRemaining === 0) finishBody()
        continue
      }
      if (paddingRemaining > 0) {
        const take = Math.min(paddingRemaining, pending.length)
        pending = pending.subarray(take)
        paddingRemaining -= take
        continue
      }
      if (pending.length < BLOCK) break
      const block = pending.subarray(0, BLOCK)
      pending = pending.subarray(BLOCK)
      if (block.every(byte => byte === 0)) {
        zeroBlocks += 1
        continue
      }
      if (zeroBlocks > 0) throw new TypeError('OpenClaw tar contains entries after its end marker')
      validateChecksum(block)
      const name = textField(block, 0, 100)
      const prefix = textField(block, 345, 155)
      const headerPath = prefix === '' ? name : `${prefix}/${name}`
      const type = String.fromCharCode(block[156] || 0)
      const size = octalField(block, 124, 12, 'member size')
      const linkName = textField(block, 157, 100)
      if (linkName !== '') throw new TypeError('OpenClaw tar member declares a link target')
      const effectivePath = nextPath ?? safeArchivePath(headerPath)
      nextPath = undefined
      if (type === '1' || type === '2') throw new TypeError(`OpenClaw tar contains forbidden link ${effectivePath}`)
      if (type !== '\0' && type !== '0' && type !== '5' && type !== 'x' && type !== 'L') {
        throw new TypeError(`OpenClaw tar contains forbidden special entry type ${JSON.stringify(type)}`)
      }
      if (type === '5' && size !== 0) throw new TypeError('OpenClaw tar directory has a non-zero body')
      if ((type === 'x' || type === 'L') && size > MAX_METADATA_BYTES) {
        throw new TypeError('OpenClaw tar metadata entry exceeds the size limit')
      }
      if (type === 'x' || type === 'L') bodyType = type
      bodyRemaining = size
      paddingRemaining = (BLOCK - (size % BLOCK)) % BLOCK
      entries += 1
      if (bodyRemaining === 0) finishBody()
    }
  }
  if (bodyRemaining !== 0 || paddingRemaining !== 0 || pending.some(byte => byte !== 0)) {
    throw new TypeError('OpenClaw tarball is truncated')
  }
  if (zeroBlocks < 2 || entries === 0 || nextPath !== undefined) {
    throw new TypeError('OpenClaw tarball has no complete end marker or payload')
  }
  return { entries }
}
