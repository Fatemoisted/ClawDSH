/** Bounded tar reader used to inspect the bytes that npm would publish. */

import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { isAbsolute, posix } from 'node:path'

const BLOCK_SIZE = 512
const MAX_COMPRESSED_BYTES = 64 * 1024 * 1024
const MAX_EXPANDED_BYTES = 256 * 1024 * 1024
const MAX_ENTRIES = 20_000

function text(buffer) {
  const end = buffer.indexOf(0)
  return buffer.subarray(0, end < 0 ? buffer.length : end).toString('utf8')
}

function octal(buffer, label) {
  if ((buffer[0] & 0x80) !== 0) throw new TypeError(`${label} uses unsupported base-256 encoding`)
  const value = text(buffer).trim().replace(/^0+/, '')
  if (value === '') return 0
  if (!/^[0-7]+$/.test(value)) throw new TypeError(`${label} is not an octal integer`)
  const parsed = Number.parseInt(value, 8)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new TypeError(`${label} is outside the safe range`)
  return parsed
}

function checksum(header) {
  let sum = 0
  for (let index = 0; index < header.length; index += 1) {
    sum += index >= 148 && index < 156 ? 32 : header[index]
  }
  return sum
}

function safePath(raw, label) {
  const value = raw.replace(/^\.\//, '').replace(/\/$/, '')
  if (value === '' || isAbsolute(value) || value.includes('\\')) {
    throw new TypeError(`${label} is not a normalized relative path`)
  }
  const normalized = posix.normalize(value)
  if (normalized !== value || normalized === '..' || normalized.startsWith('../')) {
    throw new TypeError(`${label} escapes the archive root`)
  }
  return value
}

function parsePax(bytes) {
  const values = new Map()
  let offset = 0
  while (offset < bytes.length) {
    const space = bytes.indexOf(32, offset)
    if (space < 0) throw new TypeError('tar PAX record has no length separator')
    const lengthText = bytes.subarray(offset, space).toString('ascii')
    if (!/^[1-9][0-9]*$/.test(lengthText)) throw new TypeError('tar PAX record length is invalid')
    const length = Number.parseInt(lengthText, 10)
    const end = offset + length
    if (!Number.isSafeInteger(length) || end > bytes.length || bytes[end - 1] !== 10) {
      throw new TypeError('tar PAX record exceeds its header')
    }
    const record = bytes.subarray(space + 1, end - 1).toString('utf8')
    const equals = record.indexOf('=')
    if (equals <= 0) throw new TypeError('tar PAX record has no key')
    values.set(record.slice(0, equals), record.slice(equals + 1))
    offset = end
  }
  return values
}

/** Read ordinary files and directories from a gzip-compressed npm tarball. */
export function readTarball(path) {
  const compressed = readFileSync(path)
  if (compressed.byteLength === 0 || compressed.byteLength > MAX_COMPRESSED_BYTES) {
    throw new TypeError('tarball compressed size is outside the release limit')
  }
  const archive = gunzipSync(compressed, { maxOutputLength: MAX_EXPANDED_BYTES })
  const entries = []
  const names = new Set()
  let offset = 0
  let zeroBlocks = 0
  let nextPax = new Map()
  let globalPax = new Map()
  let longName

  while (offset + BLOCK_SIZE <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK_SIZE)
    offset += BLOCK_SIZE
    if (header.every(byte => byte === 0)) {
      zeroBlocks += 1
      if (zeroBlocks === 2) break
      continue
    }
    zeroBlocks = 0
    const expectedChecksum = octal(header.subarray(148, 156), 'tar checksum')
    if (checksum(header) !== expectedChecksum) throw new TypeError('tar header checksum is invalid')
    const mode = octal(header.subarray(100, 108), 'tar entry mode')
    const size = octal(header.subarray(124, 136), 'tar entry size')
    const end = offset + size
    if (end > archive.length) throw new TypeError('tar entry exceeds the archive')
    const bytes = archive.subarray(offset, end)
    offset += Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE
    const type = String.fromCharCode(header[156] || 48)
    const prefix = text(header.subarray(345, 500))
    const headerName = `${prefix ? `${prefix}/` : ''}${text(header.subarray(0, 100))}`

    if (type === 'x' || type === 'g') {
      const pax = parsePax(bytes)
      if (type === 'x') nextPax = pax
      else globalPax = new Map([...globalPax, ...pax])
      continue
    }
    if (type === 'L') {
      longName = text(bytes)
      continue
    }
    if (type === 'K') throw new TypeError('tarball contains a GNU long link entry')
    if (type !== '0' && type !== '5') {
      throw new TypeError(`tarball contains forbidden entry type ${JSON.stringify(type)}`)
    }
    const pax = new Map([...globalPax, ...nextPax])
    const name = safePath(pax.get('path') ?? longName ?? headerName, 'tar entry path')
    nextPax = new Map()
    longName = undefined
    if (names.has(name)) throw new TypeError(`tarball contains duplicate entry ${name}`)
    names.add(name)
    if (entries.length >= MAX_ENTRIES) throw new TypeError('tarball contains too many entries')
    entries.push(Object.freeze({ name, type: type === '5' ? 'directory' : 'file', mode, bytes }))
  }
  if (zeroBlocks < 2) throw new TypeError('tarball has no two-block end marker')
  if (archive.subarray(offset).some(byte => byte !== 0)) throw new TypeError('tarball contains data after its end marker')
  return Object.freeze(entries)
}
