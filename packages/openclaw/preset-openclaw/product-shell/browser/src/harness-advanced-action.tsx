import type { ReactNode } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SidebarFooterActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { IconRightUpOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './ProductShell.module.css'

/**
 * Render the full-page escape hatch from the product surface to Harness.
 * @param props - Native sidebar width state.
 * @returns The wide row or collapsed-rail link.
 */
export function HarnessAdvancedAction({ wide }: SidebarFooterActionOwnerProps): ReactNode {
  return (
    <Tooltip label="Harness 高级" delayMs={500} disabled={wide}>
      <a
        className={wide ? css.advancedAction : `${css.advancedAction} ${css.advancedActionRail}`}
        href="/"
        aria-label="Harness 高级"
        data-clawdsh-harness-advanced
      >
        <IconRightUpOutline16 size={wide ? 14 : 18} />
        {wide && <span className={css.advancedActionLabel}>Harness 高级</span>}
      </a>
    </Tooltip>
  )
}

/**
 * Register the Harness document link in the public native-sidebar footer Slot.
 * @param ctx - Active Client context carrying the public Slot registry.
 * @returns Nothing; the registration follows the Client plugin lifecycle.
 */
export function registerHarnessAdvancedAction(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'clawdsh-harness-advanced',
    order: 100,
    label: 'Harness 高级',
  }, HarnessAdvancedAction))
}
