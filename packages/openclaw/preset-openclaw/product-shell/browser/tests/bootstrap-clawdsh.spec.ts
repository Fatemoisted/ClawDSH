import { describe, expect, it, vi } from 'vitest'
import { bootstrapClawdsh } from '../src/bootstrap-clawdsh.ts'
import { CLAWDSH_BOOT_FAILURE_CODES } from '../src/fatal-boot.ts'

const PRIVATE_FAILURE_SENTINEL = `${'sk-'}${'A'.repeat(40)} ${['', 'Users', 'operator', 'private', 'credentials.yaml'].join('/')}`

describe('ClawDSH browser bootstrap failures', () => {
  it('renders a branded failure when the entry chunk cannot load', async () => {
    const mount = document.createElement('div')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await bootstrapClawdsh(mount, async () => { throw new Error(PRIVATE_FAILURE_SENTINEL) })

    expect(mount.textContent).toContain('ClawDSH 启动失败')
    expect(mount.textContent).toContain(CLAWDSH_BOOT_FAILURE_CODES.bootstrap)
    expect(mount.textContent).not.toContain(PRIVATE_FAILURE_SENTINEL)
    expect(mount.firstElementChild?.getAttribute('role')).toBe('alert')
    expect(consoleError).toHaveBeenCalledExactlyOnceWith(CLAWDSH_BOOT_FAILURE_CODES.bootstrap)
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(PRIVATE_FAILURE_SENTINEL)
  })

  it('disposes partial state before rendering a manifest failure', async () => {
    const mount = document.createElement('div')
    const dispose = vi.fn(async () => { throw new Error(PRIVATE_FAILURE_SENTINEL) })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    class FailingEntry {
      async run(): Promise<void> { throw new Error(PRIVATE_FAILURE_SENTINEL) }
      async dispose(): Promise<void> { await dispose() }
    }

    await bootstrapClawdsh(mount, async () => ({ ClawdshWebEntry: FailingEntry }))

    expect(dispose).toHaveBeenCalledOnce()
    expect(mount.textContent).toContain(CLAWDSH_BOOT_FAILURE_CODES.bootstrap)
    expect(mount.textContent).not.toContain(PRIVATE_FAILURE_SENTINEL)
    expect(consoleError.mock.calls).toEqual([
      [CLAWDSH_BOOT_FAILURE_CODES.bootstrap],
      [CLAWDSH_BOOT_FAILURE_CODES.dispose],
    ])
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(PRIVATE_FAILURE_SENTINEL)
    expect(mount.firstElementChild?.getAttribute('data-clawdsh-fatal-boot')).toBe('true')
  })
})
