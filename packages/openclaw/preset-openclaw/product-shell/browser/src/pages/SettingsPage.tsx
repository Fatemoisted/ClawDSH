import {
  getPath,
  rehydrateSchema,
  validateDraft,
} from '@deepseek-ai/dsh-client-schema-form'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  ClawdshCapabilitiesResponse,
  ClawdshCredentialDescriptor,
  ClawdshSettingsFieldPermission,
  ClawdshSettingsNamespaceDescriptor,
  ClawdshSettingsMutation,
} from '../../../shared/src/protocol.ts'
import {
  ClawdshControlError,
  type ClawdshControlClient,
} from '../control-client.ts'
import {
  EFFECT_TIME_LABEL,
  LOADER_STATE_LABEL,
  ORIGIN_LABEL,
  SUPPORT_LABEL,
} from '../capabilities.ts'
import { AutomationRulesEditor } from './AutomationRulesEditor.tsx'
import { GatewayExtensionsTable } from './GatewayExtensionsTable.tsx'
import { SettingsFields, type SettingsFieldPresentation } from './settings-fields.tsx'
import css from './SettingsPage.module.css'

interface SettingsPageProps {
  readonly control: ClawdshControlClient
  readonly localControlAvailable: boolean
}

interface SettingsSnapshot {
  readonly capabilities: ClawdshCapabilitiesResponse
  readonly namespaces: readonly ClawdshSettingsNamespaceDescriptor[]
  readonly credentials: readonly ClawdshCredentialDescriptor[]
}

type SettingsState =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'ready'; readonly snapshot: SettingsSnapshot }

type SaveState =
  | { readonly status: 'idle' }
  | { readonly status: 'saving' | 'resetting' | 'reloading' }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'conflict'; readonly message: string }

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function plainRecord(value: unknown): Record<string, unknown> {
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

function operationsFor(
  descriptor: ClawdshSettingsNamespaceDescriptor,
  draft: Record<string, unknown>,
): ClawdshSettingsMutation[] {
  return descriptor.fields
    .filter(field => field.access === 'editable')
    .flatMap((field): ClawdshSettingsMutation[] => {
      const before = getPath(descriptor.value, field.path)
      const after = getPath(draft, field.path)
      if (equalJson(before, after)) return []
      return after === undefined
        ? [{ op: 'unset', path: field.path }]
        : [{ op: 'set', path: field.path, value: after }]
    })
}

function fieldPresentation(field: ClawdshSettingsFieldPermission): SettingsFieldPresentation {
  return {
    path: field.path,
    label: field.label,
    editable: field.access === 'editable',
    ...(field.description === undefined ? {} : { description: field.description }),
  }
}

interface NamespaceCardProps {
  readonly descriptor: ClawdshSettingsNamespaceDescriptor
  readonly control: ClawdshControlClient
  readonly onUpdated: (descriptor: ClawdshSettingsNamespaceDescriptor) => void
  readonly onCommitted: () => void
}

function NamespaceCard({ descriptor, control, onUpdated, onCommitted }: NamespaceCardProps): ReactNode {
  const [draft, setDraft] = useState<Record<string, unknown>>(() => plainRecord(descriptor.value))
  const [save, setSave] = useState<SaveState>({ status: 'idle' })
  const operations = operationsFor(descriptor, draft)
  const validation = useMemo(
    () => validateDraft(rehydrateSchema(descriptor.schema), draft),
    [descriptor.schema, draft],
  )
  const busy = save.status === 'saving' || save.status === 'resetting' || save.status === 'reloading'
  const conflicted = save.status === 'conflict'

  useEffect(() => {
    setDraft(plainRecord(descriptor.value))
    setSave({ status: 'idle' })
  }, [descriptor.desiredRevision, descriptor.value])

  const accept = (next: ClawdshSettingsNamespaceDescriptor): void => {
    onUpdated(next)
    setDraft(plainRecord(next.value))
    setSave({ status: 'idle' })
    onCommitted()
  }

  const saveDraft = async (): Promise<void> => {
    if (validation !== undefined || operations.length === 0 || busy || conflicted) return
    setSave({ status: 'saving' })
    try {
      const response = await control.mutateSetting({
        version: 1,
        namespace: descriptor.namespace,
        expectedRevision: descriptor.desiredRevision,
        operations,
      })
      accept(response.namespace)
    } catch (reason) {
      if (reason instanceof ClawdshControlError && reason.code === 'settings-conflict') {
        setSave({ status: 'conflict', message: '设置已在其他页面或外部编辑器中更新。当前草稿未丢失；重新加载后才能继续保存。' })
      } else {
        setSave({ status: 'failed', message: errorMessage(reason) })
      }
    }
  }

  const reset = async (): Promise<void> => {
    if (busy || conflicted) return
    setSave({ status: 'resetting' })
    try {
      const response = await control.resetSettings({
        version: 1,
        namespace: descriptor.namespace,
        expectedRevision: descriptor.desiredRevision,
      })
      accept(response.namespace)
    } catch (reason) {
      if (reason instanceof ClawdshControlError && reason.code === 'settings-conflict') {
        setSave({ status: 'conflict', message: '设置已发生变化；重新加载后才能重置。' })
      } else {
        setSave({ status: 'failed', message: errorMessage(reason) })
      }
    }
  }

  const reload = async (): Promise<void> => {
    setSave({ status: 'reloading' })
    try {
      const response = await control.loadSettings()
      const next = response.namespaces.find(item => item.namespace === descriptor.namespace)
      if (next === undefined) throw new Error(`设置 namespace ${descriptor.namespace} 已不可用`)
      accept(next)
    } catch (reason) {
      setSave({ status: 'conflict', message: `重新加载失败：${errorMessage(reason)}` })
    }
  }

  const renderSpecial = (
    field: SettingsFieldPresentation,
    value: unknown,
    onChange: (value: unknown) => void,
  ): ReactNode | undefined => {
    const path = field.path.join('.')
    if (descriptor.editor === 'automation-rules' && path === 'rules') {
      return (
        <AutomationRulesEditor
          id={`clawdsh-setting-${descriptor.namespace}-rules`}
          value={value}
          disabled={busy || conflicted}
          onChange={onChange}
        />
      )
    }
    if (descriptor.editor === 'gateway-deployment' && path === 'extensions') {
      return <GatewayExtensionsTable value={value} />
    }
    return undefined
  }

  return (
    <article className={css.namespaceCard} data-settings-namespace={descriptor.namespace}>
      <div className={css.namespaceHeading}>
        <div>
          <h3>{descriptor.label}</h3>
          <p>{descriptor.description}</p>
        </div>
        {descriptor.restartRequired ? <span className={css.restartBadge}>需要重启</span> : null}
      </div>
      <div className={css.revisionLine}>
        <span>生效：{EFFECT_TIME_LABEL[descriptor.effectTime]}</span>
        <span>期望版本：{descriptor.desiredRevision}</span>
        <span>运行版本：{descriptor.runtimeRevision}</span>
      </div>
      <SettingsFields
        idPrefix={`clawdsh-setting-${descriptor.namespace}`}
        serializedSchema={descriptor.schema}
        draft={draft}
        fields={descriptor.fields.map(fieldPresentation)}
        disabled={busy || conflicted}
        onChange={setDraft}
        renderSpecial={renderSpecial}
      />
      {validation === undefined ? null : <div className={css.saveError} role="alert">{validation}</div>}
      {save.status === 'failed' ? <div className={css.saveError} role="alert">{save.message}</div> : null}
      {save.status === 'conflict' ? (
        <div className={css.conflict} role="alert">
          <span>{save.message}</span>
          <button type="button" className={css.secondaryButton} onClick={() => { void reload() }}>重新加载</button>
        </div>
      ) : null}
      <div className={css.namespaceActions}>
        <button
          type="button"
          className={css.secondaryButton}
          disabled={busy || conflicted}
          onClick={() => { void reset() }}
        >
          {save.status === 'resetting' ? '重置中…' : '重置用户设置'}
        </button>
        <button
          type="button"
          className={css.primaryButton}
          disabled={busy || conflicted || validation !== undefined || operations.length === 0}
          onClick={() => { void saveDraft() }}
        >
          {save.status === 'saving' ? '保存中…' : '保存'}
        </button>
      </div>
    </article>
  )
}

interface CredentialCardProps {
  readonly credential: ClawdshCredentialDescriptor
  readonly control: ClawdshControlClient
  readonly onUpdated: (credential: ClawdshCredentialDescriptor) => void
}

function CredentialCard({ credential, control, onUpdated }: CredentialCardProps): ReactNode {
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const store = async (): Promise<void> => {
    if (secret === '' || busy || !credential.writable) return
    const value = secret
    setBusy(true)
    setError(undefined)
    try {
      onUpdated((await control.setCredential(credential.id, value)).credential)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setSecret('')
      setBusy(false)
    }
  }

  const unset = async (): Promise<void> => {
    if (busy || !credential.writable) return
    setBusy(true)
    setError(undefined)
    try {
      onUpdated((await control.unsetCredential(credential.id)).credential)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setSecret('')
      setBusy(false)
    }
  }

  return (
    <article className={css.credentialCard} data-credential={credential.id}>
      <div className={css.credentialHeading}>
        <div>
          <h3>{credential.label}</h3>
          <p>{credential.id} · {EFFECT_TIME_LABEL[credential.effectTime]}</p>
        </div>
        <span className={css.configuredBadge} data-configured={String(credential.configured)}>
          {credential.configured ? '已配置' : '未配置'}
        </span>
      </div>
      <label>
        <span className={css.emptyValue}>新凭据（不会回显）</span>
        <input
          className={css.credentialInput}
          type="password"
          autoComplete="new-password"
          value={secret}
          disabled={busy || !credential.writable}
          onChange={(event) => { setSecret(event.target.value) }}
        />
      </label>
      {credential.source === undefined ? null : <span className={css.emptyValue}>当前来源：{credential.source}</span>}
      {error === undefined ? null : <div className={css.saveError} role="alert">{error}</div>}
      <div className={css.credentialActions}>
        <button type="button" className={css.dangerButton} disabled={busy || !credential.writable || !credential.configured} onClick={() => { void unset() }}>移除</button>
        <button type="button" className={css.primaryButton} disabled={busy || !credential.writable || secret === ''} onClick={() => { void store() }}>{busy ? '处理中…' : '保存凭据'}</button>
      </div>
    </article>
  )
}

function CapabilityOverview({ snapshot }: { readonly snapshot: ClawdshCapabilitiesResponse }): ReactNode {
  return (
    <section className={css.section} aria-labelledby="clawdsh-overview-title">
      <div className={css.sectionHeading}>
        <div>
          <h2 id="clawdsh-overview-title">ClawDSH 总览</h2>
          <p>能力健康度、依赖和渠道支持证据独立于设置值展示。</p>
        </div>
        <span className={css.count}>
          {snapshot.capabilities.filter(item => item.state === 'active').length}/{snapshot.capabilities.length} 运行中
        </span>
      </div>
      <ul className={css.capabilities}>
        {snapshot.capabilities.map(capability => (
          <li className={css.capability} key={capability.id} data-capability={capability.id}>
            <div className={css.capabilityTopline}>
              <strong>{capability.label}</strong>
              <span
                className={css.state}
                data-state={capability.state}
                role="status"
                aria-label={`${capability.label} ${LOADER_STATE_LABEL[capability.state]}`}
              >
                {LOADER_STATE_LABEL[capability.state]}
              </span>
            </div>
            <p>{capability.description}</p>
            <dl>
              <div><dt>生效</dt><dd>{EFFECT_TIME_LABEL[capability.effectTime]}</dd></div>
              <div><dt>依赖</dt><dd>{capability.dependencies.length === 0 ? '无' : capability.dependencies.join(' · ')}</dd></div>
            </dl>
            <ul className={css.components} aria-label={`${capability.label} 组件`}>
              {capability.components.map(component => (
                <li key={component.id}>
                  <span>
                    <strong>{component.label}</strong>
                    <small>{component.packages.join(' · ')}</small>
                    <small>状态来源：{component.stateSource === 'preset' ? 'Preset' : 'Loader'}</small>
                  </span>
                  <span className={css.state} data-state={component.state}>{LOADER_STATE_LABEL[component.state]}</span>
                </li>
              ))}
            </ul>
            {capability.channels === undefined ? null : (
              <div className={css.channels}>
                <strong>渠道目录</strong>
                <ul>
                  {capability.channels.map(channel => (
                    <li key={channel.id}>
                      <span>{channel.label}</span>
                      <span data-support={channel.support}>{SUPPORT_LABEL[channel.support]}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function LoaderInventory({ snapshot }: { readonly snapshot: ClawdshCapabilitiesResponse }): ReactNode {
  return (
    <section className={css.section} aria-labelledby="loader-inventory-title">
      <div className={css.sectionHeading}>
        <div><h2 id="loader-inventory-title">Loader 清单</h2><p>高级只读诊断；普通设置不会任意启停 Loader entry。</p></div>
        <span className={css.count}>{snapshot.loaderInventory.length} 项</span>
      </div>
      <div className={css.tableWrap}>
        <table>
          <thead><tr><th>来源</th><th>模块</th><th>配置</th><th>Fiber</th></tr></thead>
          <tbody>
            {snapshot.loaderInventory.map(entry => (
              <tr key={entry.entryId}>
                <td><span className={css.origin} data-origin={ORIGIN_LABEL[entry.source]}>{ORIGIN_LABEL[entry.source]}</span></td>
                <td><code title={entry.entryId}>{entry.moduleName}</code></td>
                <td>{entry.enabled ? '启用' : '关闭'}</td>
                <td>{entry.fiberPhase ?? '未观测'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** Complete ClawDSH settings, credentials, capability health, and advanced inventory. */
export function SettingsPage({ control, localControlAvailable }: SettingsPageProps): ReactNode {
  const [request, setRequest] = useState(0)
  const [state, setState] = useState<SettingsState>({ status: 'loading' })

  useEffect(() => {
    if (!localControlAvailable) return
    let current = true
    void Promise.all([
      control.loadCapabilities(),
      control.loadSettings(),
      control.loadCredentials(),
    ]).then(
      ([capabilities, settings, credentials]) => {
        if (current) setState({
          status: 'ready',
          snapshot: {
            capabilities,
            namespaces: settings.namespaces,
            credentials: credentials.credentials,
          },
        })
      },
      (reason: unknown) => {
        if (current) setState({ status: 'failed', message: errorMessage(reason) })
      },
    )
    return () => { current = false }
  }, [control, localControlAvailable, request])

  const updateNamespace = (descriptor: ClawdshSettingsNamespaceDescriptor): void => {
    setState(previous => previous.status !== 'ready' ? previous : {
      status: 'ready',
      snapshot: {
        ...previous.snapshot,
        namespaces: previous.snapshot.namespaces.map(item => (
          item.namespace === descriptor.namespace ? descriptor : item
        )),
      },
    })
  }

  const updateCredential = (credential: ClawdshCredentialDescriptor): void => {
    setState(previous => previous.status !== 'ready' ? previous : {
      status: 'ready',
      snapshot: {
        ...previous.snapshot,
        credentials: previous.snapshot.credentials.map(item => item.id === credential.id ? credential : item),
      },
    })
  }

  const refreshCapabilities = (): void => {
    void control.loadCapabilities().then((capabilities) => {
      setState(previous => previous.status !== 'ready' ? previous : {
        status: 'ready',
        snapshot: { ...previous.snapshot, capabilities },
      })
    }, () => {
      // The committed settings descriptor remains authoritative when a health refresh is unavailable.
    })
  }

  return (
    <div className={css.page}>
      <header className={css.header}>
        <p className={css.eyebrow}>本地产品控制面</p>
        <h1>ClawDSH 设置</h1>
        <p>配置 ClawDSH 自有能力。DeepSeek Harness 原生设置与 raw Trajectory 继续留在 Harness 高级界面。</p>
      </header>

      {!localControlAvailable ? (
        <div className={css.failure} role="status">
          <strong>ClawDSH 设置仅本机可用</strong>
          <span>远程页面仍可使用对话；请在运行 ClawDSH 的本机打开此页面管理产品能力。</span>
        </div>
      ) : null}
      {localControlAvailable && state.status === 'loading' ? <p className={css.status}>正在读取设置与运行状态…</p> : null}
      {localControlAvailable && state.status === 'failed' ? (
        <div className={css.failure} role="alert">
          <strong>暂时无法读取 ClawDSH 设置</strong>
          <span>{state.message}</span>
          <button type="button" onClick={() => { setState({ status: 'loading' }); setRequest(value => value + 1) }}>重试</button>
        </div>
      ) : null}

      {localControlAvailable && state.status === 'ready' ? (
        <>
          <section className={css.section} aria-labelledby="settings-namespaces-title">
            <div className={css.sectionHeading}>
              <div><h2 id="settings-namespaces-title">产品能力设置</h2><p>每个能力保存自己的草稿和 revision；需要重启的修改会明确标记。</p></div>
              <span className={css.count}>{state.snapshot.namespaces.length} 个 namespace</span>
            </div>
            <div className={css.namespaceList}>
              {state.snapshot.namespaces.map(descriptor => (
                <NamespaceCard
                  key={descriptor.namespace}
                  descriptor={descriptor}
                  control={control}
                  onUpdated={updateNamespace}
                  onCommitted={refreshCapabilities}
                />
              ))}
            </div>
          </section>

          <section className={css.section} aria-labelledby="credentials-title">
            <div className={css.sectionHeading}>
              <div><h2 id="credentials-title">ClawDSH 凭据</h2><p>这里只管理 DSH 自有凭据；飞书、Telegram 等平台凭据始终由 OpenClaw Gateway 独占。</p></div>
              <span className={css.count}>{state.snapshot.credentials.length} 项</span>
            </div>
            <div className={css.credentialList}>
              {state.snapshot.credentials.map(credential => (
                <CredentialCard key={credential.id} credential={credential} control={control} onUpdated={updateCredential} />
              ))}
            </div>
          </section>

          <CapabilityOverview snapshot={state.snapshot.capabilities} />
          <LoaderInventory snapshot={state.snapshot.capabilities} />
        </>
      ) : null}
    </div>
  )
}
