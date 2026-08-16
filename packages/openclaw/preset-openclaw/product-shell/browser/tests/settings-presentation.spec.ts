import { describe, expect, it } from 'vitest'
import type {
  ClawdshCapability,
  ClawdshCapabilityComponent,
  ClawdshSettingsNamespaceDescriptor,
} from '../../shared/src/protocol.ts'
import { presentClawdshSettings } from '../src/settings-presentation.ts'
import { CAPABILITIES_FIXTURE, CREDENTIALS_FIXTURE, SETTINGS_FIXTURE } from './fixtures.ts'

function component(
  id: string,
  state: ClawdshCapabilityComponent['state'],
  stateSource: ClawdshCapabilityComponent['stateSource'] = 'loader',
): ClawdshCapabilityComponent {
  return {
    id,
    label: id,
    packages: [`@clawdsh/${id}`],
    required: false,
    stateSource,
    loaderEntries: stateSource === 'preset' ? [] : [{
      entryId: id,
      localId: id,
      moduleName: `@clawdsh/${id}`,
      enabled: state !== 'disabled',
      fiberPhase: state === 'active' ? 'active' : null,
      state,
      source: 'clawdsh',
    }],
    state,
  }
}

function capability(
  id: string,
  components: readonly ClawdshCapabilityComponent[],
): ClawdshCapability {
  return {
    id,
    label: id,
    description: id,
    dependencies: [],
    effectTime: id === 'soul' ? 'new-session' : 'restart',
    required: false,
    state: components[components.length - 1]?.state ?? 'misconfigured',
    components,
  }
}

function descriptor(
  namespace: string,
  capabilityId: string,
  value: Record<string, unknown>,
  restartRequired = false,
): ClawdshSettingsNamespaceDescriptor {
  return {
    ...SETTINGS_FIXTURE.namespaces[0]!,
    namespace,
    capabilityId,
    label: namespace,
    value,
    base: value,
    restartRequired,
  }
}

function automationRule(id: string, enabled: boolean): Record<string, unknown> {
  return {
    id,
    name: '',
    schedule: { kind: 'every', seconds: 60 },
    message: `${id} task`,
    enabled,
  }
}

function defaults() {
  const capabilities = {
    ...CAPABILITIES_FIXTURE,
    capabilities: [
      capability('soul', [component('soul', 'active', 'preset')]),
      capability('memory', [component('memory', 'active'), component('ark-embeddings', 'active')]),
      capability('skills', [component('skills-hub', 'active')]),
      {
        ...capability('channels', [
          component('channel-protocol', 'active'),
          component('agent-bridge', 'active'),
          component('openclaw-gateway-provider', 'disabled'),
        ]),
        channels: [{ id: 'feishu', label: '飞书', provenance: 'bundled' as const, support: 'cataloged' as const }],
      },
      capability('automation', [component('automation', 'disabled')]),
      capability('activity', [component('activity', 'active')]),
    ],
  }
  const namespaces = [
    descriptor('clawdsh-soul', 'soul', { enabled: true }),
    descriptor('clawdsh-memory', 'memory', { enabled: true }),
    descriptor('clawdsh-embeddings-ark', 'memory', {}),
    descriptor('clawdsh-skills-hub', 'skills', { enabled: true }),
    descriptor('clawdsh-channel-openclaw', 'channels', { enabled: false }),
    descriptor('clawdsh-automation', 'automation', { enabled: false, rules: [] }),
    descriptor('clawdsh-activity', 'activity', { enabled: true }),
  ]
  return { capabilities, namespaces, credentials: CREDENTIALS_FIXTURE.credentials }
}

describe('ClawDSH settings presentation', () => {
  it('describes safe defaults without counting Activity as a user feature', () => {
    const value = presentClawdshSettings(defaults())

    expect(value.counts).toEqual({ enabled: 3, disabled: 2, unknown: 0, reminders: 1 })
    expect(value.features.map(feature => feature.id)).toEqual([
      'soul', 'memory', 'skills', 'channels', 'automation',
    ])
    expect(value.features.find(feature => feature.id === 'soul')).toMatchObject({
      primary: '新会话启用', detail: '修改只影响后续新会话。',
    })
    expect(value.features.find(feature => feature.id === 'memory')).toMatchObject({
      primary: '已启用', configurationReminder: true,
    })
    expect(value.features.find(feature => feature.id === 'memory')?.detail).toContain('语义搜索待配置')
    expect(value.features.find(feature => feature.id === 'skills')).toMatchObject({
      primary: '来源已启用',
    })
    expect(value.features.find(feature => feature.id === 'skills')?.detail).toContain('是否从该来源发现 Skill')
    expect(value.features.find(feature => feature.id === 'channels')).toMatchObject({
      primary: '尚未连接平台', enabled: false,
    })
    expect(value.features.find(feature => feature.id === 'automation')).toMatchObject({
      primary: '尚未设置', detail: '还没有创建自动任务；这不影响正常对话。',
    })
  })

  it('calls an Ark key configured without claiming remote availability', () => {
    const input = defaults()
    const value = presentClawdshSettings({
      ...input,
      credentials: [{ ...CREDENTIALS_FIXTURE.credentials[0]!, configured: true }],
    })
    expect(value.features.find(feature => feature.id === 'memory')).toMatchObject({
      detail: '长期记忆工具已加载，本地存储和语义搜索都会在首次使用时验证。',
      configured: true,
      verified: false,
      configurationReminder: false,
    })
  })

  it('keeps an active Gateway unverified without enabled-channel evidence', () => {
    const input = defaults()
    const channels = input.capabilities.capabilities.find(item => item.id === 'channels')!
    const value = presentClawdshSettings({
      ...input,
      capabilities: {
        ...input.capabilities,
        capabilities: input.capabilities.capabilities.map(item => item.id === 'channels' ? {
          ...channels,
          state: 'active',
          components: channels.components.map(item => item.id === 'openclaw-gateway-provider'
            ? component(item.id, 'active')
            : item),
        } : item),
      },
    })
    expect(value.features.find(feature => feature.id === 'channels')).toMatchObject({
      primary: 'Gateway 已启动，平台连接未验证',
      enabled: true,
      verified: false,
      configurationReminder: true,
    })
  })

  it('degrades aggregate and required-component failures instead of reporting a feature as enabled', () => {
    const input = defaults()
    const soul = input.capabilities.capabilities.find(item => item.id === 'soul')!
    const memory = input.capabilities.capabilities.find(item => item.id === 'memory')!
    const channels = input.capabilities.capabilities.find(item => item.id === 'channels')!
    const value = presentClawdshSettings({
      ...input,
      credentials: [{ ...CREDENTIALS_FIXTURE.credentials[0]!, configured: true }],
      capabilities: {
        ...input.capabilities,
        capabilities: input.capabilities.capabilities.map((item) => {
          if (item.id === 'soul') return { ...soul, state: 'failed' as const }
          if (item.id === 'memory') return { ...memory, state: 'failed' as const }
          if (item.id === 'channels') return {
            ...channels,
            state: 'active' as const,
            components: channels.components.map(unit => unit.id === 'agent-bridge'
              ? component(unit.id, 'failed')
              : unit.id === 'openclaw-gateway-provider' ? component(unit.id, 'active') : unit),
          }
          return item
        }),
      },
    })

    expect(value.features.find(feature => feature.id === 'soul')).toMatchObject({
      primary: '运行异常', enabled: undefined, tone: 'negative',
    })
    expect(value.features.find(feature => feature.id === 'memory')).toMatchObject({
      primary: '运行异常', enabled: undefined, tone: 'negative',
    })
    expect(value.features.find(feature => feature.id === 'channels')).toMatchObject({
      primary: '运行异常', enabled: undefined, tone: 'negative',
    })
    expect(value.counts.enabled).toBe(1)
    expect(value.counts.unknown).toBe(3)
  })

  it('distinguishes Automation rule states and pending restart direction', () => {
    const input = defaults()
    const activeAutomation = capability('automation', [component('automation', 'active')])
    const replace = (value: Record<string, unknown>, restartRequired = false) => presentClawdshSettings({
      ...input,
      capabilities: {
        ...input.capabilities,
        capabilities: input.capabilities.capabilities.map(item => item.id === 'automation' ? activeAutomation : item),
      },
      namespaces: input.namespaces.map(item => item.namespace === 'clawdsh-automation'
        ? descriptor('clawdsh-automation', 'automation', value, restartRequired)
        : item),
    }).features.find(feature => feature.id === 'automation')

    expect(replace({ enabled: true, rules: [automationRule('off', false)] })).toMatchObject({
      primary: '已开启，但没有运行任务', enabled: true, configurationReminder: true,
    })
    expect(replace({ enabled: true, rules: [automationRule('daily', true)] })).toMatchObject({
      primary: '已开启', enabled: true,
    })
    expect(replace({ enabled: false, rules: [] }, true)).toMatchObject({
      primary: '等待重启',
      enabled: true,
      restartNotice: '重启后关闭',
    })
    expect(replace({ enabled: true, rules: [automationRule('replacement', true)] }, true)).toMatchObject({
      primary: '等待重启',
      enabled: true,
      restartNotice: '重启后应用修改',
    })
    expect(replace({ enabled: false, rules: [] }, true)?.detail).toContain('重启前仍按原有任务运行')
    expect(replace({ enabled: false, rules: [] }, true)?.detail).not.toContain('不影响正常对话')
  })

  it('uses a generic restart notice when enabled state is not changing', () => {
    const input = defaults()
    const value = presentClawdshSettings({
      ...input,
      namespaces: input.namespaces.map(item => item.namespace === 'clawdsh-memory'
        ? descriptor('clawdsh-memory', 'memory', { enabled: true, maxResults: 8 }, true)
        : item),
    })

    expect(value.features.find(feature => feature.id === 'memory')).toMatchObject({
      primary: '已启用',
      restartNotice: '重启后应用修改',
    })
  })

  it('degrades malformed Automation rules to unknown', () => {
    const input = defaults()
    const activeAutomation = capability('automation', [component('automation', 'active')])
    const value = presentClawdshSettings({
      ...input,
      capabilities: {
        ...input.capabilities,
        capabilities: input.capabilities.capabilities.map(item => item.id === 'automation'
          ? activeAutomation
          : item),
      },
      namespaces: input.namespaces.map(item => item.namespace === 'clawdsh-automation'
        ? descriptor('clawdsh-automation', 'automation', { enabled: true, rules: [null] })
        : item),
    })

    expect(value.features.find(feature => feature.id === 'automation')).toMatchObject({
      primary: '状态未知', enabled: undefined, tone: 'unknown',
    })
  })

  it('degrades missing evidence to an unknown row instead of throwing', () => {
    const input = defaults()
    const value = presentClawdshSettings({
      ...input,
      capabilities: { ...input.capabilities, capabilities: [] },
    })
    expect(value.features.every(feature => feature.primary === '状态未知')).toBe(true)
    expect(value.counts.unknown).toBe(5)
  })

  it('contains malformed component evidence to its feature row', () => {
    const input = defaults()
    const value = presentClawdshSettings({
      ...input,
      capabilities: {
        ...input.capabilities,
        capabilities: input.capabilities.capabilities.map(item => item.id === 'memory'
          ? { ...item, components: null } as unknown as ClawdshCapability
          : item),
      },
    })

    expect(value.features.find(feature => feature.id === 'memory')).toMatchObject({
      primary: '状态未知', enabled: undefined,
    })
    expect(value.features.find(feature => feature.id === 'soul')?.primary).toBe('新会话启用')
  })
})
