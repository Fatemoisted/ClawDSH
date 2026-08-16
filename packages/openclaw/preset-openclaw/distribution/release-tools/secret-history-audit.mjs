#!/usr/bin/env node
/** Non-mutating high-confidence secret scan over the ClawDSH Git delta. */

import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_OBJECT_BYTES = 16 * 1024 * 1024
const MAX_BATCH_BYTES = 256 * 1024 * 1024

const CONTENT_RULES = Object.freeze([
  Object.freeze({ id: 'private-key', expression: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g }),
  Object.freeze({ id: 'github-token', expression: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/g }),
  Object.freeze({ id: 'npm-token', expression: /\bnpm_[A-Za-z0-9]{36,}\b/g }),
  Object.freeze({ id: 'aws-access-key', expression: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g }),
  Object.freeze({ id: 'google-api-key', expression: /\bAIza[0-9A-Za-z_-]{35}\b/g }),
  Object.freeze({ id: 'slack-token', expression: /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/g }),
])

const PROVIDER_API_KEY = /\bsk-(?:proj-)?[A-Za-z0-9][A-Za-z0-9_-]{31,}\b/g
const CREDENTIAL_ASSIGNMENT = /(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|secret[_-]?access[_-]?key|password|private[_-]?key)\b\s*[:=]\s*["'`]?([A-Za-z0-9+/_=-]{16,})/gi
const CREDENTIAL_URL = /https?:\/\/([^/\s:@]+):([^@\s/]+)@/g
const SENSITIVE_PATH = /(?:^|\/)(?:(?:\.env|\.npmrc|\.pypirc|\.netrc)(?:$|\.)|(?:credentials|secrets?)(?:\.json|\.ya?ml)?$)/i
const SAFE_PATH_SUFFIX = /\.(?:example|sample|template|dist)$/i
const PLACEHOLDER = /(?:^|[-_.])(?:example|sample|placeholder|redacted|dummy|changeme|replace|your|test|fixture|fake|keyless|username|password|secret|user)(?:$|[-_.])/i

function checkedRef(value, label) {
  if (typeof value !== 'string' || value === '' || value.startsWith('-') || /[\s\0]/.test(value)) {
    throw new TypeError(`${label} is not a safe Git revision`)
  }
  return value
}

function runGit(repository, arguments_, { input, encoding = 'utf8', maxBuffer = MAX_BATCH_BYTES } = {}) {
  const result = spawnSync('git', arguments_, {
    cwd: repository,
    input,
    encoding,
    maxBuffer,
    env: process.env,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`git ${arguments_[0]} failed: ${String(result.stderr).trim()}`)
  return result.stdout
}

function changedBlobPaths(repository, range) {
  /** @type {Map<string, Set<string>>} */
  const aliases = new Map()
  const commits = runGit(repository, ['rev-list', '--reverse', range]).trim().split('\n').filter(Boolean)
  for (const commit of commits) {
    const output = runGit(repository, [
      'diff-tree',
      '-r',
      '-m',
      '--root',
      '--no-commit-id',
      '--raw',
      '-z',
      '--no-renames',
      commit,
    ])
    let offset = 0
    while (offset < output.length) {
      const headerEnd = output.indexOf('\0', offset)
      const pathEnd = headerEnd < 0 ? -1 : output.indexOf('\0', headerEnd + 1)
      if (headerEnd < 0 || pathEnd < 0) throw new TypeError('Git changed-path inventory is invalid')
      const header = output.slice(offset, headerEnd)
      const path = output.slice(headerEnd + 1, pathEnd)
      const match = /^:[0-7]{6} [0-7]{6} [0-9a-f]{40,64} ([0-9a-f]{40,64}) [A-Z]$/.exec(header)
      if (match === null || path === '') throw new TypeError('Git changed-path inventory is invalid')
      const oid = match[1]
      if (!/^0+$/.test(oid)) {
        const paths = aliases.get(oid) ?? new Set()
        paths.add(path)
        aliases.set(oid, paths)
      }
      offset = pathEnd + 1
    }
  }
  return aliases
}

function objectList(repository, range, aliases) {
  const output = runGit(repository, ['rev-list', '--objects', range])
  const objects = []
  const seen = new Set()
  for (const line of output.split('\n')) {
    if (line === '') continue
    const space = line.indexOf(' ')
    const oid = space < 0 ? line : line.slice(0, space)
    const path = space < 0 ? undefined : line.slice(space + 1)
    if (!/^[0-9a-f]{40,64}$/.test(oid) || seen.has(oid)) continue
    seen.add(oid)
    objects.push({ oid, path })
  }
  if (objects.length === 0) return []
  const checks = runGit(repository, ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], {
    input: `${objects.map(entry => entry.oid).join('\n')}\n`,
  }).trim().split('\n')
  if (checks.length !== objects.length) throw new TypeError('Git object inventory changed during the audit')
  const blobs = []
  for (let index = 0; index < objects.length; index += 1) {
    const [oid, type, sizeText] = checks[index].split(' ')
    const size = Number.parseInt(sizeText, 10)
    if (oid !== objects[index].oid || !Number.isSafeInteger(size) || size < 0) {
      throw new TypeError('Git object metadata is invalid')
    }
    if (type !== 'blob') continue
    if (size > MAX_OBJECT_BYTES) {
      throw new TypeError(`ClawDSH delta blob ${oid.slice(0, 12)} exceeds the secret-audit size limit`)
    }
    const paths = new Set(aliases.get(oid) ?? [])
    if (objects[index].path !== undefined) paths.add(objects[index].path)
    blobs.push({ oid, size, paths: [...paths].sort() })
  }
  return blobs
}

function batchBlobContents(repository, blobs) {
  if (blobs.length === 0) return []
  const output = runGit(repository, ['cat-file', '--batch'], {
    input: Buffer.from(`${blobs.map(entry => entry.oid).join('\n')}\n`),
    encoding: null,
  })
  const values = []
  let offset = 0
  for (const expected of blobs) {
    const newline = output.indexOf(10, offset)
    if (newline < 0) throw new TypeError('Git blob batch ended before its header')
    const [oid, type, sizeText] = output.subarray(offset, newline).toString('ascii').split(' ')
    const size = Number.parseInt(sizeText, 10)
    if (oid !== expected.oid || type !== 'blob' || size !== expected.size) {
      throw new TypeError('Git blob batch does not match its inventory')
    }
    const start = newline + 1
    const end = start + size
    if (end >= output.length || output[end] !== 10) throw new TypeError('Git blob batch ended before its payload')
    values.push(output.subarray(start, end))
    offset = end + 1
  }
  if (offset !== output.length) throw new TypeError('Git blob batch contains unexpected trailing data')
  return values
}

function placeholder(value) {
  if (value.includes('<') || value.includes('{{') || PLACEHOLDER.test(value)) return true
  const compact = value.replace(/[^A-Za-z0-9]/g, '')
  return compact.length > 0 && new Set(compact.toLowerCase()).size <= 3
}

function scanText(text) {
  const rules = new Set()
  for (const { id, expression } of CONTENT_RULES) {
    expression.lastIndex = 0
    if (expression.test(text)) rules.add(id)
  }
  PROVIDER_API_KEY.lastIndex = 0
  for (const match of text.matchAll(PROVIDER_API_KEY)) {
    if (!placeholder(match[0])) rules.add('provider-api-key')
  }
  CREDENTIAL_ASSIGNMENT.lastIndex = 0
  for (const match of text.matchAll(CREDENTIAL_ASSIGNMENT)) {
    if (!placeholder(match[1])) rules.add('credential-assignment')
  }
  CREDENTIAL_URL.lastIndex = 0
  for (const match of text.matchAll(CREDENTIAL_URL)) {
    if (!placeholder(match[1]) && !placeholder(match[2])) rules.add('credential-url')
  }
  return [...rules].sort()
}

function scanPath(path) {
  if (path === undefined || SAFE_PATH_SUFFIX.test(path)) return []
  return SENSITIVE_PATH.test(path) ? ['sensitive-path'] : []
}

/** Scan every blob introduced by commits after the merge base; never modifies Git history. */
export function auditSecretHistory({ repositoryRoot, base, head = 'HEAD' }) {
  const repository = realpathSync(resolve(repositoryRoot))
  const baseRef = checkedRef(base, 'audit base')
  const headRef = checkedRef(head, 'audit head')
  const mergeBase = runGit(repository, ['merge-base', baseRef, headRef]).trim()
  if (!/^[0-9a-f]{40,64}$/.test(mergeBase)) throw new TypeError('Git merge base is invalid')
  const range = `${mergeBase}..${headRef}`
  const commitCount = Number.parseInt(runGit(repository, ['rev-list', '--count', range]).trim(), 10)
  if (!Number.isSafeInteger(commitCount) || commitCount < 0) throw new TypeError('Git commit count is invalid')
  const aliases = changedBlobPaths(repository, range)
  const blobs = objectList(repository, range, aliases)
  const contents = batchBlobContents(repository, blobs)
  const findings = []
  for (let index = 0; index < blobs.length; index += 1) {
    const blob = blobs[index]
    const contentPath = blob.paths[0] ?? '(unresolved path)'
    for (const rule of scanText(contents[index].toString('utf8'))) {
      findings.push(Object.freeze({
        rule,
        object: blob.oid,
        path: contentPath,
      }))
    }
  }
  for (const [oid, paths] of [...aliases].sort(([left], [right]) => left.localeCompare(right))) {
    for (const path of [...paths].sort()) {
      for (const rule of scanPath(path)) findings.push(Object.freeze({ rule, object: oid, path }))
    }
  }
  const messages = runGit(repository, ['log', '--format=%H%x00%B%x00', range]).split('\0')
  for (let index = 0; index + 1 < messages.length; index += 2) {
    const oid = messages[index].trim()
    if (oid === '') continue
    for (const rule of scanText(messages[index + 1])) {
      findings.push(Object.freeze({ rule, object: oid, path: '(commit message)' }))
    }
  }
  return Object.freeze({
    base: mergeBase,
    head: runGit(repository, ['rev-parse', headRef]).trim(),
    commits: commitCount,
    blobs: blobs.length,
    findings: Object.freeze(findings),
  })
}

function argumentsFrom(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--') || values.has(key)) {
      throw new TypeError('secret-history-audit arguments must be unique --name value pairs')
    }
    values.set(key, value)
  }
  for (const key of values.keys()) {
    if (!['--repository-root', '--base', '--head'].includes(key)) throw new TypeError(`unknown argument ${key}`)
  }
  return values
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const arguments_ = argumentsFrom(process.argv.slice(2))
  const repositoryRoot = arguments_.get('--repository-root') ?? process.cwd()
  const base = arguments_.get('--base')
  if (base === undefined) throw new TypeError('usage: secret-history-audit.mjs --base <revision> [--head <revision>]')
  const result = auditSecretHistory({
    repositoryRoot,
    base,
    head: arguments_.get('--head') ?? 'HEAD',
  })
  if (result.findings.length > 0) {
    for (const finding of result.findings) {
      process.stderr.write(`potential secret: ${finding.rule} in ${finding.path} (${finding.object.slice(0, 12)})\n`)
    }
    throw new TypeError(`secret history audit found ${String(result.findings.length)} high-confidence finding(s); no history was modified`)
  }
  process.stdout.write(`secret history audit passed: ${String(result.commits)} ClawDSH commits, ${String(result.blobs)} introduced blobs\n`)
}
