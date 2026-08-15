import type { ReactNode } from 'react'
import css from './SimplePage.module.css'

interface NotFoundPageProps {
  readonly pathname: string
  readonly returnToChat: () => void
}

/** Loud product-route miss rather than an implicit redirect. */
export function NotFoundPage({ pathname, returnToChat }: NotFoundPageProps): ReactNode {
  return (
    <div className={css.page}>
      <p className={css.eyebrow}>404</p>
      <h1>页面不存在</h1>
      <p className={css.lead}>ClawDSH 中没有 <code>{pathname}</code> 这个页面。</p>
      <button className={css.button} type="button" onClick={returnToChat}>返回对话</button>
    </div>
  )
}
