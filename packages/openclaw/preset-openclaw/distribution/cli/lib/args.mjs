/** Strict ClawDSH command-line parser; only documented web flags reach dsh. */

import { PROFILE_ID } from './constants.mjs'

const FORWARD_VALUE_FLAGS = new Set(['--host', '--port', '--trusted-host'])

/** @typedef {{mode: 'help'} | {mode: 'version'} | {mode: 'init', resetPreset: boolean} | {mode: 'doctor'} | {mode: 'channel-install'} | {mode: 'channel-doctor'} | {mode: 'start', profile: string, forwarded: string[]} | {mode: 'init-start', profile: string, forwarded: string[]}} CliInvocation */

/** @param {readonly string[]} argv @param {number} index @param {string} option @returns {string} */
function requireValue(argv, index, option) {
  const value = argv[index + 1]
  if (value === undefined || value === '' || value.startsWith('--')) throw new TypeError(`${option} requires a value`)
  return value
}

/** @param {readonly string[]} argv @param {boolean} allowProfile @returns {{profile: string, forwarded: string[]}} */
function parseForward(argv, allowProfile) {
  /** @type {string[]} */
  const forwarded = []
  let profile = PROFILE_ID
  let profileSeen = false
  const singleton = new Set()
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (allowProfile && token === '--profile') {
      if (profileSeen) throw new TypeError('--profile may be supplied only once')
      profile = requireValue(argv, index, token)
      if (profile === '.' || profile === '..' || profile === 'node_modules'
        || profile.includes('/') || profile.includes('\\')) throw new TypeError('--profile has an invalid name')
      profileSeen = true
      index += 1
      continue
    }
    const equals = token.indexOf('=')
    const option = equals === -1 ? token : token.slice(0, equals)
    if (!FORWARD_VALUE_FLAGS.has(option)) throw new TypeError(`unknown ClawDSH option ${JSON.stringify(token)}`)
    if (option !== '--trusted-host' && singleton.has(option)) throw new TypeError(`${option} may be supplied only once`)
    singleton.add(option)
    if (equals !== -1) {
      if (token.slice(equals + 1) === '') throw new TypeError(`${option} requires a value`)
      forwarded.push(token)
    } else {
      const value = requireValue(argv, index, option)
      forwarded.push(token, value)
      index += 1
    }
  }
  return { profile, forwarded }
}

/** Parse one public CLI invocation. */
/** @param {readonly string[]} argv @returns {CliInvocation} */
export function parseArgs(argv) {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) return { mode: 'help' }
  if (argv.length === 1 && (argv[0] === '--version' || argv[0] === '-V')) return { mode: 'version' }
  const command = argv[0]
  if (command === 'init') {
    const rest = argv.slice(1)
    if (rest.length === 0) return { mode: 'init', resetPreset: false }
    if (rest.length === 1 && rest[0] === '--reset-preset') return { mode: 'init', resetPreset: true }
    throw new TypeError('usage: clawdsh init [--reset-preset]')
  }
  if (command === 'doctor') {
    if (argv.length !== 1) throw new TypeError('usage: clawdsh doctor')
    return { mode: 'doctor' }
  }
  if (command === 'channel') {
    if (argv.length !== 2 || (argv[1] !== 'install' && argv[1] !== 'doctor')) {
      throw new TypeError('usage: clawdsh channel (install|doctor)')
    }
    return argv[1] === 'install' ? { mode: 'channel-install' } : { mode: 'channel-doctor' }
  }
  if (command === 'start') {
    const parsed = parseForward(argv.slice(1), true)
    return { mode: 'start', ...parsed }
  }
  if (command !== undefined && !command.startsWith('--')) throw new TypeError(`unknown ClawDSH command ${JSON.stringify(command)}`)
  const parsed = parseForward(argv, false)
  return { mode: 'init-start', ...parsed }
}

/** Human-readable public command surface. */
export const HELP = `ClawDSH local product

Usage:
  clawdsh [--host <host>] [--port <port>] [--trusted-host <host>]
  clawdsh init [--reset-preset]
  clawdsh start [--profile <name>] [--host <host>] [--port <port>] [--trusted-host <host>]
  clawdsh doctor
  clawdsh channel install
  clawdsh channel doctor
`
