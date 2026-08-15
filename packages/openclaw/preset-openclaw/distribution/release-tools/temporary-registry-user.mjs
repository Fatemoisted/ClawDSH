#!/usr/bin/env node
/** Create the one ephemeral publisher accepted by the loopback release registry. */

import { randomBytes } from 'node:crypto'
import { existsSync, realpathSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function loopbackRegistry(value) {
  const url = new URL(value)
  if (url.protocol !== 'http:'
    || (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost')
    || url.port === ''
    || url.username
    || url.password
    || url.search
    || url.hash) {
    throw new TypeError('temporary publisher requires an unauthenticated loopback registry URL')
  }
  return url
}

/** Register one random local-only user and write its npm token without returning or logging it. */
export async function writeTemporaryRegistryUser({ registry, output, request = fetch }) {
  const url = loopbackRegistry(registry)
  const username = `clawdsh-smoke-${randomBytes(8).toString('hex')}`
  const password = randomBytes(32).toString('base64url')
  const endpoint = new URL(`-/user/org.couchdb.user:${username}`, url)
  const response = await request(endpoint, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      _id: `org.couchdb.user:${username}`,
      name: username,
      password,
      email: `${username}@invalid.example`,
      type: 'user',
      roles: [],
    }),
  })
  if (!response.ok) throw new Error(`temporary registry user creation failed with HTTP ${String(response.status)}`)
  const result = await response.json()
  if (typeof result.token !== 'string' || result.token.length < 16 || /[\r\n]/.test(result.token)) {
    throw new TypeError('temporary registry returned an invalid token')
  }
  const target = resolve(output)
  if (existsSync(target)) throw new TypeError('temporary npm userconfig already exists')
  const registryPath = `${url.host}${url.pathname}`.replace(/\/+$/, '/')
  writeFileSync(target, `//${registryPath}:_authToken=${result.token}\n`, { flag: 'wx', mode: 0o600 })
  return realpathSync(target)
}

function parseArguments(arguments_) {
  if (arguments_.length !== 4 || arguments_[0] !== '--registry' || arguments_[2] !== '--output') {
    throw new TypeError('usage: temporary-registry-user.mjs --registry <loopback-url> --output <npmrc>')
  }
  return { registry: arguments_[1], output: arguments_[3] }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const path = await writeTemporaryRegistryUser(parseArguments(process.argv.slice(2)))
  process.stdout.write(`${path}\n`)
}
