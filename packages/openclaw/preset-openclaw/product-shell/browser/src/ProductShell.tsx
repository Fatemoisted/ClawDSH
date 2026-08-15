import {
  useEffect,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode,
} from 'react'
import type { ClawdshControlClient } from './control-client.ts'
import { ActivityPage } from './pages/ActivityPage.tsx'
import { NotFoundPage } from './pages/NotFoundPage.tsx'
import { SettingsPage } from './pages/SettingsPage.tsx'
import {
  BrowserClawdshRouter,
  routePath,
  type ClawdshRouteId,
  type ClawdshRouter,
} from './router.ts'
import css from './ProductShell.module.css'

interface ProductShellProps {
  readonly renderConversation: () => ReactNode
  readonly control: ClawdshControlClient
  readonly localControlAvailable: boolean
  readonly router?: ClawdshRouter
}

interface NavigationItem {
  readonly id: Exclude<ClawdshRouteId, 'not-found'>
  readonly label: string
  readonly mark: string
}

const NAVIGATION: readonly NavigationItem[] = [
  { id: 'chat', label: '对话', mark: '⌁' },
  { id: 'settings', label: 'ClawDSH 设置', mark: '◇' },
  { id: 'activity', label: 'ClawDSH 活动', mark: '◎' },
]

const TITLE: Record<ClawdshRouteId, string> = {
  chat: 'ClawDSH',
  settings: 'ClawDSH 设置 · ClawDSH',
  activity: 'ClawDSH 活动 · ClawDSH',
  'not-found': '页面不存在 · ClawDSH',
}

/** Product navigation wrapped around one permanently mounted native conversation tree. */
export function ProductShell({
  renderConversation,
  control,
  localControlAvailable,
  router: suppliedRouter,
}: ProductShellProps): ReactNode {
  const [router] = useState<ClawdshRouter>(() => suppliedRouter ?? new BrowserClawdshRouter())
  const [conversation] = useState<ReactNode>(() => renderConversation())
  const route = useSyncExternalStore(router.subscribe, router.getSnapshot, router.getSnapshot)

  useEffect(() => suppliedRouter === undefined ? () => { router.dispose() } : undefined, [router, suppliedRouter])
  useEffect(() => { document.title = TITLE[route.id] }, [route.id])

  const navigate = (id: NavigationItem['id']) => (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    router.navigate(id)
  }

  return (
    <div className={css.shell} data-clawdsh-shell>
      <aside className={css.navigation}>
        <a className={css.brand} href={routePath('chat')} onClick={navigate('chat')} aria-label="ClawDSH 首页">
          <span className={css.brandMark} aria-hidden="true">C</span>
          <span><strong>ClawDSH</strong><small>Personal Agent</small></span>
        </a>
        <nav aria-label="ClawDSH 主导航">
          {NAVIGATION.map(item => (
            <a
              key={item.id}
              href={routePath(item.id)}
              aria-current={route.id === item.id ? 'page' : undefined}
              onClick={navigate(item.id)}
            >
              <span aria-hidden="true">{item.mark}</span>
              <span>{item.label}</span>
            </a>
          ))}
          <a href="/">
            <span aria-hidden="true">↗</span>
            <span>Harness 高级</span>
          </a>
        </nav>
        <div className={css.engine}>
          <span aria-hidden="true" />
          <span><strong>ClawDSH 模式</strong><small>DeepSeek Harness Engine</small></span>
        </div>
      </aside>

      <main className={css.main}>
        <div
          className={css.conversation}
          hidden={route.id !== 'chat'}
          aria-hidden={route.id !== 'chat' ? 'true' : undefined}
          data-native-conversation
        >
          {conversation}
        </div>
        {route.id === 'settings' ? (
          <div className={css.page}>
            <SettingsPage control={control} localControlAvailable={localControlAvailable} />
          </div>
        ) : null}
        {route.id === 'activity' ? (
          <div className={css.page}><ActivityPage localControlAvailable={localControlAvailable} /></div>
        ) : null}
        {route.id === 'not-found' ? (
          <div className={css.page}>
            <NotFoundPage pathname={route.pathname} returnToChat={() => { router.navigate('chat') }} />
          </div>
        ) : null}
      </main>
    </div>
  )
}
