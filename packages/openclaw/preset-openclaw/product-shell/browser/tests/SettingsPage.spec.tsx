import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ClawdshControlError,
  type ClawdshControlClient,
} from '../src/control-client.ts'
import { SettingsPage } from '../src/pages/SettingsPage.tsx'
import { ClawdshSettingsStore } from '../src/settings-store.ts'
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
    fireEvent.click(screen.getByRole('button', { name: '展开 Skills Hub' }))
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
    expect(screen.getByText('重启后应用修改')).toBeTruthy()
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

    expect(await screen.findByText('凭据保存失败，请重试。')).toBeTruthy()
    expect(input.value).toBe('')
    expect(document.body.textContent).not.toContain('rejected-secret-canary')
    expect(document.body.textContent).not.toContain('credential rejected')
  })

  it('does not call the local control client from a remote page', () => {
    const loadSettings = vi.fn()
    render(<SettingsPage control={controlFixture({ loadSettings })} localControlAvailable={false} />)
    expect(screen.getByRole('status').textContent).toContain('仅本机可用')
    expect(loadSettings).not.toHaveBeenCalled()
  })

  it('warns before unloading a dirty draft and removes the warning after save', async () => {
    render(<SettingsPage control={controlFixture()} localControlAvailable />)

    fireEvent.click(await screen.findByRole('checkbox', { name: '启用 Memory' }))
    const dirtyUnload = new Event('beforeunload', { cancelable: true })
    expect(window.dispatchEvent(dirtyUnload)).toBe(false)
    expect(dirtyUnload.defaultPrevented).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(screen.queryByText(/修改尚未保存/)).toBeNull() })
    const cleanUnload = new Event('beforeunload', { cancelable: true })
    expect(window.dispatchEvent(cleanUnload)).toBe(true)
    expect(cleanUnload.defaultPrevented).toBe(false)
  })

  it('retains a draft and unload warning after the native settings section unmounts', async () => {
    const store = new ClawdshSettingsStore(controlFixture(), true)
    const first = render(<SettingsPage store={store} />)
    const checkbox = await screen.findByRole('checkbox', { name: '启用 Memory' }) as HTMLInputElement
    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(false)
    first.unmount()

    const dirtyUnload = new Event('beforeunload', { cancelable: true })
    expect(window.dispatchEvent(dirtyUnload)).toBe(false)
    render(<SettingsPage store={store} />)
    expect((await screen.findByRole('checkbox', { name: '启用 Memory' }) as HTMLInputElement).checked).toBe(false)

    store.clearNamespaceDraft('clawdsh-memory')
    store.dispose()
  })

  it('returns an initially absent text field to a clean draft when cleared', async () => {
    const descriptor = {
      ...SETTINGS_FIXTURE.namespaces[0]!,
      schema: {
        uid: 2,
        refs: {
          1: { type: 'string', meta: {} },
          2: { type: 'object', meta: { default: {} }, dict: { inline: 1 } },
        },
      },
      value: {},
      base: {},
      fields: [{ path: ['inline'], label: '内联 Soul', access: 'editable' as const }],
    }
    const loadSettings = vi.fn(async () => ({ version: 1 as const, namespaces: [descriptor] }))
    render(<SettingsPage control={controlFixture({ loadSettings })} localControlAvailable />)

    const input = await screen.findByRole('textbox', { name: '内联 Soul' })
    fireEvent.change(input, { target: { value: 'draft' } })
    expect(screen.getByText(/修改尚未保存/)).toBeTruthy()
    fireEvent.change(input, { target: { value: '' } })
    await waitFor(() => { expect(screen.queryByText(/修改尚未保存/)).toBeNull() })
  })

  it('saves an empty string when clearing a non-empty profile text value', async () => {
    const descriptor = {
      ...SETTINGS_FIXTURE.namespaces[0]!,
      namespace: 'clawdsh-soul',
      capabilityId: 'soul',
      schema: {
        uid: 2,
        refs: {
          1: { type: 'string', meta: {} },
          2: { type: 'object', meta: { default: {} }, dict: { source: 1 } },
        },
      },
      value: { source: '/managed/SOUL.md' },
      base: { source: '/managed/SOUL.md' },
      fields: [{ path: ['source'], label: 'Soul 文件', access: 'editable' as const }],
    }
    const loadSettings = vi.fn(async () => ({ version: 1 as const, namespaces: [descriptor] }))
    const mutateSetting = vi.fn(async () => ({ version: 1 as const, namespace: descriptor }))
    render(<SettingsPage control={controlFixture({ loadSettings, mutateSetting })} localControlAvailable />)

    fireEvent.click(await screen.findByRole('button', { name: '展开 Soul' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Soul 文件' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => { expect(mutateSetting).toHaveBeenCalledOnce() })
    expect(mutateSetting).toHaveBeenCalledWith(expect.objectContaining({
      operations: [{ op: 'set', path: ['source'], value: '' }],
    }))
  })

  it('shows an unavailable editor instead of crashing on a malformed schema', async () => {
    const descriptor = {
      ...SETTINGS_FIXTURE.namespaces[0]!,
      schema: { invalid: true },
    }
    const loadSettings = vi.fn(async () => ({ version: 1 as const, namespaces: [descriptor] }))
    render(<SettingsPage control={controlFixture({ loadSettings })} localControlAvailable />)

    expect((await screen.findByRole('alert')).textContent).toContain('设置结构不可用。')
    expect(screen.queryByRole('checkbox', { name: '启用 Memory' })).toBeNull()
  })

  it('does not activate a specialized editor for a managed field', async () => {
    const descriptor = {
      ...SETTINGS_FIXTURE.namespaces[0]!,
      namespace: 'clawdsh-automation',
      capabilityId: 'automation',
      editor: 'automation-rules' as const,
      schema: {
        uid: 3,
        refs: {
          1: { type: 'any', meta: {} },
          2: { type: 'array', meta: { default: [] }, inner: 1 },
          3: { type: 'object', meta: { default: {} }, dict: { rules: 2 } },
        },
      },
      value: { rules: [] },
      base: { rules: [] },
      fields: [{ path: ['rules'], label: '自动任务规则', access: 'managed' as const }],
    }
    const loadSettings = vi.fn(async () => ({ version: 1 as const, namespaces: [descriptor] }))
    render(<SettingsPage control={controlFixture({ loadSettings })} localControlAvailable />)

    fireEvent.click(await screen.findByRole('button', { name: '展开 自动任务（Automation）' }))
    expect(screen.getByText('安装器管理')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '添加自动任务' })).toBeNull()
  })

  it('treats an explicit empty text value and an unset draft as the same clean value', async () => {
    const descriptor = {
      ...SETTINGS_FIXTURE.namespaces[0]!,
      schema: {
        uid: 2,
        refs: {
          1: { type: 'string', meta: {} },
          2: { type: 'object', meta: { default: {} }, dict: { inline: 1 } },
        },
      },
      value: { inline: '' },
      base: { inline: '' },
      fields: [{ path: ['inline'], label: '内联 Soul', access: 'editable' as const }],
    }
    const loadSettings = vi.fn(async () => ({ version: 1 as const, namespaces: [descriptor] }))
    render(<SettingsPage control={controlFixture({ loadSettings })} localControlAvailable />)

    const input = await screen.findByRole('textbox', { name: '内联 Soul' })
    fireEvent.change(input, { target: { value: 'draft' } })
    expect(screen.getByText(/修改尚未保存/)).toBeTruthy()
    fireEvent.change(input, { target: { value: '' } })
    await waitFor(() => { expect(screen.queryByText(/修改尚未保存/)).toBeNull() })
  })

  it('collapses advanced diagnostics and filters a paged Loader inventory', async () => {
    const seed = CAPABILITIES_FIXTURE.loaderInventory[0]!
    const loaderInventory = Array.from({ length: 31 }, (_, index) => ({
      ...seed,
      entryId: `entry-${index}`,
      moduleName: `module-${index}`,
    }))
    const loadCapabilities = vi.fn(async () => ({ ...CAPABILITIES_FIXTURE, loaderInventory }))
    render(<SettingsPage control={controlFixture({ loadCapabilities })} localControlAvailable />)

    const heading = await screen.findByRole('heading', { name: '系统与实现详情' })
    const section = heading.closest('section')
    expect(section).not.toBeNull()
    const loader = within(section!)
    expect(loader.getByRole('button', { name: '展开' }).getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(loader.getByRole('button', { name: '展开' }))
    expect(loader.getByRole('heading', { name: 'Loader 清单' })).toBeTruthy()
    expect(loader.getAllByRole('row')).toHaveLength(26)
    expect(loader.getByRole('button', { name: /显示更多/ })).toBeTruthy()

    fireEvent.change(loader.getByLabelText('筛选 Loader'), { target: { value: 'module-29' } })
    expect(loader.getByText('module-29')).toBeTruthy()
    expect(loader.queryByText('module-1')).toBeNull()
    expect(loader.getAllByRole('row')).toHaveLength(2)
  })
})
