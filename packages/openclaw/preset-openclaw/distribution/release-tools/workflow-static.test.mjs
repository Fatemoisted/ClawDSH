import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { RELEASE_PACKAGE_NAMES, parseReleaseOrder } from './release-contract.mjs'

const repository = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../..')
const workflow = readFileSync(resolve(repository, '.github/workflows/clawdsh-publish.yml'), 'utf8')
const bootstrapWorkflow = readFileSync(resolve(repository, '.github/workflows/clawdsh-bootstrap.yml'), 'utf8')
const smokeWorkflow = readFileSync(resolve(repository, '.github/workflows/clawdsh-smoke.yml'), 'utf8')

test('publish workflow is fixed to public npm, Node 24, OIDC, and a safe dry-run default', () => {
  const inputs = workflow.slice(workflow.indexOf('    inputs:'), workflow.indexOf('\npermissions:'))
  assert.doesNotMatch(inputs, /^\s+registry:/m)
  assert.match(inputs, /publish:[\s\S]*?default: false/)
  assert.match(workflow, /permissions:\n  contents: read/)
  assert.doesNotMatch(workflow.slice(0, workflow.indexOf('\njobs:')), /id-token: write/)
  assert.match(workflow, /publish:[\s\S]*?permissions:\n      contents: read\n      id-token: write/)
  assert.equal((workflow.match(/persist-credentials: false/g) ?? []).length, 2)
  assert.equal((workflow.match(/actions\/checkout@v6/g) ?? []).length, 2)
  assert.equal((workflow.match(/actions\/setup-node@v6/g) ?? []).length, 2)
  assert.equal((workflow.match(/node-version: 24\.19\.0/g) ?? []).length, 2)
  const prepareJobStart = workflow.indexOf('  prepare:')
  const prepareStepsStart = workflow.indexOf('    steps:', prepareJobStart)
  assert.notEqual(prepareJobStart, -1)
  assert.notEqual(prepareStepsStart, -1)
  const prepareJobEnvironment = workflow.slice(prepareJobStart, prepareStepsStart)
  assert.doesNotMatch(prepareJobEnvironment, /\$\{\{\s*runner\./)
  assert.match(workflow, /CLAWDSH_RELEASE_DIRECTORY=\$RUNNER_TEMP\/clawdsh-release/)
  assert.match(workflow, /CLAWDSH_BUNDLE_DIRECTORY=\$RUNNER_TEMP\/clawdsh-stage\/bundle/)
  assert.match(workflow, /CLAWDSH_BOOTSTRAP_DIRECTORY=\$RUNNER_TEMP\/clawdsh-release\/bootstrap/)
  assert.match(workflow, /secret-history-audit\.mjs --base origin\/master --head HEAD/)
  assert.match(workflow, /bootstrap-publication\.mjs[\s\S]*--require-complete/)
  assert.match(workflow, /Recheck bootstrap registry state after environment approval[\s\S]*bootstrap-publication\.mjs[\s\S]*--require-complete/)
  assert.equal((workflow.match(/--release-index/g) ?? []).length, 2)
  assert.match(workflow, /CLAWDSH_BOOTSTRAP_ATTESTATION:/g)
  assert.match(workflow, /playwright install --with-deps chromium/)
  assert.match(workflow, /npm@10\.9\.7 ci --ignore-scripts --prefix packages\/openclaw\/channel-openclaw\/runtime/)
  assert.match(workflow, /assembled-smoke\.ts/)
  assert.match(workflow, /NODE_OPTIONS: --max-old-space-size=4096/)
  assert.match(workflow, /--registry https:\/\/registry\.npmjs\.org\//)
  assert.match(workflow, /--tag next/g)
  assert.doesNotMatch(workflow, /--tag latest/)
  assert.match(workflow, /--provenance/)
  assert.match(workflow, /public-release-publication\.mjs[\s\S]*--verify-only/)
  assert.match(workflow, /node --test packages\/openclaw\/preset-openclaw\/distribution\/release-tools\/\*\.test\.mjs/)
  assert.doesNotMatch(workflow, /NPM_TOKEN|NODE_AUTH_TOKEN|NPM_CONFIG_REGISTRY/)
  assert.doesNotMatch(workflow, /pnpm\s+-r[\s\S]*publish/)
  assert.match(smokeWorkflow, /permissions:\n  contents: read/)
  assert.equal((smokeWorkflow.match(/persist-credentials: false/g) ?? []).length, 1)
  assert.match(smokeWorkflow, /actions\/checkout@v6/)
  assert.match(smokeWorkflow, /actions\/setup-node@v6/)
  assert.match(smokeWorkflow, /node-version: 24\.19\.0/)
  assert.match(smokeWorkflow, /npm@10\.9\.7 ci --ignore-scripts --prefix packages\/openclaw\/channel-openclaw\/runtime/)
  assert.match(smokeWorkflow, /assembled-smoke\.ts/)
})

test('bootstrap workflow can only prepare deterministic inert artifacts', () => {
  assert.match(bootstrapWorkflow, /permissions:\n  contents: read/)
  assert.doesNotMatch(bootstrapWorkflow, /id-token: write|npm publish|NODE_AUTH_TOKEN|NPM_TOKEN/)
  assert.match(bootstrapWorkflow, /persist-credentials: false/)
  assert.match(bootstrapWorkflow, /fetch-depth: 0/)
  assert.match(bootstrapWorkflow, /node-version: 24\.19\.0/)
  assert.match(bootstrapWorkflow, /secret-history-audit\.mjs --base origin\/master --head HEAD/)
  assert.match(bootstrapWorkflow, /bootstrap-pack\.mjs/)
  assert.match(bootstrapWorkflow, /bootstrap-verify\.mjs/)
  assert.match(bootstrapWorkflow, /clawdsh-npm-bootstrap-0\.1\.0-rc\.0/)
})

test('workflow spells exactly the canonical 13-package topological order', () => {
  const matched = workflow.match(/CLAWDSH_RELEASE_ORDER: '([^']+)'/)
  assert.ok(matched)
  const order = parseReleaseOrder(matched[1])
  assert.deepEqual(order, RELEASE_PACKAGE_NAMES)
  assert.equal(new Set(order).size, 13)
})

test('public publication is gated by confirmations, bootstrap integrity, public state, and smoke evidence', () => {
  for (const input of [
    'scope_ownership_confirmed',
    'trusted_publishing_confirmed',
    'public_repository_approved',
    'rc6_compatibility_confirmed',
  ]) {
    assert.match(workflow, new RegExp(`${input}:[\\s\\S]*?default: false`))
    assert.match(workflow, new RegExp(`inputs\\.${input}`))
  }
  assert.match(workflow, /if: \$\{\{ inputs\.publish && github\.ref == 'refs\/heads\/clawdsh' \}\}/)
  assert.match(workflow, /github\.event\.repository\.private/)
  assert.match(workflow, /CLAWDSH_GITHUB_REF: \$\{\{ github\.ref \}\}/g)
  assert.match(workflow, /release-readiness\.mjs/g)
  assert.match(workflow, /bootstrap-index\.json/g)
  assert.match(workflow, /bootstrap-attestation\.json/g)
  assert.match(workflow, /clean-install-smoke\.mjs/)
  assert.match(workflow, /environment: npm/)
})
