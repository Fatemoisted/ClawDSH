import { runAgentHarnessBeforeMessageWriteHook } from 'openclaw/plugin-sdk/agent-harness-runtime'
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry'
import { withSessionTranscriptWriteLock } from 'openclaw/plugin-sdk/session-transcript-runtime'
import {
  createProcessSharedOpenClawBridge,
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
    const bridge = createProcessSharedOpenClawBridge(api, {
      generation: 'v1',
      config: resolveBridgeConfig(api.pluginConfig),
      transcript,
    })
    api.registerProvider(createSyntheticProvider())
    api.registerAgentHarness(bridge.harness)
    api.registerService({
      id: 'clawdsh-bridge',
      start: bridge.start,
      stop: bridge.dispose,
    })
  },
})

export default plugin
