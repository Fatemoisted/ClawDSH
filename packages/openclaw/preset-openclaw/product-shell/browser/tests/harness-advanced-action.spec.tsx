import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HarnessAdvancedAction,
  registerHarnessAdvancedAction,
} from '../src/harness-advanced-action.tsx'

afterEach(cleanup)

describe('Harness Advanced sidebar action', () => {
  it('renders an ordinary document link with a visible label in the wide sidebar', () => {
    render(<HarnessAdvancedAction wide />)

    const link = screen.getByRole('link', { name: 'ClawDSH · Harness 高级' })
    expect(link.getAttribute('href')).toBe('/')
    expect(link.textContent).toContain('ClawDSH')
    expect(link.textContent).toContain('Powered by DeepSeek Harness')
    expect(link.querySelector('svg')).toBeTruthy()
    expect(link.querySelector('img')?.getAttribute('src')).toBe('/clawdsh/brand/clawdsh-mark.svg')
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('keeps an accessible icon link and Tooltip in the collapsed rail', () => {
    render(<HarnessAdvancedAction wide={false} />)

    const link = screen.getByRole('link', { name: 'ClawDSH · Harness 高级' })
    expect(link.getAttribute('href')).toBe('/')
    expect(link.textContent).toBe('')
    expect(link.querySelector('img')).toBeTruthy()
    fireEvent.focus(link)
    expect(screen.getByRole('tooltip').textContent).toBe('ClawDSH · Powered by DeepSeek Harness')
  })

  it('registers through the public sidebar footer Slot', () => {
    const register = vi.fn((_options: unknown, _component: unknown) => vi.fn())
    const inject = vi.fn((_slot: string, setup: () => unknown) => setup())

    registerHarnessAdvancedAction({ slots: { inject, register } } as never)

    expect(inject).toHaveBeenCalledWith('sidebar.footer.action', expect.any(Function))
    expect(register).toHaveBeenCalledWith({
      name: 'sidebar.footer.action',
      id: 'clawdsh-harness-advanced',
      order: 100,
      label: 'ClawDSH · Harness 高级',
    }, HarnessAdvancedAction)
  })
})
