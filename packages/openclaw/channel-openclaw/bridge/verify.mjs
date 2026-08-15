import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { readBridgeEnvironment } from './shared/openclaw-runtime.js'

const root = dirname(fileURLToPath(import.meta.url))
const javascript = [
  'shared/durable-store.js',
  'shared/media.js',
  'shared/ndjson-rpc.js',
  'shared/openclaw-runtime.js',
  'shared/protocol-v1.js',
  'shared/transcript-mirror.js',
  'stable-v1/index.js',
  'canary-v2/provider-policy-api.js',
]
for (const relativePath of javascript) {
  const result = spawnSync(process.execPath, ['--check', join(root, relativePath)], { encoding: 'utf8' })
  assert.equal(result.status, 0, `${relativePath}: ${result.stderr}`)
}

for (const relativePath of ['canary-v2/index.ts', 'canary-v2/provider-policy-api.ts']) {
  const source = await readFile(join(root, relativePath), 'utf8')
  const result = ts.transpileModule(source, {
    fileName: relativePath,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      isolatedModules: true,
      strict: true,
    },
  })
  const errors = (result.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
  assert.deepEqual(errors, [], `${relativePath}: ${errors.map(error => error.messageText).join('; ')}`)
}

const stableManifest = await json('stable-v1/openclaw.plugin.json')
const stablePackage = await json('stable-v1/package.json')
const canaryManifest = await json('canary-v2/openclaw.plugin.json')
const canaryPackage = await json('canary-v2/package.json')

for (const manifest of [stableManifest, canaryManifest]) {
  assert.equal(manifest.id, 'clawdsh-bridge')
  assert.deepEqual(manifest.providers, ['clawdsh'])
  assert.deepEqual(manifest.activation, { onStartup: false, onAgentHarnesses: ['clawdsh'] })
  assert.equal(manifest.configSchema.additionalProperties, false)
}
assert.equal(stablePackage.main, 'index.js')
assert.deepEqual(stablePackage.openclaw.extensions, ['./index.js'])
assert.equal(stablePackage.peerDependencies.openclaw, '2026.7.1-2')
assert.deepEqual(canaryPackage.openclaw.extensions, ['./index.ts'])
assert.equal(canaryPackage.openclaw.compat.pluginApi, '>=2026.8.1')

const stableEnvironment = environment('v1')
const stable = readBridgeEnvironment('v1', stableEnvironment)
assert.deepEqual(stable.handshake.capabilities, {
  actions: ['send', 'poll'],
  notifications: ['text.delta', 'reasoning.delta', 'tool', 'status'],
  extensions: [],
})
assert.throws(() => readBridgeEnvironment('v2', stableEnvironment), /expected v2/)

const stableIndex = await readFile(join(root, 'stable-v1/index.js'), 'utf8')
assert.match(stableIndex, /openclaw\/plugin-sdk\/agent-harness-runtime/)
assert.match(stableIndex, /api\.registerService\(/)
assert.doesNotMatch(stableIndex, /registerRuntimeLifecycle/)
assert.doesNotMatch(stableIndex, /before_agent_reply|inbound_claim/)
const canaryIndex = await readFile(join(root, 'canary-v2/index.ts'), 'utf8')
assert.match(canaryIndex, /AgentHarnessV2/)
assert.match(canaryIndex, /hostCapabilities\.assertActive\(\)/)
assert.match(canaryIndex, /api\.registerService\(/)
assert.doesNotMatch(canaryIndex, /registerRuntimeLifecycle/)
assert.doesNotMatch(canaryIndex, /fallbackRuntime/)

process.stdout.write('OpenClaw bridge verification passed.\n')

async function json(relativePath) {
  return JSON.parse(await readFile(join(root, relativePath), 'utf8'))
}

function environment(generation) {
  return {
    CLAWDSH_CHANNEL_ENDPOINT: '/private/tmp/clawdsh-verify.sock',
    CLAWDSH_CHANNEL_TOKEN: 'verify-token',
    CLAWDSH_CHANNEL_STARTUP_NONCE: 'verify-nonce',
    CLAWDSH_CHANNEL_GATEWAY_INSTANCE_ID: 'verify-gateway',
    CLAWDSH_CHANNEL_STAGING_ROOT: '/private/tmp',
    CLAWDSH_CHANNEL_MAX_FRAME_BYTES: '65536',
    CLAWDSH_CHANNEL_MAX_IN_FLIGHT: '16',
    CLAWDSH_CHANNEL_MAX_MEDIA_BYTES: '1048576',
    CLAWDSH_OPENCLAW_TAG: 'v2026.7.1-2',
    CLAWDSH_OPENCLAW_COMMIT_SHA: '0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c',
    CLAWDSH_OPENCLAW_ARTIFACT_SHA512: 'b'.repeat(128),
    CLAWDSH_OPENCLAW_NODE_ENGINE: '>=22.22.3',
    CLAWDSH_OPENCLAW_AGENT_HARNESS: generation,
  }
}
