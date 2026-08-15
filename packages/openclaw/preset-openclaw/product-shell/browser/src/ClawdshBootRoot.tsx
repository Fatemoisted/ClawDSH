import { useSyncExternalStore, type ReactNode } from 'react'
import type { KernelSignal, LoaderStatus } from '@deepseek-ai/dsh-client-web'
import css from './ClawdshBootRoot.module.css'

interface ClawdshBootRootProps {
  readonly settled: KernelSignal<boolean>
  readonly status: KernelSignal<LoaderStatus>
  readonly error: KernelSignal<string | undefined>
  readonly renderProduct: () => ReactNode
}

/** Self-contained loading/failure gate that depends on no runtime plugin. */
export function ClawdshBootRoot({ settled, status, error, renderProduct }: ClawdshBootRootProps): ReactNode {
  const isSettled = useSyncExternalStore(settled.subscribe, settled.getSnapshot, settled.getSnapshot)
  const entries = useSyncExternalStore(status.subscribe, status.getSnapshot, status.getSnapshot)
  const failure = useSyncExternalStore(error.subscribe, error.getSnapshot, error.getSnapshot)
  if (isSettled) return <>{renderProduct()}</>

  const failed = Object.entries(entries).filter(([, state]) => state === 'failed')
  const loud = failure !== undefined || failed.length > 0
  return (
    <div className={css.boot}>
      <div className={css.card}>
        <div className={css.mark}>C</div>
        <strong>ClawDSH</strong>
        {!loud ? (
          <><span className={css.spinner} /><p>正在加载 ClawDSH 能力…</p></>
        ) : (
          <div className={css.failure} role="alert">
            <strong>ClawDSH 启动失败</strong>
            {failed.map(([id]) => <code key={id}>{id}</code>)}
            {failure === undefined ? null : <pre>{failure}</pre>}
          </div>
        )}
      </div>
    </div>
  )
}
