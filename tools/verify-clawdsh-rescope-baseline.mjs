#!/usr/bin/env node
/** Accept a clean vendor-rescope check or one exact upstream false-positive baseline. */

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(import.meta.dirname, '..')

/** Upstream commit whose rescope output is the reviewed RC exception. */
export const EXPECTED_UPSTREAM_SHA = '47f943859bef60e4160492346772ded9b24f765a'
/** Git blob of the unmodified upstream rescope implementation. */
export const EXPECTED_RESCOPE_SCRIPT_BLOB = '3f5cb525c2821e37adab4689e59093e361975104'
/** Complete file set in the reviewed upstream false-positive report. */
export const EXPECTED_RESIDUE_PATHS = Object.freeze([
  'docs/event-producer-consumer.md',
  'docs/event-producer-consumer.zh.md',
  'docs/subsystems/extensions.md',
  'docs/subsystems/extensions.zh.md',
  'packages/api/remotes/src/remote-events.ts',
  'packages/client/ui-settings-plugin-inventory/src/client/PluginInventorySettingsTab.tsx',
  'packages/extensions/cordis-client-runner/src/client/index.ts',
  'packages/extensions/cordis-client-runner/src/client/runtime.ts',
  'packages/extensions/cordis-client-runner/tests/orchestrator.client.spec.ts',
  'packages/extensions/cordis-client-runner/tests/plugin.client.spec.ts',
  'packages/extensions/cordis-host-runner/src/index.ts',
  'packages/extensions/cordis-host-runner/src/inspect-registry.ts',
  'packages/extensions/cordis-host-runner/src/types.ts',
  'packages/extensions/cordis-host-runner/tests/helpers.ts',
  'packages/extensions/cordis-host-runner/tests/runner.spec.ts',
  'packages/extensions/cordis-host-runner/tests/versioning.spec.ts',
  'packages/extensions/tool-cordis/src/api-catalog.ts',
  'packages/extensions/tool-cordis/src/providers.ts',
  'packages/extensions/ui-cordis/src/client/CordisActionRow.tsx',
  'packages/extensions/ui-cordis/src/client/CordisDefineRow.tsx',
  'packages/extensions/ui-cordis/src/client/CordisPanel.tsx',
  'packages/extensions/ui-cordis/src/client/CordisRunRow.tsx',
  'packages/extensions/ui-cordis/src/client/index.ts',
  'packages/extensions/ui-cordis/src/client/inventory.ts',
  'packages/extensions/ui-cordis/src/client/locales.ts',
  'scripts/gen-cordis-catalog.ts',
])

const EXPECTED_STDOUT_SUMMARIES = Object.freeze([
  '  Markdown fences and docs prose    4 file(s), 38 line(s)',
  '  code specifiers            22 file(s), 73 line(s)',
])
const EXPECTED_FINAL_FAILURE = 'rescope-vendor: 26 problem(s); the mapping or an upstream site moved.'
const RESIDUE_PATTERN = /^rescope-vendor: residue: (.+) still carries a pre-rescope name token$/

function nonblankLines(value) {
  return String(value ?? '').split(/\r?\n/).filter(line => line !== '')
}

function reject(reason) {
  throw new TypeError(`ClawDSH rescope baseline rejected: ${reason}`)
}

/** Classify captured rescope output without invoking Git or a subprocess. */
export function evaluateRescopeBaseline({
  status,
  stdout,
  stderr,
  upstreamSha,
  scriptBlob,
}) {
  if (status === 0) return Object.freeze({ result: 'clean', residues: 0 })
  if (status !== 1) reject(`rescope check exited with ${String(status)} instead of 0 or 1`)
  if (upstreamSha !== EXPECTED_UPSTREAM_SHA) {
    reject(`upstream ref is ${String(upstreamSha)}, expected ${EXPECTED_UPSTREAM_SHA}`)
  }
  if (scriptBlob !== EXPECTED_RESCOPE_SCRIPT_BLOB) {
    reject(`rescope script blob is ${String(scriptBlob)}, expected ${EXPECTED_RESCOPE_SCRIPT_BLOB}`)
  }

  const output = nonblankLines(stdout)
  if (output.length !== 3
    || !/^rescope-vendor: check over [1-9][0-9]* tracked files$/.test(output[0])
    || output[1] !== EXPECTED_STDOUT_SUMMARIES[0]
    || output[2] !== EXPECTED_STDOUT_SUMMARIES[1]) {
    reject('summary must contain only the exact 4/38 Markdown and 22/73 code counts')
  }

  const failures = nonblankLines(stderr)
  if (failures.length !== EXPECTED_RESIDUE_PATHS.length + 1
    || failures.at(-1) !== EXPECTED_FINAL_FAILURE) {
    reject('failure output contains a missing or additional diagnostic')
  }
  const residues = failures.slice(0, -1).map((line) => {
    const matched = line.match(RESIDUE_PATTERN)
    if (!matched) reject(`unexpected failure ${JSON.stringify(line)}`)
    return matched[1]
  })
  const unique = new Set(residues)
  const actual = [...unique].sort()
  const expected = [...EXPECTED_RESIDUE_PATHS].sort()
  if (unique.size !== residues.length
    || actual.length !== expected.length
    || actual.some((path, index) => path !== expected[index])) {
    reject('residue paths do not equal the exact 26-file upstream baseline')
  }
  return Object.freeze({
    result: 'accepted-upstream-baseline',
    residues: residues.length,
    markdownFiles: 4,
    markdownLines: 38,
    codeFiles: 22,
    codeLines: 73,
  })
}

function runRescope(root) {
  const require = createRequire(resolve(root, 'package.json'))
  const cli = require.resolve('tsx/cli')
  return spawnSync(process.execPath, [cli, 'scripts/rescope-vendor.ts', '--check'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  })
}

function gitValue(root, arguments_, label) {
  const result = spawnSync('git', arguments_, { cwd: root, encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${label} failed:\n${result.stderr || result.stdout}`)
  return result.stdout.trim()
}

/** Execute the real upstream check and validate any failure against the closed baseline. */
export function verifyClawdshRescopeBaseline({
  root = repositoryRoot,
  upstreamRef = 'origin/master',
  execute = runRescope,
  resolveGit = gitValue,
} = {}) {
  const repository = realpathSync(resolve(root))
  const result = execute(repository)
  if (result.error) throw result.error
  if (result.status === 0) {
    return evaluateRescopeBaseline({
      status: 0,
      stdout: result.stdout,
      stderr: result.stderr,
    })
  }
  const upstreamSha = resolveGit(repository, ['rev-parse', '--verify', `${upstreamRef}^{commit}`], 'upstream ref resolution')
  const scriptBlob = resolveGit(repository, ['hash-object', 'scripts/rescope-vendor.ts'], 'rescope script hashing')
  return evaluateRescopeBaseline({
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    upstreamSha,
    scriptBlob,
  })
}

function parseArguments(argv) {
  if (argv.length === 0) return 'origin/master'
  if (argv.length !== 2 || argv[0] !== '--upstream-ref' || !argv[1] || argv[1].startsWith('-')) {
    throw new TypeError('usage: verify-clawdsh-rescope-baseline.mjs [--upstream-ref <git-ref>]')
  }
  return argv[1]
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const result = verifyClawdshRescopeBaseline({ upstreamRef: parseArguments(process.argv.slice(2)) })
  if (result.result === 'clean') {
    process.stdout.write('verify-clawdsh-rescope-baseline: upstream rescope check passed; no exception used\n')
  } else {
    process.stdout.write('verify-clawdsh-rescope-baseline: accepted exact upstream 47f9438 baseline (26 files; 38 Markdown lines; 73 code lines)\n')
  }
}
