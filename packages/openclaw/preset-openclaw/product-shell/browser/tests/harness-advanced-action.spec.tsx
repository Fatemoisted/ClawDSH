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

    const link = screen.getByRole('link', { name: 'Harness 高级' })
    expect(link.getAttribute('href')).toBe('/')
    expect(link.textContent).toBe('Harness 高级')
    expect(link.querySelector('svg')).toBeTruthy()
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('keeps an accessible icon link and Tooltip in the collapsed rail', () => {
    render(<HarnessAdvancedAction wide={false} />)

    const link = screen.getByRole('link', { name: 'Harness 高级' })
    expect(link.getAttribute('href')).toBe('/')
    expect(link.textContent).toBe('')
    expect(link.querySelector('svg')).toBeTruthy()
    fireEvent.focus(link)
    expect(screen.getByRole('tooltip').textContent).toBe('Harness 高级')
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
      label: 'Harness 高级',
    }, HarnessAdvancedAction)
  })
})
