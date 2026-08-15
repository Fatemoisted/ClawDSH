import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { ProductShell } from '../src/ProductShell.tsx'
import type { ClawdshControlClient } from '../src/control-client.ts'
import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import { createMemoryRouter } from '../src/router.ts'
import {
  CAPABILITIES_FIXTURE,
  CREDENTIALS_FIXTURE,
  ACTIVITY_FIXTURE,
  SETTINGS_FIXTURE,
} from './fixtures.ts'

afterEach(cleanup)

function ConversationFixture() {
  const [count, setCount] = useState(0)
  return <button type="button" onClick={() => { setCount(value => value + 1) }}>conversation {count}</button>
}

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

function sessionsFixture(current = 'session-one'): Pick<ISessions, 'list'> {
  return {
    list: {
      getSnapshot: () => ({ current }),
      subscribe: () => () => undefined,
    },
  } as unknown as Pick<ISessions, 'list'>
}

function mutableSessionsFixture(initial?: string): {
  readonly sessions: Pick<ISessions, 'list'>
  readonly select: (sessionId: string | undefined) => void
} {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    sessions: {
      list: {
        getSnapshot: () => ({ current }),
        subscribe: (listener: () => void) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      },
    } as unknown as Pick<ISessions, 'list'>,
    select(sessionId) {
      current = sessionId
      for (const listener of listeners) listener()
    },
  }
}

describe('ClawDSH product shell', () => {
  it('exposes the fixed product navigation and a direct Harness document link', () => {
    render(
      <ProductShell
        renderConversation={() => <ConversationFixture />}
        control={controlFixture()}
        localControlAvailable
        sessions={sessionsFixture()}
        router={createMemoryRouter()}
      />,
    )

    expect(screen.getByRole('link', { name: '对话' }).getAttribute('href')).toBe('/clawdsh/')
    expect(screen.getByRole('link', { name: 'ClawDSH 设置' }).getAttribute('href')).toBe('/clawdsh/settings')
    expect(screen.getByRole('link', { name: 'ClawDSH 活动' }).getAttribute('href')).toBe('/clawdsh/activity')
    expect(screen.getByRole('link', { name: 'Harness 高级' }).getAttribute('href')).toBe('/')
    for (const label of ['对话', 'ClawDSH 设置', 'ClawDSH 活动', 'Harness 高级']) {
      const link = screen.getByRole('link', { name: label })
      expect(link.getAttribute('aria-label')).toBe(label)
      expect(link.getAttribute('title')).toBe(label)
    }
  })

  it('keeps the native conversation mounted while product pages change', async () => {
    const renderConversation = vi.fn(() => <ConversationFixture />)
    render(
      <ProductShell
        renderConversation={renderConversation}
        control={controlFixture()}
        localControlAvailable
        sessions={sessionsFixture()}
        router={createMemoryRouter()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'conversation 0' }))
    fireEvent.click(screen.getByRole('link', { name: 'ClawDSH 设置' }))
    expect(await screen.findByRole('heading', { name: 'ClawDSH 总览' })).toBeTruthy()
    expect(screen.getByText('Channel Protocol')).toBeTruthy()
    expect(screen.getByText('OpenClaw Gateway Provider')).toBeTruthy()
    expect(screen.getByText('飞书')).toBeTruthy()
    expect(screen.getByText('Telegram')).toBeTruthy()

    fireEvent.click(screen.getByRole('link', { name: 'ClawDSH 活动' }))
    expect(screen.getByRole('heading', { name: 'ClawDSH 活动' })).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: '对话' }))
    expect(screen.getByRole('button', { name: 'conversation 1' })).toBeTruthy()
    expect(renderConversation).toHaveBeenCalledTimes(1)
  })

  it('renders unknown product paths without redirecting them', () => {
    render(
      <ProductShell
        renderConversation={() => <ConversationFixture />}
        control={controlFixture()}
        localControlAvailable
        sessions={sessionsFixture()}
        router={createMemoryRouter('/clawdsh/chat')}
      />,
    )

    expect(screen.getByRole('heading', { name: '页面不存在' })).toBeTruthy()
    expect(screen.getByText('/clawdsh/chat')).toBeTruthy()
  })

  it('offers a retry when the Host projection fails', async () => {
    const loadCapabilities = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(CAPABILITIES_FIXTURE)
    render(
      <ProductShell
        renderConversation={() => <ConversationFixture />}
        control={controlFixture({ loadCapabilities })}
        localControlAvailable
        sessions={sessionsFixture()}
        router={createMemoryRouter('/clawdsh/settings')}
      />,
    )

    expect((await screen.findByRole('alert')).textContent).toContain('offline')
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => { expect(screen.getByText('Channel Protocol')).toBeTruthy() })
    expect(loadCapabilities).toHaveBeenCalledTimes(2)
  })

  it('keeps remote conversation available while marking product control pages local-only', () => {
    const loadCapabilities = vi.fn(async () => CAPABILITIES_FIXTURE)
    const router = createMemoryRouter('/clawdsh/settings')
    render(
      <ProductShell
        renderConversation={() => <ConversationFixture />}
        control={controlFixture({ loadCapabilities })}
        localControlAvailable={false}
        sessions={sessionsFixture()}
        router={router}
      />,
    )

    expect(screen.getByRole('status').textContent).toContain('ClawDSH 设置仅本机可用')
    expect(loadCapabilities).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('link', { name: 'ClawDSH 活动' }))
    expect(screen.getByRole('status').textContent).toContain('ClawDSH 活动仅本机可用')
    fireEvent.click(screen.getByRole('link', { name: '对话' }))
    expect(screen.getByRole('button', { name: 'conversation 0' })).toBeTruthy()
  })

  it('follows the current Session from the public Client sessions snapshot', async () => {
    const selected = mutableSessionsFixture()
    const listActivity = vi.fn<ClawdshControlClient['listActivity']>(async () => ACTIVITY_FIXTURE)
    render(
      <ProductShell
        renderConversation={() => <ConversationFixture />}
        control={controlFixture({ listActivity })}
        localControlAvailable
        sessions={selected.sessions}
        router={createMemoryRouter('/clawdsh/activity')}
      />,
    )

    expect(screen.getByRole('status').textContent).toContain('请先选择一个对话')
    expect(listActivity).not.toHaveBeenCalled()
    act(() => { selected.select('session-one') })
    await waitFor(() => { expect(listActivity).toHaveBeenCalledTimes(1) })
    expect(listActivity.mock.calls[0]?.[0]).toMatchObject({ sessionId: 'session-one' })
    act(() => { selected.select('session-two') })
    await waitFor(() => { expect(listActivity).toHaveBeenCalledTimes(2) })
    expect(listActivity.mock.calls[1]?.[0]).toMatchObject({ sessionId: 'session-two' })
  })
})
