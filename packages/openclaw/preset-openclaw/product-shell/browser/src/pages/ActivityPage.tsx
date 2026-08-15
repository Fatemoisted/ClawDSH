import type { ReactNode } from 'react'
import css from './SimplePage.module.css'

interface ActivityPageProps {
  readonly localControlAvailable: boolean
}

/** Stage-one Activity empty state; semantic records arrive in the Activity stage. */
export function ActivityPage({ localControlAvailable }: ActivityPageProps): ReactNode {
  return (
    <div className={css.page}>
      <p className={css.eyebrow}>会话可解释性</p>
      <h1>ClawDSH 活动</h1>
      <div className={css.empty} role="status">
        <span className={css.emptyIcon} aria-hidden="true">◎</span>
        <strong>{localControlAvailable ? '当前会话还没有 ClawDSH 活动' : 'ClawDSH 活动仅本机可用'}</strong>
        <p>{localControlAvailable
          ? 'Prompt、Memory、渠道、Skills 与 Automation 活动将在后续阶段显示在这里。'
          : '远程页面仍可使用对话；请在运行 ClawDSH 的本机打开此页面查看活动。'}</p>
      </div>
    </div>
  )
}
