import type { ClawdshCapabilitiesResponse } from '../../shared/src/protocol.ts'

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
