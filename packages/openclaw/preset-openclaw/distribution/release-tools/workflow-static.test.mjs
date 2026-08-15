import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { RELEASE_PACKAGE_NAMES, parseReleaseOrder } from './release-contract.mjs'

const repository = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../..')
const workflow = readFileSync(resolve(repository, '.github/workflows/clawdsh-publish.yml'), 'utf8')
const smokeWorkflow = readFileSync(resolve(repository, '.github/workflows/clawdsh-smoke.yml'), 'utf8')

test('publish workflow is fixed to public npm, Node 24, OIDC, and a safe dry-run default', () => {
  const inputs = workflow.slice(workflow.indexOf('    inputs:'), workflow.indexOf('\npermissions:'))
  const prepareHeader = workflow.slice(workflow.indexOf('  prepare:'), workflow.indexOf('    steps:'))
  assert.doesNotMatch(inputs, /^\s+registry:/m)
  assert.doesNotMatch(prepareHeader, /\$\{\{\s*runner\./)
  assert.match(workflow, /CLAWDSH_RELEASE_DIRECTORY=\$RUNNER_TEMP\/clawdsh-release/)
  assert.match(workflow, /CLAWDSH_BUNDLE_DIRECTORY=\$RUNNER_TEMP\/clawdsh-stage\/bundle/)
  assert.match(inputs, /publish:[\s\S]*?default: false/)
  assert.match(workflow, /permissions:\n  contents: read/)
  assert.doesNotMatch(workflow.slice(0, workflow.indexOf('\njobs:')), /id-token: write/)
  assert.match(workflow, /publish:[\s\S]*?permissions:\n      contents: read\n      id-token: write/)
  assert.equal((workflow.match(/persist-credentials: false/g) ?? []).length, 2)
  assert.equal((workflow.match(/actions\/checkout@[0-9a-f]{40}/g) ?? []).length, 2)
  assert.equal((workflow.match(/actions\/setup-node@[0-9a-f]{40}/g) ?? []).length, 2)
  assert.match(workflow, /pnpm\/action-setup@[0-9a-f]{40}/)
  assert.match(workflow, /actions\/upload-artifact@[0-9a-f]{40}/)
  assert.match(workflow, /actions\/download-artifact@[0-9a-f]{40}/)
  assert.match(workflow, /node-version: 24\.19\.0/)
  assert.match(workflow, /npm@10\.9\.7 ci --ignore-scripts --prefix packages\/openclaw\/channel-openclaw\/runtime/)
  assert.match(workflow, /assembled-smoke\.ts/)
  assert.match(workflow, /NODE_OPTIONS: --max-old-space-size=4096/)
  assert.match(workflow, /--registry https:\/\/registry\.npmjs\.org\//)
  assert.match(workflow, /--tag next/g)
  assert.match(workflow, /--provenance/)
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

test('workflow spells exactly the canonical 13-package topological order', () => {
  const matched = workflow.match(/CLAWDSH_RELEASE_ORDER: '([^']+)'/)
  assert.ok(matched)
  const order = parseReleaseOrder(matched[1])
  assert.deepEqual(order, RELEASE_PACKAGE_NAMES)
  assert.equal(new Set(order).size, 13)
})

test('public publication is gated by all four confirmations, public repository state, and smoke evidence', () => {
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
  assert.match(workflow, /clean-install-smoke\.mjs/)
  assert.match(workflow, /environment: npm/)
})
