import type { ChildProcess } from 'node:child_process'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const repositoryRoot = resolve(import.meta.dirname, '../../../..')
const sourceLauncher = join(repositoryRoot, 'tools/run-clawdsh-dev.sh')
const builtWeb = join(repositoryRoot, 'apps/web/dist/index.html')
const productShell = join(repositoryRoot, 'packages/openclaw/preset-openclaw/product-shell')
const builtProductRuntime = join(productShell, 'runtime/lib/index.mjs')
const builtProductWeb = join(productShell, 'runtime/web/index.html')
const expectedSnapshot = join(import.meta.dirname, 'snapshots/real-profile/ui.expected.md')
const externalCredentialNames = [
  'ARK_API_KEY',
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_BASE_URL',
  'FEISHU_APP_ID',
  'FEISHU_APP_SECRET',
  'TELEGRAM_BOT_TOKEN',
] as const
const expectedSettingsNamespaces = [
  'clawdsh-soul',
  'clawdsh-channel-agent',
  'clawdsh-channel-openclaw',
  'clawdsh-memory',
  'clawdsh-embeddings-ark',
  'clawdsh-skills-hub',
  'clawdsh-automation',
  'clawdsh-activity',
] as const

interface ConsoleMessageLike {
  /** Browser console severity. */
  type(): string
  /** Rendered console message without inspecting argument objects. */
  text(): string
}

interface LocatorLike {
  /** Wait for this browser element to reach the requested state. */
  waitFor(options?: { state?: 'attached' | 'detached' | 'visible'; timeout?: number }): Promise<void>
  /** Activate this browser element. */
  click(): Promise<void>
  /** Return this element's stable accessibility projection. */
  ariaSnapshot(): Promise<string>
  /** Locate a descendant by accessible role. */
  getByRole(role: string, options?: { name?: string | RegExp; exact?: boolean }): LocatorLike
  /** Locate a descendant by visible text. */
  getByText(text: string, options?: { exact?: boolean }): LocatorLike
  /** Count matching elements. */
  count(): Promise<number>
  /** Read one DOM attribute without depending on implementation-only selectors. */
  getAttribute(name: string): Promise<string | null>
  /** Read one checkbox's current DOM property. */
  isChecked(): Promise<boolean>
  /** Capture this element when visual evidence is requested. */
  screenshot(options: { path: string; animations?: 'disabled' }): Promise<unknown>
}

interface PageLike {
  /** Send a real keyboard event through the browser input pipeline. */
  readonly keyboard: { press(key: string): Promise<void> }
  /** Observe browser console output before the first navigation. */
  on(event: 'console', listener: (message: ConsoleMessageLike) => void): void
  /** Observe uncaught page errors before the first navigation. */
  on(event: 'pageerror', listener: (error: Error) => void): void
  /** Navigate the browser page. */
  goto(url: string, options?: { waitUntil?: 'load' }): Promise<unknown>
  /** Locate a page element by accessible role. */
  getByRole(role: string, options?: { name?: string | RegExp; exact?: boolean }): LocatorLike
  /** Locate a page element by visible text. */
  getByText(text: string | RegExp, options?: { exact?: boolean }): LocatorLike
  /** Locate browser elements by a CSS selector. */
  locator(selector: string): LocatorLike
  /** Evaluate a serializable function in this page. */
  evaluate<Result, Argument>(
    pageFunction: (argument: Argument) => Result | Promise<Result>,
    argument: Argument,
  ): Promise<Result>
  /** Resize the browser viewport for responsive layout assertions. */
  setViewportSize(viewport: { width: number; height: number }): Promise<void>
  /** Capture a stable visual acceptance frame when an evidence directory is requested. */
  screenshot(options: { path: string; fullPage?: boolean; animations?: 'disabled' }): Promise<unknown>
}

interface BrowserLike {
  /** Open a page with deterministic locale, timezone, and viewport. */
  newPage(options: {
    viewport: { width: number; height: number }
    locale: string
    timezoneId: string
    reducedMotion: 'reduce'
  }): Promise<PageLike>
  /** Close the browser and its pages. */
  close(): Promise<void>
}

interface BrowserLauncherLike {
  /** Launch Chromium; a channel is optional for local environments with no downloaded browser. */
  launch(options?: { channel?: string }): Promise<BrowserLike>
}

interface NativeProviderRequest {
  /** OpenAI-compatible tool definitions sent to the local provider double. */
  tools?: Array<{
    function?: {
      name?: string
      description?: string
      parameters?: Record<string, unknown>
    }
  }>
}

interface LocalProvider {
  /** Bound local HTTP server. */
  server: Server
  /** Base URL accepted by the DeepSeek-compatible adapter. */
  baseUrl: string
  /** First model request that carries the assembled tool catalog. */
  toolRequest: Promise<NativeProviderRequest>
}

async function startLocalProvider(): Promise<LocalProvider> {
  let resolveToolRequest!: (request: NativeProviderRequest) => void
  const toolRequest = new Promise<NativeProviderRequest>((resolve) => {
    resolveToolRequest = resolve
  })
  let observedToolRequest = false
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      const parsed = JSON.parse(body) as NativeProviderRequest
      if (!observedToolRequest && (parsed.tools?.length ?? 0) > 0) {
        observedToolRequest = true
        resolveToolRequest(parsed)
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end([
        'data: {"choices":[{"delta":{"role":"assistant","content":null,"reasoning_content":""}}]}',
        'data: {"choices":[{"delta":{"content":"done"}}]}',
        'data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
        'data: [DONE]',
        '',
      ].join('\n\n'))
    })
  })
  await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('local model provider did not bind a TCP port')
  }
  return { server, baseUrl: `http://127.0.0.1:${String(address.port)}`, toolRequest }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.close((error) => {
      if (error === undefined) resolveClose()
      else reject(error)
    })
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Redact likely credentials and bound browser diagnostics before an assertion can print them. */
function safeBrowserErrorMessage(value: string): string {
  return value
    .replaceAll(/[\u0000-\u001F\u007F]+/g, ' ')
    .replaceAll(/([?&][^=\s&]+)=([^&\s#]*)/g, '$1=[redacted]')
    .replaceAll(/\b(Bearer|Basic)\s+\S+/gi, '$1 [redacted]')
    .replaceAll(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, '[redacted-token]')
    .replaceAll(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}\b/g, '[redacted-token]')
    .replaceAll(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted-value]')
    .slice(0, 500)
}

async function chromiumLauncher(): Promise<BrowserLauncherLike> {
  const requireFromWeb = createRequire(join(repositoryRoot, 'apps/web/package.json'))
  const entry = requireFromWeb.resolve('playwright')
  const loaded: unknown = await import(pathToFileURL(entry).href)
  if (!isRecord(loaded) || !isRecord(loaded.chromium) || typeof loaded.chromium.launch !== 'function') {
    throw new TypeError('apps/web playwright dependency did not export chromium.launch')
  }
  return loaded.chromium as unknown as BrowserLauncherLike
}

function keylessEnvironment(harnessHome: string, agentsHome: string): NodeJS.ProcessEnv {
  const externalCredentials = new Set<string>(externalCredentialNames)
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => (
      !externalCredentials.has(name)
      && !name.startsWith('CLAWDSH_OPENCLAW_')
      && name !== 'CLAWDSH_CHANNEL_CWD'
    )),
  )
  environment.DSH_HOME = harnessHome
  environment.CLAWDSH_DEV_HOME = harnessHome
  environment.DSH_AGENTS_HOME = agentsHome
  environment.DSH_TELEMETRY_DISABLED = '1'
  return environment
}

interface SettingsFieldDescriptor {
  readonly path: readonly string[]
  readonly access: 'editable' | 'managed'
}

interface SettingsNamespaceDescriptor {
  readonly namespace: string
  readonly schema: unknown
  readonly fields: readonly SettingsFieldDescriptor[]
}

interface SerializedSchemaNode {
  readonly type?: unknown
  readonly dict?: Readonly<Record<string, unknown>>
  readonly inner?: unknown
  readonly list?: readonly unknown[]
}

interface SerializedSchemaGraph {
  readonly uid: number
  readonly refs: Readonly<Record<string, SerializedSchemaNode>>
}

function serializedSchemaGraph(value: unknown): SerializedSchemaGraph {
  if (!isRecord(value)
    || !Number.isSafeInteger(value.uid)
    || !isRecord(value.refs)) {
    throw new TypeError('real profile returned an invalid serialized Settings schema')
  }
  return value as unknown as SerializedSchemaGraph
}

/** Return every path that can be replaced atomically through the product settings UI. */
function settingsLeafPaths(value: unknown): readonly string[] {
  const graph = serializedSchemaGraph(value)
  const leaves = new Set<string>()
  const visit = (reference: unknown, path: readonly string[]): void => {
    if (!Number.isSafeInteger(reference)) {
      throw new TypeError('real profile Settings schema contains an invalid reference')
    }
    const node = graph.refs[String(reference)]
    if (node === undefined || typeof node.type !== 'string') {
      throw new TypeError('real profile Settings schema contains an unresolved reference')
    }
    if (node.type === 'object') {
      const entries = Object.entries(node.dict ?? {})
      if (entries.length === 0 && path.length > 0) leaves.add(path.join('.'))
      for (const [key, child] of entries) visit(child, [...path, key])
      return
    }
    if ((node.type === 'transform' || node.type === 'lazy') && node.inner !== undefined) {
      visit(node.inner, path)
      return
    }
    if (node.type === 'union' || node.type === 'intersect') {
      const members = node.list ?? []
      if (members.length === 0 && path.length > 0) leaves.add(path.join('.'))
      for (const child of members) visit(child, path)
      return
    }
    if (path.length === 0) throw new TypeError('real profile Settings schema root is not an object')
    leaves.add(path.join('.'))
  }
  visit(graph.uid, [])
  return [...leaves].sort()
}

async function controlRpc<T>(baseUrl: string, endpoint: string): Promise<T> {
  const rpcId = `clawdsh-real-profile-control-${endpoint.replaceAll('/', '-')}`
  const response = await fetch(new URL(`/clawdsh-rpc/${endpoint}`, baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId,
      method: endpoint,
      payload: { version: 1 },
    }),
  })
  if (!response.ok) throw new Error(`${endpoint} failed over HTTP ${String(response.status)}: ${await response.text()}`)
  const body = await response.json() as {
    rpcId: string
    result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
  }
  if (body.rpcId !== rpcId) throw new Error(`${endpoint} returned a mismatched rpcId`)
  if (!body.result.ok) throw new Error(`${endpoint} failed: ${body.result.error.code}: ${body.result.error.message}`)
  return body.result.value
}

async function captureEvidence(page: PageLike, name: string): Promise<void> {
  const requested = process.env.CLAWDSH_GUI_SCREENSHOT_DIR?.trim()
  if (requested === undefined || requested === '') return
  const directory = resolve(requested)
  mkdirSync(directory, { recursive: true })
  await page.screenshot({ path: join(directory, name), fullPage: false, animations: 'disabled' })
}

async function captureElementEvidence(locator: LocatorLike, name: string): Promise<void> {
  const requested = process.env.CLAWDSH_GUI_SCREENSHOT_DIR?.trim()
  if (requested === undefined || requested === '') return
  const directory = resolve(requested)
  mkdirSync(directory, { recursive: true })
  await locator.screenshot({ path: join(directory, name), animations: 'disabled' })
}

async function waitForCollapsedSidebar(page: PageLike): Promise<void> {
  await page.locator('[data-sidebar-collapsed]').waitFor({ timeout: 10_000 })
  await page.evaluate(async () => {
    const frame = document.querySelector<HTMLElement>('[data-sidebar-collapsed]')
    if (frame === null) throw new Error('collapsed application frame is missing')
    await new Promise<void>((resolveLayout, rejectLayout) => {
      const started = performance.now()
      const inspect = (): void => {
        const sidebarColumn = frame.firstElementChild
        const settingsTrigger = frame.querySelector<HTMLElement>('[aria-haspopup="dialog"]')
        if (sidebarColumn instanceof HTMLElement
          && sidebarColumn.getBoundingClientRect().width <= 56.01
          && settingsTrigger !== null
          && settingsTrigger.getBoundingClientRect().width <= 36.01) {
          resolveLayout()
          return
        }
        if (performance.now() - started >= 10_000) {
          rejectLayout(new Error('collapsed application sidebar did not finish its width transition'))
          return
        }
        requestAnimationFrame(inspect)
      }
      inspect()
    })
    await new Promise<void>((resolvePaint) => {
      requestAnimationFrame(() => { requestAnimationFrame(() => { resolvePaint() }) })
    })
  }, undefined)
}

async function waitForInteractiveApplication(page: PageLike): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolveReady, rejectReady) => {
      const started = performance.now()
      let stableFrames = 0
      const inspect = (): void => {
        const root = document.getElementById('root')
        if (root === null) {
          rejectReady(new Error('application root is missing'))
          return
        }
        stableFrames = root.inert ? 0 : stableFrames + 1
        if (stableFrames >= 2) {
          resolveReady()
          return
        }
        if (performance.now() - started >= 10_000) {
          rejectReady(new Error('application remained inert after onboarding'))
          return
        }
        requestAnimationFrame(inspect)
      }
      inspect()
    })
  }, undefined)
}

interface ReadyOutput {
  /** Canonical product URL emitted only after the Loader settles. */
  productUrl: string
  /** Combined process output through the readiness line. */
  output: string
}

function waitForReadyLine(child: ChildProcess): Promise<ReadyOutput> {
  return new Promise((resolveReady, reject) => {
    let output = ''
    const timer = setTimeout(() => {
      reject(new Error(`ClawDSH profile did not start in 90s; output:\n${output}`))
    }, 90_000)
    const observe = (chunk: Buffer): void => {
      output += chunk.toString()
      const match = /(?:^|\n)clawdsh web: (http:\/\/127\.0\.0\.1:\d+\/clawdsh\/)/.exec(output)
      if (match?.[1] === undefined) return
      clearTimeout(timer)
      resolveReady({ productUrl: match[1], output })
    }
    child.stdout?.on('data', observe)
    child.stderr?.on('data', observe)
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`ClawDSH profile exited before readiness (code ${String(code)}); output:\n${output}`))
    })
  })
}

function waitForClose(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolveClosed) => {
    const onClose = (): void => {
      clearTimeout(timer)
      child.off('close', onClose)
      resolveClosed(true)
    }
    const timer = setTimeout(() => {
      child.off('close', onClose)
      resolveClosed(false)
    }, timeoutMs)
    child.once('close', onClose)
    if (child.exitCode !== null || child.signalCode !== null) onClose()
  })
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return

  const gracefulClose = waitForClose(child, 5_000)
  child.kill('SIGTERM')
  if (await gracefulClose) return

  const forcedClose = waitForClose(child, 5_000)
  child.kill('SIGKILL')
  if (!(await forcedClose)) throw new Error(`ClawDSH profile process ${String(child.pid)} did not stop`)
}

function snapshotMode(): 'replay' | 'refresh' {
  const mode = process.env.DSH_SNAPSHOT
  if (mode === undefined || mode === '' || mode === 'replay') return 'replay'
  if (mode === 'refresh') return mode
  throw new Error(`real-profile snapshot is keyless; DSH_SNAPSHOT must be replay or refresh, got ${JSON.stringify(mode)}`)
}

function compareOrRefresh(snapshot: string): void {
  if (snapshotMode() === 'refresh') {
    mkdirSync(resolve(expectedSnapshot, '..'), { recursive: true })
    writeFileSync(expectedSnapshot, `${snapshot}\n`)
    return
  }
  expect(snapshot).toBe(readFileSync(expectedSnapshot, 'utf8').trimEnd())
}

async function rpc<T>(baseUrl: string, method: string, payload: unknown): Promise<T> {
  const response = await fetch(new URL(`/api/${method}`, baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: `clawdsh-real-profile-${method}`,
      method,
      payload,
    }),
  })
  if (!response.ok) throw new Error(`${method} failed over HTTP ${String(response.status)}: ${await response.text()}`)
  const body = await response.json() as {
    result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
  }
  if (!body.result.ok) throw new Error(`${method} failed: ${body.result.error.code}: ${body.result.error.message}`)
  return body.result.value
}

function writeActivityFixture(harnessHome: string, sessionId: string): void {
  const activityRoot = join(harnessHome, 'clawdsh', 'activity', 'v1')
  const sessionDirectory = join(activityRoot, createHash('sha256').update(sessionId).digest('hex'))
  mkdirSync(sessionDirectory, { recursive: true, mode: 0o700 })
  for (const directory of [join(harnessHome, 'clawdsh'), join(harnessHome, 'clawdsh', 'activity'), activityRoot, sessionDirectory]) {
    chmodSync(directory, 0o700)
  }
  const sidecar = join(sessionDirectory, 'soul.jsonl')
  writeFileSync(sidecar, `${JSON.stringify({
    version: 1,
    id: '8bf0627d-d6e5-4e29-a963-5cb6579e5d56',
    timestamp: '2026-08-15T12:00:00.000Z',
    sessionId,
    category: 'prompt',
    kind: 'prompt.contribution',
    status: 'succeeded',
    summary: 'ClawDSH Prompt contribution recorded',
    metadata: {
      producer: 'soul',
      section: 'clawdsh:soul',
      mode: 'append',
      characters: 128,
      sha256: 'a'.repeat(64),
      seq: 1,
    },
  })}\n`, { mode: 0o600 })
  chmodSync(sidecar, 0o600)
  const memorySidecar = join(sessionDirectory, 'memory.jsonl')
  writeFileSync(memorySidecar, `${JSON.stringify({
    version: 1,
    id: 'ca251d2f-02f7-4397-bfbd-f7cb80ab9c0a',
    timestamp: '2026-08-15T12:00:00.000Z',
    sessionId,
    category: 'prompt',
    kind: 'prompt.contribution',
    status: 'succeeded',
    summary: 'ClawDSH Prompt contribution recorded',
    metadata: {
      producer: 'memory',
      section: 'clawdsh:memory-recall',
      mode: 'append',
      characters: 256,
      sha256: 'b'.repeat(64),
      seq: 1,
    },
  })}\n`, { mode: 0o600 })
  chmodSync(memorySidecar, 0o600)
}

describe('ClawDSH isolated real profile browser entry', () => {
  it('boots the native Slot composition keyless and exposes secret-free product settings', async () => {
    expect(existsSync(sourceLauncher), 'ClawDSH source launcher is missing').toBe(true)
    expect(existsSync(builtWeb), 'built Web app missing; run `pnpm run build` before this lane').toBe(true)

    const temporaryRoot = mkdtempSync(join(tmpdir(), 'clawdsh-real-profile-'))
    const harnessHome = join(temporaryRoot, '.dsh')
    const environment = keylessEnvironment(harnessHome, join(temporaryRoot, '.agents'))
    expect(externalCredentialNames.every(name => environment[name] === undefined)).toBe(true)
    expect(Object.keys(environment).some(name => name.startsWith('CLAWDSH_OPENCLAW_'))).toBe(false)
    const localProvider = await startLocalProvider()
    environment.DEEPSEEK_BASE_URL = localProvider.baseUrl
    let child: ChildProcess | undefined
    let browser: BrowserLike | undefined

    try {
      const productBuild = spawnSync('pnpm', ['--dir', productShell, 'run', 'build'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        env: environment,
      })
      expect(productBuild.error).toBeUndefined()
      expect(productBuild.status, `${productBuild.stdout}\n${productBuild.stderr}`).toBe(0)
      expect(existsSync(builtProductRuntime), 'nested product runtime build did not emit lib/index.mjs').toBe(true)
      expect(existsSync(builtProductWeb), 'nested browser build did not emit runtime/web/index.html').toBe(true)

      child = spawn(
        sourceLauncher,
        ['--host', '127.0.0.1', '--port', '0'],
        {
          cwd: temporaryRoot,
          env: environment,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
      const ready = await waitForReadyLine(child)
      expect(ready.productUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/clawdsh\/$/)
      expect(ready.output).not.toMatch(/(?:^|\n)dsh web: http:\/\//)
      const harnessUrl = new URL('/', ready.productUrl).href
      expect((await fetch(ready.productUrl)).status).toBe(200)
      expect((await fetch(harnessUrl)).status).toBe(200)
      const faviconResponse = await fetch(new URL('favicon.svg', ready.productUrl))
      expect(faviconResponse.status).toBe(200)
      expect(faviconResponse.headers.get('content-type')).toMatch(/^image\/svg\+xml(?:;|$)/)
      expect(await faviconResponse.text()).toContain('ClawDSH Tidal Claw mark')
      const manifestResponse = await fetch(new URL('manifest.webmanifest', ready.productUrl))
      expect(manifestResponse.status).toBe(200)
      expect(manifestResponse.headers.get('content-type')).toMatch(/^application\/manifest\+json(?:;|$)/)
      const webManifest = await manifestResponse.json() as {
        start_url?: unknown
        scope?: unknown
        icons?: Array<{ src?: unknown; purpose?: unknown }>
      }
      expect(webManifest).toMatchObject({ start_url: '/clawdsh/', scope: '/clawdsh/' })
      expect(webManifest.icons?.some(icon => icon.purpose === 'maskable')).toBe(true)
      expect(webManifest.icons?.every(icon => (
        typeof icon.src === 'string' && icon.src.startsWith('/clawdsh/brand/')
      ))).toBe(true)
      for (const legacyPath of ['settings', 'settings/', 'activity', 'activity/']) {
        const legacy = await fetch(new URL(`${legacyPath}?from=real-profile`, ready.productUrl), {
          redirect: 'manual',
        })
        expect(legacy.status).toBe(308)
        expect(legacy.headers.get('location')).toBe('/clawdsh/?from=real-profile')
      }
      const settingsCatalog = await controlRpc<{
        namespaces: readonly SettingsNamespaceDescriptor[]
      }>(harnessUrl, 'settings/describe')
      expect(settingsCatalog.namespaces.map(item => item.namespace)).toEqual(expectedSettingsNamespaces)
      for (const namespace of settingsCatalog.namespaces) {
        const schemaPaths = settingsLeafPaths(namespace.schema)
        const manifestPaths = namespace.fields.map(field => field.path.join('.')).sort()
        expect(namespace.fields.every(field => field.access === 'editable' || field.access === 'managed')).toBe(true)
        expect(manifestPaths, `${namespace.namespace} manifest must classify every schema leaf`).toEqual(schemaPaths)
      }
      const credentialCatalog = await controlRpc<{
        credentials: ReadonlyArray<{ id: string; configured: boolean; writable: boolean; effectTime: string }>
      }>(harnessUrl, 'credentials/describe')
      expect(credentialCatalog.credentials).toEqual([
        expect.objectContaining({
          id: 'ark-api-key',
          configured: false,
          writable: true,
          effectTime: 'next-call',
        }),
      ])
      expect(JSON.stringify({ settingsCatalog, credentialCatalog })).not.toContain('ARK_API_KEY')
      const created = await rpc<{ sessionId: string }>(harnessUrl, 'session.create', {})
      writeActivityFixture(harnessHome, created.sessionId)

      const chromium = await chromiumLauncher()
      const channel = process.env.DSH_PLAYWRIGHT_CHANNEL
      browser = await chromium.launch(channel === undefined || channel === '' ? {} : { channel })
      const page = await browser.newPage({
        viewport: { width: 1680, height: 1000 },
        locale: 'zh-CN',
        timezoneId: 'Asia/Shanghai',
        reducedMotion: 'reduce',
      })
      const unexpectedBrowserErrors: string[] = []
      page.on('console', (message) => {
        if (message.type() === 'error') {
          unexpectedBrowserErrors.push(`console.error: ${safeBrowserErrorMessage(message.text())}`)
        }
      })
      page.on('pageerror', (error) => {
        unexpectedBrowserErrors.push(`pageerror: ${safeBrowserErrorMessage(error.message)}`)
      })
      await page.goto(ready.productUrl, { waitUntil: 'load' })
      expect(await page.locator('link[rel="icon"]').getAttribute('href')).toBe('/clawdsh/favicon.svg')
      expect(await page.locator('link[rel="manifest"]').getAttribute('href')).toBe('/clawdsh/manifest.webmanifest')

      const sidebarFooter = page.locator('[data-slot="sidebar.footer.action"]')
      const advancedLink = sidebarFooter.getByRole('link', { name: 'ClawDSH · Harness 高级', exact: true })
      await advancedLink.waitFor({ timeout: 30_000 })
      expect(await page.locator('[data-slot="sidebar"]').count()).toBe(1)
      expect(await sidebarFooter.count()).toBe(1)
      expect(await advancedLink.count()).toBe(1)
      expect(await advancedLink.getAttribute('href')).toBe('/')
      const sidebarFooterSnapshot = (await advancedLink.ariaSnapshot()).trim()

      const notice = page.getByRole('dialog', { name: '内测声明' })
      await notice.waitFor({ timeout: 10_000 })
      const blockingOnboardingState = await page.evaluate(() => {
        const root = document.getElementById('root')
        const product = document.getElementById('clawdsh-root')
        return {
          rootExists: root !== null,
          productInsideRoot: root !== null && product !== null && root.contains(product),
          inert: root?.inert,
        }
      }, undefined)
      expect(blockingOnboardingState).toEqual({ rootExists: true, productInsideRoot: true, inert: true })
      await notice.getByRole('button', { name: '继续', exact: true }).click()
      await notice.waitFor({ state: 'detached', timeout: 10_000 })
      const keyDialog = page.getByRole('dialog', { name: '添加一个 API Key 开始使用' })
      await keyDialog.waitFor({ timeout: 10_000 })
      expect(await page.evaluate(() => document.getElementById('root')?.inert, undefined)).toBe(true)
      await keyDialog.getByRole('button', { name: '稍后配置', exact: true }).click()
      await keyDialog.waitFor({ state: 'detached', timeout: 10_000 })
      await waitForInteractiveApplication(page)
      expect(existsSync(join(harnessHome, '.credentials.yaml'))).toBe(false)
      await page.getByText('ClawDSH 模式', { exact: true }).waitFor({ timeout: 10_000 })
      await captureEvidence(page, '1680x1000-home.png')

      await page.setViewportSize({ width: 375, height: 800 })
      await waitForCollapsedSidebar(page)
      const mobileHomeLayout = await page.evaluate(() => {
        const frame = document.querySelector<HTMLElement>('[data-sidebar-collapsed]')
        if (frame === null) throw new Error('collapsed application frame is missing')
        const sidebarColumn = frame.firstElementChild
        if (!(sidebarColumn instanceof HTMLElement)) throw new Error('application sidebar column is missing')
        return {
          innerWidth: window.innerWidth,
          clientWidth: document.documentElement.clientWidth,
          frameWidth: frame.getBoundingClientRect().width,
          sidebarWidth: sidebarColumn.getBoundingClientRect().width,
          gridTemplateColumns: getComputedStyle(frame).gridTemplateColumns,
          horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }
      }, undefined)
      expect(mobileHomeLayout).toMatchObject({
        innerWidth: 375,
        clientWidth: 375,
        frameWidth: 375,
        horizontalOverflow: 0,
      })
      expect(mobileHomeLayout.sidebarWidth).toBeCloseTo(56, 1)
      expect(mobileHomeLayout.gridTemplateColumns).toBe('56px 319px 0px')
      expect((await advancedLink.ariaSnapshot()).trim()).not.toBe('')
      await captureEvidence(page, '375x800-home.png')
      await page.setViewportSize({ width: 1680, height: 1000 })
      await page.locator('[data-sidebar-collapsed]').waitFor({ state: 'detached', timeout: 10_000 })

      await page.getByRole('button', { name: '设置', exact: true }).click()
      const settings = page.getByRole('dialog', { name: '设置' })
      await settings.waitFor({ timeout: 10_000 })
      const initialSettingsFocus = await page.evaluate(() => {
        const active = document.activeElement
        return {
          tag: active?.tagName,
          text: active?.textContent?.trim(),
          insideDialog: active?.closest('[role="dialog"][aria-modal="true"]') !== null,
        }
      }, undefined)
      expect(initialSettingsFocus).toEqual({ tag: 'BUTTON', text: '关闭', insideDialog: true })
      await page.keyboard.press('Escape')
      await settings.waitFor({ state: 'detached', timeout: 10_000 })
      await page.getByRole('button', { name: '设置', exact: true }).click()
      await settings.waitFor({ timeout: 10_000 })
      const clawdshSection = settings.getByRole('button', { name: 'ClawDSH', exact: true })
      await clawdshSection.waitFor({ timeout: 10_000 })
      expect(await clawdshSection.getAttribute('aria-current')).toBe('true')
      await settings.getByRole('heading', { name: 'ClawDSH', exact: true }).waitFor({ timeout: 10_000 })
      const featureStatus = page.locator('section[aria-labelledby="clawdsh-feature-status-title"]')
      await featureStatus.waitFor({ timeout: 10_000 })
      const expectedFeatures = [
        ['soul', 'Soul', 'Soul', '新会话启用'],
        ['memory', 'Memory', 'Memory', '已启用'],
        ['skills', 'Skills Hub', 'Skills Hub', '来源已启用'],
        ['channels', 'Channels', 'Channels', '尚未连接平台'],
        ['automation', '自动任务', '自动任务（Automation）', '尚未设置'],
      ] as const
      for (const [id, statusLabel, configLabel, state] of expectedFeatures) {
        const statusCard = page.locator(`[data-feature="${id}"]`)
        await statusCard.waitFor({ timeout: 10_000 })
        expect(await statusCard.getByText(statusLabel, { exact: true }).count()).toBe(1)
        expect(await statusCard.getByText(state, { exact: true }).count()).toBe(1)
        const configCard = page.locator(`[data-feature-config="${id}"]`)
        expect(await configCard.getByText(configLabel, { exact: true }).count()).toBe(1)
      }
      await page.getByText('3 项已启用 · 2 项未启用 · 1 个配置提醒', { exact: true }).waitFor({ timeout: 10_000 })
      await page.getByText('长期记忆工具已加载，本地存储会在首次读写时验证；语义搜索待配置。', { exact: true }).waitFor({ timeout: 10_000 })
      const settingsSectionSnapshot = (await clawdshSection.ariaSnapshot()).trim()
      const featureStatusSnapshot = (await featureStatus.ariaSnapshot()).trim()
      expect(featureStatusSnapshot).not.toContain('ARK_API_KEY')
      expect(featureStatusSnapshot).not.toContain('FEISHU_APP_SECRET')
      expect(featureStatusSnapshot).not.toContain('TELEGRAM_BOT_TOKEN')
      const configurationLocations = page.locator('section[aria-labelledby="clawdsh-configuration-locations-title"]')
      await configurationLocations.waitFor({ timeout: 10_000 })
      await page.setViewportSize({ width: 1680, height: 1000 })
      await captureEvidence(page, '1680x1000-settings.png')
      for (const width of [375, 320]) {
        await page.setViewportSize({ width, height: 800 })
        await waitForCollapsedSidebar(page)
        const mobileLayout = await page.evaluate(() => {
          const viewportOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth
          const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
          if (dialog === null) throw new Error('native Settings dialog is missing')
          const locations = document.querySelector<HTMLElement>(
            'section[aria-labelledby="clawdsh-configuration-locations-title"]',
          )
          if (locations === null) throw new Error('ClawDSH configuration locations are missing')
          const centerTarget = document.elementFromPoint(window.innerWidth / 2, Math.min(200, window.innerHeight / 2))
          return {
            horizontalOverflow: Math.max(viewportOverflow, dialog.scrollWidth - dialog.clientWidth),
            contentWidth: locations.getBoundingClientRect().width,
            dialogOwnsCenter: centerTarget !== null && dialog.contains(centerTarget),
            focusInsideDialog: dialog.contains(document.activeElement),
          }
        }, undefined)
        expect(mobileLayout.horizontalOverflow).toBeLessThanOrEqual(0)
        expect(mobileLayout.dialogOwnsCenter, 'mobile Settings must paint and receive input outside the collapsed rail')
          .toBe(true)
        expect(mobileLayout.focusInsideDialog, 'mobile Settings must retain keyboard focus while the sidebar settles')
          .toBe(true)
        if (width === 375) {
          await captureEvidence(page, '375x800-settings.png')
          await captureElementEvidence(settings, '375x800-settings-dialog.png')
        }
        expect(mobileLayout.contentWidth, 'mobile Settings must not collapse its content beside a desktop nav rail')
          .toBeGreaterThanOrEqual(220)
        expect((await advancedLink.ariaSnapshot()).trim()).not.toBe('')
      }
      await settings.getByRole('button', { name: '关闭', exact: true }).click()
      await settings.waitFor({ state: 'detached', timeout: 10_000 })
      const closedMobileShell = await page.evaluate(() => {
        const frame = document.querySelector<HTMLElement>('[data-sidebar-collapsed]')
        const sidebarColumn = frame?.firstElementChild
        return {
          hasDialog: frame !== null && frame.querySelector('[role="dialog"][aria-modal="true"]') !== null,
          sidebarOverflow: sidebarColumn instanceof HTMLElement ? getComputedStyle(sidebarColumn).overflow : undefined,
        }
      }, undefined)
      expect(closedMobileShell).toEqual({ hasDialog: false, sidebarOverflow: 'hidden' })
      await page.setViewportSize({ width: 1680, height: 1000 })
      await page.locator('[data-sidebar-collapsed]').waitFor({ state: 'detached', timeout: 10_000 })

      const runtimeCredentials = join(harnessHome, '.credentials.yaml')
      writeFileSync(runtimeCredentials, 'DEEPSEEK_API_KEY: keyless-clawdsh-local-provider\n', { mode: 0o600 })
      chmodSync(runtimeCredentials, 0o600)
      await new Promise<void>((resolveReload) => { setTimeout(resolveReload, 500) })
      await rpc<{ accepted: true }>(harnessUrl, 'session.prompt', {
        sessionId: created.sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: 'ClawDSH real-profile UI fixture' }],
      })
      const providerRequest = await Promise.race([
        localProvider.toolRequest,
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => { reject(new Error('local provider received no model-visible tool catalog in 10s')) }, 10_000).unref()
        }),
      ])
      const automationTool = providerRequest.tools?.find(tool => tool.function?.name === 'automation')?.function
      expect(automationTool?.description).toContain('never substitute Bash, Batch, jobs, sleep, or a background process')
      const parameters = automationTool?.parameters as {
        required?: unknown
        properties?: Record<string, { enum?: unknown }>
      } | undefined
      const automationToolSnapshot = JSON.stringify({
        name: automationTool?.name,
        description: automationTool?.description,
        required: parameters?.required,
        actions: parameters?.properties?.action?.enum,
        scheduleSelectors: ['after_seconds', 'at', 'every_seconds', 'cron']
          .filter(field => parameters?.properties?.[field] !== undefined),
      }, null, 2)
      await page.evaluate(({ sessionId }) => {
        localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId }))
      }, created)
      await page.goto(ready.productUrl, { waitUntil: 'load' })

      const tablist = page.getByRole('tablist')
      await tablist.waitFor({ timeout: 10_000 })
      const tablistSnapshot = (await tablist.ariaSnapshot()).trim()
      const chatIndex = tablistSnapshot.indexOf('tab "对话"')
      const trajectoryIndex = tablistSnapshot.indexOf('tab "轨迹"')
      const recordsIndex = tablistSnapshot.indexOf('tab "ClawDSH 记录"')
      expect(chatIndex).toBeGreaterThanOrEqual(0)
      expect(trajectoryIndex).toBeGreaterThan(chatIndex)
      expect(recordsIndex).toBeGreaterThan(trajectoryIndex)
      const recordsTab = page.getByRole('tab', { name: 'ClawDSH 记录', exact: true })
      await recordsTab.click()
      expect(await recordsTab.getAttribute('aria-selected')).toBe('true')
      await page.locator('section[aria-labelledby="clawdsh-records-title"]').waitFor({ timeout: 10_000 })
      const activityRecord = page.locator(
        `[data-kind="prompt.contribution"]:has-text("${'a'.repeat(64)}")`,
      )
      await activityRecord.waitFor({ timeout: 10_000 })
      await activityRecord.getByRole('heading', { name: '已准备本轮 ClawDSH 上下文', exact: true }).waitFor({ timeout: 10_000 })
      await activityRecord.getByText('技术详情', { exact: true }).waitFor({ timeout: 10_000 })
      const activityRecordSnapshot = (await activityRecord.ariaSnapshot()).trim()
      for (const width of [320, 375]) {
        await page.setViewportSize({ width, height: 800 })
        const horizontalOverflow = await page.evaluate(() => (
          document.documentElement.scrollWidth - document.documentElement.clientWidth
        ), undefined)
        expect(horizontalOverflow).toBeLessThanOrEqual(0)
        expect((await recordsTab.ariaSnapshot()).trim()).not.toBe('')
      }
      await page.setViewportSize({ width: 1680, height: 1000 })

      await page.goto(new URL('not-found', ready.productUrl).href, { waitUntil: 'load' })
      const notFound = page.getByRole('heading', { name: '页面不存在', exact: true })
      await notFound.waitFor({ timeout: 10_000 })
      const notFoundSnapshot = (await notFound.ariaSnapshot()).trim()

      expect(unexpectedBrowserErrors, 'browser emitted unexpected error-level diagnostics').toEqual([])
      compareOrRefresh([
        '# Native sidebar footer',
        sidebarFooterSnapshot,
        '# Native settings default section',
        settingsSectionSnapshot,
        '# Feature status',
        featureStatusSnapshot,
        '# Model-visible Automation tool',
        automationToolSnapshot,
        '# Conversation views',
        tablistSnapshot,
        '# ClawDSH records',
        activityRecordSnapshot,
        '# Unknown product page',
        notFoundSnapshot,
      ].join('\n\n'))
    } finally {
      try {
        await browser?.close()
      } finally {
        try {
          if (child !== undefined) await stop(child)
        } finally {
          try {
            await closeServer(localProvider.server)
          } finally {
            rmSync(temporaryRoot, { recursive: true, force: true })
          }
        }
      }
    }
  })
})
