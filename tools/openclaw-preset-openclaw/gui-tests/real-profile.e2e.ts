import type { ChildProcess } from 'node:child_process'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const repositoryRoot = resolve(import.meta.dirname, '../../..')
const linkScript = join(repositoryRoot, 'tools/link-clawdsh.sh')
const builtCli = join(repositoryRoot, 'apps/cli/lib/bin.js')
const builtWeb = join(repositoryRoot, 'apps/web/dist/index.html')
const expectedSnapshot = join(import.meta.dirname, 'snapshots/real-profile/ui.expected.md')
const externalCredentialNames = [
  'ARK_API_KEY',
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_BASE_URL',
  'DISCORD_BOT_TOKEN',
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
}

interface PageLike {
  /** Navigate the browser page. */
  goto(url: string, options?: { waitUntil?: 'load' }): Promise<unknown>
  /** Locate a page element by accessible role. */
  getByRole(role: string, options?: { name?: string | RegExp; exact?: boolean }): LocatorLike
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
    Object.entries(process.env).filter(([name]) => !externalCredentials.has(name)),
  )
  environment.DSH_HOME = harnessHome
  environment.DSH_AGENTS_HOME = agentsHome
  environment.DSH_TELEMETRY_DISABLED = '1'
  environment.CLAWDSH_SKIP_BUILD = '1'
  return environment
}

function waitForReadyLine(child: ChildProcess): Promise<string> {
  return new Promise((resolveReady, reject) => {
    let output = ''
    const timer = setTimeout(() => {
      reject(new Error(`ClawDSH profile did not start in 90s; output:\n${output}`))
    }, 90_000)
    const observe = (chunk: Buffer): void => {
      output += chunk.toString()
      const match = /dsh web: (http:\/\/[^\s]+)/.exec(output)
      if (match?.[1] === undefined) return
      clearTimeout(timer)
      resolveReady(match[1])
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

describe('ClawDSH isolated real profile browser entry', () => {
  it('boots keyless and exposes the clawdsh default as ClawDSH 模式', async () => {
    expect(existsSync(builtCli), 'built CLI missing; run `pnpm run build` before this lane').toBe(true)
    expect(existsSync(builtWeb), 'built Web app missing; run `pnpm run build` before this lane').toBe(true)

    const temporaryRoot = mkdtempSync(join(tmpdir(), 'clawdsh-real-profile-'))
    const harnessHome = join(temporaryRoot, '.dsh')
    const environment = keylessEnvironment(harnessHome, join(temporaryRoot, '.agents'))
    let child: ChildProcess | undefined
    let browser: BrowserLike | undefined

    try {
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
      const baseUrl = await waitForReadyLine(child)
      expect(baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
      expect((await fetch(baseUrl)).status).toBe(200)

      const chromium = await chromiumLauncher()
      const channel = process.env.DSH_PLAYWRIGHT_CHANNEL
      browser = await chromium.launch(channel === undefined || channel === '' ? {} : { channel })
      const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: 'zh-CN' })
      await page.goto(baseUrl, { waitUntil: 'load' })

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

      compareOrRefresh([
        '# ClawDSH product entry',
        (await productEntry.ariaSnapshot()).trim(),
        '# Installed preset identity',
        (await current.ariaSnapshot()).trim(),
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
