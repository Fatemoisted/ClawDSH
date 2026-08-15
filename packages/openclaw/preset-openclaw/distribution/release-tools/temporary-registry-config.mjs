#!/usr/bin/env node
/** Write a fail-closed Verdaccio config used only by the release smoke job. */

import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Create a local registry that publishes only @clawdsh and proxies all dependencies to public npm. */
export function writeTemporaryRegistryConfig({ output, stateDirectory }) {
  const state = resolve(stateDirectory)
  if (existsSync(state)) throw new TypeError('temporary registry state directory must not exist')
  mkdirSync(state, { recursive: true, mode: 0o700 })
  const config = {
    storage: `${state}/storage`,
    auth: { htpasswd: { file: `${state}/htpasswd`, max_users: 1 } },
    uplinks: { npmjs: { url: 'https://registry.npmjs.org/' } },
    packages: {
      '@clawdsh/*': { access: '$all', publish: '$all', unpublish: '$none' },
      '@*/*': { access: '$all', publish: '$authenticated', proxy: 'npmjs' },
      '**': { access: '$all', publish: '$authenticated', proxy: 'npmjs' },
    },
    web: { enable: false },
    security: { api: { legacy: false } },
  }
  const target = resolve(output)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  return realpathSync(target)
}

function parseArguments(arguments_) {
  if (arguments_.length !== 4 || arguments_[0] !== '--output' || arguments_[2] !== '--state') {
    throw new TypeError('usage: temporary-registry-config.mjs --output <path> --state <directory>')
  }
  return { output: arguments_[1], stateDirectory: arguments_[3] }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const path = writeTemporaryRegistryConfig(parseArguments(process.argv.slice(2)))
  process.stdout.write(`${path}\n`)
}
