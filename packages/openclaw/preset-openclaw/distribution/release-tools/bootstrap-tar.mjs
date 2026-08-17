/** Minimal deterministic npm-tarball writer for inert bootstrap packages. */

import { posix } from 'node:path'
import { gzipSync } from 'node:zlib'

const BLOCK_SIZE = 512

function writeText(header, offset, length, value, label) {
  const bytes = Buffer.from(value)
  if (bytes.byteLength > length) throw new TypeError(`${label} exceeds its tar field`)
  bytes.copy(header, offset)
}

function writeOctal(header, offset, length, value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative integer`)
  const digits = value.toString(8)
  if (digits.length > length - 1) throw new TypeError(`${label} exceeds its tar field`)
  writeText(header, offset, length, `${digits.padStart(length - 1, '0')}\0`, label)
}

function tarHeader(name, { mode, size, type }) {
  const header = Buffer.alloc(BLOCK_SIZE)
  writeText(header, 0, 100, name, 'tar path')
  writeOctal(header, 100, 8, mode, 'tar mode')
  writeOctal(header, 108, 8, 0, 'tar uid')
  writeOctal(header, 116, 8, 0, 'tar gid')
  writeOctal(header, 124, 12, size, 'tar size')
  writeOctal(header, 136, 12, 0, 'tar mtime')
  header.fill(0x20, 148, 156)
  writeText(header, 156, 1, type, 'tar type')
  writeText(header, 257, 6, 'ustar\0', 'tar magic')
  writeText(header, 263, 2, '00', 'tar version')
  let checksum = 0
  for (const byte of header) checksum += byte
  const digits = checksum.toString(8)
  if (digits.length > 6) throw new TypeError('tar checksum exceeds its field')
  writeText(header, 148, 8, `${digits.padStart(6, '0')}\0 `, 'tar checksum')
  return header
}

function normalizedPath(value) {
  if (typeof value !== 'string' || value === '' || value.includes('\\') || value.startsWith('/')) {
    throw new TypeError('bootstrap tar path must be a normalized relative path')
  }
  const normalized = posix.normalize(value)
  if (normalized !== value || normalized === '..' || normalized.startsWith('../')) {
    throw new TypeError('bootstrap tar path escapes its package root')
  }
  return value
}

/** Build one byte-stable gzip-compressed npm tarball from ordinary files. */
export function deterministicNpmTarball(files) {
  if (!Array.isArray(files) || files.length === 0) throw new TypeError('bootstrap tarball requires files')
  const seen = new Set()
  const normalized = files.map((entry) => {
    const path = normalizedPath(entry.path)
    if (seen.has(path)) throw new TypeError(`bootstrap tarball repeats ${path}`)
    seen.add(path)
    const bytes = Buffer.isBuffer(entry.bytes) ? entry.bytes : Buffer.from(entry.bytes)
    return { path, bytes }
  }).sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
  const blocks = [tarHeader('package/', { mode: 0o755, size: 0, type: '5' })]
  for (const { path, bytes } of normalized) {
    blocks.push(tarHeader(`package/${path}`, { mode: 0o644, size: bytes.byteLength, type: '0' }))
    blocks.push(bytes)
    const padding = (BLOCK_SIZE - (bytes.byteLength % BLOCK_SIZE)) % BLOCK_SIZE
    if (padding > 0) blocks.push(Buffer.alloc(padding))
  }
  blocks.push(Buffer.alloc(BLOCK_SIZE * 2))
  const compressed = gzipSync(Buffer.concat(blocks), { level: 9, mtime: 0 })
  // gzip's OS byte is descriptive only; pinning it avoids host-dependent archives.
  compressed[9] = 255
  return compressed
}
