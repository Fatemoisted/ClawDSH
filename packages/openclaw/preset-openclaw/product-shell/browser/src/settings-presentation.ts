import type {
  ClawdshCapabilitiesResponse,
  ClawdshCapability,
  ClawdshCapabilityComponent,
  ClawdshCredentialDescriptor,
  ClawdshLoaderState,
  ClawdshSettingsNamespaceDescriptor,
} from '../../shared/src/protocol.ts'

/** Stable user-facing ClawDSH capability ids and display order. */
export type ClawdshFeatureId = 'soul' | 'memory' | 'skills' | 'channels' | 'automation'

/** Runtime-oriented status presentation for one user-facing feature. */
export interface ClawdshFeaturePresentation {
  readonly id: ClawdshFeatureId
  readonly label: string
  readonly primary: string
  readonly detail: string
  readonly tone: 'positive' | 'neutral' | 'warning' | 'negative' | 'unknown'
  readonly enabled: boolean | undefined
  readonly mounted: boolean | undefined
  readonly configured: boolean | undefined
  readonly verified: boolean
  readonly configurationReminder: boolean
  readonly restartNotice: string | undefined
}

/** Summary counts derived only from the five user-facing features. */
export interface ClawdshFeatureCounts {
  readonly enabled: number
  readonly disabled: number
  readonly unknown: number
  readonly reminders: number
}

/** Pure presentation input assembled from the three v1 read endpoints. */
export interface ClawdshSettingsPresentationInput {
  readonly capabilities: ClawdshCapabilitiesResponse
  readonly namespaces: readonly ClawdshSettingsNamespaceDescriptor[]
  readonly credentials: readonly ClawdshCredentialDescriptor[]
}

/** Complete presentation projection for the settings UI. */
export interface ClawdshSettingsPresentation {
  readonly features: readonly ClawdshFeaturePresentation[]
  readonly counts: ClawdshFeatureCounts
}

const FEATURE_LABEL: Readonly<Record<ClawdshFeatureId, string>> = {
  soul: 'Soul',
  memory: 'Memory',
  skills: 'Skills Hub',
  channels: 'Channels',
  automation: '自动任务',
}

const FEATURE_ORDER: readonly ClawdshFeatureId[] = [
  'soul',
  'memory',
  'skills',
  'channels',
  'automation',
]

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function enabledValue(descriptor: ClawdshSettingsNamespaceDescriptor | undefined): boolean | undefined {
  const value = record(descriptor?.value)
  return typeof value?.enabled === 'boolean' ? value.enabled : undefined
}

function namespace(
  input: ClawdshSettingsPresentationInput,
  id: string,
): ClawdshSettingsNamespaceDescriptor | undefined {
  return Array.isArray(input.namespaces)
    ? input.namespaces.find(candidate => candidate?.namespace === id)
    : undefined
}

function credential(
  input: ClawdshSettingsPresentationInput,
  id: string,
): ClawdshCredentialDescriptor | undefined {
  return Array.isArray(input.credentials)
    ? input.credentials.find(candidate => candidate?.id === id)
    : undefined
}

function capability(
  input: ClawdshSettingsPresentationInput,
  id: string,
): ClawdshCapability | undefined {
  const capabilities = input.capabilities?.capabilities
  return Array.isArray(capabilities)
    ? capabilities.find(candidate => candidate?.id === id)
    : undefined
}

function component(
  capabilityValue: ClawdshCapability | undefined,
  id: string,
): ClawdshCapabilityComponent | undefined {
  return Array.isArray(capabilityValue?.components)
    ? capabilityValue.components.find(candidate => candidate?.id === id)
    : undefined
}

function mounted(componentValue: ClawdshCapabilityComponent | undefined): boolean | undefined {
  if (componentValue === undefined) return undefined
  if (componentValue.stateSource === 'preset') return componentValue.state !== 'misconfigured'
  if (!Array.isArray(componentValue.loaderEntries)) return undefined
  return componentValue.loaderEntries.length > 0
}

function restartNotice(
  descriptor: ClawdshSettingsNamespaceDescriptor | undefined,
  runtimeEnabled?: boolean,
): string | undefined {
  if (descriptor?.restartRequired !== true) return undefined
  const desired = enabledValue(descriptor)
  if (runtimeEnabled === false && desired === true) return '重启后启用'
  if (runtimeEnabled === true && desired === false) return '重启后关闭'
  return '重启后应用修改'
}

function unknownFeature(id: ClawdshFeatureId): ClawdshFeaturePresentation {
  return {
    id,
    label: FEATURE_LABEL[id],
    primary: '状态未知',
    detail: '暂时没有足够的运行证据。',
    tone: 'unknown',
    enabled: undefined,
    mounted: undefined,
    configured: undefined,
    verified: false,
    configurationReminder: false,
    restartNotice: undefined,
  }
}

function abnormal(
  id: ClawdshFeatureId,
  state: ClawdshLoaderState,
  componentValue: ClawdshCapabilityComponent | undefined,
  descriptor?: ClawdshSettingsNamespaceDescriptor,
): ClawdshFeaturePresentation {
  if (state === 'failed') {
    return {
      ...unknownFeature(id),
      primary: '运行异常',
      detail: '组件已装载，但最近一次启动失败。',
      tone: 'negative',
      mounted: mounted(componentValue),
      restartNotice: restartNotice(descriptor),
    }
  }
  if (state === 'starting') {
    return {
      ...unknownFeature(id),
      primary: '正在启动',
      detail: '运行状态尚未稳定。',
      tone: 'neutral',
      mounted: mounted(componentValue),
      restartNotice: restartNotice(descriptor),
    }
  }
  if (state === 'misconfigured') {
    return {
      ...unknownFeature(id),
      primary: '状态未知',
      detail: '装载或配置证据不完整。',
      tone: 'warning',
      mounted: mounted(componentValue),
      configurationReminder: true,
      restartNotice: restartNotice(descriptor),
    }
  }
  return unknownFeature(id)
}

interface CapabilityIssue {
  readonly state: ClawdshLoaderState
  readonly component: ClawdshCapabilityComponent
}

function issueState(state: ClawdshLoaderState): ClawdshLoaderState | undefined {
  if (state === 'active') return undefined
  return state === 'disabled' ? 'misconfigured' : state
}

function capabilityIssue(
  capabilityValue: ClawdshCapability,
  stateComponent: ClawdshCapabilityComponent,
  requiredComponents: readonly ClawdshCapabilityComponent[],
): CapabilityIssue | undefined {
  if (capabilityValue.state !== 'active' && capabilityValue.state !== 'disabled') {
    return {
      state: capabilityValue.state,
      component: capabilityValue.components.find(candidate => candidate.state === capabilityValue.state)
        ?? stateComponent,
    }
  }
  if (capabilityValue.state === 'disabled') return undefined
  for (const required of requiredComponents) {
    const state = issueState(required.state)
    if (state !== undefined) return { state, component: required }
  }
  const state = issueState(stateComponent.state)
  return state === undefined ? undefined : { state, component: stateComponent }
}

function soul(input: ClawdshSettingsPresentationInput): ClawdshFeaturePresentation {
  const cap = capability(input, 'soul')
  const unit = component(cap, 'soul')
  const descriptor = namespace(input, 'clawdsh-soul')
  if (cap === undefined || unit === undefined) return unknownFeature('soul')
  const issue = capabilityIssue(cap, unit, [])
  if (issue !== undefined) return abnormal('soul', issue.state, issue.component, descriptor)
  const active = cap.state === 'active'
  return {
    id: 'soul',
    label: FEATURE_LABEL.soul,
    primary: active ? '新会话启用' : '未启用',
    detail: active ? '修改只影响后续新会话。' : '后续新会话不会注入 Soul。',
    tone: active ? 'positive' : 'neutral',
    enabled: active,
    mounted: mounted(unit),
    configured: enabledValue(descriptor),
    verified: false,
    configurationReminder: false,
    restartNotice: undefined,
  }
}

function memory(input: ClawdshSettingsPresentationInput): ClawdshFeaturePresentation {
  const cap = capability(input, 'memory')
  const unit = component(cap, 'memory')
  const arkUnit = component(cap, 'ark-embeddings')
  const descriptor = namespace(input, 'clawdsh-memory')
  if (cap === undefined || unit === undefined || arkUnit === undefined) return unknownFeature('memory')
  const issue = capabilityIssue(cap, unit, [arkUnit])
  if (issue !== undefined) return abnormal('memory', issue.state, issue.component, descriptor)
  const active = cap.state === 'active'
  const ark = credential(input, 'ark-api-key')
  const arkKnown = ark !== undefined && typeof ark.configured === 'boolean'
  const arkConfigured = ark?.configured === true
  const semantic = arkConfigured
    ? '长期记忆工具已加载，本地存储和语义搜索都会在首次使用时验证。'
    : arkKnown
      ? '长期记忆工具已加载，本地存储会在首次读写时验证；语义搜索待配置。'
      : '长期记忆工具已加载；本地存储和语义搜索的可用性尚未验证。'
  return {
    id: 'memory',
    label: FEATURE_LABEL.memory,
    primary: active ? '已启用' : '未启用',
    detail: active ? semantic : 'Memory 读取、写回和语义搜索均未运行。',
    tone: active ? (arkKnown && !arkConfigured ? 'warning' : 'positive') : 'neutral',
    enabled: active,
    mounted: mounted(unit),
    configured: arkKnown ? arkConfigured : undefined,
    verified: false,
    configurationReminder: active && arkKnown && !arkConfigured,
    restartNotice: restartNotice(descriptor, active),
  }
}

function skills(input: ClawdshSettingsPresentationInput): ClawdshFeaturePresentation {
  const cap = capability(input, 'skills')
  const unit = component(cap, 'skills-hub')
  const descriptor = namespace(input, 'clawdsh-skills-hub')
  if (cap === undefined || unit === undefined) return unknownFeature('skills')
  const issue = capabilityIssue(cap, unit, [])
  if (issue !== undefined) return abnormal('skills', issue.state, issue.component, descriptor)
  const active = cap.state === 'active'
  return {
    id: 'skills',
    label: FEATURE_LABEL.skills,
    primary: active ? '来源已启用' : '未启用',
    detail: active
      ? '已启用 ClawHub 兼容目录来源；是否从该来源发现 Skill 会在实际目录扫描时确认。'
      : 'ClawHub 兼容目录不会加入当前运行环境。',
    tone: active ? 'positive' : 'neutral',
    enabled: active,
    mounted: mounted(unit),
    configured: enabledValue(descriptor),
    verified: false,
    configurationReminder: false,
    restartNotice: restartNotice(descriptor, active),
  }
}

function channels(input: ClawdshSettingsPresentationInput): ClawdshFeaturePresentation {
  const cap = capability(input, 'channels')
  const protocol = component(cap, 'channel-protocol')
  const bridge = component(cap, 'agent-bridge')
  const gateway = component(cap, 'openclaw-gateway-provider')
  const descriptor = namespace(input, 'clawdsh-channel-openclaw')
  if (cap === undefined || protocol === undefined || bridge === undefined || gateway === undefined) {
    return unknownFeature('channels')
  }
  const issue = capabilityIssue(cap, gateway, [protocol, bridge])
  if (issue !== undefined) return abnormal('channels', issue.state, issue.component, descriptor)
  const foundationsReady = protocol.state === 'active' && bridge.state === 'active'
  const active = cap.state === 'active'
  if (!active) {
    return {
      id: 'channels',
      label: FEATURE_LABEL.channels,
      primary: '尚未连接平台',
      detail: foundationsReady
        ? 'Protocol 与 Agent Bridge 就绪；Gateway 为避免未授权外联而未启用。'
        : 'Gateway 未启用，基础通信组件状态也不完整。',
      tone: foundationsReady ? 'neutral' : 'warning',
      enabled: false,
      mounted: mounted(gateway),
      configured: enabledValue(descriptor),
      verified: false,
      configurationReminder: false,
      restartNotice: restartNotice(descriptor, false),
    }
  }
  const enabledChannels = Array.isArray(cap?.channels)
    ? cap.channels.filter(channel => channel?.support === 'enabled').length
    : 0
  return {
    id: 'channels',
    label: FEATURE_LABEL.channels,
    primary: enabledChannels > 0 ? `已启用 ${String(enabledChannels)} 个平台` : 'Gateway 已启动，平台连接未验证',
    detail: enabledChannels > 0
      ? 'Gateway 正在运行；平台是否完成真实收发仍以 ClawDSH 记录为准。'
      : '尚无已启用渠道的运行证据。',
    tone: enabledChannels > 0 ? 'positive' : 'warning',
    enabled: true,
    mounted: mounted(gateway),
    configured: enabledValue(descriptor),
    verified: false,
    configurationReminder: enabledChannels === 0,
    restartNotice: restartNotice(descriptor, true),
  }
}

function rules(value: unknown): readonly Record<string, unknown>[] | undefined {
  const list = record(value)?.rules
  if (!Array.isArray(list)) return undefined
  const result: Record<string, unknown>[] = []
  for (const candidate of list) {
    const item = record(candidate)
    if (item === undefined || typeof item.enabled !== 'boolean') return undefined
    result.push(item)
  }
  return result
}

function automation(input: ClawdshSettingsPresentationInput): ClawdshFeaturePresentation {
  const cap = capability(input, 'automation')
  const unit = component(cap, 'automation')
  const descriptor = namespace(input, 'clawdsh-automation')
  if (cap === undefined || unit === undefined || descriptor === undefined) return unknownFeature('automation')
  const issue = capabilityIssue(cap, unit, [])
  if (issue !== undefined) return abnormal('automation', issue.state, issue.component, descriptor)
  const configuredRules = rules(descriptor.value)
  const desiredEnabled = enabledValue(descriptor)
  if (configuredRules === undefined || desiredEnabled === undefined) return unknownFeature('automation')
  const runnableRules = configuredRules.filter(rule => rule.enabled !== false).length
  const active = cap.state === 'active'
  if (descriptor.restartRequired) {
    let detail = active
      ? '当前已启用自动任务；重启前仍按原有任务运行。'
      : '当前没有运行自动任务。'
    if (!desiredEnabled) detail += '重启后将暂停所有自动任务。'
    else if (runnableRules === 0) detail += '重启后仍没有已启用的任务。'
    else detail += `重启后将有 ${String(runnableRules)} 个任务可按设定时间运行。`
    return {
      id: 'automation',
      label: FEATURE_LABEL.automation,
      primary: '等待重启',
      detail,
      tone: 'warning',
      enabled: active,
      mounted: mounted(unit),
      configured: configuredRules.length > 0,
      verified: false,
      configurationReminder: desiredEnabled && runnableRules === 0,
      restartNotice: restartNotice(descriptor, active),
    }
  }
  if (desiredEnabled !== active) return unknownFeature('automation')
  let detail: string
  if (configuredRules.length === 0) {
    detail = '还没有创建自动任务；这不影响正常对话。'
  } else if (!active) {
    detail = `已保存 ${String(configuredRules.length)} 个任务，但自动运行已暂停。`
  } else if (runnableRules === 0) {
    detail = '自动运行已开启，但所有任务都处于暂停状态。'
  } else {
    detail = `${String(runnableRules)} 个任务会按各自设定的时间运行。`
  }
  return {
    id: 'automation',
    label: FEATURE_LABEL.automation,
    primary: active ? (runnableRules === 0 ? '已开启，但没有运行任务' : '已开启') : (configuredRules.length === 0 ? '尚未设置' : '已暂停'),
    detail,
    tone: active && runnableRules > 0 ? 'positive' : active ? 'warning' : 'neutral',
    enabled: active,
    mounted: mounted(unit),
    configured: configuredRules.length > 0,
    verified: false,
    configurationReminder: active && runnableRules === 0,
    restartNotice: undefined,
  }
}

/**
 * Combine Loader, settings, and credential evidence without claiming remote readiness.
 * @param input - v1 responses already accepted by the browser control client.
 * @returns five feature rows plus user-facing counts.
 */
export function presentClawdshSettings(input: ClawdshSettingsPresentationInput): ClawdshSettingsPresentation {
  const safe = (
    id: ClawdshFeatureId,
    project: (value: ClawdshSettingsPresentationInput) => ClawdshFeaturePresentation,
  ): ClawdshFeaturePresentation => {
    try {
      return project(input)
    } catch {
      return unknownFeature(id)
    }
  }
  const byId: Readonly<Record<ClawdshFeatureId, ClawdshFeaturePresentation>> = {
    soul: safe('soul', soul),
    memory: safe('memory', memory),
    skills: safe('skills', skills),
    channels: safe('channels', channels),
    automation: safe('automation', automation),
  }
  const features = FEATURE_ORDER.map(id => byId[id])
  return {
    features,
    counts: {
      enabled: features.filter(feature => feature.enabled === true).length,
      disabled: features.filter(feature => feature.enabled === false).length,
      unknown: features.filter(feature => feature.enabled === undefined).length,
      reminders: features.filter(feature => feature.configurationReminder).length,
    },
  }
}
