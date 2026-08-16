import { useEffect, useState, type ReactNode } from 'react'
import { NotFoundPage } from './pages/NotFoundPage.tsx'
import css from './ProductShell.module.css'

interface ProductShellProps {
  readonly renderApp: () => ReactNode
  /** Deterministic pathname seam for component tests. */
  readonly pathname?: string
  /** Deterministic navigation seam for component tests. */
  readonly navigateToRoot?: () => void
}

const PRODUCT_ROOT = '/clawdsh/'

/**
 * Render one native DSH application tree at the sole canonical product route.
 * @param props - Native renderer and optional deterministic browser seams.
 * @returns The canonical native application or a loud product-route miss.
 */
export function ProductShell({
  renderApp,
  pathname,
  navigateToRoot,
}: ProductShellProps): ReactNode {
  const [app] = useState<ReactNode>(() => renderApp())
  const currentPath = pathname ?? window.location.pathname
  const atProductRoot = currentPath === PRODUCT_ROOT || currentPath === '/clawdsh'
  useEffect(() => {
    if (!atProductRoot) document.title = '页面不存在 · ClawDSH'
  }, [atProductRoot])

  return (
    <div className={css.shell} data-clawdsh-shell>
      {atProductRoot ? (
        <div className={css.nativeApp} data-native-app>{app}</div>
      ) : (
        <div className={css.page}>
          <NotFoundPage
            pathname={currentPath}
            returnToChat={navigateToRoot ?? (() => { window.location.assign(PRODUCT_ROOT) })}
          />
        </div>
      )}
    </div>
  )
}
