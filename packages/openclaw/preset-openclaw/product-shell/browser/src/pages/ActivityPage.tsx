import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type {
  ClawdshActivityCategory,
  ClawdshActivityListResponse,
  ClawdshActivityOrder,
  ClawdshActivityRecord,
} from '../../../shared/src/protocol.ts'
import type { ClawdshControlClient } from '../control-client.ts'
import { ActivityRecordCard } from './ActivityRecordCard.tsx'
import css from './ActivityPage.module.css'

interface ActivityPageProps {
  readonly control: ClawdshControlClient
  readonly localControlAvailable: boolean
  readonly sessionId?: string
}

interface ActivitySnapshot extends ClawdshActivityListResponse {
  readonly loadingMore: boolean
  readonly loadMoreError?: string
}

type ActivityState =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'ready'; readonly snapshot: ActivitySnapshot }

const CATEGORY_FILTERS = [
  { id: 'prompt', label: 'Soul / Prompt' },
  { id: 'memory', label: 'Memory' },
  { id: 'channel', label: 'Channels' },
  { id: 'skill', label: 'Skills' },
  { id: 'automation', label: 'Automation' },
] as const satisfies readonly { readonly id: ClawdshActivityCategory; readonly label: string }[]

const ALL_CATEGORIES = CATEGORY_FILTERS.map(filter => filter.id)
const PAGE_LIMIT = 50

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function isAbort(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === 'AbortError'
}

function appendRecords(
  previous: readonly ClawdshActivityRecord[],
  next: readonly ClawdshActivityRecord[],
): readonly ClawdshActivityRecord[] {
  const seen = new Set(previous.map(record => record.id))
  return [...previous, ...next.filter(record => !seen.has(record.id))]
}

function Warnings({ snapshot }: { readonly snapshot: ActivitySnapshot }): ReactNode {
  const missing = snapshot.warnings.includes('activity-sidecar-missing')
  const historyUnavailable = snapshot.warnings.includes('activity-history-unavailable')
  const incomplete = snapshot.warnings.includes('activity-data-incomplete')
  if (!missing && !historyUnavailable && !incomplete) return null
  return (
    <div className={css.warnings} role="status">
      {missing ? <p>这个会话没有 Activity sidecar；早期活动可能不完整。</p> : null}
      {historyUnavailable ? <p>标准会话历史当前不可用，仍会显示可读取的 ClawDSH sidecar 活动。</p> : null}
      {incomplete ? <p>部分活动数据无法读取；对话、渠道和自动化执行不受影响。</p> : null}
    </div>
  )
}

/** Session-following semantic Activity view over the loopback control plane. */
export function ActivityPage({ control, localControlAvailable, sessionId }: ActivityPageProps): ReactNode {
  const [categories, setCategories] = useState<readonly ClawdshActivityCategory[]>(ALL_CATEGORIES)
  const [order, setOrder] = useState<ClawdshActivityOrder>('desc')
  const [refresh, setRefresh] = useState(0)
  const [state, setState] = useState<ActivityState>({ status: 'loading' })
  const generation = useRef(0)
  const activeRequest = useRef<AbortController>()
  const categoriesKey = categories.join(',')

  useEffect(() => {
    generation.current += 1
    const currentGeneration = generation.current
    activeRequest.current?.abort()
    activeRequest.current = undefined
    if (!localControlAvailable || sessionId === undefined) return

    const controller = new AbortController()
    activeRequest.current = controller
    setState({ status: 'loading' })
    void control.listActivity({
      version: 1,
      sessionId,
      categories,
      order,
      limit: PAGE_LIMIT,
    }, controller.signal).then((response) => {
      if (controller.signal.aborted || generation.current !== currentGeneration) return
      setState({
        status: 'ready',
        snapshot: { ...response, loadingMore: false },
      })
    }, (reason: unknown) => {
      if (controller.signal.aborted || generation.current !== currentGeneration || isAbort(reason)) return
      setState({ status: 'failed', message: errorMessage(reason) })
    }).finally(() => {
      if (activeRequest.current === controller) activeRequest.current = undefined
    })
    return () => { controller.abort() }
  }, [categoriesKey, control, localControlAvailable, order, refresh, sessionId])

  const toggleCategory = (category: ClawdshActivityCategory): void => {
    setCategories((current) => {
      const selected = new Set(current)
      if (selected.has(category)) selected.delete(category)
      else selected.add(category)
      return ALL_CATEGORIES.filter(candidate => selected.has(candidate))
    })
  }

  const loadMore = (): void => {
    if (state.status !== 'ready'
      || state.snapshot.nextCursor === undefined
      || state.snapshot.loadingMore
      || sessionId === undefined) return
    const currentGeneration = generation.current
    const cursor = state.snapshot.nextCursor
    const controller = new AbortController()
    activeRequest.current?.abort()
    activeRequest.current = controller
    setState({
      status: 'ready',
      snapshot: {
        version: state.snapshot.version,
        records: state.snapshot.records,
        ...(state.snapshot.nextCursor === undefined ? {} : { nextCursor: state.snapshot.nextCursor }),
        availability: state.snapshot.availability,
        degraded: state.snapshot.degraded,
        warnings: state.snapshot.warnings,
        loadingMore: true,
      },
    })
    void control.listActivity({
      version: 1,
      sessionId,
      categories,
      order,
      limit: PAGE_LIMIT,
      cursor,
    }, controller.signal).then((response) => {
      if (controller.signal.aborted || generation.current !== currentGeneration) return
      setState(previous => previous.status !== 'ready' ? previous : {
        status: 'ready',
        snapshot: {
          ...response,
          records: appendRecords(previous.snapshot.records, response.records),
          loadingMore: false,
        },
      })
    }, (reason: unknown) => {
      if (controller.signal.aborted || generation.current !== currentGeneration || isAbort(reason)) return
      setState(previous => previous.status !== 'ready' ? previous : {
        status: 'ready',
        snapshot: {
          ...previous.snapshot,
          loadingMore: false,
          loadMoreError: errorMessage(reason),
        },
      })
    }).finally(() => {
      if (activeRequest.current === controller) activeRequest.current = undefined
    })
  }

  if (!localControlAvailable) {
    return (
      <div className={css.page}>
        <p className={css.eyebrow}>会话可解释性</p>
        <h1>ClawDSH 活动</h1>
        <div className={css.empty} role="status">
          <span className={css.emptyIcon} aria-hidden="true">◎</span>
          <strong>ClawDSH 活动仅本机可用</strong>
          <p>远程页面仍可使用对话；请在运行 ClawDSH 的本机打开此页面查看活动。</p>
        </div>
      </div>
    )
  }

  if (sessionId === undefined) {
    return (
      <div className={css.page}>
        <p className={css.eyebrow}>会话可解释性</p>
        <h1>ClawDSH 活动</h1>
        <div className={css.empty} role="status">
          <span className={css.emptyIcon} aria-hidden="true">◎</span>
          <strong>请先选择一个对话</strong>
          <p>Activity 跟随当前会话。进入对话并选择或创建一个 Session 后即可查看。</p>
          <a className={css.primaryLink} href="/clawdsh/">进入对话</a>
        </div>
      </div>
    )
  }

  return (
    <div className={css.page}>
      <header className={css.header}>
        <div>
          <p className={css.eyebrow}>会话可解释性</p>
          <h1>ClawDSH 活动</h1>
          <p className={css.lead}>仅展示 ClawDSH 的隐私保护语义记录；最终原始轨迹仍由 Harness 提供。</p>
        </div>
        <a className={css.advancedLink} href="/">打开 Raw Trajectory ↗</a>
      </header>

      <section className={css.controls} aria-label="Activity 筛选与排序">
        <div className={css.filters} aria-label="Activity 分类">
          {CATEGORY_FILTERS.map(filter => (
            <button
              key={filter.id}
              type="button"
              aria-pressed={categories.includes(filter.id)}
              onClick={() => { toggleCategory(filter.id) }}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <label className={css.order}>
          <span>排序</span>
          <select value={order} onChange={(event) => { setOrder(event.target.value as ClawdshActivityOrder) }}>
            <option value="desc">最新优先</option>
            <option value="asc">最早优先</option>
          </select>
        </label>
      </section>

      {state.status === 'loading' ? (
        <div className={css.loading} role="status"><span aria-hidden="true" />正在读取当前会话活动…</div>
      ) : null}
      {state.status === 'failed' ? (
        <div className={css.failure} role="alert">
          <strong>无法读取 ClawDSH 活动</strong>
          <p>{state.message}</p>
          <button type="button" onClick={() => { setRefresh(value => value + 1) }}>重试</button>
        </div>
      ) : null}
      {state.status === 'ready' ? (
        <>
          <Warnings snapshot={state.snapshot} />
          {state.snapshot.records.length === 0 ? (
            <div className={css.empty} role="status">
              <span className={css.emptyIcon} aria-hidden="true">◎</span>
              <strong>当前筛选下还没有 ClawDSH 活动</strong>
              <p>这里不会展示完整 Prompt、消息正文、工具结果、平台身份或凭据。</p>
            </div>
          ) : (
            <div className={css.timeline} aria-label="ClawDSH Activity 记录">
              {state.snapshot.records.map(record => <ActivityRecordCard key={record.id} record={record} />)}
            </div>
          )}
          {state.snapshot.loadMoreError === undefined ? null : (
            <div className={css.loadError} role="alert">加载更多失败：{state.snapshot.loadMoreError}</div>
          )}
          {state.snapshot.nextCursor === undefined ? null : (
            <button
              type="button"
              className={css.loadMore}
              disabled={state.snapshot.loadingMore}
              onClick={loadMore}
            >
              {state.snapshot.loadingMore ? '加载中…' : '加载更多'}
            </button>
          )}
        </>
      ) : null}
    </div>
  )
}
