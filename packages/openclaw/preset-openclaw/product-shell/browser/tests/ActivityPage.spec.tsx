import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type {
  ClawdshActivityListResponse,
  ClawdshActivityRecord,
} from '../../shared/src/protocol.ts'
import type { ClawdshControlClient } from '../src/control-client.ts'
import { ActivityPage } from '../src/pages/ActivityPage.tsx'
import { registerClawdshRecords } from '../src/register-clawdsh-records.tsx'
import {
  ACTIVITY_FIXTURE,
  CAPABILITIES_FIXTURE,
  CREDENTIALS_FIXTURE,
  SETTINGS_FIXTURE,
} from './fixtures.ts'

afterEach(cleanup)

function controlFixture(overrides: Partial<ClawdshControlClient> = {}): ClawdshControlClient {
  return {
    loadCapabilities: async () => CAPABILITIES_FIXTURE,
    loadSettings: async () => SETTINGS_FIXTURE,
    loadCredentials: async () => CREDENTIALS_FIXTURE,
    mutateSetting: async () => ({ version: 1, namespace: SETTINGS_FIXTURE.namespaces[0]! }),
    resetSettings: async () => ({ version: 1, namespace: SETTINGS_FIXTURE.namespaces[0]! }),
    setCredential: async () => ({ version: 1, credential: CREDENTIALS_FIXTURE.credentials[0]! }),
    unsetCredential: async () => ({ version: 1, credential: CREDENTIALS_FIXTURE.credentials[0]! }),
    listActivity: async () => ACTIVITY_FIXTURE,
    ...overrides,
  }
}

function memoryRecord(id: string, timestamp: string, sessionId = 'session-one'): ClawdshActivityRecord {
  return {
    version: 1,
    id,
    timestamp,
    sessionId,
    category: 'memory',
    kind: 'memory.search',
    status: 'succeeded',
    summary: 'Memory search activity recorded',
    metadata: { seq: 8 },
  }
}

function page(
  records: readonly ClawdshActivityRecord[],
  overrides: Partial<ClawdshActivityListResponse> = {},
): ClawdshActivityListResponse {
  return {
    version: 1,
    records,
    availability: { history: 'live', sidecar: 'available' },
    degraded: false,
    warnings: [],
    ...overrides,
  }
}

describe('ClawDSH records view', () => {
  it('groups context preparation, uses user-facing categories, and folds technical fields', async () => {
    render(
      <ActivityPage
        control={controlFixture()}
        localControlAvailable
        sessionId="session-one"
      />,
    )

    expect(await screen.findByRole('heading', { name: '已准备本轮 ClawDSH 上下文' })).toBeTruthy()
    expect(screen.getByText(/不是完整调试轨迹/)).toBeTruthy()
    expect(screen.getByText(/只属于当前对话/)).toBeTruthy()
    expect(screen.getAllByRole('heading', { name: '已准备本轮 ClawDSH 上下文' })).toHaveLength(1)
    expect(screen.getByText('已应用 ClawDSH 助手身份。')).toBeTruthy()
    expect(screen.getByText(/不代表已读取或写入记忆/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: '收到外部消息' })).toBeTruthy()
    for (const label of ['身份与上下文', '记忆', '外部消息', '技能', '定时任务']) {
      expect(screen.getByRole('button', { name: label }).getAttribute('aria-pressed')).toBe('true')
    }
    expect(screen.getByText(/当前对话还没有产生专属行为记录/)).toBeTruthy()
    const summaries = screen.getAllByText('技术详情')
    expect(new Set(summaries.map(summary => summary.getAttribute('aria-label'))).size).toBe(summaries.length)
    expect(summaries.every(summary => summary.getAttribute('aria-label')?.includes('技术详情'))).toBe(true)
    const technical = summaries[0]?.closest('details')
    expect(technical?.hasAttribute('open')).toBe(false)
    fireEvent.click(summaries[0]!)
    expect(technical?.hasAttribute('open')).toBe(true)
    expect(technical?.textContent).toContain('会话事件序号')
    expect(technical?.textContent).toContain('SHA-256')
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    expect(screen.queryByRole('button', { name: /Raw Trajectory/ })).toBeNull()
    expect(document.body.textContent).not.toContain('{"')
  })

  it('surfaces failures and distinguishes Memory writes, cleanup requests, and Skill availability', async () => {
    const records: readonly ClawdshActivityRecord[] = [
      {
        version: 1,
        id: 'history:failed-search',
        timestamp: '2026-08-15T12:00:00.000Z',
        sessionId: 'session-one',
        category: 'memory',
        kind: 'memory.search',
        status: 'failed',
        summary: 'Memory search activity recorded',
        metadata: { seq: 4 },
      },
      {
        version: 1,
        id: 'history:write',
        timestamp: '2026-08-15T12:01:00.000Z',
        sessionId: 'session-one',
        category: 'memory',
        kind: 'memory.write',
        status: 'succeeded',
        summary: 'Memory write activity recorded',
        metadata: { scope: 'daily', outcome: 'stored', seq: 5 },
      },
      {
        version: 1,
        id: 'history:update',
        timestamp: '2026-08-15T12:01:30.000Z',
        sessionId: 'session-one',
        category: 'memory',
        kind: 'memory.update',
        status: 'succeeded',
        summary: 'Memory update activity recorded',
        metadata: { action: 'forgotten', outcome: 'forgotten', seq: 6 },
      },
      {
        version: 1,
        id: 'history:flush',
        timestamp: '2026-08-15T12:02:00.000Z',
        sessionId: 'session-one',
        category: 'memory',
        kind: 'memory.flush',
        status: 'started',
        summary: 'Memory flush activity recorded',
        metadata: { seq: 6 },
      },
      {
        version: 1,
        id: 'history:catalog',
        timestamp: '2026-08-15T12:03:00.000Z',
        sessionId: 'session-one',
        category: 'skill',
        kind: 'skill.catalog',
        status: 'succeeded',
        summary: 'Skill catalog activity recorded',
        metadata: { count: 38, seq: 7 },
      },
    ]
    render(
      <ActivityPage
        control={controlFixture({ listActivity: async () => page(records) })}
        localControlAvailable
        sessionId="session-one"
      />,
    )

    expect(await screen.findByText('发现 1 项失败记录')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '搜索长期记忆失败' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '写入当日记录' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '删除长期记忆' })).toBeTruthy()
    expect(screen.getByText(/不会展示被删除的内容/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: '发起记忆整理' })).toBeTruthy()
    expect(screen.getAllByText('未记录完成结果')).not.toHaveLength(0)
    expect(screen.getByText(/不代表记忆已经写入/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: '已准备可用技能目录' })).toBeTruthy()
    expect(screen.getByText(/不代表调用了技能/)).toBeTruthy()
    expect(document.body.textContent).not.toContain('Memory 写回')
  })

  it('sends category and order changes as fresh cursor-free queries', async () => {
    const listActivity = vi.fn<ClawdshControlClient['listActivity']>(async () => page([]))
    render(
      <ActivityPage
        control={controlFixture({ listActivity })}
        localControlAvailable
        sessionId="session-one"
      />,
    )
    await waitFor(() => { expect(listActivity).toHaveBeenCalledTimes(1) })

    fireEvent.click(screen.getByRole('button', { name: '身份与上下文' }))
    await waitFor(() => { expect(listActivity).toHaveBeenCalledTimes(2) })
    expect(listActivity.mock.calls[1]?.[0]).toMatchObject({
      sessionId: 'session-one',
      categories: ['memory', 'channel', 'skill', 'automation'],
      order: 'desc',
    })
    expect(listActivity.mock.calls[1]?.[0]).not.toHaveProperty('cursor')

    fireEvent.change(screen.getByLabelText('排序'), { target: { value: 'asc' } })
    await waitFor(() => { expect(listActivity).toHaveBeenCalledTimes(3) })
    expect(listActivity.mock.calls[2]?.[0]).toMatchObject({ order: 'asc' })
    expect(listActivity.mock.calls[2]?.[0]).not.toHaveProperty('cursor')
  })

  it('aborts an obsolete Session request and ignores its late result', async () => {
    const first = Promise.withResolvers<ClawdshActivityListResponse>()
    const secondPage = page([memoryRecord('history:second', '2026-08-15T12:02:00.000Z', 'session-two')])
    let firstSignal: AbortSignal | undefined
    const listActivity = vi.fn()
      .mockImplementationOnce((_request, signal: AbortSignal | undefined) => {
        firstSignal = signal
        return first.promise
      })
      .mockResolvedValueOnce(secondPage)
    const view = render(
      <ActivityPage
        control={controlFixture({ listActivity })}
        localControlAvailable
        sessionId="session-one"
      />,
    )
    await waitFor(() => { expect(listActivity).toHaveBeenCalledTimes(1) })

    view.rerender(
      <ActivityPage
        control={controlFixture({ listActivity })}
        localControlAvailable
        sessionId="session-two"
      />,
    )
    await waitFor(() => { expect(listActivity).toHaveBeenCalledTimes(2) })
    expect(firstSignal?.aborted).toBe(true)
    expect(listActivity.mock.calls[1]?.[0]).toMatchObject({ sessionId: 'session-two' })
    expect(listActivity.mock.calls[1]?.[0]).not.toHaveProperty('cursor')
    expect(await screen.findByRole('heading', { name: '搜索长期记忆' })).toBeTruthy()

    first.resolve(ACTIVITY_FIXTURE)
    await Promise.resolve()
    expect(screen.queryByRole('heading', { name: '已准备本轮 ClawDSH 上下文' })).toBeNull()
  })

  it('loads a continuation page without replacing existing records', async () => {
    const firstRecord = memoryRecord('history:first', '2026-08-15T12:00:00.000Z')
    const secondRecord = memoryRecord('history:second', '2026-08-15T12:01:00.000Z')
    const listActivity = vi.fn()
      .mockResolvedValueOnce(page([firstRecord], { nextCursor: 'cursor_one' }))
      .mockResolvedValueOnce(page([secondRecord]))
    render(
      <ActivityPage
        control={controlFixture({ listActivity })}
        localControlAvailable
        sessionId="session-one"
      />,
    )

    await screen.findByRole('heading', { name: '搜索长期记忆' })
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }))
    await waitFor(() => { expect(listActivity).toHaveBeenCalledTimes(2) })
    expect(listActivity.mock.calls[1]?.[0]).toMatchObject({ cursor: 'cursor_one' })
    await waitFor(() => { expect(screen.getAllByRole('heading', { name: '搜索长期记忆' })).toHaveLength(2) })
  })

  it('offers a fresh read when continuation becomes stale without exposing the control error', async () => {
    const firstRecord = memoryRecord('history:first', '2026-08-15T12:00:00.000Z')
    const refreshedRecord = memoryRecord('history:refreshed', '2026-08-15T12:02:00.000Z')
    const listActivity = vi.fn()
      .mockResolvedValueOnce(page([firstRecord], { nextCursor: 'cursor_one' }))
      .mockRejectedValueOnce(new Error('private cursor diagnostic'))
      .mockResolvedValueOnce(page([refreshedRecord]))
    render(
      <ActivityPage
        control={controlFixture({ listActivity })}
        localControlAvailable
        sessionId="session-one"
      />,
    )

    await screen.findByRole('button', { name: '加载更多' })
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('请从第一页重新读取')
    expect(alert.textContent).not.toContain('private cursor diagnostic')
    const reread = alert.querySelector('button')
    if (reread === null) throw new Error('continuation error did not offer a fresh read')
    fireEvent.click(reread)

    await waitFor(() => { expect(listActivity).toHaveBeenCalledTimes(3) })
    expect(listActivity.mock.calls[2]?.[0]).not.toHaveProperty('cursor')
    expect(await screen.findByRole('heading', { name: '搜索长期记忆' })).toBeTruthy()
  })

  it('keeps an initial control failure private and offers a fresh read', async () => {
    const listActivity = vi.fn()
      .mockRejectedValueOnce(new Error('cannot read /private/activity/sidecar'))
      .mockResolvedValueOnce(page([]))
    render(
      <ActivityPage
        control={controlFixture({ listActivity })}
        localControlAvailable
        sessionId="session-one"
      />,
    )

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('请确认本机 ClawDSH 服务仍在运行')
    expect(alert.textContent).not.toContain('/private/activity/sidecar')
    fireEvent.click(screen.getByRole('button', { name: '重试' }))

    await waitFor(() => { expect(listActivity).toHaveBeenCalledTimes(2) })
    expect(await screen.findByText('这个对话还没有使用所选能力')).toBeTruthy()
  })

  it('explains delivery, Skill, and Automation outcomes without opaque ids in headings', async () => {
    const records: readonly ClawdshActivityRecord[] = [
      {
        version: 1,
        id: 'channel:sent',
        timestamp: '2026-08-15T12:00:00.000Z',
        sessionId: 'session-one',
        category: 'channel',
        kind: 'channel.delivery',
        status: 'sent',
        summary: 'Channel delivery state recorded',
        metadata: { adapter: 'telegram', conversation: 'direct', mention: null, seq: 1 },
      },
      {
        version: 1,
        id: 'skill:started',
        timestamp: '2026-08-15T12:01:00.000Z',
        sessionId: 'session-one',
        category: 'skill',
        kind: 'skill.invoked',
        status: 'started',
        summary: 'Skill invocation activity recorded',
        metadata: { skill: 'browser', seq: 2 },
      },
      {
        version: 1,
        id: 'automation:succeeded',
        timestamp: '2026-08-15T12:02:00.000Z',
        sessionId: 'session-one',
        category: 'automation',
        kind: 'automation.run',
        status: 'succeeded',
        summary: 'Automation run activity recorded',
        metadata: {
          ruleId: 'opaque-rule-identifier',
          scheduledAt: '2026-08-15T12:02:00.000Z',
          seq: 3,
        },
      },
    ]
    render(
      <ActivityPage
        control={controlFixture({ listActivity: async () => page(records) })}
        localControlAvailable
        sessionId="session-one"
      />,
    )

    expect(await screen.findByRole('heading', { name: '已发送外部消息' })).toBeTruthy()
    expect(screen.getByText(/平台已确认发送/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: '调用 browser 技能' })).toBeTruthy()
    expect(screen.getByText(/技能调用已开始，但没有记录到完成结果/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: '运行定时任务' })).toBeTruthy()
    expect(screen.getByText(/结果保存在该任务自己的对话中/)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /opaque-rule-identifier/ })).toBeNull()
    const automation = screen.getByRole('heading', { name: '运行定时任务' }).closest('article')
    expect(automation?.querySelector('details')?.textContent).toContain('opaque-rule-identifier')
  })

  it('describes unfinished and no-op Memory records without claiming ongoing or completed mutations', async () => {
    const records: readonly ClawdshActivityRecord[] = [
      {
        ...memoryRecord('history:started', '2026-08-15T12:00:00.000Z'),
        status: 'started',
      },
      {
        version: 1,
        id: 'history:already-stored',
        timestamp: '2026-08-15T12:01:00.000Z',
        sessionId: 'session-one',
        category: 'memory',
        kind: 'memory.write',
        status: 'succeeded',
        summary: 'Memory write activity recorded',
        metadata: { scope: 'durable', outcome: 'already-stored', seq: 9 },
      },
      {
        version: 1,
        id: 'history:already-current',
        timestamp: '2026-08-15T12:02:00.000Z',
        sessionId: 'session-one',
        category: 'memory',
        kind: 'memory.update',
        status: 'succeeded',
        summary: 'Memory update activity recorded',
        metadata: { action: 'updated', outcome: 'already-current', seq: 10 },
      },
      {
        version: 1,
        id: 'history:not-found',
        timestamp: '2026-08-15T12:03:00.000Z',
        sessionId: 'session-one',
        category: 'memory',
        kind: 'memory.update',
        status: 'succeeded',
        summary: 'Memory update activity recorded',
        metadata: { action: 'forgotten', outcome: 'not-found', seq: 11 },
      },
    ]
    render(
      <ActivityPage
        control={controlFixture({ listActivity: async () => page(records) })}
        localControlAvailable
        sessionId="session-one"
      />,
    )

    expect(await screen.findAllByText('未记录完成结果')).not.toHaveLength(0)
    expect(screen.getByText(/没有记录到完成结果/)).toBeTruthy()
    expect(screen.queryByText(/正在搜索长期记忆/)).toBeNull()
    expect(screen.getByRole('heading', { name: '长期事实已存在' })).toBeTruthy()
    expect(screen.getByText(/没有重复写入/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: '长期记忆无需更新' })).toBeTruthy()
    expect(screen.getByText(/因此没有修改/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: '未找到要删除的长期记忆' })).toBeTruthy()
    expect(screen.getByText(/没有删除任何内容/)).toBeTruthy()
  })

  it('refreshes once when a newly completed turn advances the public Session revision', async () => {
    const listActivity = vi.fn<ClawdshControlClient['listActivity']>(async () => page([]))
    const control = controlFixture({ listActivity })
    const view = render(
      <ActivityPage
        control={control}
        localControlAvailable
        refreshRevision={10}
        sessionId="session-one"
      />,
    )
    await waitFor(() => { expect(listActivity).toHaveBeenCalledTimes(1) })

    view.rerender(
      <ActivityPage
        control={control}
        localControlAvailable
        refreshRevision={10}
        sessionId="session-one"
      />,
    )
    await Promise.resolve()
    expect(listActivity).toHaveBeenCalledTimes(1)

    view.rerender(
      <ActivityPage
        control={control}
        localControlAvailable
        refreshRevision={20}
        sessionId="session-one"
      />,
    )
    await waitFor(() => { expect(listActivity).toHaveBeenCalledTimes(2) })
    expect(listActivity.mock.calls[1]?.[0]).not.toHaveProperty('cursor')
  })

  it('hides the previous Session records and continuation while the new Session loads', async () => {
    const second = Promise.withResolvers<ClawdshActivityListResponse>()
    const listActivity = vi.fn()
      .mockResolvedValueOnce(page([
        memoryRecord('history:first', '2026-08-15T12:00:00.000Z'),
      ], { nextCursor: 'old_cursor' }))
      .mockImplementationOnce(() => second.promise)
    const control = controlFixture({ listActivity })
    const view = render(
      <ActivityPage control={control} localControlAvailable sessionId="session-one" />,
    )
    await screen.findByRole('button', { name: '加载更多' })

    view.rerender(<ActivityPage control={control} localControlAvailable sessionId="session-two" />)

    expect(screen.queryByRole('heading', { name: '搜索长期记忆' })).toBeNull()
    expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull()
    expect(screen.getByText(/正在读取当前会话/)).toBeTruthy()
    second.resolve(page([]))
    expect(await screen.findByText('这个对话还没有使用所选能力')).toBeTruthy()
  })

  it('does not contact local control without a current Session or on a remote page', () => {
    const noSession = vi.fn(async () => page([]))
    const first = render(
      <ActivityPage
        control={controlFixture({ listActivity: noSession })}
        localControlAvailable
      />,
    )
    expect(screen.getByRole('status').textContent).toContain('请先选择一个对话')
    expect(noSession).not.toHaveBeenCalled()
    first.unmount()

    const remote = vi.fn(async () => page([]))
    render(
      <ActivityPage
        control={controlFixture({ listActivity: remote })}
        localControlAvailable={false}
        sessionId="session-one"
      />,
    )
    expect(screen.getByRole('status').textContent).toContain('仅本机可用')
    expect(remote).not.toHaveBeenCalled()
  })

  it('shows category-specific empty guidance and stops querying when every category is deselected', async () => {
    const listActivity = vi.fn(async () => page([]))
    render(
      <ActivityPage
        control={controlFixture({ listActivity })}
        localControlAvailable
        sessionId="session-one"
      />,
    )

    expect(await screen.findByText('这个对话还没有使用所选能力')).toBeTruthy()
    expect(screen.getByText('可以继续对话，相关能力被使用后会在这里说明。')).toBeTruthy()

    for (const label of ['身份与上下文', '记忆', '外部消息', '技能', '定时任务']) {
      fireEvent.click(screen.getByRole('button', { name: label }))
    }
    expect(await screen.findByText('请至少选择一个分类')).toBeTruthy()
    await waitFor(() => { expect(listActivity).toHaveBeenCalledTimes(5) })
  })

  it.each([
    [
      'historical missing sidecar',
      { history: 'inspect' as const, sidecar: 'missing' as const },
      false,
      ['activity-sidecar-missing' as const],
      '较早的对话',
    ],
    [
      'unreadable sidecar',
      { history: 'live' as const, sidecar: 'unavailable' as const },
      true,
      ['activity-data-incomplete' as const],
      'ClawDSH 行为记录暂时无法读取',
    ],
    [
      'unavailable Session history',
      { history: 'unavailable' as const, sidecar: 'available' as const },
      false,
      ['activity-history-unavailable' as const],
      '常规对话轨迹暂时无法读取',
    ],
    [
      'degraded records',
      { history: 'live' as const, sidecar: 'available' as const },
      true,
      ['activity-data-incomplete' as const],
      '部分行为可能没有完整记录',
    ],
  ])('explains %s without source diagnostics', async (_name, availability, degraded, warnings, message) => {
    const listActivity = vi.fn(async () => page([], { availability, degraded, warnings }))
    render(
      <ActivityPage
        control={controlFixture({ listActivity })}
        localControlAvailable
        sessionId="session-one"
      />,
    )

    expect(await screen.findByText(new RegExp(message))).toBeTruthy()
    expect(screen.getByText('没有可显示的所选记录')).toBeTruthy()
    expect(document.body.textContent).not.toContain('/private/activity/path')
  })

  it('aborts the active request when the view unmounts', async () => {
    const pending = Promise.withResolvers<ClawdshActivityListResponse>()
    let signal: AbortSignal | undefined
    const listActivity = vi.fn((_request, requestSignal: AbortSignal | undefined) => {
      signal = requestSignal
      return pending.promise
    })
    const view = render(
      <ActivityPage
        control={controlFixture({ listActivity })}
        localControlAvailable
        sessionId="session-one"
      />,
    )
    await waitFor(() => { expect(listActivity).toHaveBeenCalledOnce() })

    view.unmount()

    expect(signal?.aborted).toBe(true)
    pending.resolve(page([]))
  })

  it('registers after Trajectory and binds the Slot-provided Session id', async () => {
    const listActivity = vi.fn<ClawdshControlClient['listActivity']>(async () => page([]))
    const register = vi.fn((_options: unknown, _component: unknown) => vi.fn())
    const inject = vi.fn((_name: string, setup: () => unknown) => setup())

    registerClawdshRecords({ slots: { inject, register } } as never, {
      control: controlFixture({ listActivity }),
      localControlAvailable: true,
    })

    expect(inject).toHaveBeenCalledWith('conversation.view', expect.any(Function))
    expect(register).toHaveBeenCalledOnce()
    expect(register.mock.calls[0]?.[0]).toEqual({
      name: 'conversation.view',
      id: 'clawdsh-records',
      order: 20,
      label: 'ClawDSH 记录',
    })
    const View = register.mock.calls[0]?.[1] as (props: {
      readonly sessionId: string
      readonly useSession: <T>(selector: (snapshot: { readonly turnEnds: ReadonlyMap<number, number> }) => T) => T
    }) => ReactNode
    let selectedSessionSnapshot = false
    const useSession = <T,>(selector: (
      snapshot: { readonly turnEnds: ReadonlyMap<number, number> },
    ) => T): T => {
      selectedSessionSnapshot = true
      return selector({ turnEnds: new Map([[1, 42]]) })
    }
    render(<View sessionId="slot-session" useSession={useSession} />)

    await waitFor(() => { expect(listActivity).toHaveBeenCalledOnce() })
    expect(selectedSessionSnapshot).toBe(true)
    expect(listActivity.mock.calls[0]?.[0]).toMatchObject({ sessionId: 'slot-session' })
  })
})
