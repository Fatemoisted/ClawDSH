import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repositoryRoot = resolve(import.meta.dirname, '../../../..')
const brandRoot = join(repositoryRoot, 'packages/openclaw/preset-openclaw/brand')
const webRoot = join(repositoryRoot, 'packages/openclaw/preset-openclaw/product-shell/browser/public')
const productRuntimeRoot = join(repositoryRoot, 'packages/openclaw/preset-openclaw/product-shell/runtime')
const builtWebRoot = join(productRuntimeRoot, 'web')
const renderScript = join(repositoryRoot, 'tools/render-clawdsh-brand.mjs')

interface RawImage {
  readonly data: Uint8Array
  readonly info: { readonly width: number; readonly height: number; readonly channels: number }
}

interface SharpPipeline {
  resize(width: number, height: number, options?: { fit?: 'fill' | 'contain' }): SharpPipeline
  ensureAlpha(): SharpPipeline
  raw(): SharpPipeline
  png(options?: { compressionLevel?: number; adaptiveFiltering?: boolean; palette?: boolean }): SharpPipeline
  composite(overlays: ReadonlyArray<{ input: Uint8Array; gravity?: 'centre' }>): SharpPipeline
  toBuffer(options: { resolveWithObject: true }): Promise<RawImage>
  toBuffer(): Promise<Buffer>
}

interface SharpFactory {
  (input: Uint8Array | { create: {
    width: number
    height: number
    channels: 4
    background: { r: number; g: number; b: number; alpha: number }
  } }): SharpPipeline
}

function loadSharp(): SharpFactory {
  const requireFromAttachment = createRequire(join(
    repositoryRoot,
    'packages/attachment/attachment-local/package.json',
  ))
  return requireFromAttachment('sharp') as SharpFactory
}

function visibleBounds(image: RawImage, background?: readonly [number, number, number]): {
  minX: number
  minY: number
  maxX: number
  maxY: number
  pixels: number
} {
  const { data, info } = image
  let minX = info.width
  let minY = info.height
  let maxX = -1
  let maxY = -1
  let pixels = 0
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels
      const alpha = data[offset + 3] ?? 0
      const backgroundDistance = background === undefined ? Number.POSITIVE_INFINITY : Math.hypot(
        (data[offset] ?? 0) - background[0],
        (data[offset + 1] ?? 0) - background[1],
        (data[offset + 2] ?? 0) - background[2],
      )
      const differs = alpha > (background === undefined ? 8 : 250) && backgroundDistance > 10
      if (!differs) continue
      pixels += 1
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  return { minX, minY, maxX, maxY, pixels }
}

async function renderedRaw(source: Buffer, size: number): Promise<RawImage> {
  return loadSharp()(source).resize(size, size, { fit: 'fill' }).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true })
}

async function brandedBackground(
  source: Buffer,
  background: readonly [number, number, number],
): Promise<{ png: Buffer; raw: RawImage }> {
  const sharp = loadSharp()
  const mark = await sharp(source).resize(384, 384, { fit: 'contain' }).png().toBuffer()
  const canvas = sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: background[0], g: background[1], b: background[2], alpha: 1 },
    },
  }).composite([{ input: mark, gravity: 'centre' }])
  const png = await canvas.png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer()
  const raw = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { png, raw }
}

describe('ClawDSH brand asset acceptance', () => {
  it('keeps every deterministic derivative current', () => {
    const output = execFileSync(process.execPath, [renderScript, '--check'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    })
    expect(output).toContain('ClawDSH brand assets are current')
    for (const logical of [
      'favicon.svg',
      'manifest.webmanifest',
      'brand/clawdsh-mark.svg',
      'brand/clawdsh-mark-192.png',
      'brand/clawdsh-mark-512.png',
      'brand/clawdsh-maskable.svg',
      'brand/clawdsh-maskable-512.png',
      'brand/clawdsh-monochrome.svg',
      'brand/clawdsh-lockup.svg',
    ]) {
      expect(readFileSync(join(builtWebRoot, logical)), `${logical} is stale in the product build`).toEqual(
        readFileSync(join(webRoot, logical)),
      )
    }
  })

  it('keeps the colored mark legible and unclipped at 16, 24, 32, and 512 pixels', async () => {
    const source = readFileSync(join(brandRoot, 'clawdsh-mark.svg'))
    for (const size of [16, 24, 32, 512]) {
      const image = await renderedRaw(source, size)
      const bounds = visibleBounds(image)
      expect(image.info).toMatchObject({ width: size, height: size, channels: 4 })
      expect(bounds.pixels).toBeGreaterThan(size)
      expect(bounds.minX).toBeGreaterThan(0)
      expect(bounds.minY).toBeGreaterThan(0)
      expect(bounds.maxX).toBeLessThan(size - 1)
      expect(bounds.maxY).toBeLessThan(size - 1)
      let closestCoralDistance = Number.POSITIVE_INFINITY
      let hasTidalBlue = false
      for (let offset = 0; offset < image.data.length; offset += image.info.channels) {
        if ((image.data[offset + 3] ?? 0) < 32) continue
        const red = image.data[offset] ?? 0
        const green = image.data[offset + 1] ?? 0
        const blue = image.data[offset + 2] ?? 0
        if (red === 20 && green === 115 && blue === 230) hasTidalBlue = true
        closestCoralDistance = Math.min(
          closestCoralDistance,
          Math.hypot(red - 240, green - 90, blue - 91),
        )
      }
      expect(hasTidalBlue, `${String(size)}px mark lost Tidal Blue`).toBe(true)
      const coralTolerance = size === 16 ? 90 : size === 24 ? 30 : 5
      expect(closestCoralDistance, `${String(size)}px mark lost Coral Claw`).toBeLessThanOrEqual(coralTolerance)
    }
  })

  it('renders on light and dark surfaces and keeps the maskable artwork in the safe area', async () => {
    const source = readFileSync(join(brandRoot, 'clawdsh-mark.svg'))
    const light = await brandedBackground(source, [244, 250, 255])
    const dark = await brandedBackground(source, [7, 26, 43])
    expect(visibleBounds(light.raw, [244, 250, 255]).pixels).toBeGreaterThan(10_000)
    expect(visibleBounds(dark.raw, [7, 26, 43]).pixels).toBeGreaterThan(10_000)

    const maskable = await renderedRaw(readFileSync(join(brandRoot, 'clawdsh-maskable.svg')), 512)
    const artwork = visibleBounds(maskable, [244, 250, 255])
    const safeInset = Math.ceil(512 * 0.1)
    expect(artwork.minX).toBeGreaterThanOrEqual(safeInset)
    expect(artwork.minY).toBeGreaterThanOrEqual(safeInset)
    expect(artwork.maxX).toBeLessThan(512 - safeInset)
    expect(artwork.maxY).toBeLessThan(512 - safeInset)
    let maximumArtworkRadius = 0
    for (let y = 0; y < maskable.info.height; y += 1) {
      for (let x = 0; x < maskable.info.width; x += 1) {
        const offset = (y * maskable.info.width + x) * maskable.info.channels
        if ((maskable.data[offset + 3] ?? 0) <= 250) continue
        const backgroundDistance = Math.hypot(
          (maskable.data[offset] ?? 0) - 244,
          (maskable.data[offset + 1] ?? 0) - 250,
          (maskable.data[offset + 2] ?? 0) - 255,
        )
        if (backgroundDistance <= 10) continue
        maximumArtworkRadius = Math.max(maximumArtworkRadius, Math.hypot(x - 255.5, y - 255.5))
      }
    }
    expect(maximumArtworkRadius, 'maskable artwork exceeds the platform-safe center circle')
      .toBeLessThanOrEqual(512 * 0.4)

    const evidenceDirectory = process.env.CLAWDSH_BRAND_QA_DIR?.trim()
    if (evidenceDirectory !== undefined && evidenceDirectory !== '') {
      const directory = resolve(evidenceDirectory)
      mkdirSync(directory, { recursive: true })
      writeFileSync(join(directory, 'mark-on-foam.png'), light.png)
      writeFileSync(join(directory, 'mark-on-deep-ocean.png'), dark.png)
    }
  })

  it('publishes monochrome and product-scoped PWA variants', async () => {
    const monochromeSource = readFileSync(join(brandRoot, 'clawdsh-monochrome.svg'))
    expect(new Set(monochromeSource.toString('utf8').match(/#[0-9A-F]{6}/g))).toEqual(new Set(['#071A2B']))
    for (const size of [16, 24, 32, 512]) {
      const monochrome = await renderedRaw(monochromeSource, size)
      const bounds = visibleBounds(monochrome)
      expect(bounds.pixels, `${String(size)}px monochrome mark disappeared`).toBeGreaterThan(size)
      expect(bounds.minX).toBeGreaterThan(0)
      expect(bounds.maxX).toBeLessThan(size - 1)
    }
    const manifest = JSON.parse(readFileSync(join(webRoot, 'manifest.webmanifest'), 'utf8')) as {
      start_url?: unknown
      scope?: unknown
      icons?: Array<{ src?: unknown; sizes?: unknown; type?: unknown; purpose?: unknown }>
    }
    expect(manifest).toMatchObject({ start_url: '/clawdsh/', scope: '/clawdsh/' })
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ sizes: '192x192', type: 'image/png', purpose: 'any' }),
      expect.objectContaining({ sizes: '512x512', type: 'image/png', purpose: 'any' }),
      expect.objectContaining({ sizes: '512x512', type: 'image/png', purpose: 'maskable' }),
    ]))
    expect(manifest.icons?.every(icon => (
      typeof icon.src === 'string' && icon.src.startsWith('/clawdsh/brand/')
    ))).toBe(true)
  })
})
