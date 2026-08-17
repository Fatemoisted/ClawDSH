import type { ReactNode } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SidebarFooterActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { IconRightUpOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { ClawdshMark } from './clawdsh-brand.tsx'
import css from './ProductShell.module.css'

/**
 * Render the full-page escape hatch from the product surface to Harness.
 * @param props - Native sidebar width state.
 * @returns The wide row or collapsed-rail link.
 */
export function HarnessAdvancedAction({ wide }: SidebarFooterActionOwnerProps): ReactNode {
  return (
    <Tooltip label="ClawDSH · Powered by DeepSeek Harness" delayMs={500} disabled={wide}>
      <a
        className={wide ? css.advancedAction : `${css.advancedAction} ${css.advancedActionRail}`}
        href="/"
        aria-label="ClawDSH · Harness 高级"
        data-clawdsh-harness-advanced
      >
        <ClawdshMark className={css.advancedActionMark} />
        {wide ? (
          <span className={css.advancedActionCopy}>
            <span className={css.advancedActionLabel}>ClawDSH</span>
            <small>Powered by DeepSeek Harness</small>
          </span>
        ) : null}
        {wide ? <IconRightUpOutline16 className={css.advancedActionExternal} size={14} /> : null}
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
    label: 'ClawDSH · Harness 高级',
  }, HarnessAdvancedAction))
}
