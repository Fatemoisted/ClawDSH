import {
  getPath,
  rehydrateSchema,
  validateDraft,
} from '@deepseek-ai/dsh-client-schema-form'
import type {
  ClawdshCapabilitiesResponse,
  ClawdshCredentialDescriptor,
  ClawdshSettingsMutation,
  ClawdshSettingsNamespaceDescriptor,
} from '../../shared/src/protocol.ts'
import {
  ClawdshControlError,
  type ClawdshControlClient,
} from './control-client.ts'

/** One namespace's plugin-lifetime edit state. */
export interface ClawdshNamespaceDraftState {
  readonly descriptor: ClawdshSettingsNamespaceDescriptor
  readonly draft: Record<string, unknown>
  readonly save:
    | { readonly status: 'idle' }
    | { readonly status: 'saving' | 'resetting' | 'reloading' }
    | { readonly status: 'failed' | 'conflict'; readonly message: string }
}

/** Secret-free credential edit state; the draft value stays in a private Map. */
export interface ClawdshCredentialDraftState {
  readonly descriptor: ClawdshCredentialDescriptor
  readonly busy: boolean
  readonly error?: string
}

/** Immutable snapshot consumed through useSyncExternalStore. */
export interface ClawdshSettingsStoreSnapshot {
  readonly status: 'idle' | 'loading' | 'ready' | 'failed' | 'remote'
  readonly message?: string
  readonly capabilities?: ClawdshCapabilitiesResponse
  readonly namespaces: readonly ClawdshNamespaceDraftState[]
  readonly credentials: readonly ClawdshCredentialDraftState[]
  readonly expanded: ReadonlySet<string>
  readonly dirtyCount: number
  readonly epoch: number
}

type Listener = () => void
type PresentationInput = 'capabilities' | 'settings' | 'credentials'

const UNKNOWN_CAPABILITIES: ClawdshCapabilitiesResponse = Object.freeze({
  version: 1,
  readOnly: true,
  capabilities: [],
  loaderInventory: [],
})

/** Copy an RPC-projected object before placing it in editable memory. */
export function plainSettingsRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return structuredClone(value as Record<string, unknown>)
}

function equalJson(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => equalJson(item, right[index]))
  }
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const keys = Object.keys(leftRecord)
  return keys.length === Object.keys(rightRecord).length
    && keys.every(key => Object.hasOwn(rightRecord, key) && equalJson(leftRecord[key], rightRecord[key]))
}

/** Build the exact optimistic mutation list for an editable namespace draft. */
export function settingsOperations(
  descriptor: ClawdshSettingsNamespaceDescriptor,
  draft: Record<string, unknown>,
): readonly ClawdshSettingsMutation[] {
  return descriptor.fields
    .filter(field => field.access === 'editable')
    .flatMap((field): ClawdshSettingsMutation[] => {
      const before = getPath(descriptor.value, field.path)
      const after = getPath(draft, field.path)
      if ((before === undefined || before === '') && (after === undefined || after === '')) return []
      if (equalJson(before, after)) return []
      return after === undefined
        ? [{ op: 'unset', path: field.path }]
        : [{ op: 'set', path: field.path, value: after }]
    })
}

function namespaceState(descriptor: ClawdshSettingsNamespaceDescriptor): ClawdshNamespaceDraftState {
  return {
    descriptor,
    draft: plainSettingsRecord(descriptor.value),
    save: { status: 'idle' },
  }
}

function credentialState(descriptor: ClawdshCredentialDescriptor): ClawdshCredentialDraftState {
  return { descriptor, busy: false }
}

/**
 * Browser-process-only editor store. Its lifetime is owned by the Client plugin,
 * so closing or switching the native Settings panel cannot discard drafts.
 */
export class ClawdshSettingsStore {
  private readonly listeners = new Set<Listener>()
  private readonly secrets = new Map<string, string>()
  private readonly unavailableInputs = new Set<PresentationInput>()
  private loadPromise: Promise<void> | undefined
  private partialRetryPromise: Promise<void> | undefined
  private capabilitiesStale = false
  private disposed = false
  private unloadProtected = false
  private snapshot: ClawdshSettingsStoreSnapshot

  /**
   * @param control - loopback-only v1 product-control client.
   * @param localControlAvailable - whether the current browser origin may call it.
   */
  constructor(
    private readonly control: ClawdshControlClient,
    readonly localControlAvailable: boolean,
  ) {
    this.snapshot = {
      status: localControlAvailable ? 'idle' : 'remote',
      namespaces: [],
      credentials: [],
      expanded: new Set(['feature:memory']),
      dirtyCount: 0,
      epoch: 0,
    }
  }

  /** Current immutable React store snapshot. */
  readonly getSnapshot = (): ClawdshSettingsStoreSnapshot => this.snapshot

  /** Subscribe to state changes. */
  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private dirtyCount(namespaces = this.snapshot.namespaces): number {
    const namespaceCount = namespaces.filter((item) => {
      try {
        return settingsOperations(item.descriptor, item.draft).length > 0
      } catch {
        return false
      }
    }).length
    const credentialCount = [...this.secrets.values()].filter(value => value !== '').length
    return namespaceCount + credentialCount
  }

  private publish(next: Omit<ClawdshSettingsStoreSnapshot, 'dirtyCount' | 'epoch'>): void {
    if (this.disposed) return
    this.snapshot = {
      ...next,
      dirtyCount: this.dirtyCount(next.namespaces),
      epoch: this.snapshot.epoch + 1,
    }
    this.syncUnloadProtection()
    for (const listener of this.listeners) listener()
  }

  private republish(): void {
    const { dirtyCount: _dirtyCount, epoch: _epoch, ...snapshot } = this.snapshot
    this.publish(snapshot)
  }

  private readonly warnBeforeUnload = (event: BeforeUnloadEvent): void => {
    event.preventDefault()
    event.returnValue = ''
  }

  private syncUnloadProtection(): void {
    if (typeof window === 'undefined') return
    const shouldProtect = this.snapshot.dirtyCount > 0
    if (shouldProtect === this.unloadProtected) return
    this.unloadProtected = shouldProtect
    if (shouldProtect) window.addEventListener('beforeunload', this.warnBeforeUnload)
    else window.removeEventListener('beforeunload', this.warnBeforeUnload)
  }

  private presentationWarning(): string | undefined {
    if (this.capabilitiesStale) {
      return '设置已保存，但功能状态刷新失败；当前功能状态可能仍是保存前的结果。请重新读取运行状态。'
    }
    if (this.unavailableInputs.size > 0) {
      return '部分状态暂时不可用；已读取的功能配置仍可使用。'
    }
    return undefined
  }

  /** Load the three presentation inputs once; one unavailable input degrades independently. */
  ensureLoaded(): Promise<void> {
    if (!this.localControlAvailable || this.disposed || this.snapshot.status === 'ready') {
      return Promise.resolve()
    }
    if (this.loadPromise !== undefined) return this.loadPromise
    const { dirtyCount: _dirtyCount, epoch: _epoch, message: _message, ...current } = this.snapshot
    this.publish({ ...current, status: 'loading' })
    const pending = Promise.allSettled([
      this.control.loadCapabilities(),
      this.control.loadSettings(),
      this.control.loadCredentials(),
    ]).then(([capabilities, settings, credentials]) => {
      if (this.disposed) return
      this.capabilitiesStale = false
      this.unavailableInputs.clear()
      if (capabilities.status === 'rejected') this.unavailableInputs.add('capabilities')
      if (settings.status === 'rejected') this.unavailableInputs.add('settings')
      if (credentials.status === 'rejected') this.unavailableInputs.add('credentials')
      if (capabilities.status === 'rejected'
        && settings.status === 'rejected'
        && credentials.status === 'rejected') {
        this.publish({
          status: 'failed',
          message: 'ClawDSH 控制面暂时不可用，请重试。',
          namespaces: [],
          credentials: [],
          expanded: this.snapshot.expanded,
        })
        return
      }
      this.secrets.clear()
      const warning = this.presentationWarning()
      this.publish({
        status: 'ready',
        capabilities: capabilities.status === 'fulfilled' ? capabilities.value : UNKNOWN_CAPABILITIES,
        namespaces: settings.status === 'fulfilled' ? settings.value.namespaces.map(namespaceState) : [],
        credentials: credentials.status === 'fulfilled' ? credentials.value.credentials.map(credentialState) : [],
        ...(warning === undefined ? {} : { message: warning }),
        expanded: this.snapshot.expanded,
      })
    }).finally(() => {
      if (this.loadPromise === pending) this.loadPromise = undefined
    })
    this.loadPromise = pending
    return pending
  }

  /** Retry a failed initial load. */
  retry(): Promise<void> {
    if (this.snapshot.status !== 'failed') return Promise.resolve()
    return this.ensureLoaded()
  }

  /** Retry only unavailable presentation inputs, preserving every successful editor draft. */
  retryUnavailable(): Promise<void> {
    if (this.disposed || this.snapshot.status !== 'ready' || this.unavailableInputs.size === 0) {
      return Promise.resolve()
    }
    if (this.partialRetryPromise !== undefined) return this.partialRetryPromise
    const inputs = [...this.unavailableInputs]
    const calls = inputs.map(async (input) => {
      if (input === 'capabilities') return this.control.loadCapabilities()
      if (input === 'settings') return this.control.loadSettings()
      return this.control.loadCredentials()
    })
    const pending = Promise.allSettled(calls).then((results) => {
      if (this.disposed || this.snapshot.status !== 'ready') return
      let capabilities = this.snapshot.capabilities
      let namespaces = this.snapshot.namespaces
      let credentials = this.snapshot.credentials
      results.forEach((result, index) => {
        if (result.status !== 'fulfilled') return
        const input = inputs[index]
        if (input === 'capabilities') {
          capabilities = result.value as ClawdshCapabilitiesResponse
          this.capabilitiesStale = false
        } else if (input === 'settings') {
          const response = result.value as Awaited<ReturnType<ClawdshControlClient['loadSettings']>>
          namespaces = response.namespaces.map(namespaceState)
        } else if (input === 'credentials') {
          const response = result.value as Awaited<ReturnType<ClawdshControlClient['loadCredentials']>>
          this.secrets.clear()
          credentials = response.credentials.map(credentialState)
        }
        if (input !== undefined) this.unavailableInputs.delete(input)
      })
      const { dirtyCount: _dirtyCount, epoch: _epoch, message: _message, ...current } = this.snapshot
      const message = this.presentationWarning()
      this.publish({
        ...current,
        status: 'ready',
        ...(capabilities === undefined ? {} : { capabilities }),
        namespaces,
        credentials,
        ...(message === undefined ? {} : { message }),
      })
    }).finally(() => {
      if (this.partialRetryPromise === pending) this.partialRetryPromise = undefined
    })
    this.partialRetryPromise = pending
    return pending
  }

  /** Read one private credential draft for its controlled password input. */
  credentialSecret(id: string): string {
    return this.secrets.get(id) ?? ''
  }

  /** Replace one private credential draft without projecting it into the snapshot. */
  setCredentialSecret(id: string, value: string): void {
    if (this.disposed || !this.snapshot.credentials.some(item => item.descriptor.id === id)) return
    if (value === '') this.secrets.delete(id)
    else this.secrets.set(id, value)
    this.snapshot = {
      ...this.snapshot,
      credentials: this.snapshot.credentials.map(item => item.descriptor.id === id
        ? { descriptor: item.descriptor, busy: item.busy }
        : item),
    }
    this.republish()
  }

  /** Explicitly clear one credential draft and its dirty marker. */
  clearCredentialSecret(id: string): void {
    if (!this.secrets.delete(id)) return
    this.republish()
  }

  /** Replace one namespace draft while retaining the server descriptor revision. */
  setNamespaceDraft(namespace: string, draft: Record<string, unknown>): void {
    this.publish({
      ...this.snapshot,
      namespaces: this.snapshot.namespaces.map(item => item.descriptor.namespace === namespace
        ? { ...item, draft: plainSettingsRecord(draft), save: { status: 'idle' } }
        : item),
    })
  }

  /** Reset a local draft to its current server-projected value without an RPC write. */
  clearNamespaceDraft(namespace: string): void {
    this.publish({
      ...this.snapshot,
      namespaces: this.snapshot.namespaces.map(item => item.descriptor.namespace === namespace
        ? namespaceState(item.descriptor)
        : item),
    })
  }

  /** Return schema validation feedback for one draft, degrading malformed data safely. */
  validation(namespace: string): string | undefined {
    const item = this.snapshot.namespaces.find(candidate => candidate.descriptor.namespace === namespace)
    if (item === undefined) return '设置项已不可用'
    try {
      const schema = rehydrateSchema(item.descriptor.schema)
      if (schema.type !== 'object') return '设置结构不可用'
      return validateDraft(schema, item.draft)
    } catch {
      return '设置结构不可用'
    }
  }

  /** Return whether one namespace differs from its loaded descriptor. */
  namespaceDirty(namespace: string): boolean {
    const item = this.snapshot.namespaces.find(candidate => candidate.descriptor.namespace === namespace)
    if (item === undefined) return false
    try {
      return settingsOperations(item.descriptor, item.draft).length > 0
    } catch {
      return false
    }
  }

  private replaceNamespace(
    descriptor: ClawdshSettingsNamespaceDescriptor,
    capabilities = this.snapshot.capabilities,
  ): void {
    this.publish({
      ...this.snapshot,
      ...(capabilities === undefined ? {} : { capabilities }),
      namespaces: this.snapshot.namespaces.map(item => item.descriptor.namespace === descriptor.namespace
        ? namespaceState(descriptor)
        : item),
    })
  }

  private setNamespaceSave(
    namespace: string,
    save: ClawdshNamespaceDraftState['save'],
  ): void {
    this.publish({
      ...this.snapshot,
      namespaces: this.snapshot.namespaces.map(item => item.descriptor.namespace === namespace
        ? { ...item, save }
        : item),
    })
  }

  private async refreshCapabilities(): Promise<void> {
    try {
      const capabilities = await this.control.loadCapabilities()
      if (this.disposed || this.snapshot.status !== 'ready') return
      this.unavailableInputs.delete('capabilities')
      this.capabilitiesStale = false
      const { dirtyCount: _dirtyCount, epoch: _epoch, message: _message, ...current } = this.snapshot
      const message = this.presentationWarning()
      this.publish({
        ...current,
        capabilities,
        ...(message === undefined ? {} : { message }),
      })
    } catch {
      if (this.disposed || this.snapshot.status !== 'ready') return
      this.unavailableInputs.add('capabilities')
      this.capabilitiesStale = true
      this.publish({
        ...this.snapshot,
        message: '设置已保存，但功能状态刷新失败；当前功能状态可能仍是保存前的结果。请重新读取运行状态。',
      })
    }
  }

  /** Run one optimistic namespace write through the shared settlement contract. */
  private async updateNamespace(
    namespace: string,
    status: 'saving' | 'resetting',
    update: () => Promise<ClawdshSettingsNamespaceDescriptor>,
    conflictMessage: string,
    failureMessage: string,
  ): Promise<void> {
    if (this.disposed) return
    this.setNamespaceSave(namespace, { status })
    try {
      const descriptor = await update()
      if (this.disposed) return
      if (descriptor.namespace !== namespace) {
        throw new TypeError('settings response namespace mismatch')
      }
      this.replaceNamespace(descriptor)
      await this.refreshCapabilities()
    } catch (reason) {
      if (this.disposed) return
      if (reason instanceof ClawdshControlError && reason.code === 'settings-conflict') {
        this.setNamespaceSave(namespace, { status: 'conflict', message: conflictMessage })
      } else {
        this.setNamespaceSave(namespace, { status: 'failed', message: failureMessage })
      }
    }
  }

  /** Save one namespace with its loaded optimistic revision. */
  async saveNamespace(namespace: string): Promise<void> {
    const item = this.snapshot.namespaces.find(candidate => candidate.descriptor.namespace === namespace)
    if (item === undefined || item.save.status !== 'idle') return
    const validation = this.validation(namespace)
    let operations: readonly ClawdshSettingsMutation[]
    try {
      operations = settingsOperations(item.descriptor, item.draft)
    } catch {
      this.setNamespaceSave(namespace, { status: 'failed', message: '设置结构不可用' })
      return
    }
    if (validation !== undefined || operations.length === 0) return
    await this.updateNamespace(
      namespace,
      'saving',
      async () => (await this.control.mutateSetting({
        version: 1,
        namespace,
        expectedRevision: item.descriptor.desiredRevision,
        operations,
      })).namespace,
      '设置已在其他页面或外部编辑器中更新。当前草稿未丢失；重新加载后才能继续保存。',
      '设置保存失败，请重试。',
    )
  }

  /** Reset one namespace's user layer using optimistic conflict protection. */
  async resetNamespace(namespace: string): Promise<void> {
    const item = this.snapshot.namespaces.find(candidate => candidate.descriptor.namespace === namespace)
    if (item === undefined || item.save.status !== 'idle') return
    await this.updateNamespace(
      namespace,
      'resetting',
      async () => (await this.control.resetSettings({
        version: 1,
        namespace,
        expectedRevision: item.descriptor.desiredRevision,
      })).namespace,
      '设置已发生变化；重新加载后才能重置。',
      '设置重置失败，请重试。',
    )
  }

  /** Reload one conflicted namespace, discarding that namespace's stale draft. */
  async reloadNamespace(namespace: string): Promise<void> {
    const item = this.snapshot.namespaces.find(candidate => candidate.descriptor.namespace === namespace)
    if (item === undefined) return
    this.setNamespaceSave(namespace, { status: 'reloading' })
    try {
      const response = await this.control.loadSettings()
      const descriptor = response.namespaces.find(candidate => candidate.namespace === namespace)
      if (descriptor === undefined) throw new Error(`设置 ${namespace} 已不可用`)
      if (this.disposed) return
      this.replaceNamespace(descriptor)
    } catch {
      if (this.disposed) return
      this.setNamespaceSave(namespace, { status: 'conflict', message: '重新加载失败，请稍后重试。' })
    }
  }

  private setCredentialState(id: string, state: ClawdshCredentialDraftState): void {
    this.publish({
      ...this.snapshot,
      credentials: this.snapshot.credentials.map(item => item.descriptor.id === id
        ? state
        : item),
    })
  }

  /** Run one write-only credential request and erase its private draft on settlement. */
  private async updateCredential(
    id: string,
    item: ClawdshCredentialDraftState,
    update: () => Promise<ClawdshCredentialDescriptor>,
    failureMessage: string,
  ): Promise<void> {
    if (this.disposed) return
    this.setCredentialState(id, { descriptor: item.descriptor, busy: true })
    try {
      const descriptor = await update()
      if (this.disposed) return
      if (descriptor.id !== id) throw new TypeError('credential response id mismatch')
      this.secrets.delete(id)
      this.setCredentialState(id, { descriptor, busy: false })
    } catch {
      if (this.disposed) return
      this.secrets.delete(id)
      this.setCredentialState(id, { descriptor: item.descriptor, busy: false, error: failureMessage })
    }
  }

  /** Save a write-only credential and clear its draft after either outcome. */
  async saveCredential(id: string): Promise<void> {
    const item = this.snapshot.credentials.find(candidate => candidate.descriptor.id === id)
    const value = this.secrets.get(id) ?? ''
    if (item === undefined || item.busy || !item.descriptor.writable || value === '') return
    await this.updateCredential(
      id,
      item,
      async () => (await this.control.setCredential(id, value)).credential,
      '凭据保存失败，请重试。',
    )
  }

  /** Remove one credential and clear any unsaved replacement value. */
  async unsetCredential(id: string): Promise<void> {
    const item = this.snapshot.credentials.find(candidate => candidate.descriptor.id === id)
    if (item === undefined || item.busy || !item.descriptor.writable) return
    await this.updateCredential(
      id,
      item,
      async () => (await this.control.unsetCredential(id)).credential,
      '凭据移除失败，请重试。',
    )
  }

  /** Persist one disclosure's open state across native section unmounts. */
  setExpanded(key: string, expanded: boolean): void {
    const next = new Set(this.snapshot.expanded)
    if (expanded) next.add(key)
    else next.delete(key)
    this.publish({ ...this.snapshot, expanded: next })
  }

  /** Clear private values, listeners, and browser navigation protection. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.secrets.clear()
    if (typeof window !== 'undefined' && this.unloadProtected) {
      window.removeEventListener('beforeunload', this.warnBeforeUnload)
    }
    this.unloadProtected = false
    this.listeners.clear()
  }
}
