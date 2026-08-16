#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const brandDir = resolve(root, 'packages/openclaw/preset-openclaw/brand')
const webRoot = resolve(root, 'packages/openclaw/preset-openclaw/product-shell/browser/public')
const webBrandDir = resolve(webRoot, 'brand')
const check = process.argv.includes('--check')

if (process.argv.length > (check ? 3 : 2) || (process.argv[2] !== undefined && process.argv[2] !== '--check')) {
  console.error('Usage: node tools/render-clawdsh-brand.mjs [--check]')
  process.exit(2)
}

const palette = new Set(['#071A2B', '#1473E6', '#F05A5B', '#F4FAFF'])
const canonicalSvgs = [
  'clawdsh-mark.svg',
  'clawdsh-lockup.svg',
  'clawdsh-monochrome.svg',
  'clawdsh-maskable.svg',
  'clawdsh-social-preview.svg',
]
const webSvgs = canonicalSvgs.filter(name => name !== 'clawdsh-social-preview.svg')
const prohibitedSvg = /<(?:text|image|foreignObject|style|linearGradient|radialGradient|filter|script|use|metadata)\b|\b(?:href|font-family|class|style)=/i

/** Resolve sharp through its owning workspace package without adding a duplicate root dependency. */
function loadSharp() {
  const require = createRequire(resolve(root, 'packages/attachment/attachment-local/package.json'))
  try {
    return require('sharp')
  } catch (error) {
    throw new Error(`sharp is unavailable; run pnpm install before rendering brand assets (${error instanceof Error ? error.message : String(error)})`)
  }
}

/** Reject features that make a logo dependent on fonts, network resources, or renderer-specific effects. */
function validateSvg(name, source) {
  if (!source.includes('viewBox=')) throw new Error(`${name}: missing viewBox`)
  if (prohibitedSvg.test(source)) throw new Error(`${name}: contains a prohibited SVG feature`)
  const colors = source.match(/#[0-9A-Fa-f]{6}/g) ?? []
  for (const color of colors) {
    if (!palette.has(color.toUpperCase())) throw new Error(`${name}: color ${color} is outside the ClawDSH palette`)
  }
  if (colors.length === 0) throw new Error(`${name}: contains no explicit palette color`)
}

/** Compute the content id recorded by a bilingual-pair sidecar. */
function gitBlobHash(content) {
  return createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex')
}

/** Write one derivative, or fail if the checked derivative is absent or stale. */
async function synchronize(path, expected) {
  if (check) {
    let actual
    try {
      actual = await readFile(path)
    } catch {
      throw new Error(`${path.slice(root.length + 1)}: missing generated asset`)
    }
    if (!actual.equals(expected)) throw new Error(`${path.slice(root.length + 1)}: generated asset is stale`)
    return
  }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, expected)
}

const sharp = loadSharp()
const brandEnglish = await readFile(resolve(brandDir, 'README.md'))
const brandChinese = await readFile(resolve(brandDir, 'README.zh.md'))
const brandPairing = await readFile(resolve(brandDir, 'README.i18n.yaml'), 'utf8')
for (const [name, content] of [['README.md', brandEnglish], ['README.zh.md', brandChinese]]) {
  const expected = gitBlobHash(content)
  if (!brandPairing.includes(`${name}: ${expected}`)) {
    throw new Error(`README.i18n.yaml: ${name} is not recorded at its current content`)
  }
}

const svgSources = new Map()
for (const name of canonicalSvgs) {
  const source = await readFile(resolve(brandDir, name))
  validateSvg(name, source.toString('utf8'))
  svgSources.set(name, source)
}

for (const name of webSvgs) {
  await synchronize(resolve(webBrandDir, name), svgSources.get(name))
}
await synchronize(resolve(webRoot, 'favicon.svg'), svgSources.get('clawdsh-mark.svg'))

const pngJobs = [
  { source: 'clawdsh-mark.svg', name: 'clawdsh-mark-192.png', width: 192, height: 192, web: true },
  { source: 'clawdsh-mark.svg', name: 'clawdsh-mark-512.png', width: 512, height: 512, web: true },
  { source: 'clawdsh-maskable.svg', name: 'clawdsh-maskable-512.png', width: 512, height: 512, web: true },
  { source: 'clawdsh-social-preview.svg', name: 'clawdsh-social-preview.png', width: 1280, height: 640, web: false },
]

for (const job of pngJobs) {
  const png = await sharp(svgSources.get(job.source), { density: 384 })
    .resize(job.width, job.height, { fit: 'fill' })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer()
  await synchronize(resolve(brandDir, job.name), png)
  if (job.web) await synchronize(resolve(webBrandDir, job.name), png)
}

const manifestPath = resolve(webRoot, 'manifest.webmanifest')
await access(manifestPath, fsConstants.R_OK)
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
if (manifest.start_url !== '/clawdsh/' || manifest.scope !== '/clawdsh/') {
  throw new Error(`${basename(manifestPath)}: start_url and scope must remain /clawdsh/`)
}
for (const icon of manifest.icons ?? []) {
  const relative = String(icon.src).replace(/^\/clawdsh\//, '')
  await access(resolve(webRoot, relative), fsConstants.R_OK)
}

console.log(`ClawDSH brand assets ${check ? 'are current' : 'rendered'}: ${webSvgs.length + 1} SVG mirrors and ${pngJobs.length + pngJobs.filter(job => job.web).length} PNG files.`)
