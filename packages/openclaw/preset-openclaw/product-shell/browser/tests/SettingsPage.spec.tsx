import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ClawdshControlError,
  type ClawdshControlClient,
} from '../src/control-client.ts'
import { SettingsPage } from '../src/pages/SettingsPage.tsx'
import {
  CAPABILITIES_FIXTURE,
  CREDENTIALS_FIXTURE,
  ACTIVITY_FIXTURE,
  SETTINGS_FIXTURE,
} from './fixtures.ts'

afterEach(cleanup)

function controlFixture(overrides: Partial<ClawdshControlClient> = {}): ClawdshControlClient {
  const namespace = SETTINGS_FIXTURE.namespaces[0]!
  const credential = CREDENTIALS_FIXTURE.credentials[0]!
  return {
    loadCapabilities: async () => CAPABILITIES_FIXTURE,
    loadSettings: async () => SETTINGS_FIXTURE,
    loadCredentials: async () => CREDENTIALS_FIXTURE,
    mutateSetting: async () => ({ version: 1, namespace }),
    resetSettings: async () => ({ version: 1, namespace }),
    setCredential: async () => ({ version: 1, credential }),
    unsetCredential: async () => ({ version: 1, credential }),
    listActivity: async () => ACTIVITY_FIXTURE,
    ...overrides,
  }
}

describe('ClawDSH settings page', () => {
  it('keeps drafts independent across capability namespaces', async () => {
    const memory = SETTINGS_FIXTURE.namespaces[0]!
    const skills = {
      ...memory,
      namespace: 'clawdsh-skills-hub',
      capabilityId: 'skills',
      label: 'Skills Hub',
      fields: [{ path: ['enabled'], label: '启用 Skills Hub', access: 'editable' as const }],
    }
    const loadSettings = vi.fn(async () => ({ version: 1 as const, namespaces: [memory, skills] }))
    render(<SettingsPage control={controlFixture({ loadSettings })} localControlAvailable />)

    const memoryToggle = await screen.findByRole('checkbox', { name: '启用 Memory' }) as HTMLInputElement
    const skillsToggle = screen.getByRole('checkbox', { name: '启用 Skills Hub' }) as HTMLInputElement
    fireEvent.click(memoryToggle)

    expect(memoryToggle.checked).toBe(false)
    expect(skillsToggle.checked).toBe(true)
  })

  it('saves one namespace draft with its current revision', async () => {
    const descriptor = SETTINGS_FIXTURE.namespaces[0]!
    const loadCapabilities = vi.fn(async () => CAPABILITIES_FIXTURE)
    const mutateSetting = vi.fn(async () => ({
      version: 1 as const,
      namespace: {
        ...descriptor,
        value: { enabled: false },
        user: { enabled: false },
        desiredRevision: 1,
        restartRequired: true,
      },
    }))
    render(<SettingsPage control={controlFixture({ loadCapabilities, mutateSetting })} localControlAvailable />)

    const checkbox = await screen.findByRole('checkbox', { name: '启用 Memory' })
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => { expect(mutateSetting).toHaveBeenCalledOnce() })
    expect(mutateSetting).toHaveBeenCalledWith({
      version: 1,
      namespace: 'clawdsh-memory',
      expectedRevision: 0,
      operations: [{ op: 'set', path: ['enabled'], value: false }],
    })
    expect(await screen.findByText('期望版本：1')).toBeTruthy()
    expect(screen.getByText('需要重启')).toBeTruthy()
    await waitFor(() => { expect(loadCapabilities).toHaveBeenCalledTimes(2) })
  })

  it('commits every changed field in one atomic namespace mutation', async () => {
    const descriptor = {
      ...SETTINGS_FIXTURE.namespaces[0]!,
      schema: {
        uid: 3,
        refs: {
          1: { type: 'boolean', meta: { default: true } },
          2: { type: 'boolean', meta: { default: false } },
          3: { type: 'object', meta: { default: {} }, dict: { enabled: 1, watch: 2 } },
        },
      },
      value: { enabled: true, watch: false },
      base: { enabled: true, watch: false },
      fields: [
        { path: ['enabled'], label: '启用 Memory', access: 'editable' as const },
        { path: ['watch'], label: '监听 Memory 文件', access: 'editable' as const },
      ],
    }
    const loadSettings = vi.fn(async () => ({ version: 1 as const, namespaces: [descriptor] }))
    const mutateSetting = vi.fn(async () => ({ version: 1 as const, namespace: descriptor }))
    render(<SettingsPage control={controlFixture({ loadSettings, mutateSetting })} localControlAvailable />)

    fireEvent.click(await screen.findByRole('checkbox', { name: '启用 Memory' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '监听 Memory 文件' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => { expect(mutateSetting).toHaveBeenCalledOnce() })
    expect(mutateSetting).toHaveBeenCalledWith({
      version: 1,
      namespace: 'clawdsh-memory',
      expectedRevision: 0,
      operations: [
        { op: 'set', path: ['enabled'], value: false },
        { op: 'set', path: ['watch'], value: true },
      ],
    })
  })

  it('keeps a stale draft locked until the user explicitly reloads it', async () => {
    const descriptor = SETTINGS_FIXTURE.namespaces[0]!
    const refreshed = {
      version: 1 as const,
      namespaces: [{ ...descriptor, value: { enabled: true }, desiredRevision: 2 }],
    }
    const loadSettings = vi.fn()
      .mockResolvedValueOnce(SETTINGS_FIXTURE)
      .mockResolvedValueOnce(refreshed)
    const mutateSetting = vi.fn(async () => {
      throw new ClawdshControlError('settings-conflict', 'stale')
    })
    render(<SettingsPage control={controlFixture({ loadSettings, mutateSetting })} localControlAvailable />)

    const checkbox = await screen.findByRole('checkbox', { name: '启用 Memory' })
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText(/当前草稿未丢失/)).toBeTruthy()
    expect((checkbox as HTMLInputElement).checked).toBe(false)
    expect(screen.getByRole('button', { name: '保存' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    await waitFor(() => { expect(loadSettings).toHaveBeenCalledTimes(2) })
    expect((screen.getByRole('checkbox', { name: '启用 Memory' }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText('期望版本：2')).toBeTruthy()
  })

  it('resets only through the namespace reset operation', async () => {
    const descriptor = {
      ...SETTINGS_FIXTURE.namespaces[0]!,
      value: { enabled: false },
      user: { enabled: false },
      desiredRevision: 3,
      restartRequired: true,
    }
    const resetSettings = vi.fn(async () => ({
      version: 1 as const,
      namespace: {
        ...descriptor,
        value: { enabled: true },
        user: undefined,
        desiredRevision: 4,
        restartRequired: false,
      },
    }))
    const loadSettings = vi.fn(async () => ({ version: 1 as const, namespaces: [descriptor] }))
    render(<SettingsPage control={controlFixture({ loadSettings, resetSettings })} localControlAvailable />)

    await screen.findByRole('checkbox', { name: '启用 Memory' })
    fireEvent.click(screen.getByRole('button', { name: '重置用户设置' }))

    await waitFor(() => { expect(resetSettings).toHaveBeenCalledWith({
      version: 1,
      namespace: 'clawdsh-memory',
      expectedRevision: 3,
    }) })
    expect((screen.getByRole('checkbox', { name: '启用 Memory' }) as HTMLInputElement).checked).toBe(true)
  })

  it('clears a secret input after the credential request settles', async () => {
    let resolve!: (value: Awaited<ReturnType<ClawdshControlClient['setCredential']>>) => void
    const setCredential = vi.fn(() => new Promise<Awaited<ReturnType<ClawdshControlClient['setCredential']>>>((done) => {
      resolve = done
    }))
    render(<SettingsPage control={controlFixture({ setCredential })} localControlAvailable />)

    const input = await screen.findByLabelText(/新凭据/) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'secret-dom-canary' } })
    fireEvent.click(screen.getByRole('button', { name: '保存凭据' }))
    expect(input.value).toBe('secret-dom-canary')
    resolve({
      version: 1,
      credential: { ...CREDENTIALS_FIXTURE.credentials[0]!, configured: true, source: 'file' },
    })

    await waitFor(() => { expect(input.value).toBe('') })
    expect(document.body.textContent).not.toContain('secret-dom-canary')
  })

  it('clears a secret input after a rejected credential request', async () => {
    const setCredential = vi.fn(async () => {
      throw new ClawdshControlError('credential-rejected', 'credential rejected')
    })
    render(<SettingsPage control={controlFixture({ setCredential })} localControlAvailable />)

    const input = await screen.findByLabelText(/新凭据/) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'rejected-secret-canary' } })
    fireEvent.click(screen.getByRole('button', { name: '保存凭据' }))

    expect(await screen.findByText('credential rejected')).toBeTruthy()
    expect(input.value).toBe('')
    expect(document.body.textContent).not.toContain('rejected-secret-canary')
  })

  it('does not call the local control client from a remote page', () => {
    const loadSettings = vi.fn()
    render(<SettingsPage control={controlFixture({ loadSettings })} localControlAvailable={false} />)
    expect(screen.getByRole('status').textContent).toContain('仅本机可用')
    expect(loadSettings).not.toHaveBeenCalled()
  })
})
