import type {
  ClawdshCapabilitiesResponse,
  ClawdshCredentialsDescribeResponse,
  ClawdshActivityListResponse,
  ClawdshSettingsDescribeResponse,
} from '../../shared/src/protocol.ts'

/** Minimal valid Host projection shared by browser component and transport tests. */
export const CAPABILITIES_FIXTURE: ClawdshCapabilitiesResponse = {
  version: 1,
  readOnly: true,
  capabilities: [
    {
      id: 'channels',
      label: 'Channels',
      description: '社交渠道协议、Agent 桥接与 OpenClaw Gateway Provider。',
      dependencies: ['Channel Protocol', 'Agent Bridge'],
      effectTime: 'restart',
      required: true,
      state: 'active',
      components: [
        {
          id: 'channel-protocol',
          label: 'Channel Protocol',
          packages: ['@clawdsh/dsh-channel'],
          required: true,
          stateSource: 'loader',
          loaderEntries: [],
          state: 'active',
        },
        {
          id: 'agent-bridge',
          label: 'Agent Bridge',
          packages: ['@clawdsh/dsh-channel-agent'],
          required: true,
          stateSource: 'loader',
          loaderEntries: [],
          state: 'active',
        },
        {
          id: 'openclaw-gateway-provider',
          label: 'OpenClaw Gateway Provider',
          packages: ['@clawdsh/dsh-channel-openclaw'],
          required: false,
          stateSource: 'loader',
          loaderEntries: [],
          state: 'disabled',
        },
      ],
      channels: [
        { id: 'feishu', label: '飞书', provenance: 'bundled', support: 'cataloged' },
        { id: 'telegram', label: 'Telegram', provenance: 'bundled', support: 'cataloged' },
      ],
    },
    {
      id: 'activity',
      label: 'Activity',
      description: '会话级 ClawDSH 语义活动投影。',
      dependencies: [],
      effectTime: 'live',
      required: false,
      state: 'starting',
      components: [],
    },
  ],
  loaderInventory: [
    {
      entryId: 'clawdsh-soul',
      localId: 'soul',
      moduleName: '@clawdsh/dsh-soul',
      enabled: true,
      fiberPhase: 'active',
      state: 'active',
      source: 'clawdsh',
    },
    {
      entryId: 'client-runtime',
      localId: 'runtime',
      moduleName: '@deepseek-ai/dsh-client-runtime',
      enabled: true,
      fiberPhase: 'active',
      state: 'active',
      source: 'platform',
    },
  ],
}

/** Minimal serialized settings catalog accepted by the browser schema editor. */
export const SETTINGS_FIXTURE: ClawdshSettingsDescribeResponse = {
  version: 1,
  namespaces: [
    {
      namespace: 'clawdsh-memory',
      capabilityId: 'memory',
      label: 'Memory',
      description: '配置持久记忆。',
      editor: 'generic',
      schema: {
        uid: 2,
        refs: {
          1: { type: 'boolean', meta: { default: true } },
          2: { type: 'object', meta: { default: {} }, dict: { enabled: 1 } },
        },
      },
      value: { enabled: true },
      base: { enabled: true },
      desiredRevision: 0,
      runtimeRevision: 0,
      restartRequired: false,
      effectTime: 'restart',
      fields: [{ path: ['enabled'], label: '启用 Memory', access: 'editable' }],
    },
  ],
}

/** Secret-free DSH credential catalog fixture. */
export const CREDENTIALS_FIXTURE: ClawdshCredentialsDescribeResponse = {
  version: 1,
  credentials: [
    {
      id: 'ark-api-key',
      label: 'Ark API Key',
      configured: false,
      writable: true,
      effectTime: 'next-call',
    },
  ],
}

/** Privacy-safe Activity page with one history and one sidecar-style record. */
export const ACTIVITY_FIXTURE: ClawdshActivityListResponse = {
  version: 1,
  records: [
    {
      version: 1,
      id: 'history:prompt-1',
      timestamp: '2026-08-15T12:00:00.000Z',
      sessionId: 'session-one',
      category: 'prompt',
      kind: 'prompt.contribution',
      status: 'succeeded',
      summary: 'ClawDSH Prompt contribution recorded',
      metadata: {
        producer: 'soul',
        section: 'clawdsh:soul',
        mode: 'append',
        characters: 128,
        sha256: 'a'.repeat(64),
        seq: 4,
      },
    },
    {
      version: 1,
      id: 'history:prompt-2',
      timestamp: '2026-08-15T12:00:00.000Z',
      sessionId: 'session-one',
      category: 'prompt',
      kind: 'prompt.contribution',
      status: 'succeeded',
      summary: 'ClawDSH Prompt contribution recorded',
      metadata: {
        producer: 'memory',
        section: 'clawdsh:memory-recall',
        mode: 'append',
        characters: 256,
        sha256: 'b'.repeat(64),
        seq: 4,
      },
    },
    {
      version: 1,
      id: '2e24da12-8204-4e4e-9b4a-c27c230d7676',
      timestamp: '2026-08-15T12:01:00.000Z',
      sessionId: 'session-one',
      category: 'channel',
      kind: 'channel.received',
      summary: 'Channel message received',
      metadata: {
        adapter: 'telegram',
        conversation: 'direct',
        mention: null,
        seq: 5,
      },
    },
  ],
  availability: { history: 'live', sidecar: 'missing' },
  degraded: false,
  warnings: ['activity-sidecar-missing'],
}
