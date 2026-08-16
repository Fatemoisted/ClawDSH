/** Public ClawDSH CLI orchestration API. */

import { spawn } from 'node:child_process'
import { lstatSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { parseArgs, HELP } from './args.mjs'
import { inspectBundle, packageRoot } from './bundle.mjs'
import { createChannelManager } from './channel.mjs'
import { CLI_VERSION, DSH_NAME, DSH_VERSION } from './constants.mjs'
import { createInstaller } from './installer.mjs'
import { safeRelative } from './files.mjs'
import { acquireManagementLock } from './transaction.mjs'

/** @typedef {{binary: string, profile: string, forwarded: string[], home: string}} DshRun */
/** @typedef {{execPath: string, environment: NodeJS.ProcessEnv, onSignal: (signal: NodeJS.Signals, listener: () => void) => void, offSignal: (signal: NodeJS.Signals, listener: () => void) => void, signalSelf: (signal: NodeJS.Signals) => void}} DshRunnerHost */
/** @typedef {{spawnChild?: typeof spawn, host?: DshRunnerHost}} DshRunnerOptions */
/** @typedef {{home?: string, environment?: NodeJS.ProcessEnv, bundleRoot?: string, npmRunner?: (cwd: string) => void, runtimeRunner?: (cwd: string) => void, acquire?: (url: string, destination: string) => Promise<void>, bridgeRoot?: string, now?: () => Date, out?: (message: string) => void, warn?: (message: string) => void, dshBinary?: string, dshRunner?: (invocation: DshRun) => number | Promise<number>}} RunCliOptions */

const FORWARDED_SIGNALS = /** @type {const} */ (['SIGINT', 'SIGTERM', 'SIGHUP'])

/** Resolve the same Harness home convention used by dsh. */
/** @param {NodeJS.ProcessEnv} [environment] @returns {string} */
export function resolveHome(environment = process.env) {
  const configured = environment.DSH_HOME
  const selected = configured !== undefined && configured.trim().length > 0
    ? configured
    : join(homedir(), '.dsh')
  const expanded = selected === '~'
    ? homedir()
    : selected.startsWith('~/') || selected.startsWith('~\\')
      ? join(homedir(), selected.slice(2))
      : selected
  return resolve(expanded)
}

/** Resolve and validate the exact bundled dsh executable. */
/** @param {string | URL} [anchor] @returns {string} */
export function resolveDshBinary(anchor = import.meta.url) {
  const require = createRequire(anchor)
  const manifestPath = require.resolve(`${DSH_NAME}/package.json`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.name !== DSH_NAME || manifest.version !== DSH_VERSION
    || manifest.bin === null || typeof manifest.bin !== 'object' || Array.isArray(manifest.bin)
    || typeof manifest.bin.dsh !== 'string') {
    throw new TypeError(`expected ${DSH_NAME}@${DSH_VERSION} with a dsh binary`)
  }
  const relativeBin = safeRelative(manifest.bin.dsh, 'dsh binary path')
  const binary = resolve(dirname(manifestPath), relativeBin)
  const metadata = lstatSync(binary)
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new TypeError('the exact dsh binary must be an ordinary file')
  return binary
}

/** Spawn the exact CLI dependency's dsh binary and preserve its terminal lifecycle. */
/** @param {DshRun} invocation @param {DshRunnerOptions} [options] @returns {Promise<number>} */
export async function defaultDshRunner({ binary, profile, forwarded, home }, options = {}) {
  const host = options.host ?? {
    execPath: process.execPath,
    environment: process.env,
    onSignal: (signal, listener) => process.on(signal, listener),
    offSignal: (signal, listener) => process.off(signal, listener),
    signalSelf: signal => { process.kill(process.pid, signal) },
  }
  const child = (options.spawnChild ?? spawn)(host.execPath, [binary, '--profile', profile, ...forwarded], {
    stdio: 'inherit',
    env: { ...host.environment, DSH_HOME: home },
  })
  return await new Promise((resolveRun, rejectRun) => {
    let settled = false
    /** @type {NodeJS.Signals | undefined} */
    let receivedSignal
    /** @type {Map<NodeJS.Signals, () => void>} */
    const signalListeners = new Map()

    const cleanup = () => {
      for (const [signal, listener] of signalListeners) host.offSignal(signal, listener)
      signalListeners.clear()
      child.off('error', onError)
      child.off('close', onClose)
    }
    const beginSettlement = () => {
      if (settled) return false
      settled = true
      cleanup()
      return true
    }
    /** @param {Error} error */
    const onError = error => {
      if (!beginSettlement()) return
      rejectRun(error)
    }
    /** @param {number | null} code @param {NodeJS.Signals | null} childSignal */
    const onClose = (code, childSignal) => {
      if (!beginSettlement()) return
      const terminalSignal = receivedSignal ?? childSignal ?? undefined
      if (terminalSignal !== undefined) {
        try {
          host.signalSelf(terminalSignal)
        } catch (error) {
          rejectRun(error)
          return
        }
        resolveRun(1)
        return
      }
      resolveRun(code ?? 1)
    }

    child.once('error', onError)
    child.once('close', onClose)
    for (const signal of FORWARDED_SIGNALS) {
      const listener = () => {
        receivedSignal ??= signal
        if (child.exitCode !== null || child.signalCode !== null) return
        try {
          if (!child.kill(signal)) onError(new Error(`failed to forward ${signal} to dsh`))
        } catch (error) {
          onError(error instanceof Error ? error : new Error(String(error)))
        }
      }
      signalListeners.set(signal, listener)
      host.onSignal(signal, listener)
    }
  })
}

/** Execute one parsed command with injectable filesystem/network/process dependencies. */
/** @param {readonly string[]} argv @param {RunCliOptions} [options] @returns {Promise<number>} */
export async function runCli(argv, options = {}) {
  const invocation = parseArgs(argv)
  const out = options.out ?? ((/** @type {string} */ message) => process.stdout.write(`${message}\n`))
  const warn = options.warn ?? ((/** @type {string} */ message) => process.stderr.write(`${message}\n`))
  if (invocation.mode === 'help') {
    out(HELP.trimEnd())
    return 0
  }
  if (invocation.mode === 'version') {
    out(CLI_VERSION)
    return 0
  }
  const home = resolve(options.home ?? resolveHome(options.environment))
  const bundleRoot = resolve(options.bundleRoot ?? packageRoot('@clawdsh/dsh-bundle'))
  inspectBundle(bundleRoot)
  if (invocation.mode === 'migrate-source' && !invocation.apply) {
    createInstaller({
      home,
      bundleRoot,
      npmRunner: options.npmRunner,
      now: options.now,
      out,
      warn,
    }).migrateSource({ apply: false, backupModified: false })
    return 0
  }
  if (invocation.mode !== 'start') {
    const releaseLock = acquireManagementLock(home)
    try {
      const installer = createInstaller({
        home,
        bundleRoot,
        npmRunner: options.npmRunner,
        now: options.now,
        out,
        warn,
      })
      const channel = createChannelManager({
        home,
        channelRoot: join(bundleRoot, 'channel'),
        acquire: options.acquire,
        runtimeRunner: options.runtimeRunner,
        bridgeRoot: options.bridgeRoot,
        now: options.now,
        out,
      })
      if (invocation.mode === 'init') {
        installer.init({ resetPreset: invocation.resetPreset })
        return 0
      }
      if (invocation.mode === 'doctor') {
        installer.doctor()
        return 0
      }
      if (invocation.mode === 'migrate-source') {
        installer.migrateSource({ apply: invocation.apply, backupModified: invocation.backupModified })
        return 0
      }
      if (invocation.mode === 'channel-install') {
        await channel.install()
        return 0
      }
      if (invocation.mode === 'channel-doctor') {
        await channel.doctor()
        return 0
      }
      installer.init()
    } finally {
      releaseLock()
    }
  }
  const dshRunner = options.dshRunner ?? defaultDshRunner
  const binary = options.dshBinary ?? resolveDshBinary()
  return dshRunner({ binary, profile: invocation.profile, forwarded: invocation.forwarded, home })
}

export { createChannelManager } from './channel.mjs'
export { createInstaller, readMarker } from './installer.mjs'
export { inspectNpmTarball, safeArchivePath } from './archive.mjs'
export { parseArgs } from './args.mjs'
