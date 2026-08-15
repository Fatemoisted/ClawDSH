#!/usr/bin/env node
/** Publish a verified release index to npm or to an explicit loopback test registry. */

import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PUBLIC_NPM_REGISTRY,
  PUBLIC_TAG,
  RELEASE_PACKAGE_NAMES,
  parseReleaseOrder,
  tarballFilename,
} from './release-contract.mjs'
import { verifyReleaseIndex } from './release-verify.mjs'

function normalizedRegistry(value, allowLoopback) {
  const url = new URL(value)
  if (url.username || url.password || url.search || url.hash) throw new TypeError('registry URL must not contain credentials or query data')
  if (url.href === PUBLIC_NPM_REGISTRY) return url.href
  const loopback = url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  if (!allowLoopback || !loopback || url.port === '') {
    throw new TypeError('registry must be the public npm registry or an explicitly allowed loopback test registry')
  }
  return url.href
}

function defaultPublisher({ tarball, registry, provenance, tag }) {
  const arguments_ = [
    'publish', tarball,
    '--access', 'public',
    '--tag', tag,
    '--registry', registry,
  ]
  if (provenance) arguments_.push('--provenance')
  const result = spawnSync('npm', arguments_, {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 4 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`npm publish failed:\n${result.stderr || result.stdout}`)
}

/** Publish exactly once per package in dependency-first order. */
export function publishRelease({
  directory,
  registry,
  order,
  tag = PUBLIC_TAG,
  allowLoopback = false,
  provenance = false,
  publish = defaultPublisher,
}) {
  const root = realpathSync(resolve(directory))
  const checked = verifyReleaseIndex(root)
  const names = parseReleaseOrder(order)
  const target = normalizedRegistry(registry, allowLoopback)
  if (tag !== PUBLIC_TAG) throw new TypeError(`release tag must be ${PUBLIC_TAG}`)
  if (target === PUBLIC_NPM_REGISTRY && !provenance) throw new TypeError('public npm publication requires provenance')
  if (target !== PUBLIC_NPM_REGISTRY && provenance) throw new TypeError('test registry publication must not request provenance')
  for (const name of names) {
    publish({
      name,
      tarball: join(root, tarballFilename(name)),
      registry: target,
      provenance,
      tag,
    })
  }
  return checked
}

function parseArguments(arguments_) {
  const flags = new Set()
  const values = new Map()
  for (let index = 0; index < arguments_.length; index += 1) {
    const key = arguments_[index]
    if (key === '--allow-loopback' || key === '--provenance') {
      if (flags.has(key)) throw new TypeError(`duplicate flag ${key}`)
      flags.add(key)
      continue
    }
    const value = arguments_[index + 1]
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--') || values.has(key)) {
      throw new TypeError('publish-release arguments are invalid')
    }
    values.set(key, value)
    index += 1
  }
  const allowed = new Set(['--directory', '--registry', '--order', '--tag'])
  for (const key of values.keys()) if (!allowed.has(key)) throw new TypeError(`unknown argument ${key}`)
  return { flags, values }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const { flags, values } = parseArguments(process.argv.slice(2))
  const result = publishRelease({
    directory: values.get('--directory'),
    registry: values.get('--registry'),
    order: values.get('--order') ?? RELEASE_PACKAGE_NAMES.join(','),
    tag: values.get('--tag') ?? PUBLIC_TAG,
    allowLoopback: flags.has('--allow-loopback'),
    provenance: flags.has('--provenance'),
  })
  process.stdout.write(`published ${String(result.packages.length)} ClawDSH packages to ${values.get('--registry')}\n`)
}
