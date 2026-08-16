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
    const ctx = {
      get: vi.fn((service: string) => service === 'connection'
        ? { isLoopback: true, rpc: { call: vi.fn() } }
        : undefined),
      effect: vi.fn((setup: () => unknown) => setup()),
      slots: {
        install: vi.fn(),
        inject: vi.fn((_key: string, setup: () => unknown) => setup()),
        register,
      },
      reflect: { provide },
    }
    const plugin = createNativeAppPlugin(buildRenderApp as never)

    plugin.apply(ctx as never)

    expect(register).toHaveBeenCalledTimes(4)
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
      slots: {
        install: vi.fn(),
        inject: vi.fn((_key: string, setup: () => unknown) => setup()),
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
})
