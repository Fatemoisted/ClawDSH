import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ClawdshActivityListResponse,
  ClawdshActivityRecord,
} from '../../shared/src/protocol.ts'
import type { ClawdshControlClient } from '../src/control-client.ts'
import { ActivityPage } from '../src/pages/ActivityPage.tsx'
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

describe('ClawDSH Activity page', () => {
  it('renders fixed kind components, five filters, warnings, and the Raw Trajectory link', async () => {
    render(<ActivityPage control={controlFixture()} localControlAvailable sessionId="session-one" />)

    expect(await screen.findByRole('heading', { name: 'ClawDSH Prompt 贡献' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '收到渠道消息' })).toBeTruthy()
    for (const label of ['Soul / Prompt', 'Memory', 'Channels', 'Skills', 'Automation']) {
      expect(screen.getByRole('button', { name: label }).getAttribute('aria-pressed')).toBe('true')
    }
    expect(screen.getByRole('status').textContent).toContain('早期活动可能不完整')
    expect(screen.getByRole('link', { name: /Raw Trajectory/ }).getAttribute('href')).toBe('/')
    expect(document.body.textContent).not.toContain('{"')
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

    fireEvent.click(screen.getByRole('button', { name: 'Soul / Prompt' }))
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
    expect(await screen.findByRole('heading', { name: 'Memory 搜索' })).toBeTruthy()

    first.resolve(ACTIVITY_FIXTURE)
    await Promise.resolve()
    expect(screen.queryByRole('heading', { name: 'ClawDSH Prompt 贡献' })).toBeNull()
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

    await screen.findByRole('heading', { name: 'Memory 搜索' })
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }))
    await waitFor(() => { expect(listActivity).toHaveBeenCalledTimes(2) })
    expect(listActivity.mock.calls[1]?.[0]).toMatchObject({ cursor: 'cursor_one' })
    await waitFor(() => { expect(screen.getAllByRole('heading', { name: 'Memory 搜索' })).toHaveLength(2) })
  })

  it('does not contact local control without a current Session or on a remote page', () => {
    const noSession = vi.fn(async () => page([]))
    const first = render(<ActivityPage control={controlFixture({ listActivity: noSession })} localControlAvailable />)
    expect(screen.getByRole('status').textContent).toContain('请先选择一个对话')
    expect(screen.getByRole('link', { name: '进入对话' }).getAttribute('href')).toBe('/clawdsh/')
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

  it('renders degraded availability without exposing source diagnostics', async () => {
    const canary = '/private/activity/path secret-error-canary'
    const listActivity = vi.fn(async () => page([], {
      availability: { history: 'unavailable', sidecar: 'unavailable' },
      degraded: true,
      warnings: ['activity-history-unavailable', 'activity-data-incomplete'],
    }))
    render(
      <ActivityPage
        control={controlFixture({ listActivity })}
        localControlAvailable
        sessionId="session-one"
      />,
    )

    expect(await screen.findByText(/部分活动数据无法读取/)).toBeTruthy()
    expect(document.body.textContent).not.toContain(canary)
  })
})
