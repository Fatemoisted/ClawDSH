import { useEffect, useState, type ReactNode } from 'react'
import type { ClawdshCapabilitiesResponse } from '../../../shared/src/protocol.ts'
import {
  EFFECT_TIME_LABEL,
  LOADER_STATE_LABEL,
  ORIGIN_LABEL,
  SUPPORT_LABEL,
} from '../capabilities.ts'
import css from './SettingsPage.module.css'

/** Async source for the sanitized ClawDSH capability projection. */
export type CapabilitiesLoader = () => Promise<ClawdshCapabilitiesResponse>

interface SettingsPageProps {
  readonly loadCapabilities: CapabilitiesLoader
  readonly localControlAvailable: boolean
}

type CapabilitiesState =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'ready'; readonly snapshot: ClawdshCapabilitiesResponse }

/** Read-only ClawDSH capability and Loader overview. */
export function SettingsPage({ loadCapabilities, localControlAvailable }: SettingsPageProps): ReactNode {
  const [request, setRequest] = useState(0)
  const [capabilities, setCapabilities] = useState<CapabilitiesState>({ status: 'loading' })

  useEffect(() => {
    if (!localControlAvailable) return
    let current = true
    void loadCapabilities().then(
      (snapshot) => { if (current) setCapabilities({ status: 'ready', snapshot }) },
      (reason: unknown) => {
        if (!current) return
        setCapabilities({
          status: 'failed',
          message: reason instanceof Error ? reason.message : String(reason),
        })
      },
    )
    return () => { current = false }
  }, [loadCapabilities, localControlAvailable, request])

  return (
    <div className={css.page}>
      <header className={css.header}>
        <p className={css.eyebrow}>本地产品控制面</p>
        <h1>ClawDSH 设置</h1>
        <p>查看 ClawDSH 能力、依赖与当前运行状态。可编辑设置将在下一阶段开放。</p>
      </header>

      <section className={css.section} aria-labelledby="clawdsh-overview-title">
        <div className={css.sectionHeading}>
          <div>
            <h2 id="clawdsh-overview-title">ClawDSH 总览</h2>
            <p>这些能力由 ClawDSH Host 控制面统一描述，与 DeepSeek Harness 平台插件分层展示。</p>
          </div>
          {capabilities.status === 'ready' ? (
            <span className={css.count}>
              {capabilities.snapshot.capabilities.filter(item => item.state === 'active').length}/
              {capabilities.snapshot.capabilities.length} 运行中
            </span>
          ) : null}
        </div>

        {!localControlAvailable ? (
          <div className={css.failure} role="status">
            <strong>ClawDSH 设置仅本机可用</strong>
            <span>远程页面仍可使用对话；请在运行 ClawDSH 的本机打开此页面管理产品能力。</span>
          </div>
        ) : null}
        {localControlAvailable && capabilities.status === 'loading' ? <p className={css.status}>正在读取运行状态…</p> : null}
        {localControlAvailable && capabilities.status === 'failed' ? (
          <div className={css.failure} role="alert">
            <strong>暂时无法读取 ClawDSH 状态</strong>
            <span>{capabilities.message}</span>
            <button
              type="button"
              onClick={() => {
                setCapabilities({ status: 'loading' })
                setRequest(value => value + 1)
              }}
            >
              重试
            </button>
          </div>
        ) : null}
        {localControlAvailable && capabilities.status === 'ready' ? (
          <ul className={css.capabilities}>
            {capabilities.snapshot.capabilities.map(capability => (
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
                  <div>
                    <dt>生效</dt>
                    <dd>{EFFECT_TIME_LABEL[capability.effectTime]}</dd>
                  </div>
                  <div>
                    <dt>依赖</dt>
                    <dd>{capability.dependencies.length === 0 ? '无' : capability.dependencies.join(' · ')}</dd>
                  </div>
                </dl>
                <ul className={css.components} aria-label={`${capability.label} 组件`}>
                  {capability.components.map(component => (
                    <li key={component.id}>
                      <span>
                        <strong>{component.label}</strong>
                        <small>{component.packages.join(' · ')}</small>
                        <small>状态来源：{component.stateSource === 'preset' ? 'Preset' : 'Loader'}</small>
                      </span>
                      <span className={css.state} data-state={component.state}>
                        {LOADER_STATE_LABEL[component.state]}
                      </span>
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
        ) : null}
      </section>

      {localControlAvailable && capabilities.status === 'ready' ? (
        <section className={css.section} aria-labelledby="loader-inventory-title">
          <div className={css.sectionHeading}>
            <div>
              <h2 id="loader-inventory-title">Loader 清单</h2>
              <p>只读展示 Host 返回的完整 Loader 状态，不在浏览器中推断产品所有权。</p>
            </div>
            <span className={css.count}>{capabilities.snapshot.loaderInventory.length} 项</span>
          </div>
          <div className={css.tableWrap}>
            <table>
              <thead><tr><th>来源</th><th>模块</th><th>配置</th><th>Fiber</th></tr></thead>
              <tbody>
                {capabilities.snapshot.loaderInventory.map(entry => (
                  <tr key={entry.entryId}>
                    <td>
                      <span className={css.origin} data-origin={ORIGIN_LABEL[entry.source]}>
                        {ORIGIN_LABEL[entry.source]}
                      </span>
                    </td>
                    <td><code title={entry.entryId}>{entry.moduleName}</code></td>
                    <td>{entry.enabled ? '启用' : '关闭'}</td>
                    <td>{entry.fiberPhase ?? '未观测'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  )
}
