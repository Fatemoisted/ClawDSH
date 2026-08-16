import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEffect, useState } from 'react'
import { ProductShell } from '../src/ProductShell.tsx'

afterEach(cleanup)

function NativeAppFixture() {
  const [count, setCount] = useState(0)
  return <button type="button" onClick={() => { setCount(value => value + 1) }}>native app {count}</button>
}

function NativeTitleFixture() {
  useEffect(() => { document.title = '已选会话 — ClawDSH' }, [])
  return <span>native title owner</span>
}

describe('ClawDSH product shell', () => {
  it('renders only the native application without a second product navigation', () => {
    render(<ProductShell renderApp={() => <NativeAppFixture />} pathname="/clawdsh/" />)

    expect(screen.getByRole('button', { name: 'native app 0' })).toBeTruthy()
    expect(document.querySelector('[data-native-app]')).toBeTruthy()
    expect(document.querySelector('aside')).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'ClawDSH 主导航' })).toBeNull()
  })

  it('materializes one native React tree and preserves its state across shell rerenders', () => {
    const renderApp = vi.fn(() => <NativeAppFixture />)
    const view = render(<ProductShell renderApp={renderApp} pathname="/clawdsh/" />)

    fireEvent.click(screen.getByRole('button', { name: 'native app 0' }))
    view.rerender(<ProductShell renderApp={renderApp} pathname="/clawdsh/" />)

    expect(screen.getByRole('button', { name: 'native app 1' })).toBeTruthy()
    expect(renderApp).toHaveBeenCalledOnce()
  })

  it('leaves the canonical document title to the native application', () => {
    render(<ProductShell renderApp={() => <NativeTitleFixture />} pathname="/clawdsh/" />)

    expect(document.title).toBe('已选会话 — ClawDSH')
  })

  it('renders unknown product paths as a product 404 without a silent redirect', () => {
    const navigateToRoot = vi.fn()
    render(
      <ProductShell
        renderApp={() => <NativeAppFixture />}
        pathname="/clawdsh/unknown"
        navigateToRoot={navigateToRoot}
      />,
    )

    expect(screen.getByRole('heading', { name: '页面不存在' })).toBeTruthy()
    expect(document.title).toBe('页面不存在 · ClawDSH')
    expect(screen.getByText('/clawdsh/unknown')).toBeTruthy()
    expect(navigateToRoot).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '返回对话' }))
    expect(navigateToRoot).toHaveBeenCalledOnce()
  })
})
