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
import { ActivityItemCard } from './ActivityRecordCard.tsx'
import { presentActivity } from './activity-presentation.ts'
import css from './ActivityPage.module.css'

interface ActivityPageProps {
  readonly control: ClawdshControlClient
  readonly localControlAvailable: boolean
  /** Latest completed-turn sequence from the public conversation snapshot. */
  readonly refreshRevision?: number
  readonly sessionId?: string
}

interface ActivitySnapshot extends ClawdshActivityListResponse {
  readonly loadingMore: boolean
  readonly loadMoreError?: true
}

type ActivityState =
  | { readonly status: 'loading'; readonly queryKey?: string }
  | { readonly status: 'unselected' }
  | { readonly status: 'failed'; readonly queryKey: string }
  | { readonly status: 'ready'; readonly queryKey: string; readonly snapshot: ActivitySnapshot }

const CATEGORY_FILTERS = [
  { id: 'prompt', label: '身份与上下文' },
  { id: 'memory', label: '记忆' },
  { id: 'channel', label: '外部消息' },
  { id: 'skill', label: '技能' },
  { id: 'automation', label: '定时任务' },
] as const satisfies readonly { readonly id: ClawdshActivityCategory; readonly label: string }[]

const ALL_CATEGORIES = CATEGORY_FILTERS.map(filter => filter.id)
const PAGE_LIMIT = 50

function isAbort(reason: unknown): boolean {
  return reason instanceof Error && reason.name === 'AbortError'
}

function appendRecords(
  previous: readonly ClawdshActivityRecord[],
  next: readonly ClawdshActivityRecord[],
): readonly ClawdshActivityRecord[] {
  const seen = new Set(previous.map(record => record.id))
  return [...previous, ...next.filter(record => !seen.has(record.id))]
}

function Warnings({ snapshot }: { readonly snapshot: ActivitySnapshot }): ReactNode {
  const sidecarMissing = snapshot.availability.sidecar === 'missing'
  const sidecarUnavailable = snapshot.availability.sidecar === 'unavailable'
  const historyUnavailable = snapshot.availability.history === 'unavailable'
  if (!sidecarMissing && !sidecarUnavailable && !historyUnavailable && !snapshot.degraded) return null
  return (
    <div className={css.warnings} role="status">
      {sidecarMissing && snapshot.availability.history === 'inspect' ? (
        <p>这是较早的对话，部分 ClawDSH 行为当时可能没有被记录。</p>
      ) : null}
      {sidecarMissing && snapshot.availability.history === 'live' ? (
        <p>当前对话还没有产生专属行为记录；使用相关能力后才会出现。</p>
      ) : null}
      {sidecarMissing && snapshot.availability.history === 'unavailable' ? (
        <p>这个对话暂时没有可读取的 ClawDSH 行为记录。</p>
      ) : null}
      {sidecarUnavailable ? <p>ClawDSH 行为记录暂时无法读取；实际对话不受影响。</p> : null}
      {historyUnavailable && snapshot.availability.sidecar === 'available' ? (
        <p>常规对话轨迹暂时无法读取；下面仍会展示可用的 ClawDSH 行为记录。</p>
      ) : null}
      {historyUnavailable && snapshot.availability.sidecar !== 'available' ? (
        <p>常规对话轨迹暂时无法读取。</p>
      ) : null}
      {snapshot.degraded ? <p>部分行为可能没有完整记录，但不影响实际对话执行。</p> : null}
    </div>
  )
}

const EMPTY_CATEGORY_MESSAGE: Readonly<Record<ClawdshActivityCategory, string>> = {
  prompt: '没有记录到身份或上下文准备。',
  memory: '没有记录到记忆搜索、读取、写入、更新、删除或整理。',
  channel: '没有记录到外部消息收发。',
  skill: '没有记录到技能准备或调用。',
  automation: '没有记录到定时任务运行。',
}

function EmptyActivity({ categories, complete }: {
  readonly categories: readonly ClawdshActivityCategory[]
  readonly complete: boolean
}): ReactNode {
  return (
    <div className={css.empty} role="status">
      <span className={css.emptyIcon} aria-hidden="true">◎</span>
      <strong>{complete ? '这个对话还没有使用所选能力' : '没有可显示的所选记录'}</strong>
      <p>{complete
        ? categories.length === 1
          ? EMPTY_CATEGORY_MESSAGE[categories[0]!]
          : '可以继续对话，相关能力被使用后会在这里说明。'
        : '部分记录来源不可用或尚未产生，暂时无法据此判断这些能力是否被使用。'}</p>
    </div>
  )
}

function RecordsFrame({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <section className={css.page} aria-labelledby="clawdsh-records-title">
      <h2 id="clawdsh-records-title" className={css.visuallyHidden}>ClawDSH 记录</h2>
      {children}
    </section>
  )
}

/**
 * Render current-Session ClawDSH records over the loopback Activity control plane.
 * @param props - Control client, loopback availability, and Slot-owned Session id.
 * @returns The filterable, paginated semantic record view.
 */
export function ActivityPage({
  control,
  localControlAvailable,
  refreshRevision = -1,
  sessionId,
}: ActivityPageProps): ReactNode {
  const [categories, setCategories] = useState<readonly ClawdshActivityCategory[]>(ALL_CATEGORIES)
  const [order, setOrder] = useState<ClawdshActivityOrder>('desc')
  const [refresh, setRefresh] = useState(0)
  const [state, setState] = useState<ActivityState>({ status: 'loading' })
  const generation = useRef(0)
  const activeRequest = useRef<AbortController>()
  const categoriesKey = categories.join(',')
  const queryKey = `${sessionId ?? ''}\u0000${categoriesKey}\u0000${order}\u0000${refreshRevision}\u0000${refresh}`

  useEffect(() => () => {
    generation.current += 1
    activeRequest.current?.abort()
    activeRequest.current = undefined
  }, [])

  useEffect(() => {
    generation.current += 1
    const currentGeneration = generation.current
    activeRequest.current?.abort()
    activeRequest.current = undefined
    if (!localControlAvailable || sessionId === undefined) return
    if (categories.length === 0) {
      setState({ status: 'unselected' })
      return
    }

    const controller = new AbortController()
    activeRequest.current = controller
    setState({ status: 'loading', queryKey })
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
        queryKey,
        snapshot: { ...response, loadingMore: false },
      })
    }, (reason: unknown) => {
      if (controller.signal.aborted || generation.current !== currentGeneration || isAbort(reason)) return
      setState({ status: 'failed', queryKey })
    }).finally(() => {
      if (activeRequest.current === controller) activeRequest.current = undefined
    })
    return () => { controller.abort() }
  }, [categoriesKey, control, localControlAvailable, order, queryKey, refresh, sessionId])

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
      || state.queryKey !== queryKey
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
      queryKey: state.queryKey,
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
        queryKey: previous.queryKey,
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
        queryKey: previous.queryKey,
        snapshot: {
          ...previous.snapshot,
          loadingMore: false,
          loadMoreError: true,
        },
      })
    }).finally(() => {
      if (activeRequest.current === controller) activeRequest.current = undefined
    })
  }

  if (!localControlAvailable) {
    return (
      <RecordsFrame>
        <div className={css.empty} role="status">
          <span className={css.emptyIcon} aria-hidden="true">◎</span>
          <strong>ClawDSH 记录仅本机可用</strong>
          <p>远程页面仍可使用对话；请在运行 ClawDSH 的本机打开此标签查看记录。</p>
        </div>
      </RecordsFrame>
    )
  }

  if (sessionId === undefined) {
    return (
      <RecordsFrame>
        <div className={css.empty} role="status">
          <span className={css.emptyIcon} aria-hidden="true">◎</span>
          <strong>请先选择一个对话</strong>
          <p>ClawDSH 记录跟随当前会话。选择或创建一个 Session 后即可查看。</p>
        </div>
      </RecordsFrame>
    )
  }

  const visibleState: ActivityState = categories.length === 0
    ? { status: 'unselected' }
    : state.status === 'unselected' || (state.queryKey !== undefined && state.queryKey !== queryKey)
      ? { status: 'loading', queryKey }
      : state

  return (
    <RecordsFrame>
      <div className={css.introduction}>
        <strong>ClawDSH 在这个对话中做了什么</strong>
        <p>这里不是完整调试轨迹，而是用简短中文说明 ClawDSH 专属功能何时被使用；相邻的「轨迹」可补充标准会话步骤，但不一定包含专属记录的错误细节。</p>
        <p>记录只属于当前对话；外部消息和定时任务会在它们各自的独立对话中显示。消息正文、记忆内容和凭据不会展示。</p>
      </div>
      <div className={css.controls}>
        <fieldset className={css.filters}>
          <legend className={css.visuallyHidden}>ClawDSH 记录分类</legend>
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
        </fieldset>
        <label className={css.order}>
          <span>排序</span>
          <select value={order} onChange={(event) => { setOrder(event.target.value as ClawdshActivityOrder) }}>
            <option value="desc">最新优先</option>
            <option value="asc">最早优先</option>
          </select>
        </label>
        <button type="button" className={css.loadMore} onClick={() => { setRefresh(value => value + 1) }}>
          重新读取
        </button>
      </div>

      {visibleState.status === 'loading' ? (
        <div className={css.loading} role="status"><span aria-hidden="true" />正在读取当前会话的 ClawDSH 记录…</div>
      ) : null}
      {visibleState.status === 'unselected' ? (
        <div className={css.empty} role="status">
          <span className={css.emptyIcon} aria-hidden="true">◎</span>
          <strong>请至少选择一个分类</strong>
          <p>选择分类后才会读取并展示当前会话的相关记录。</p>
        </div>
      ) : null}
      {visibleState.status === 'failed' ? (
        <div className={css.failure} role="alert">
          <strong>无法读取 ClawDSH 记录</strong>
          <p>请确认本机 ClawDSH 服务仍在运行，然后重试。实际对话不受影响。</p>
          <button type="button" onClick={() => { setRefresh(value => value + 1) }}>重试</button>
        </div>
      ) : null}
      {visibleState.status === 'ready' ? (
        <>
          <Warnings snapshot={visibleState.snapshot} />
          {visibleState.snapshot.records.length === 0 ? (
            <EmptyActivity
              categories={categories}
              complete={!visibleState.snapshot.degraded
                && visibleState.snapshot.availability.history !== 'unavailable'
                && visibleState.snapshot.availability.sidecar === 'available'}
            />
          ) : (() => {
            const presentation = presentActivity(visibleState.snapshot.records)
            return (
              <>
                {presentation.failures === 0 ? null : (
                  <div className={css.failureSummary} role="status">
                    <strong>发现 {presentation.failures} 项失败记录</strong>
                    <p>失败项会在下面明确标出。可尝试在相邻的「轨迹」查看标准工具调用；专属 sidecar 记录不一定在那里包含错误细节。</p>
                  </div>
                )}
                <ol className={css.timeline} aria-label="ClawDSH 记录列表">
                  {presentation.items.map(item => (
                    <li key={item.id}><ActivityItemCard item={item} /></li>
                  ))}
                </ol>
              </>
            )
          })()}
          {visibleState.snapshot.loadMoreError === undefined ? null : (
            <div className={css.loadError} role="alert">
              <p>记录在分页期间发生了变化，或继续读取暂时失败。请从第一页重新读取。</p>
              <button type="button" className={css.loadMore} onClick={() => { setRefresh(value => value + 1) }}>
                重新读取
              </button>
            </div>
          )}
          {visibleState.snapshot.nextCursor === undefined
            || visibleState.snapshot.loadMoreError !== undefined ? null : (
              <button
                type="button"
                className={css.loadMore}
                disabled={visibleState.snapshot.loadingMore}
                onClick={loadMore}
              >
                {visibleState.snapshot.loadingMore ? '加载中…' : '加载更多'}
              </button>
            )}
        </>
      ) : null}
    </RecordsFrame>
  )
}
