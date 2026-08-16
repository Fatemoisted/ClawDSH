import { describe, expect, it, vi } from 'vitest'
import type { ClawdshControlClient } from '../src/control-client.ts'
import { ClawdshSettingsStore } from '../src/settings-store.ts'
import {
  ACTIVITY_FIXTURE,
  CAPABILITIES_FIXTURE,
  CREDENTIALS_FIXTURE,
  SETTINGS_FIXTURE,
} from './fixtures.ts'

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

describe('ClawDSH settings memory store', () => {
  it('loads once and retains namespace drafts and disclosure state without a component owner', async () => {
    const loadSettings = vi.fn(async () => SETTINGS_FIXTURE)
    const store = new ClawdshSettingsStore(controlFixture({ loadSettings }), true)
    await store.ensureLoaded()
    await store.ensureLoaded()

    const current = store.getSnapshot().namespaces[0]!
    store.setNamespaceDraft(current.descriptor.namespace, { enabled: false })
    store.setExpanded('feature:memory', false)

    expect(loadSettings).toHaveBeenCalledOnce()
    expect(store.getSnapshot().namespaces[0]?.draft).toEqual({ enabled: false })
    expect(store.getSnapshot().dirtyCount).toBe(1)
    expect(store.getSnapshot().expanded.has('feature:memory')).toBe(false)
    store.dispose()
  })

  it('keeps unload protection outside React and removes it after a successful save', async () => {
    const descriptor = SETTINGS_FIXTURE.namespaces[0]!
    const mutateSetting = vi.fn(async () => ({
      version: 1 as const,
      namespace: { ...descriptor, value: { enabled: false }, desiredRevision: 1 },
    }))
    const store = new ClawdshSettingsStore(controlFixture({ mutateSetting }), true)
    await store.ensureLoaded()
    store.setNamespaceDraft(descriptor.namespace, { enabled: false })

    const dirtyUnload = new Event('beforeunload', { cancelable: true })
    expect(window.dispatchEvent(dirtyUnload)).toBe(false)
    await store.saveNamespace(descriptor.namespace)
    expect(store.getSnapshot().dirtyCount).toBe(0)
    const cleanUnload = new Event('beforeunload', { cancelable: true })
    expect(window.dispatchEvent(cleanUnload)).toBe(true)
    store.dispose()
  })

  it('clears private credential drafts on failure without exposing the remote message', async () => {
    const setCredential = vi.fn(async () => {
      throw new Error('upstream echoed secret-canary')
    })
    const store = new ClawdshSettingsStore(controlFixture({ setCredential }), true)
    await store.ensureLoaded()
    store.setCredentialSecret('ark-api-key', 'secret-canary')
    await store.saveCredential('ark-api-key')

    expect(store.credentialSecret('ark-api-key')).toBe('')
    expect(store.getSnapshot().dirtyCount).toBe(0)
    expect(store.getSnapshot().credentials[0]?.error).toBe('凭据保存失败，请重试。')
    expect(store.getSnapshot().credentials[0]?.error).not.toContain('secret-canary')
    store.dispose()
  })

  it('keeps a dirty draft after a malformed save response and sanitizes the failure', async () => {
    const descriptor = SETTINGS_FIXTURE.namespaces[0]!
    const mutateSetting = vi.fn(async () => ({
      version: 1 as const,
      namespace: { ...descriptor, namespace: 'clawdsh-soul' },
    }))
    const store = new ClawdshSettingsStore(controlFixture({ mutateSetting }), true)
    await store.ensureLoaded()
    store.setNamespaceDraft(descriptor.namespace, { enabled: false })

    await store.saveNamespace(descriptor.namespace)

    expect(store.getSnapshot().namespaces[0]).toMatchObject({
      draft: { enabled: false },
      save: { status: 'failed', message: '设置保存失败，请重试。' },
    })
    expect(store.getSnapshot().dirtyCount).toBe(1)
    store.dispose()
  })

  it('clears a credential draft when a malformed success response names another id', async () => {
    const setCredential = vi.fn(async () => ({
      version: 1 as const,
      credential: { ...CREDENTIALS_FIXTURE.credentials[0]!, id: 'other-key' },
    }))
    const store = new ClawdshSettingsStore(controlFixture({ setCredential }), true)
    await store.ensureLoaded()
    store.setCredentialSecret('ark-api-key', 'mismatch-secret-canary')

    await store.saveCredential('ark-api-key')

    expect(store.credentialSecret('ark-api-key')).toBe('')
    expect(store.getSnapshot().credentials[0]?.error).toBe('凭据保存失败，请重试。')
    expect(JSON.stringify(store.getSnapshot())).not.toContain('mismatch-secret-canary')
    store.dispose()
  })

  it('clears secrets and dirty navigation protection on plugin disposal', async () => {
    const store = new ClawdshSettingsStore(controlFixture(), true)
    await store.ensureLoaded()
    store.setCredentialSecret('ark-api-key', 'dispose-canary')
    expect(store.getSnapshot().dirtyCount).toBe(1)
    store.dispose()

    expect(store.credentialSecret('ark-api-key')).toBe('')
    const unload = new Event('beforeunload', { cancelable: true })
    expect(window.dispatchEvent(unload)).toBe(true)
  })

  it('does not call loopback control from a remote browser', async () => {
    const loadSettings = vi.fn(async () => SETTINGS_FIXTURE)
    const store = new ClawdshSettingsStore(controlFixture({ loadSettings }), false)
    await store.ensureLoaded()
    expect(store.getSnapshot().status).toBe('remote')
    expect(loadSettings).not.toHaveBeenCalled()
    store.dispose()
  })

  it('keeps successful editors available when one presentation input is malformed', async () => {
    const store = new ClawdshSettingsStore(controlFixture({
      loadCapabilities: async () => { throw new TypeError('malformed capability response') },
    }), true)

    await store.ensureLoaded()

    expect(store.getSnapshot()).toMatchObject({
      status: 'ready',
      message: '部分状态暂时不可用；已读取的功能配置仍可使用。',
      capabilities: { capabilities: [], loaderInventory: [] },
    })
    expect(store.getSnapshot().namespaces).toHaveLength(SETTINGS_FIXTURE.namespaces.length)
    expect(store.getSnapshot().credentials).toHaveLength(CREDENTIALS_FIXTURE.credentials.length)
    store.dispose()
  })

  it('retries only unavailable presentation inputs without replacing a successful draft', async () => {
    const loadCapabilities = vi.fn()
      .mockRejectedValueOnce(new TypeError('malformed capability response'))
      .mockResolvedValueOnce(CAPABILITIES_FIXTURE)
    const loadSettings = vi.fn(async () => SETTINGS_FIXTURE)
    const store = new ClawdshSettingsStore(controlFixture({ loadCapabilities, loadSettings }), true)
    await store.ensureLoaded()
    const descriptor = store.getSnapshot().namespaces[0]!.descriptor
    store.setNamespaceDraft(descriptor.namespace, { enabled: false })

    await store.retryUnavailable()

    expect(loadCapabilities).toHaveBeenCalledTimes(2)
    expect(loadSettings).toHaveBeenCalledOnce()
    expect(store.getSnapshot().message).toBeUndefined()
    expect(store.getSnapshot().namespaces[0]?.draft).toEqual({ enabled: false })
    expect(store.getSnapshot().dirtyCount).toBe(1)
    store.dispose()
  })

  it('marks feature status stale when Soul saves but its capabilities refresh fails', async () => {
    const base = SETTINGS_FIXTURE.namespaces[0]!
    const soul = {
      ...base,
      namespace: 'clawdsh-soul' as const,
      capabilityId: 'soul' as const,
      label: 'Soul',
    }
    const refreshedCapabilities = { ...CAPABILITIES_FIXTURE, readOnly: true }
    const loadCapabilities = vi.fn()
      .mockResolvedValueOnce(CAPABILITIES_FIXTURE)
      .mockRejectedValueOnce(new Error('capability refresh unavailable'))
      .mockResolvedValueOnce(refreshedCapabilities)
    const mutateSetting = vi.fn(async () => ({
      version: 1 as const,
      namespace: { ...soul, value: { enabled: false }, desiredRevision: 1 },
    }))
    const store = new ClawdshSettingsStore(controlFixture({
      loadCapabilities,
      loadSettings: async () => ({ version: 1 as const, namespaces: [soul] }),
      mutateSetting,
    }), true)
    await store.ensureLoaded()
    store.setNamespaceDraft('clawdsh-soul', { enabled: false })

    await store.saveNamespace('clawdsh-soul')

    expect(store.getSnapshot().dirtyCount).toBe(0)
    expect(store.getSnapshot().message).toContain('设置已保存')
    expect(store.getSnapshot().message).toContain('保存前的结果')
    expect(store.getSnapshot().capabilities).toBe(CAPABILITIES_FIXTURE)

    await store.retryUnavailable()

    expect(loadCapabilities).toHaveBeenCalledTimes(3)
    expect(store.getSnapshot().message).toBeUndefined()
    expect(store.getSnapshot().capabilities).toBe(refreshedCapabilities)
    store.dispose()
  })
})
