import css from './FatalBoot.module.css'

const MARK_URL = '/clawdsh/brand/clawdsh-mark.svg'

/** Stable public codes for browser boot failures; unknown error values remain private. */
export const CLAWDSH_BOOT_FAILURE_CODES = Object.freeze({
  bootstrap: 'CLAWDSH_BOOT_FAILED',
  dispose: 'CLAWDSH_BOOT_DISPOSE_FAILED',
  plugin: 'CLAWDSH_PLUGIN_BOOT_FAILED',
})

function cssClass(name: string): string {
  const value = css[name]
  if (value === undefined) throw new Error(`ClawDSH fatal boot style is missing: ${name}`)
  return value
}

/** Replace an unusable browser mount with a dependency-free branded failure surface. */
export function renderFatalBootFailure(mount: HTMLElement): void {
  const root = document.createElement('div')
  root.className = cssClass('root')
  root.dataset.clawdshFatalBoot = 'true'
  root.setAttribute('role', 'alert')

  const card = document.createElement('div')
  card.className = cssClass('card')

  const mark = document.createElement('img')
  mark.className = cssClass('mark')
  mark.src = MARK_URL
  mark.alt = ''

  const title = document.createElement('strong')
  title.className = cssClass('title')
  title.textContent = 'ClawDSH 启动失败'

  const message = document.createElement('p')
  message.className = cssClass('message')
  message.textContent = '浏览器应用未能完成初始化。请刷新页面；若问题持续，请运行 ClawDSH doctor。'

  const detail = document.createElement('code')
  detail.className = cssClass('detail')
  detail.textContent = CLAWDSH_BOOT_FAILURE_CODES.bootstrap

  card.append(mark, title, message, detail)
  root.append(card)
  mount.replaceChildren(root)
}
