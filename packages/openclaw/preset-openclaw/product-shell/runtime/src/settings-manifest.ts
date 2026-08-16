import type {
  ClawdshEffectTime,
  ClawdshSettingsEditor,
  ClawdshSettingsFieldPermission,
} from '../../shared/src/protocol.ts'

/** Server-owned product metadata and exact field allowlist for one namespace. */
export interface ClawdshSettingsManifestEntry {
  readonly namespace: string
  readonly capabilityId: string
  readonly label: string
  readonly description: string
  readonly editor: ClawdshSettingsEditor
  readonly effectTime: ClawdshEffectTime
  readonly fields: readonly ClawdshSettingsFieldPermission[]
}

const editable = (
  path: readonly string[],
  label: string,
  description?: string,
): ClawdshSettingsFieldPermission => ({
  path,
  label,
  ...(description === undefined ? {} : { description }),
  access: 'editable',
})

const managed = (
  path: readonly string[],
  label: string,
  description?: string,
): ClawdshSettingsFieldPermission => ({
  path,
  label,
  ...(description === undefined ? {} : { description }),
  access: 'managed',
})

/** Ordered product manifest; the browser cannot add namespaces or writable paths. */
export const SETTINGS_MANIFEST: readonly ClawdshSettingsManifestEntry[] = [
  {
    namespace: 'clawdsh-soul',
    capabilityId: 'soul',
    label: 'Soul',
    description: '配置 ClawDSH 对新会话贡献的身份与行为规则。',
    editor: 'generic',
    effectTime: 'new-session',
    fields: [
      editable(['enabled'], '启用 Soul'),
      editable(['source'], 'Soul 文件'),
      editable(['text'], '内联 Soul'),
      editable(['mode'], '贡献方式'),
      editable(['includeRuntimeContext'], '包含运行时上下文'),
    ],
  },
  {
    namespace: 'clawdsh-channel-agent',
    capabilityId: 'channels',
    label: 'Agent Bridge',
    description: '查看渠道会话归属，并配置安全关停策略。',
    editor: 'generic',
    effectTime: 'restart',
    fields: [
      managed(['ownerPreset'], 'Owner Preset', '固定为 clawdsh。'),
      managed(['safePreset'], 'Safe Preset', '固定为 clawdsh-messaging-safe。'),
      managed(['cwd'], '渠道工作目录', '由当前 ClawDSH 安装管理；新渠道会话使用当前值，已有会话保留创建时的工作目录。'),
      managed(['stagingRoot'], '媒体暂存目录'),
      managed(['maxMediaBytes'], '媒体大小上限'),
      editable(['shutdownGraceMs'], '关停等待时间'),
    ],
  },
  {
    namespace: 'clawdsh-channel-openclaw',
    capabilityId: 'channels',
    label: 'OpenClaw Gateway',
    description: '管理锁定的 OpenClaw Gateway 部署；平台账号与凭据始终由 OpenClaw 独占。',
    editor: 'gateway-deployment',
    effectTime: 'restart',
    fields: [
      editable(['enabled'], '启用 Gateway'),
      managed(['track'], '发行轨道'),
      managed(['gatewayInstanceId'], 'Gateway 实例'),
      managed(['artifactPath'], 'Artifact'),
      managed(['hostRoot'], 'Host 根目录'),
      managed(['runtimeRoot'], 'Runtime 根目录'),
      managed(['extensions'], '锁定 Extensions'),
      managed(['nodePath'], 'Node Runtime'),
      managed(['configPath'], 'OpenClaw 配置'),
      managed(['stateDir'], 'OpenClaw 状态目录'),
      managed(['stagingRoot'], '媒体暂存目录'),
      managed(['maxMediaBytes'], '媒体大小上限'),
      managed(['endpoint'], 'Bridge Socket'),
      editable(['gatewayPort'], 'Gateway 端口'),
      editable(['maxFrameBytes'], '最大帧大小'),
      editable(['maxInFlight'], '最大并发请求'),
      editable(['requestTimeoutMs'], '请求超时'),
      editable(['handshakeTimeoutMs'], '握手超时'),
      editable(['startupTimeoutMs'], '启动超时'),
      editable(['shutdownGraceMs'], '关停等待时间'),
      editable(['diagnosticBytes'], '诊断输出上限'),
    ],
  },
  {
    namespace: 'clawdsh-memory',
    capabilityId: 'memory',
    label: 'Memory',
    description: '配置持久记忆、语义召回、文件监听与压缩前写回。',
    editor: 'generic',
    effectTime: 'restart',
    fields: [
      editable(['enabled'], '启用 Memory'),
      editable(['root'], 'Memory 根目录'),
      editable(['chunkSizeChars'], '分块字符数'),
      editable(['chunkOverlapChars'], '分块重叠字符数'),
      editable(['maxResults'], '最大召回数'),
      editable(['minScore'], '最低相似度'),
      editable(['snippetChars'], '摘要字符上限'),
      editable(['timeoutMs'], '搜索超时'),
      editable(['maxReadLines'], '最大读取行数'),
      editable(['maxWriteChars'], '单条记忆最大字符数'),
      editable(['watch'], '监听 Memory 文件'),
      editable(['watchStabilityThresholdMs'], '监听稳定窗口'),
      editable(['watchPollIntervalMs'], '监听轮询间隔'),
      editable(['flush', 'enabled'], '启用压缩前写回'),
      editable(['flush', 'reserveTokensFloor'], '保留 Token'),
      editable(['flush', 'softThresholdTokens'], '写回触发窗口'),
      editable(['flush', 'prompt'], '写回 Prompt'),
    ],
  },
  {
    namespace: 'clawdsh-embeddings-ark',
    capabilityId: 'memory',
    label: 'Ark Embeddings',
    description: '配置 Memory 使用的火山方舟向量服务；API Key 由独立凭据控件管理。',
    editor: 'generic',
    effectTime: 'restart',
    fields: [
      editable(['baseURL'], '服务地址'),
      editable(['model'], 'Embedding 模型'),
      editable(['timeoutMs'], '调用超时'),
      editable(['maxConcurrentTexts'], '最大并发文本'),
    ],
  },
  {
    namespace: 'clawdsh-skills-hub',
    capabilityId: 'skills',
    label: 'Skills Hub',
    description: '配置 ClawHub 兼容的 Skills 来源与准入检查。',
    editor: 'generic',
    effectTime: 'restart',
    fields: [
      editable(['enabled'], '启用 Skills Hub'),
      editable(['workspaceDir'], 'Workspace Skills 目录'),
      editable(['managedDir'], 'Managed Skills 目录'),
      editable(['extraDirs'], '额外 Skills 目录'),
      editable(['gating'], '启用依赖准入检查'),
    ],
  },
  {
    namespace: 'clawdsh-automation',
    capabilityId: 'automation',
    label: 'Automation',
    description: '配置自动化开关和原子保存的规则集合。',
    editor: 'automation-rules',
    effectTime: 'restart',
    fields: [
      editable(['enabled'], '启用自动运行'),
      managed(['preset'], 'Agent Preset', '固定为 clawdsh，确保自动任务拥有完整的 ClawDSH 能力。'),
      managed(['cwd'], '自动任务工作目录', '由当前 ClawDSH 安装管理，任务结果会归入对应工作区。'),
      editable(['rules'], '自动任务规则'),
    ],
  },
  {
    namespace: 'clawdsh-activity',
    capabilityId: 'activity',
    label: 'Activity',
    description: 'Activity 是产品内部必需能力，其存储安全策略由安装器管理。',
    editor: 'generic',
    effectTime: 'restart',
    fields: [managed(['enabled'], 'Activity 状态')],
  },
] as const

/** Product id mapped to the only DSH-owned credential exposed by ClawDSH v1. */
export const CREDENTIAL_MANIFEST = [
  {
    id: 'ark-api-key',
    ref: 'ARK_API_KEY',
    label: 'Ark API Key',
    effectTime: 'next-call' as const,
  },
] as const
