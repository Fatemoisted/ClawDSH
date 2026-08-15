/** Product-owned routes; the Harness application remains a separate document at `/`. */
export type ClawdshRouteId = 'chat' | 'settings' | 'activity' | 'not-found'

/** Stable route snapshot consumed through useSyncExternalStore. */
export interface ClawdshRoute {
  readonly id: ClawdshRouteId
  readonly pathname: string
}

/** Minimal observable router contract used by the product shell and tests. */
export interface ClawdshRouter {
  getSnapshot(): ClawdshRoute
  subscribe(listener: () => void): () => void
  navigate(id: Exclude<ClawdshRouteId, 'not-found'>): void
  dispose(): void
}

const ROUTE_PATHS = {
  chat: '/clawdsh/',
  settings: '/clawdsh/settings',
  activity: '/clawdsh/activity',
} as const satisfies Record<Exclude<ClawdshRouteId, 'not-found'>, string>

/** Convert one URL pathname into the product route without silently redirecting misses. */
export function parseClawdshRoute(pathname: string): ClawdshRoute {
  const normalized = pathname.length > 1 && pathname.endsWith('/')
    ? pathname.slice(0, -1)
    : pathname
  if (normalized === '/clawdsh') {
    return { id: 'chat', pathname }
  }
  if (normalized === '/clawdsh/settings') return { id: 'settings', pathname }
  if (normalized === '/clawdsh/activity') return { id: 'activity', pathname }
  return { id: 'not-found', pathname }
}

/** Canonical pathname for a navigable route. */
export function routePath(id: Exclude<ClawdshRouteId, 'not-found'>): string {
  return ROUTE_PATHS[id]
}

/** Browser History API-backed product router. */
export class BrowserClawdshRouter implements ClawdshRouter {
  private readonly listeners = new Set<() => void>()
  private snapshot: ClawdshRoute

  constructor(private readonly browser: Window = window) {
    this.snapshot = parseClawdshRoute(browser.location.pathname)
    browser.addEventListener('popstate', this.onPopState)
  }

  getSnapshot = (): ClawdshRoute => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  navigate = (id: Exclude<ClawdshRouteId, 'not-found'>): void => {
    const pathname = routePath(id)
    if (this.browser.location.pathname !== pathname) {
      this.browser.history.pushState(null, '', pathname)
    }
    this.publish(parseClawdshRoute(pathname))
  }

  dispose(): void {
    this.browser.removeEventListener('popstate', this.onPopState)
    this.listeners.clear()
  }

  private readonly onPopState = (): void => {
    this.publish(parseClawdshRoute(this.browser.location.pathname))
  }

  private publish(next: ClawdshRoute): void {
    if (next.id === this.snapshot.id && next.pathname === this.snapshot.pathname) return
    this.snapshot = next
    for (const listener of [...this.listeners]) listener()
  }
}

/** In-memory router for deterministic component tests. */
export function createMemoryRouter(initialPath = '/clawdsh/'): ClawdshRouter {
  let snapshot = parseClawdshRoute(initialPath)
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    navigate(id) {
      snapshot = parseClawdshRoute(routePath(id))
      for (const listener of [...listeners]) listener()
    },
    dispose() { listeners.clear() },
  }
}
