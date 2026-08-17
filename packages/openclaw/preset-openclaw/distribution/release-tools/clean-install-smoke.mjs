#!/usr/bin/env node
/** Install and start the packed CLI in a credential-free, isolated DSH home. */

import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DSH_VERSION, RELEASE_VERSION } from './release-contract.mjs'
import { verifyReleaseIndex } from './release-verify.mjs'

const READY_URL = /https?:\/\/(?:127\.0\.0\.1|localhost):[0-9]+\/clawdsh\//
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024
const MAX_PRODUCT_PAGE_BYTES = 1024 * 1024
const MAX_PRODUCT_ASSET_BYTES = 16 * 1024 * 1024
const PAGE_PROBE_ATTEMPTS = 20
const PAGE_PROBE_INTERVAL_MS = 100
const PAGE_REQUEST_TIMEOUT_MS = 1_000
const BROWSER_READY_TIMEOUT_MS = 30_000
const STOP_GRACE_MS = 5_000
const INIT_HARNESS = fileURLToPath(new URL('./clean-install-smoke-init.mjs', import.meta.url))
const PLAYWRIGHT_REQUIRE = createRequire(new URL('../../../../../apps/web/package.json', import.meta.url))

const INHERITED_ENVIRONMENT_KEYS = Object.freeze([
  'PATH',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'SystemRoot',
  'WINDIR',
  'ComSpec',
  'PATHEXT',
])

function inside(root, path) {
  const relation = relative(root, path)
  return relation === '' || (relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation))
}

function temporaryRegistry(value) {
  const url = new URL(value)
  if (url.protocol !== 'http:'
    || (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost')
    || url.port === ''
    || url.username
    || url.password
    || url.search
    || url.hash) {
    throw new TypeError('clean-install registry must be an unauthenticated loopback HTTP URL with an explicit port')
  }
  return url.href
}

function wait(milliseconds) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds))
}

function productUrl(value) {
  const url = new URL(value)
  if ((url.protocol !== 'http:' && url.protocol !== 'https:')
    || (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost')
    || url.port === ''
    || url.pathname !== '/clawdsh/'
    || url.username
    || url.password
    || url.search
    || url.hash) {
    throw new TypeError('ClawDSH ready URL must be an uncredentialed loopback /clawdsh/ URL')
  }
  return url.href
}

function htmlAttribute(tag, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag)
  return match?.[2]
}

function productAssetUrl(base, reference, label) {
  if (typeof reference !== 'string' || reference === '') throw new TypeError(`${label} has no URL`)
  const url = new URL(reference, base)
  const root = new URL(base)
  if (url.origin !== root.origin || !url.pathname.startsWith('/clawdsh/')
    || url.username || url.password || url.search || url.hash) {
    throw new TypeError(`${label} must stay inside the loopback /clawdsh/ origin`)
  }
  return url
}

function pageAssets(html) {
  const assets = []
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
    const source = htmlAttribute(tag, 'src')
    if (source !== undefined) assets.push({ reference: source, kind: 'script' })
  }
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const relation = htmlAttribute(tag, 'rel')?.toLowerCase().split(/\s+/) ?? []
    const reference = htmlAttribute(tag, 'href')
    if (reference === undefined) continue
    if (relation.includes('stylesheet')) assets.push({ reference, kind: 'stylesheet' })
    else if (relation.includes('modulepreload')) assets.push({ reference, kind: 'script' })
    else if (relation.includes('manifest')) assets.push({ reference, kind: 'manifest' })
    else if (relation.includes('icon')) assets.push({ reference, kind: 'icon' })
  }
  for (const kind of ['script', 'stylesheet', 'manifest', 'icon']) {
    if (!assets.some(asset => asset.kind === kind)) throw new TypeError(`ClawDSH product page has no ${kind} asset`)
  }
  return assets
}

function expectedContentType(kind, url) {
  if (kind === 'script') return /^(?:text|application)\/javascript(?:;|$)/i
  if (kind === 'stylesheet') return /^text\/css(?:;|$)/i
  if (kind === 'manifest') return /^application\/(?:manifest\+json|json)(?:;|$)/i
  if (url.pathname.endsWith('.svg')) return /^image\/svg\+xml(?:;|$)/i
  if (url.pathname.endsWith('.png')) return /^image\/png(?:;|$)/i
  return /^image\//i
}

async function responseBytes(response, label) {
  const bytes = typeof response.arrayBuffer === 'function'
    ? Buffer.from(await response.arrayBuffer())
    : Buffer.from(await response.text())
  if (bytes.byteLength > MAX_PRODUCT_ASSET_BYTES) throw new TypeError(`${label} exceeds the smoke-test response limit`)
  return bytes
}

async function requireProductAsset(base, asset, request) {
  const url = productAssetUrl(base, asset.reference, `ClawDSH ${asset.kind}`)
  const response = await request(url.href, {
    redirect: 'error',
    signal: AbortSignal.timeout(PAGE_REQUEST_TIMEOUT_MS),
  })
  if (response.status !== 200) throw new Error(`ClawDSH ${asset.kind} returned HTTP ${String(response.status)}`)
  const contentType = response.headers?.get?.('content-type') ?? ''
  if (!expectedContentType(asset.kind, url).test(contentType)) {
    throw new TypeError(`ClawDSH ${asset.kind} has invalid content-type ${JSON.stringify(contentType)}`)
  }
  return { url, bytes: await responseBytes(response, `ClawDSH ${asset.kind}`) }
}

async function verifyProductAssets(base, html, request) {
  const checked = new Map()
  let manifest
  for (const asset of pageAssets(html)) {
    const result = await requireProductAsset(base, asset, request)
    checked.set(result.url.href, asset.kind)
    if (asset.kind === 'manifest') manifest = JSON.parse(result.bytes.toString('utf8'))
  }
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)
    || manifest.name !== 'ClawDSH' || manifest.start_url !== '/clawdsh/' || manifest.scope !== '/clawdsh/'
    || !Array.isArray(manifest.icons) || manifest.icons.length === 0) {
    throw new TypeError('ClawDSH web manifest identity is invalid')
  }
  for (const icon of manifest.icons) {
    if (icon === null || typeof icon !== 'object' || Array.isArray(icon) || typeof icon.src !== 'string') {
      throw new TypeError('ClawDSH web manifest icon is invalid')
    }
    const url = productAssetUrl(base, icon.src, 'ClawDSH manifest icon')
    if (!checked.has(url.href)) await requireProductAsset(base, { reference: icon.src, kind: 'icon' }, request)
  }
}

function sameProductOrigin(value, origin) {
  try {
    const url = new URL(value)
    return url.origin === origin && url.pathname.startsWith('/clawdsh/')
  } catch {
    return false
  }
}

function browserProblem(kind, value) {
  try {
    const url = new URL(String(value))
    return `${kind}: ${url.pathname}${url.hash}`
  } catch {
    // Page exceptions and console records may contain application data; the
    // event kind is enough to reject the release without echoing that data.
    return kind
  }
}

/** Execute the installed browser bundle and require its settled native product shell. */
export async function verifyClawdshBrowser(value, {
  loadPlaywright = () => PLAYWRIGHT_REQUIRE('playwright'),
  timeoutMs = BROWSER_READY_TIMEOUT_MS,
} = {}) {
  const url = new URL(productUrl(value))
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError('browser probe timeout must be a positive integer')
  }
  const playwright = loadPlaywright()
  if (typeof playwright?.chromium?.launch !== 'function') {
    throw new TypeError('clean-install browser probe requires Playwright Chromium')
  }
  const browser = await playwright.chromium.launch({ headless: true })
  const problems = []
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    page.on('pageerror', error => { problems.push(browserProblem('pageerror', error.message)) })
    page.on('console', message => {
      if (message.type() === 'error') problems.push(browserProblem('console.error', message.text()))
    })
    page.on('requestfailed', request => {
      if (sameProductOrigin(request.url(), url.origin)) {
        problems.push(browserProblem('request failed', request.url()))
      }
    })
    page.on('response', response => {
      if (response.status() >= 400 && sameProductOrigin(response.url(), url.origin)) {
        problems.push(browserProblem(`HTTP ${String(response.status())}`, response.url()))
      }
    })
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
    await page.locator('[data-clawdsh-shell] [data-native-app]').waitFor({ state: 'visible', timeout: timeoutMs })
    await page.locator('[data-clawdsh-harness-advanced]').waitFor({ state: 'visible', timeout: timeoutMs })
    await page.waitForTimeout(250)
    if (problems.length > 0) {
      throw new Error(`ClawDSH browser emitted ${String(problems.length)} startup problem(s): ${problems.join('; ')}`)
    }
  } finally {
    await browser.close()
  }
}

/**
 * Require the advertised product URL to serve the ClawDSH HTML entry point.
 * @param value - Loopback URL emitted by the installed CLI.
 * @param options - Bounded request and retry hooks.
 * @returns nothing after an HTTP 200 response contains both product identity markers.
 */
export async function verifyClawdshPage(value, {
  request = fetch,
  attempts = PAGE_PROBE_ATTEMPTS,
  intervalMs = PAGE_PROBE_INTERVAL_MS,
  sleep = wait,
  browserProbe = verifyClawdshBrowser,
} = {}) {
  const url = productUrl(value)
  if (!Number.isSafeInteger(attempts) || attempts < 1) throw new TypeError('page probe attempts must be a positive integer')
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 0) throw new TypeError('page probe interval must be a non-negative integer')
  let lastResult = 'no response'
  let staticAssetsVerified = false
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await request(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(PAGE_REQUEST_TIMEOUT_MS),
      })
      const body = await response.text()
      if (Buffer.byteLength(body, 'utf8') > MAX_PRODUCT_PAGE_BYTES) {
        throw new TypeError('ClawDSH product page exceeds the smoke-test response limit')
      }
      const productIdentity = /<title>\s*ClawDSH\s*<\/title>/i.test(body)
        && /id=["']clawdsh-root["']/i.test(body)
      if (response.status === 200 && productIdentity) {
        await verifyProductAssets(url, body, request)
        staticAssetsVerified = true
        break
      }
      lastResult = response.status === 200
        ? 'HTTP 200 without the ClawDSH product identity markers'
        : `HTTP ${String(response.status)}`
    } catch (error) {
      if (error instanceof TypeError && error.message === 'ClawDSH product page exceeds the smoke-test response limit') {
        throw error
      }
      lastResult = error instanceof Error ? error.message : 'request failed'
    }
    if (attempt + 1 < attempts) await sleep(intervalMs)
  }
  if (!staticAssetsVerified) throw new Error(`ClawDSH product page did not become ready: ${lastResult}`)
  await browserProbe(url)
}

function collect(child, timeoutMs, readyPattern, readyProbe) {
  return new Promise((resolvePromise, rejectPromise) => {
    let output = ''
    let ready = false
    let probing = false
    let completed = false
    let stopOutcome
    let forceTimer

    const finish = (callback, value) => {
      if (completed) return
      completed = true
      clearTimeout(timer)
      if (forceTimer !== undefined) clearTimeout(forceTimer)
      callback(value)
    }

    const stop = (outcome) => {
      if (completed || stopOutcome !== undefined) return
      stopOutcome = outcome
      child.kill('SIGTERM')
      forceTimer = setTimeout(() => child.kill('SIGKILL'), STOP_GRACE_MS)
    }

    const timer = setTimeout(() => {
      stop(new Error(`command did not become ready within ${String(timeoutMs)}ms:\n${output}`))
    }, timeoutMs)
    const append = (chunk) => {
      output += chunk.toString('utf8')
      if (output.length > MAX_OUTPUT_BYTES) {
        stop(new Error('command output exceeded the smoke-test limit'))
        return
      }
      const matched = !probing && readyPattern?.exec(output)
      if (matched !== null && matched !== undefined) {
        probing = true
        Promise.resolve(readyProbe?.(matched[0])).then(() => {
          if (completed) return
          ready = true
          stop(null)
        }, (error) => {
          stop(error instanceof Error ? error : new Error('ClawDSH product page probe failed'))
        })
      }
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.on('error', (error) => {
      finish(rejectPromise, error)
    })
    child.on('close', (code, signal) => {
      if (ready && stopOutcome === null) finish(resolvePromise, { output, code, signal })
      else if (stopOutcome instanceof Error) finish(rejectPromise, stopOutcome)
      else if (code === 0 && !readyPattern) finish(resolvePromise, { output, code, signal })
      else finish(
        rejectPromise,
        new Error(`command exited before readiness (code ${String(code)}, signal ${String(signal)}):\n${output}`),
      )
    })
  })
}

function defaultRunner() {
  return {
    run(command, arguments_, options) {
      const child = spawn(command, arguments_, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      return collect(child, options.timeoutMs ?? 120_000)
    },
    start(command, arguments_, options) {
      const child = spawn(command, arguments_, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      return collect(child, options.timeoutMs ?? 60_000, options.readyPattern, options.readyProbe)
    },
  }
}

function isolatedEnvironment(root, registry) {
  const environment = {}
  for (const key of INHERITED_ENVIRONMENT_KEYS) {
    const value = process.env[key]
    if (value !== undefined) environment[key] = value
  }
  if (typeof environment.PATH !== 'string' || environment.PATH.length === 0) {
    throw new TypeError('clean-install smoke requires PATH')
  }
  const home = join(root, 'home')
  const dshHome = join(root, 'dsh-home')
  const npmCache = join(root, 'npm-cache')
  const npmConfig = join(root, 'npmrc')
  const temporary = join(root, 'tmp')
  const appData = join(root, 'app-data')
  const localAppData = join(root, 'local-app-data')
  const directories = [
    home,
    dshHome,
    npmCache,
    temporary,
    appData,
    localAppData,
    join(root, 'xdg-config'),
    join(root, 'xdg-data'),
    join(root, 'xdg-cache'),
  ]
  for (const directory of directories) mkdirSync(directory, { recursive: true, mode: 0o700 })
  writeFileSync(npmConfig, `registry=${registry}\naudit=false\nfund=false\n`, { mode: 0o600 })
  return {
    ...environment,
    CI: 'true',
    TERM: 'dumb',
    NO_COLOR: '1',
    DSH_TELEMETRY_DISABLED: '1',
    HOME: home,
    USERPROFILE: home,
    DSH_HOME: dshHome,
    TMPDIR: temporary,
    TMP: temporary,
    TEMP: temporary,
    APPDATA: appData,
    LOCALAPPDATA: localAppData,
    XDG_CONFIG_HOME: join(root, 'xdg-config'),
    XDG_DATA_HOME: join(root, 'xdg-data'),
    XDG_CACHE_HOME: join(root, 'xdg-cache'),
    NPM_CONFIG_CACHE: npmCache,
    NPM_CONFIG_USERCONFIG: npmConfig,
    NPM_CONFIG_GLOBALCONFIG: join(root, 'npm-globalrc'),
    NPM_CONFIG_REGISTRY: registry,
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost',
    NO_UPDATE_NOTIFIER: '1',
  }
}

function installedPackage(project, fromPackage, name) {
  const packageSegments = name.split('/')
  let current = fromPackage
  while (inside(project, current)) {
    const candidate = join(current, 'node_modules', ...packageSegments)
    if (existsSync(join(candidate, 'package.json'))) {
      const physical = realpathSync(candidate)
      if (!inside(project, physical)) throw new TypeError(`${name} resolves outside the isolated install`)
      return physical
    }
    if (current === project) break
    current = dirname(current)
  }
  throw new TypeError(`${name} is missing from the isolated install`)
}

function installedManifest(directory, expectedName, expectedVersion) {
  const manifestPath = join(directory, 'package.json')
  const metadata = lstatSync(manifestPath)
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw new TypeError(`${expectedName} package.json is not an ordinary file`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.name !== expectedName || manifest.version !== expectedVersion) {
    throw new TypeError(`installed package must be ${expectedName}@${expectedVersion}`)
  }
  return manifest
}

/** Run the clean install, init, and keyless GUI startup smoke. */
export async function runCleanInstallSmoke({
  releaseDirectory,
  registry,
  workDirectory,
  attestationPath,
  runner = defaultRunner(),
  pageProbe = verifyClawdshPage,
}) {
  if (!workDirectory) throw new TypeError('clean-install work directory is required')
  if (!attestationPath) throw new TypeError('smoke attestation path is required')
  const release = verifyReleaseIndex(releaseDirectory)
  const targetRegistry = temporaryRegistry(registry)
  let root = resolve(workDirectory)
  if (existsSync(root)) throw new TypeError('clean-install work directory must not exist')
  mkdirSync(root, { recursive: true, mode: 0o700 })
  root = realpathSync(root)
  chmodSync(root, 0o700)
  writeFileSync(join(root, 'package.json'), '{"name":"clawdsh-clean-install-smoke","private":true}\n', { mode: 0o600 })
  const environment = isolatedEnvironment(root, targetRegistry)
  await runner.run('npm', [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--save-exact',
    '--registry', targetRegistry,
    `@clawdsh/cli@${RELEASE_VERSION}`,
  ], { cwd: root, env: environment, timeoutMs: 600_000 })

  const cliDirectory = installedPackage(root, root, '@clawdsh/cli')
  const cliManifest = installedManifest(cliDirectory, '@clawdsh/cli', RELEASE_VERSION)
  if (cliManifest.dependencies?.['@deepseek-ai/dsh'] !== DSH_VERSION
    || cliManifest.dependencies?.['@clawdsh/dsh-bundle'] !== RELEASE_VERSION) {
    throw new TypeError('installed CLI does not retain the exact DSH and bundle dependencies')
  }
  const dshDirectory = installedPackage(root, cliDirectory, '@deepseek-ai/dsh')
  installedManifest(dshDirectory, '@deepseek-ai/dsh', DSH_VERSION)
  const bundleDirectory = installedPackage(root, cliDirectory, '@clawdsh/dsh-bundle')
  installedManifest(bundleDirectory, '@clawdsh/dsh-bundle', RELEASE_VERSION)
  const bin = typeof cliManifest.bin === 'string' ? cliManifest.bin : cliManifest.bin?.clawdsh
  if (typeof bin !== 'string' || isAbsolute(bin) || bin.includes('\\')) throw new TypeError('installed CLI bin is invalid')
  const cliBin = resolve(cliDirectory, bin)
  if (!inside(cliDirectory, cliBin)) throw new TypeError('installed CLI bin escapes its package')
  const binMetadata = lstatSync(cliBin)
  if (binMetadata.isSymbolicLink() || !binMetadata.isFile()) throw new TypeError('installed CLI bin is not an ordinary file')

  const cliModule = join(cliDirectory, 'lib/index.mjs')
  const cliModuleMetadata = lstatSync(cliModule)
  if (cliModuleMetadata.isSymbolicLink() || !cliModuleMetadata.isFile()) {
    throw new TypeError('installed CLI has no ordinary runCli module')
  }
  await runner.run(process.execPath, [
    INIT_HARNESS,
    '--cli-module', cliModule,
    '--bundle-root', bundleDirectory,
  ], { cwd: root, env: environment, timeoutMs: 600_000 })
  await runner.start(process.execPath, [cliBin, 'start', '--host', '127.0.0.1', '--port', '0'], {
    cwd: root,
    env: environment,
    timeoutMs: 60_000,
    readyPattern: READY_URL,
    readyProbe: pageProbe,
  })

  const indexBytes = readFileSync(join(realpathSync(releaseDirectory), 'release-index.json'))
  const attestation = {
    version: 2,
    releaseVersion: RELEASE_VERSION,
    dshVersion: DSH_VERSION,
    cliStarted: true,
    productPageVerified: true,
    browserRuntimeVerified: true,
    releaseIndexIntegrity: `sha512-${createHash('sha512').update(indexBytes).digest('base64')}`,
    packageCount: release.packages.length,
  }
  writeFileSync(attestationPath, `${JSON.stringify(attestation, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  return Object.freeze(attestation)
}

function parseArguments(arguments_) {
  const values = new Map()
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index]
    const value = arguments_[index + 1]
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--') || values.has(key)) {
      throw new TypeError('clean-install-smoke arguments must be unique --name value pairs')
    }
    values.set(key, value)
  }
  const allowed = new Set(['--release-directory', '--registry', '--work-directory', '--attestation'])
  for (const key of values.keys()) if (!allowed.has(key)) throw new TypeError(`unknown argument ${key}`)
  return values
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const arguments_ = parseArguments(process.argv.slice(2))
  const result = await runCleanInstallSmoke({
    releaseDirectory: arguments_.get('--release-directory'),
    registry: arguments_.get('--registry'),
    workDirectory: arguments_.get('--work-directory'),
    attestationPath: arguments_.get('--attestation'),
  })
  process.stdout.write(`clean install started ClawDSH CLI with dsh ${result.dshVersion}\n`)
}
