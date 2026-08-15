import type { ChildProcess } from 'node:child_process'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const repositoryRoot = resolve(import.meta.dirname, '../../../..')
const linkScript = join(repositoryRoot, 'tools/link-clawdsh.sh')
const builtCli = join(repositoryRoot, 'apps/cli/lib/bin.js')
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
}

interface PageLike {
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
}

interface BrowserLike {
  /** Open a page with deterministic locale and viewport. */
  newPage(options: { viewport: { width: number; height: number }; locale: string }): Promise<PageLike>
  /** Close the browser and its pages. */
  close(): Promise<void>
}

interface BrowserLauncherLike {
  /** Launch Chromium; a channel is optional for local environments with no downloaded browser. */
  launch(options?: { channel?: string }): Promise<BrowserLike>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
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
  environment.DSH_AGENTS_HOME = agentsHome
  environment.DSH_TELEMETRY_DISABLED = '1'
  return environment
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
}

describe('ClawDSH isolated real profile browser entry', () => {
  it('boots both routes keyless and exposes secret-free product settings', async () => {
    expect(existsSync(builtCli), 'built CLI missing; run `pnpm run build` before this lane').toBe(true)
    expect(existsSync(builtWeb), 'built Web app missing; run `pnpm run build` before this lane').toBe(true)

    const temporaryRoot = mkdtempSync(join(tmpdir(), 'clawdsh-real-profile-'))
    const harnessHome = join(temporaryRoot, '.dsh')
    const environment = keylessEnvironment(harnessHome, join(temporaryRoot, '.agents'))
    expect(externalCredentialNames.every(name => environment[name] === undefined)).toBe(true)
    expect(Object.keys(environment).some(name => name.startsWith('CLAWDSH_OPENCLAW_'))).toBe(false)
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

      const linked = spawnSync(linkScript, [], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        env: environment,
      })
      expect(linked.error).toBeUndefined()
      expect(linked.status, `${linked.stdout}\n${linked.stderr}`).toBe(0)

      child = spawn(
        process.execPath,
        [builtCli, '--profile', 'clawdsh', '--host', '127.0.0.1', '--port', '0'],
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
      const created = await rpc<{ sessionId: string }>(harnessUrl, 'session.create', {})
      writeActivityFixture(harnessHome, created.sessionId)

      const chromium = await chromiumLauncher()
      const channel = process.env.DSH_PLAYWRIGHT_CHANNEL
      browser = await chromium.launch(channel === undefined || channel === '' ? {} : { channel })
      const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: 'zh-CN' })
      await page.goto(ready.productUrl, { waitUntil: 'load' })

      const conversationLink = page.getByRole('link', { name: '对话', exact: true })
      const settingsLink = page.getByRole('link', { name: 'ClawDSH 设置', exact: true })
      const activityLink = page.getByRole('link', { name: 'ClawDSH 活动', exact: true })
      const advancedLink = page.getByRole('link', { name: 'Harness 高级', exact: true })
      for (const destination of [conversationLink, settingsLink, activityLink, advancedLink]) {
        await destination.waitFor({ timeout: 30_000 })
      }
      expect(await advancedLink.getAttribute('href')).toBe('/')
      const navigationSnapshot = await Promise.all(
        [conversationLink, settingsLink, activityLink, advancedLink].map(async link => (await link.ariaSnapshot()).trim()),
      )

      const productEntry = page.getByRole('button', { name: 'ClawDSH 模式', exact: true })
      await productEntry.waitFor({ timeout: 30_000 })
      const notice = page.getByRole('dialog', { name: '内测声明' })
      if (await notice.count() > 0) {
        await notice.getByRole('button', { name: '继续', exact: true }).click()
        await notice.waitFor({ state: 'detached', timeout: 10_000 })
      }
      const keyDialog = page.getByRole('dialog', { name: '添加一个 API Key 开始使用' })
      await keyDialog.waitFor({ timeout: 10_000 })
      await keyDialog.getByRole('button', { name: '稍后配置', exact: true }).click()
      await keyDialog.waitFor({ state: 'detached', timeout: 10_000 })

      await page.getByRole('button', { name: '设置', exact: true }).click()
      const settings = page.getByRole('dialog', { name: '设置' })
      await settings.waitFor({ timeout: 10_000 })
      await settings.getByRole('button', { name: 'Agent 预设', exact: true }).click()
      const current = settings.getByRole('button', { name: /^当前使用: ClawDSH 模式$/ })
      await current.waitFor({ timeout: 10_000 })
      expect(await current.getByText('clawdsh', { exact: true }).count()).toBe(1)
      const currentSnapshot = (await current.ariaSnapshot()).trim()
      await settings.getByRole('button', { name: '关闭', exact: true }).click()
      await settings.waitFor({ state: 'detached', timeout: 10_000 })

      await page.evaluate(({ sessionId }) => {
        localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId }))
      }, created)
      await page.goto(ready.productUrl, { waitUntil: 'load' })
      await page.getByRole('button', { name: 'ClawDSH 模式', exact: true }).waitFor({ timeout: 30_000 })

      await settingsLink.click()
      const settingsPage = page.getByRole('heading', { name: 'ClawDSH 设置', exact: true })
      await settingsPage.waitFor({ timeout: 10_000 })
      const overview = page.getByRole('heading', { name: 'ClawDSH 总览', exact: true })
      await overview.waitFor({ timeout: 10_000 })
      for (const namespace of [
        'clawdsh-soul',
        'clawdsh-channel-agent',
        'clawdsh-channel-openclaw',
        'clawdsh-memory',
        'clawdsh-embeddings-ark',
        'clawdsh-skills-hub',
        'clawdsh-automation',
        'clawdsh-activity',
      ]) {
        await page.locator(`[data-settings-namespace="${namespace}"]`).waitFor({ timeout: 10_000 })
      }
      const gatewayEnabled = page.locator(
        '[data-settings-namespace="clawdsh-channel-openclaw"] [data-setting-path="enabled"] input[type="checkbox"]',
      )
      expect(await gatewayEnabled.count()).toBe(1)
      expect(await gatewayEnabled.isChecked()).toBe(false)
      const arkCredential = page.locator('[data-credential="ark-api-key"]')
      await arkCredential.waitFor({ timeout: 10_000 })
      const arkCredentialSnapshot = (await arkCredential.ariaSnapshot()).trim()
      expect(arkCredentialSnapshot).toContain('未配置')
      expect(arkCredentialSnapshot).not.toContain('ARK_API_KEY')
      expect(arkCredentialSnapshot).not.toContain('FEISHU_APP_SECRET')
      expect(arkCredentialSnapshot).not.toContain('TELEGRAM_BOT_TOKEN')
      await page.getByRole('status', { name: 'Soul 运行中', exact: true }).waitFor({ timeout: 10_000 })
      await page.getByRole('status', { name: 'Channels 已关闭', exact: true }).waitFor({ timeout: 10_000 })
      await page.getByRole('status', { name: 'Automation 已关闭', exact: true }).waitFor({ timeout: 10_000 })
      expect(await page.locator('[data-capability="channels"] [data-support="cataloged"]').count()).toBe(27)
      expect(await page.locator('[data-origin="ClawDSH"]').count()).toBeGreaterThan(0)
      expect(await page.locator('[data-origin="Platform"]').count()).toBeGreaterThan(0)
      const overviewSnapshot = (await overview.ariaSnapshot()).trim()

      await activityLink.click()
      const activity = page.getByRole('heading', { name: 'ClawDSH 活动', exact: true })
      await activity.waitFor({ timeout: 10_000 })
      const activityRecord = page.locator('[data-kind="prompt.contribution"]')
      await activityRecord.waitFor({ timeout: 10_000 })
      await activityRecord.getByRole('heading', { name: 'ClawDSH Prompt 贡献', exact: true }).waitFor({ timeout: 10_000 })
      const activitySnapshot = (await activity.ariaSnapshot()).trim()
      const activityRecordSnapshot = (await activityRecord.ariaSnapshot()).trim()

      await page.goto(new URL('not-found', ready.productUrl).href, { waitUntil: 'load' })
      const notFound = page.getByRole('heading', { name: '页面不存在', exact: true })
      await notFound.waitFor({ timeout: 10_000 })
      const notFoundSnapshot = (await notFound.ariaSnapshot()).trim()

      await page.goto(harnessUrl, { waitUntil: 'load' })
      await page.getByRole('button', { name: 'ClawDSH 模式', exact: true }).waitFor({ timeout: 30_000 })
      expect(await page.getByRole('link', { name: 'ClawDSH 设置', exact: true }).count()).toBe(0)
      expect(await page.getByRole('link', { name: 'ClawDSH 活动', exact: true }).count()).toBe(0)

      compareOrRefresh([
        '# ClawDSH navigation',
        ...navigationSnapshot,
        '# Read-only overview',
        overviewSnapshot,
        '# Semantic activity',
        activitySnapshot,
        activityRecordSnapshot,
        '# Unknown product page',
        notFoundSnapshot,
        '# Installed preset identity',
        currentSnapshot,
      ].join('\n\n'))
    } finally {
      try {
        await browser?.close()
      } finally {
        try {
          if (child !== undefined) await stop(child)
        } finally {
          rmSync(temporaryRoot, { recursive: true, force: true })
        }
      }
    }
  })
})
