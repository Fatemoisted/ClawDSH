import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')
const script = resolve(root, 'tools/render-clawdsh-brand.mjs')
const manifestPath = resolve(root, 'packages/openclaw/preset-openclaw/product-shell/browser/public/manifest.webmanifest')

test('every checked brand derivative matches its vector source', () => {
  const output = execFileSync(process.execPath, [script, '--check'], { cwd: root, encoding: 'utf8' })
  assert.match(output, /ClawDSH brand assets are current/)
})

test('the Web manifest publishes only product-scoped routes', () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  assert.equal(manifest.start_url, '/clawdsh/')
  assert.equal(manifest.scope, '/clawdsh/')
  assert.equal(manifest.icons.every(icon => icon.src.startsWith('/clawdsh/brand/')), true)
})
