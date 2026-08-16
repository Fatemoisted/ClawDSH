import { render, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClawdshBootRoot } from '../src/ClawdshBootRoot.tsx'
import { ClawdshWebEntry } from '../src/ClawdshWebEntry.tsx'
import { CLAWDSH_BOOT_FAILURE_CODES } from '../src/fatal-boot.ts'

const PRIVATE_FAILURE_SENTINEL = `${'sk-'}${'B'.repeat(40)} ${['', 'Users', 'operator', 'private', 'settings.yaml'].join('/')}`

function signal<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(next: T) {
      value = next
      for (const listener of listeners) listener()
    },
  }
}

afterEach(() => {
  delete (globalThis as { __DSH_MODULES__?: unknown }).__DSH_MODULES__
  delete (globalThis as { __ModuleLoader__?: unknown }).__ModuleLoader__
})

describe('ClawDSH browser lifecycle', () => {
  it('disposes the Client context and releases module globals it owns', async () => {
    const entry = new ClawdshWebEntry(document.createElement('div'))
    const unmount = vi.fn()
    const dispose = vi.fn(async () => undefined)
    const modules = {}
    Object.assign(entry, { root: { unmount }, ctx: { fiber: { dispose } }, modules })
    Object.assign(globalThis, {
      __DSH_MODULES__: modules,
      __ModuleLoader__: { load: vi.fn() },
    })

    await entry.dispose()

    expect(unmount).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
    expect((globalThis as { __DSH_MODULES__?: unknown }).__DSH_MODULES__).toBeUndefined()
    expect((globalThis as { __ModuleLoader__?: unknown }).__ModuleLoader__).toBeUndefined()
  })

  it('keeps an ordinary plugin boot failure out of the DOM and console', async () => {
    const entry = new ClawdshWebEntry(document.createElement('div'))
    const error = signal<string | undefined>(undefined)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    Object.assign(entry, { error })
    const view = render(createElement(ClawdshBootRoot, {
      settled: signal(false),
      status: signal({}),
      error,
      renderProduct: () => null,
    }))

    ;(entry as unknown as { failPluginBoot(reason: unknown): void })
      .failPluginBoot(new Error(PRIVATE_FAILURE_SENTINEL))

    await waitFor(() => { expect(view.container.textContent).toContain(CLAWDSH_BOOT_FAILURE_CODES.plugin) })
    expect(view.container.textContent).not.toContain(PRIVATE_FAILURE_SENTINEL)
    expect(consoleError).toHaveBeenCalledExactlyOnceWith(CLAWDSH_BOOT_FAILURE_CODES.plugin)
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(PRIVATE_FAILURE_SENTINEL)
    view.unmount()
  })
})
