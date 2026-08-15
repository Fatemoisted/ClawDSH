import type { AgentHarness, AgentHarnessV2 } from 'openclaw/plugin-sdk/agent-harness'
import { runAgentHarnessBeforeMessageWriteHook } from 'openclaw/plugin-sdk/agent-harness-runtime'
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry'
import { withSessionTranscriptWriteLock } from 'openclaw/plugin-sdk/session-transcript-runtime'
import {
  createOpenClawBridge,
  createSyntheticProvider,
  resolveBridgeConfig,
} from '../shared/openclaw-runtime.js'
import { createTranscriptMirror } from '../shared/transcript-mirror.js'

const plugin = definePluginEntry({
  id: 'clawdsh-bridge',
  name: 'ClawDSH Bridge',
  description: 'Routes admitted OpenClaw channel turns to a local ClawDSH Agent.',
  register(api) {
    const transcript = createTranscriptMirror({
      runAgentHarnessBeforeMessageWriteHook,
      withSessionTranscriptWriteLock,
    })
    const bridge = createOpenClawBridge(api, {
      generation: 'v2',
      config: resolveBridgeConfig(api.pluginConfig),
      transcript,
      assertActive: (params: Parameters<AgentHarnessV2['runAttempt']>[0]) => {
        params.hostCapabilities.assertActive()
      },
      supports: (context: Parameters<AgentHarnessV2['supports']>[0]) => {
        if (context.modelProvider?.requestTransportOverrides !== 'none') {
          return { supported: false, reason: 'ClawDSH cannot reproduce provider transport overrides' }
        }
        if (!context.modelProvider.runtimePolicy?.compatibleIds.includes('clawdsh')) {
          return { supported: false, reason: 'The prepared provider route is not compatible with ClawDSH' }
        }
        return { supported: true, priority: 1000, reason: 'locked ClawDSH V2 route' }
      },
    })
    const harness = {
      ...bridge.harness,
      autoSelection: { providerIds: ['clawdsh'] as const },
    } satisfies AgentHarnessV2
    api.registerProvider(createSyntheticProvider())
    api.registerAgentHarness(harness as unknown as AgentHarness)
    api.registerService({
      id: 'clawdsh-bridge',
      start: bridge.start,
      stop: bridge.dispose,
    })
  },
})

export default plugin
