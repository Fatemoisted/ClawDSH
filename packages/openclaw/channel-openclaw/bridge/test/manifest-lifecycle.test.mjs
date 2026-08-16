import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

for (const track of ['stable-v1', 'canary-v2']) {
  test(`${track} stays startup-inert and activates for the selected AgentHarness`, async () => {
    const manifestPath = join(import.meta.dirname, '..', track, 'openclaw.plugin.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))

    assert.equal(manifest.activation?.onStartup, false)
    assert.deepEqual(manifest.activation?.onAgentHarnesses, ['clawdsh'])
  })
}
