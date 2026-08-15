#!/usr/bin/env node
/** Execute installed ClawDSH initialization inside the smoke test's scrubbed process. */

import { spawnSync } from 'node:child_process'
import { lstatSync, realpathSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024

function ordinaryPath(value, kind, label) {
  if (typeof value !== 'string' || !isAbsolute(value)) throw new TypeError(`${label} must be an absolute path`)
  const path = resolve(value)
  const metadata = lstatSync(path)
  if (metadata.isSymbolicLink() || (kind === 'file' ? !metadata.isFile() : !metadata.isDirectory())) {
    throw new TypeError(`${label} must be an ordinary ${kind}`)
  }
  return realpathSync(path)
}

function parseArguments(arguments_) {
  if (arguments_.length !== 4
    || arguments_[0] !== '--cli-module'
    || arguments_[2] !== '--bundle-root') {
    throw new TypeError('usage: clean-install-smoke-init.mjs --cli-module <path> --bundle-root <path>')
  }
  return {
    cliModule: ordinaryPath(arguments_[1], 'file', 'CLI module'),
    bundleRoot: ordinaryPath(arguments_[3], 'directory', 'bundle root'),
  }
}

function installProfile(cwd) {
  const registry = process.env.NPM_CONFIG_REGISTRY
  if (registry === undefined) throw new TypeError('isolated npm registry is missing')
  const result = spawnSync('npm', [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    '--legacy-peer-deps',
    '--registry', registry,
  ], {
    cwd,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: MAX_OUTPUT_BYTES,
    timeout: 600_000,
  })
  if (result.error) throw result.error
  if (result.status !== 0 || result.signal !== null) {
    throw new Error(`temporary-registry profile install failed (code ${String(result.status)}, signal ${String(result.signal)})`)
  }
}

async function initializeInstalledCli(arguments_) {
  const { cliModule, bundleRoot } = parseArguments(arguments_)
  const imported = await import(pathToFileURL(cliModule).href)
  if (typeof imported.runCli !== 'function') throw new TypeError('installed CLI has no runCli API')
  const result = await imported.runCli(['init'], {
    home: process.env.DSH_HOME,
    bundleRoot,
    npmRunner: installProfile,
    out() {},
    warn() {},
  })
  if (result !== 0) throw new Error(`installed CLI init returned ${String(result)}`)
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  await initializeInstalledCli(process.argv.slice(2))
}
