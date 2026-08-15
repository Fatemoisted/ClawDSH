import type {
  ClawdshEffectTime,
  ClawdshLoaderState,
  ClawdshPluginOrigin,
  ClawdshSupportState,
} from '../../shared/src/protocol.ts'

/** Localized labels for the frozen Loader state vocabulary. */
export const LOADER_STATE_LABEL: Readonly<Record<ClawdshLoaderState, string>> = {
  disabled: '已关闭',
  starting: '启动中',
  active: '运行中',
  failed: '异常',
  misconfigured: '配置不完整',
}

/** Localized labels for product ownership returned by the Host. */
export const ORIGIN_LABEL: Readonly<Record<ClawdshPluginOrigin, string>> = {
  clawdsh: 'ClawDSH',
  platform: 'Platform',
  community: 'Community',
}

/** Localized labels for when one capability change takes effect. */
export const EFFECT_TIME_LABEL: Readonly<Record<ClawdshEffectTime, string>> = {
  live: '立即',
  'new-session': '新会话',
  'next-call': '下次调用',
  restart: '重启后',
}

/** Localized labels for the locked channel-catalog evidence levels. */
export const SUPPORT_LABEL: Readonly<Record<ClawdshSupportState, string>> = {
  cataloged: '已编目',
  installable: '可安装',
  certified: '已验证',
  enabled: '已启用',
}
