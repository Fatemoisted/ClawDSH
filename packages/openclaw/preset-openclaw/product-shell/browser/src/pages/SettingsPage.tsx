import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import type {
  ClawdshCapability,
  ClawdshCapabilitiesResponse,
  ClawdshLoaderEntry,
  ClawdshSettingsFieldPermission,
} from '../../../shared/src/protocol.ts'
import type { ClawdshControlClient } from '../control-client.ts'
import {
  EFFECT_TIME_LABEL,
  LOADER_STATE_LABEL,
  ORIGIN_LABEL,
  SUPPORT_LABEL,
} from '../capabilities.ts'
import {
  presentClawdshSettings,
  type ClawdshFeatureId,
  type ClawdshFeaturePresentation,
} from '../settings-presentation.ts'
import {
  ClawdshSettingsStore,
  type ClawdshCredentialDraftState,
  type ClawdshNamespaceDraftState,
} from '../settings-store.ts'
import { AutomationRulesEditor } from './AutomationRulesEditor.tsx'
import { GatewayExtensionsTable } from './GatewayExtensionsTable.tsx'
import { SettingsFields, type SettingsFieldPresentation } from './settings-fields.tsx'
import css from './SettingsPage.module.css'

type SettingsPageProps =
  | { readonly store: ClawdshSettingsStore; readonly control?: never; readonly localControlAvailable?: never }
  | {
    readonly store?: never
    readonly control: ClawdshControlClient
    readonly localControlAvailable: boolean
  }

interface ResolvedStore {
  readonly store: ClawdshSettingsStore
  readonly owned: boolean
}

interface FeatureConfig {
  readonly id: ClawdshFeatureId
  readonly label: string
  readonly description: string
  readonly namespaces: readonly { readonly id: string; readonly subsection?: string }[]
  readonly credentialId?: string
}

const FEATURE_CONFIGS: readonly FeatureConfig[] = [
  {
    id: 'soul',
    label: 'Soul',
    description: '控制新会话中的身份和行为规则。',
    namespaces: [{ id: 'clawdsh-soul' }],
  },
  {
    id: 'memory',
    label: 'Memory',
    description: '持久记忆与可选的语义搜索配置在同一功能组中。',
    namespaces: [
      { id: 'clawdsh-memory', subsection: 'Memory 行为' },
      { id: 'clawdsh-embeddings-ark', subsection: '语义搜索（Ark Embeddings）' },
    ],
    credentialId: 'ark-api-key',
  },
  {
    id: 'skills',
    label: 'Skills Hub',
    description: '配置本地和托管 Skill 目录及准入检查。',
    namespaces: [{ id: 'clawdsh-skills-hub' }],
  },
  {
    id: 'channels',
    label: 'Channels',
    description: 'Agent Bridge 与安全默认关闭的 OpenClaw Gateway。',
    namespaces: [
      { id: 'clawdsh-channel-agent', subsection: 'Agent Bridge' },
      { id: 'clawdsh-channel-openclaw', subsection: 'OpenClaw Gateway' },
    ],
  },
  {
    id: 'automation',
    label: '自动任务（Automation）',
    description: '让 ClawDSH 在你设定的时间自动执行一条任务，例如每天整理待办或每周生成研究回顾。默认关闭，不影响正常对话。',
    namespaces: [{ id: 'clawdsh-automation' }],
  },
]

function fieldPresentation(field: ClawdshSettingsFieldPermission): SettingsFieldPresentation {
  return {
    path: field.path,
    label: field.label,
    editable: field.access === 'editable',
    ...(field.description === undefined ? {} : { description: field.description }),
  }
}

function busy(state: ClawdshNamespaceDraftState): boolean {
  return state.save.status === 'saving'
    || state.save.status === 'resetting'
    || state.save.status === 'reloading'
}

function NamespaceEditor({
  state,
  store,
  subsection,
}: {
  readonly state: ClawdshNamespaceDraftState
  readonly store: ClawdshSettingsStore
  readonly subsection?: string
}): ReactNode {
  const descriptor = state.descriptor
  const isBusy = busy(state)
  const conflicted = state.save.status === 'conflict'
  const dirty = store.namespaceDirty(descriptor.namespace)
  const validation = store.validation(descriptor.namespace)

  const renderSpecial = (
    field: SettingsFieldPresentation,
    value: unknown,
    onChange: (value: unknown) => void,
  ): ReactNode | undefined => {
    const path = field.path.join('.')
    if (descriptor.editor === 'automation-rules' && path === 'rules' && field.editable) {
      return (
        <AutomationRulesEditor
          id={`clawdsh-setting-${descriptor.namespace}-rules`}
          value={value}
          disabled={isBusy || conflicted}
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
    <div className={css.namespaceEditor} data-settings-namespace={descriptor.namespace}>
      {subsection === undefined ? null : (
        <div className={css.subsectionHeading}>
          <h4>{subsection}</h4>
          <p>{descriptor.description}</p>
        </div>
      )}
      <div className={css.revisionLine}>
        <span>生效：{EFFECT_TIME_LABEL[descriptor.effectTime]}</span>
        <span>期望版本：{descriptor.desiredRevision}</span>
        <span>运行版本：{descriptor.runtimeRevision}</span>
        {dirty ? <span className={css.dirtyBadge}>未保存</span> : null}
        {descriptor.restartRequired ? (
          <span className={css.restartBadge}>重启后应用修改</span>
        ) : null}
      </div>
      <SettingsFields
        idPrefix={`clawdsh-setting-${descriptor.namespace}`}
        serializedSchema={descriptor.schema}
        draft={state.draft}
        fields={descriptor.fields.map(fieldPresentation)}
        disabled={isBusy || conflicted}
        onChange={(draft) => { store.setNamespaceDraft(descriptor.namespace, draft) }}
        renderSpecial={renderSpecial}
      />
      {validation === undefined || validation === '设置结构不可用'
        ? null
        : <div className={css.saveError} role="alert">{validation}</div>}
      {state.save.status === 'failed' ? <div className={css.saveError} role="alert">{state.save.message}</div> : null}
      {state.save.status === 'conflict' ? (
        <div className={css.conflict} role="alert">
          <span>{state.save.message}</span>
          <button type="button" className={css.secondaryButton} onClick={() => { void store.reloadNamespace(descriptor.namespace) }}>
            重新加载
          </button>
        </div>
      ) : null}
      <div className={css.namespaceActions}>
        {dirty ? (
          <button type="button" className={css.secondaryButton} disabled={isBusy || conflicted} onClick={() => { store.clearNamespaceDraft(descriptor.namespace) }}>
            放弃草稿
          </button>
        ) : null}
        <button
          type="button"
          className={css.secondaryButton}
          disabled={isBusy || conflicted}
          onClick={() => { void store.resetNamespace(descriptor.namespace) }}
        >
          {state.save.status === 'resetting' ? '重置中…' : '重置用户设置'}
        </button>
        <button
          type="button"
          className={css.primaryButton}
          disabled={isBusy || conflicted || validation !== undefined || !dirty}
          onClick={() => { void store.saveNamespace(descriptor.namespace) }}
        >
          {state.save.status === 'saving' ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  )
}

function CredentialEditor({
  state,
  store,
}: {
  readonly state: ClawdshCredentialDraftState
  readonly store: ClawdshSettingsStore
}): ReactNode {
  const credential = state.descriptor
  const secret = store.credentialSecret(credential.id)
  return (
    <div className={css.credentialEditor} data-credential={credential.id}>
      <div className={css.credentialHeading}>
        <div>
          <h4>{credential.label}</h4>
          <p>{credential.configured
            ? '已配置，语义搜索会在首次调用时验证'
            : '未配置；基础长期记忆工具仍会加载，本地存储在首次使用时验证'}</p>
        </div>
        <span className={css.configuredBadge} data-configured={String(credential.configured)}>
          {credential.configured ? '已配置' : '未配置'}
        </span>
      </div>
      <label className={css.credentialLabel}>
        <span>新凭据（不会回显）</span>
        <input
          className={css.credentialInput}
          type="password"
          autoComplete="new-password"
          value={secret}
          disabled={state.busy || !credential.writable}
          onChange={(event) => { store.setCredentialSecret(credential.id, event.target.value) }}
        />
      </label>
      {credential.source === undefined ? null : <span className={css.muted}>当前来源：{credential.source}</span>}
      {state.error === undefined ? null : <div className={css.saveError} role="alert">{state.error}</div>}
      <div className={css.credentialActions}>
        {secret === '' ? null : (
          <button type="button" className={css.secondaryButton} disabled={state.busy} onClick={() => { store.clearCredentialSecret(credential.id) }}>
            清空
          </button>
        )}
        <button
          type="button"
          className={css.dangerButton}
          disabled={state.busy || !credential.writable || !credential.configured}
          onClick={() => { void store.unsetCredential(credential.id) }}
        >
          移除
        </button>
        <button
          type="button"
          className={css.primaryButton}
          disabled={state.busy || !credential.writable || secret === ''}
          onClick={() => { void store.saveCredential(credential.id) }}
        >
          {state.busy ? '处理中…' : '保存凭据'}
        </button>
      </div>
    </div>
  )
}

function FeatureStatusCard({ feature }: { readonly feature: ClawdshFeaturePresentation }): ReactNode {
  return (
    <li className={css.featureStatus} data-feature={feature.id} data-tone={feature.tone}>
      <div className={css.featureStatusTopline}>
        <strong>{feature.label}</strong>
        <span className={css.featureState} data-tone={feature.tone}>{feature.primary}</span>
      </div>
      <p>{feature.detail}</p>
      {feature.restartNotice === undefined ? null : <span className={css.restartNotice}>{feature.restartNotice}</span>}
    </li>
  )
}

function FeatureConfiguration({
  config,
  namespaces,
  credentials,
  store,
}: {
  readonly config: FeatureConfig
  readonly namespaces: readonly ClawdshNamespaceDraftState[]
  readonly credentials: readonly ClawdshCredentialDraftState[]
  readonly store: ClawdshSettingsStore
}): ReactNode {
  const key = `feature:${config.id}`
  const expanded = store.getSnapshot().expanded.has(key)
  const bodyId = `clawdsh-feature-config-${config.id}`
  const rows = config.namespaces.map(entry => ({
    ...entry,
    state: namespaces.find(candidate => candidate.descriptor.namespace === entry.id),
  }))
  const credential = config.credentialId === undefined
    ? undefined
    : credentials.find(candidate => candidate.descriptor.id === config.credentialId)
  return (
    <article className={css.featureConfig} data-feature-config={config.id}>
      <div className={css.featureConfigHeading}>
        <div>
          <h3>{config.label}</h3>
          <p>{config.description}</p>
        </div>
        <button
          type="button"
          className={css.sectionToggle}
          aria-expanded={expanded}
          aria-controls={bodyId}
          aria-label={`${expanded ? '收起' : '展开'} ${config.label}`}
          onClick={() => { store.setExpanded(key, !expanded) }}
        >
          {expanded ? '收起' : '展开'}
        </button>
      </div>
      <div id={bodyId} className={css.featureConfigBody} hidden={!expanded}>
        {rows.map(row => row.state === undefined ? (
          <div className={css.unknownSetting} key={row.id}>这项配置暂时不可用。</div>
        ) : (
          <NamespaceEditor
            key={row.id}
            state={row.state}
            store={store}
            {...row.subsection === undefined ? {} : { subsection: row.subsection }}
          />
        ))}
        {config.credentialId !== undefined && credential === undefined
          ? <div className={css.unknownSetting}>Ark API Key 状态未知。</div>
          : credential === undefined ? null : <CredentialEditor state={credential} store={store} />}
      </div>
    </article>
  )
}

function CapabilityImplementation({ capability }: { readonly capability: ClawdshCapability }): ReactNode {
  const components: ClawdshCapability['components'] = Array.isArray(capability.components)
    ? capability.components
    : []
  const channels: ClawdshCapability['channels'] = Array.isArray(capability.channels)
    ? capability.channels
    : undefined
  return (
    <div className={css.implementationCapability} data-implementation-capability={capability.id}>
      <div className={css.implementationTopline}>
        <strong>{capability.label}</strong>
        <span className={css.loaderState} data-state={capability.state}>{LOADER_STATE_LABEL[capability.state]}</span>
      </div>
      <ul>
        {components.map(component => (
          <li key={component.id}>
            <span><strong>{component.label}</strong><small>{component.packages.join(' · ')}</small></span>
            <span>{component.stateSource === 'preset' ? 'Preset' : 'Loader'} · {LOADER_STATE_LABEL[component.state]}</span>
          </li>
        ))}
      </ul>
      {channels === undefined ? null : (
        <ul aria-label="渠道目录">
          {channels.map(channel => (
            <li key={channel.id}><span>{channel.label}</span><span>{SUPPORT_LABEL[channel.support]}</span></li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SystemDetails({
  capabilities,
  store,
}: {
  readonly capabilities: ClawdshCapabilitiesResponse
  readonly store: ClawdshSettingsStore
}): ReactNode {
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(25)
  const expanded = store.getSnapshot().expanded.has('system-details')
  const needle = query.trim().toLocaleLowerCase()
  const loaderInventory: readonly ClawdshLoaderEntry[] = Array.isArray(capabilities.loaderInventory)
    ? capabilities.loaderInventory
    : []
  const filtered = loaderInventory.filter(entry => needle === '' || [
    entry.entryId,
    entry.moduleName,
    entry.fiberPhase ?? '未观测',
    ORIGIN_LABEL[entry.source],
    entry.enabled ? '启用' : '关闭',
  ].some(value => value.toLocaleLowerCase().includes(needle)))
  const visible = filtered.slice(0, limit)
  const bodyId = 'clawdsh-system-details-body'
  const implementationCapabilities: ClawdshCapabilitiesResponse['capabilities'] = Array.isArray(capabilities.capabilities)
    ? capabilities.capabilities
    : []
  return (
    <section className={css.section} aria-labelledby="clawdsh-system-details-title">
      <div className={css.sectionHeading}>
        <div>
          <h2 id="clawdsh-system-details-title">系统与实现详情</h2>
          <p>Activity、package、Loader 和渠道目录仅用于诊断，不计入用户功能状态。</p>
        </div>
        <button
          type="button"
          className={css.sectionToggle}
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => { store.setExpanded('system-details', !expanded) }}
        >
          {expanded ? '收起' : '展开'}
        </button>
      </div>
      <div id={bodyId} className={css.systemDetailsBody} hidden={!expanded}>
        <div className={css.implementationGrid}>
          {implementationCapabilities.map(capability => <CapabilityImplementation key={capability.id} capability={capability} />)}
        </div>
        <div className={css.loaderHeading}>
          <div><h3>Loader 清单</h3><span>{String(loaderInventory.length)} 项</span></div>
          <label>筛选 Loader<input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(25) }} /></label>
        </div>
        <div className={css.tableWrap}>
          <table>
            <thead><tr><th>来源</th><th>模块</th><th>配置</th><th>Fiber</th></tr></thead>
            <tbody>
              {visible.map(entry => (
                <tr key={entry.entryId}>
                  <td>{ORIGIN_LABEL[entry.source]}</td>
                  <td><code title={entry.entryId}>{entry.moduleName}</code></td>
                  <td>{entry.enabled ? '启用' : '关闭'}</td>
                  <td>{entry.fiberPhase ?? '未观测'}</td>
                </tr>
              ))}
              {visible.length === 0 ? <tr><td colSpan={4} className={css.emptyTable}>没有匹配项。</td></tr> : null}
            </tbody>
          </table>
        </div>
        {visible.length < filtered.length ? (
          <button type="button" className={css.secondaryButton} onClick={() => { setLimit(value => value + 25) }}>
            显示更多（{visible.length}/{filtered.length}）
          </button>
        ) : null}
      </div>
    </section>
  )
}

/** Native ClawDSH settings section backed by a plugin-lifetime memory store. */
export function SettingsPage(props: SettingsPageProps): ReactNode {
  const [resolved] = useState<ResolvedStore>(() => props.store === undefined
    ? { store: new ClawdshSettingsStore(props.control, props.localControlAvailable), owned: true }
    : { store: props.store, owned: false })
  const store = resolved.store
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

  useEffect(() => {
    void store.ensureLoaded()
    return resolved.owned ? () => { store.dispose() } : undefined
  }, [resolved.owned, store])

  const presentation = useMemo(() => {
    if (snapshot.status !== 'ready' || snapshot.capabilities === undefined) return undefined
    return presentClawdshSettings({
      capabilities: snapshot.capabilities,
      namespaces: snapshot.namespaces.map(item => item.descriptor),
      credentials: snapshot.credentials.map(item => item.descriptor),
    })
  }, [snapshot])

  return (
    <div className={css.page}>
      <header className={css.header}>
        <h1>ClawDSH</h1>
        <p>个人助手功能、凭据和安全默认值。运行证据与配置状态分开显示。</p>
      </header>

      {snapshot.dirtyCount > 0 ? (
        <div className={css.dirtyNotice} role="status">
          有 {snapshot.dirtyCount} 项修改尚未保存；关闭或切换设置分区不会丢失草稿，刷新页面前浏览器会提醒。
        </div>
      ) : null}

      {snapshot.status === 'ready' && snapshot.message !== undefined ? (
        <div className={css.partialWarning} role="status">{snapshot.message}</div>
      ) : null}

      {snapshot.status === 'remote' ? (
        <div className={css.failure} role="status">
          <strong>ClawDSH 设置仅本机可用</strong>
          <span>远程页面仍可使用对话；请在运行 ClawDSH 的本机管理这些功能。</span>
        </div>
      ) : null}
      {snapshot.status === 'idle' || snapshot.status === 'loading' ? <p className={css.status}>正在读取设置与运行状态…</p> : null}
      {snapshot.status === 'failed' ? (
        <div className={css.failure} role="alert">
          <strong>暂时无法读取 ClawDSH 设置</strong>
          <span>{snapshot.message}</span>
          <button type="button" onClick={() => { void store.retry() }}>重试</button>
        </div>
      ) : null}

      {snapshot.status === 'ready' && presentation !== undefined && snapshot.capabilities !== undefined ? (
        <>
          <section className={css.section} aria-labelledby="clawdsh-feature-status-title">
            <div className={css.sectionHeading}>
              <div><h2 id="clawdsh-feature-status-title">功能状态</h2><p>“已启用”表示组件已装载且运行开关生效，不代表每次实际调用已验证；不主动执行远端探针。</p></div>
              <span className={css.summaryCount}>
                {presentation.counts.enabled} 项已启用 · {presentation.counts.disabled} 项未启用
                {presentation.counts.unknown === 0 ? '' : ` · ${String(presentation.counts.unknown)} 项状态未知`}
                {presentation.counts.reminders === 0 ? '' : ` · ${String(presentation.counts.reminders)} 个配置提醒`}
              </span>
            </div>
            <ul className={css.featureStatuses}>
              {presentation.features.map(feature => <FeatureStatusCard key={feature.id} feature={feature} />)}
            </ul>
          </section>

          <section className={css.section} aria-labelledby="clawdsh-feature-config-title">
            <div className={css.sectionHeading}>
              <div><h2 id="clawdsh-feature-config-title">功能配置</h2><p>设置按用户功能组织；保存仍以 namespace revision 原子提交。</p></div>
              <span className={css.summaryCount}>5 项功能配置</span>
            </div>
            <div className={css.featureConfigList}>
              {FEATURE_CONFIGS.map(config => (
                <FeatureConfiguration
                  key={config.id}
                  config={config}
                  namespaces={snapshot.namespaces}
                  credentials={snapshot.credentials}
                  store={store}
                />
              ))}
            </div>
          </section>

          <SystemDetails capabilities={snapshot.capabilities} store={store} />
        </>
      ) : null}
    </div>
  )
}
