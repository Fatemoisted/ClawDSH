import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import {
  EXPECTED_RESCOPE_SCRIPT_BLOB,
  EXPECTED_RESIDUE_PATHS,
  EXPECTED_UPSTREAM_SHA,
  evaluateRescopeBaseline,
  verifyClawdshRescopeBaseline,
} from './verify-clawdsh-rescope-baseline.mjs'

const root = resolve(import.meta.dirname, '..')

function output({
  paths = EXPECTED_RESIDUE_PATHS,
  markdown = '  Markdown fences and docs prose    4 file(s), 38 line(s)',
  code = '  code specifiers            22 file(s), 73 line(s)',
  extraFailure,
} = {}) {
  return {
    stdout: [
      'rescope-vendor: check over 4816 tracked files',
      markdown,
      code,
    ].join('\n') + '\n',
    stderr: [
      ...paths.map(path => `rescope-vendor: residue: ${path} still carries a pre-rescope name token`),
      ...(extraFailure ? [extraFailure] : []),
      'rescope-vendor: 26 problem(s); the mapping or an upstream site moved.',
    ].join('\n') + '\n',
  }
}

function baseline(overrides = {}) {
  return {
    status: 1,
    upstreamSha: EXPECTED_UPSTREAM_SHA,
    scriptBlob: EXPECTED_RESCOPE_SCRIPT_BLOB,
    ...output(),
    ...overrides,
  }
}

test('accepts a clean rescope check without consulting the baseline identity', () => {
  assert.deepEqual(evaluateRescopeBaseline({ status: 0, stdout: '', stderr: '' }), {
    result: 'clean',
    residues: 0,
  })
  assert.deepEqual(verifyClawdshRescopeBaseline({
    root,
    execute: () => ({ status: 0, stdout: '', stderr: '' }),
    resolveGit: () => assert.fail('a clean rescope check must not consult Git identity'),
  }), {
    result: 'clean',
    residues: 0,
  })
})

test('accepts only the exact upstream false-positive baseline', () => {
  assert.deepEqual(evaluateRescopeBaseline(baseline()), {
    result: 'accepted-upstream-baseline',
    residues: 26,
    markdownFiles: 4,
    markdownLines: 38,
    codeFiles: 22,
    codeLines: 73,
  })
})

test('rejects upstream, script, count, path, duplicate, and extra-failure drift', async t => {
  const missingPath = EXPECTED_RESIDUE_PATHS.slice(1)
  const extraPath = [...EXPECTED_RESIDUE_PATHS, 'packages/openclaw/unexpected.ts']
  const duplicatePath = [...EXPECTED_RESIDUE_PATHS.slice(0, -1), EXPECTED_RESIDUE_PATHS[0]]
  const cases = [
    ['upstream SHA', { upstreamSha: '0'.repeat(40) }, /upstream ref/],
    ['script blob', { scriptBlob: '1'.repeat(40) }, /script blob/],
    ['Markdown counts', output({ markdown: '  Markdown fences and docs prose    4 file(s), 39 line(s)' }), /exact 4\/38/],
    ['code counts', output({ code: '  code specifiers            22 file(s), 74 line(s)' }), /exact 4\/38/],
    ['missing path', output({ paths: missingPath }), /missing or additional diagnostic/],
    ['extra path', output({ paths: extraPath }), /missing or additional diagnostic/],
    ['duplicate path', output({ paths: duplicatePath }), /exact 26-file/],
    ['extra failure', output({ extraFailure: 'rescope-vendor: postcondition: unexpected' }), /missing or additional diagnostic/],
    ['unexpected exit', { status: 2 }, /instead of 0 or 1/],
  ]
  for (const [name, overrides, pattern] of cases) {
    await t.test(name, () => {
      assert.throws(() => evaluateRescopeBaseline(baseline(overrides)), pattern)
    })
  }
})

test('publish workflow runs the exact exception, complete remaining hygiene, and package-owned Playwright', () => {
  const workflow = readFileSync(resolve(root, '.github/workflows/clawdsh-publish.yml'), 'utf8')
  assert.match(workflow, /pnpm run lint/)
  assert.match(workflow, /pnpm run doc-sync/)
  assert.match(workflow, /node --test tools\/verify-clawdsh-rescope-baseline\.test\.mjs/)
  assert.match(workflow, /node tools\/verify-clawdsh-rescope-baseline\.mjs --upstream-ref origin\/master/)
  for (const gate of [
    'knip',
    'publint',
    'constraints',
    'verify-dsh-package-licenses',
    'verify-package-invariants',
    'verify-built-package-invariants',
    'verify-cordis-config',
    'verify-node-next-types',
    'verify-runtime-closure',
    'verify-vendored-links',
  ]) {
    assert.match(workflow, new RegExp(`pnpm run ${gate}`))
  }
  assert.match(workflow, /pnpm --filter @deepseek-ai\/dsh-web-frontend exec playwright install --with-deps chromium/)
  assert.doesNotMatch(workflow, /pnpm --dir apps\/web exec playwright/)
})
