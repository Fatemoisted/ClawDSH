import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { ProductShell } from '../src/ProductShell.tsx'
import { createMemoryRouter } from '../src/router.ts'
import { CAPABILITIES_FIXTURE } from './fixtures.ts'

afterEach(cleanup)

function ConversationFixture() {
  const [count, setCount] = useState(0)
  return <button type="button" onClick={() => { setCount(value => value + 1) }}>conversation {count}</button>
}

describe('ClawDSH product shell', () => {
  it('exposes the fixed product navigation and a direct Harness document link', () => {
    render(
      <ProductShell
        renderConversation={() => <ConversationFixture />}
        loadCapabilities={async () => CAPABILITIES_FIXTURE}
        localControlAvailable
        router={createMemoryRouter()}
      />,
    )

    expect(screen.getByRole('link', { name: '对话' }).getAttribute('href')).toBe('/clawdsh/')
    expect(screen.getByRole('link', { name: 'ClawDSH 设置' }).getAttribute('href')).toBe('/clawdsh/settings')
    expect(screen.getByRole('link', { name: 'ClawDSH 活动' }).getAttribute('href')).toBe('/clawdsh/activity')
    expect(screen.getByRole('link', { name: 'Harness 高级' }).getAttribute('href')).toBe('/')
  })

  it('keeps the native conversation mounted while product pages change', async () => {
    const renderConversation = vi.fn(() => <ConversationFixture />)
    render(
      <ProductShell
        renderConversation={renderConversation}
        loadCapabilities={async () => CAPABILITIES_FIXTURE}
        localControlAvailable
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
        loadCapabilities={async () => CAPABILITIES_FIXTURE}
        localControlAvailable
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
        loadCapabilities={loadCapabilities}
        localControlAvailable
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
        loadCapabilities={loadCapabilities}
        localControlAvailable={false}
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
})
