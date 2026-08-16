import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { createNativeAppPlugin } from '../src/native-app-plugin.tsx'

afterEach(cleanup)

describe('ClawDSH native application adapter', () => {
  it('replaces the new-session preset picker with fixed product identity', () => {
    const register = vi.fn((_options: unknown, _component: unknown) => vi.fn())
    const provide = vi.fn((_name: string, _service: unknown) => undefined)
    const buildRenderApp = vi.fn(() => () => <div>native root</div>)
    const overrideTokens = vi.fn(() => vi.fn())
    const ctx = {
      get: vi.fn((service: string) => service === 'connection'
        ? { isLoopback: true, rpc: { call: vi.fn() } }
        : undefined),
      effect: vi.fn((setup: () => unknown) => setup()),
      theme: { overrideTokens },
      slots: {
        install: vi.fn(),
        inject: vi.fn((_key: string, setup: () => unknown) => setup()),
        entries: vi.fn(() => [
          { options: { key: 'context' }, component: () => null },
          { options: { key: 'user' }, component: () => null },
        ]),
        subscribe: vi.fn(() => vi.fn()),
        register,
      },
      reflect: { provide },
    }
    const plugin = createNativeAppPlugin(buildRenderApp as never)

    plugin.apply(ctx as never)

    expect(overrideTokens).toHaveBeenCalledWith('@clawdsh/dsh-product-browser', {
      '--dsw-alias-brand-primary': { light: '#1473E6', dark: '#F4FAFF' },
      '--dsw-alias-state-business-primary': { light: '#1473E6', dark: '#F4FAFF' },
    })
    expect(register).toHaveBeenCalledTimes(5)
    const registrations = register.mock.calls.map(call => call[0])
    expect(registrations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'sidebar.footer.action',
        id: 'clawdsh-harness-advanced',
        order: 100,
      }),
      expect.objectContaining({
        name: 'settings.section',
        id: 'clawdsh',
        order: -100,
        label: 'ClawDSH',
      }),
      expect.objectContaining({
        name: 'conversation.view',
        id: 'clawdsh-records',
        order: 20,
        label: 'ClawDSH 记录',
      }),
      expect.objectContaining({
        name: 'conversation.chat.node',
        key: 'context',
        priority: -1,
      }),
    ]))
    const identityCall = register.mock.calls.find(call => (
      call[0] as { name?: string }
    ).name === 'conversation.hero.agentPreset')
    expect(identityCall?.[0]).toEqual({
      name: 'conversation.hero.agentPreset',
      priority: -1,
    })
    const Identity = identityCall?.[1] as () => ReactNode
    render(<Identity />)
    expect(screen.getByText('ClawDSH 模式')).toBeTruthy()
  })

  it('builds the native root once through the public Web renderer', () => {
    const provide = vi.fn((_name: string, _service: unknown) => undefined)
    const buildRenderApp = vi.fn(() => () => <div>native root</div>)
    const ctx = {
      get: vi.fn((service: string) => service === 'connection'
        ? { isLoopback: true, rpc: { call: vi.fn() } }
        : undefined),
      effect: vi.fn((setup: () => unknown) => setup()),
      theme: { overrideTokens: vi.fn(() => vi.fn()) },
      slots: {
        install: vi.fn(),
        inject: vi.fn((_key: string, setup: () => unknown) => setup()),
        entries: vi.fn(() => [
          { options: { key: 'context' }, component: () => null },
          { options: { key: 'user' }, component: () => null },
        ]),
        subscribe: vi.fn(() => vi.fn()),
        register: vi.fn((_options: unknown, _component: unknown) => vi.fn()),
      },
      reflect: { provide },
    }
    createNativeAppPlugin(buildRenderApp as never).apply(ctx as never)
    const service = provide.mock.calls[0]?.[1] as { renderApp: () => ReactNode }

    render(<>{service.renderApp()}{service.renderApp()}</>)

    expect(buildRenderApp).toHaveBeenCalledOnce()
    expect(screen.getAllByText('native root')).toHaveLength(2)
  })

  it('waits for the standard Chat renderers when Loader activation declares the slot first', () => {
    const entries: Array<{ options: { key: string }; component: () => null }> = []
    let notify = (): void => {}
    const register = vi.fn((_options: unknown, _component: unknown) => vi.fn())
    const ctx = {
      get: vi.fn((service: string) => service === 'connection'
        ? { isLoopback: true, rpc: { call: vi.fn() } }
        : undefined),
      effect: vi.fn((setup: () => unknown) => setup()),
      theme: { overrideTokens: vi.fn(() => vi.fn()) },
      slots: {
        install: vi.fn(),
        inject: vi.fn((_key: string, setup: () => unknown) => setup()),
        entries: vi.fn(() => entries),
        subscribe: vi.fn((_key: string, callback: () => void) => {
          notify = callback
          return vi.fn()
        }),
        register,
      },
      reflect: { provide: vi.fn() },
    }

    createNativeAppPlugin(vi.fn(() => () => null) as never).apply(ctx as never)
    expect(register.mock.calls.some(call => (
      call[0] as { name?: string }
    ).name === 'conversation.chat.node')).toBe(false)

    entries.push(
      { options: { key: 'context' }, component: () => null },
      { options: { key: 'user' }, component: () => null },
    )
    notify()

    expect(register.mock.calls.some(call => (
      call[0] as { name?: string; key?: string; priority?: number }
    ).name === 'conversation.chat.node'
      && (call[0] as { key?: string }).key === 'context'
      && (call[0] as { priority?: number }).priority === -1)).toBe(true)
  })
})
