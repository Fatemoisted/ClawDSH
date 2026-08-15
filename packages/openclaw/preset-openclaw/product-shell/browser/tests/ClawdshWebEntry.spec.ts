import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClawdshWebEntry } from '../src/ClawdshWebEntry.tsx'

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
})
