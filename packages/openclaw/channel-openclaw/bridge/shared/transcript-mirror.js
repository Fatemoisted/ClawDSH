/**
 * Build the minimal OpenClaw transcript mirror used by an external AgentHarness.
 * The DSH Session Log remains the model-history authority; this mirror contains
 * only the admitted user turn and final visible assistant result.
 */
export function createTranscriptMirror(dependencies) {
  const { withSessionTranscriptWriteLock, runAgentHarnessBeforeMessageWriteHook } = dependencies
  if (typeof withSessionTranscriptWriteLock !== 'function' || typeof runAgentHarnessBeforeMessageWriteHook !== 'function') {
    throw new Error('OpenClaw transcript runtime exports are unavailable')
  }
  return {
    /**
     * @param {object} input - Active attempt and terminal message pair.
     * @returns {Promise<{assistantOwned: boolean}>} Transcript ownership outcome.
     */
    async mirror(input) {
      const target = {
        ...(nonEmpty(input.params.agentId) ? { agentId: input.params.agentId } : {}),
        sessionId: input.params.sessionId,
        sessionKey: input.params.sessionKey ?? input.params.sessionId,
        ...(nonEmpty(input.params.sessionFile) ? { sessionFile: input.params.sessionFile } : {}),
        ...(input.params.config === undefined ? {} : { config: input.params.config }),
      }
      let assistantOwned = false
      await withSessionTranscriptWriteLock(target, async transcript => {
        const events = await transcript.readEvents()
        const state = transcriptState(events)
        let sequence = state.messageCount
        const candidates = [
          { message: input.userMessage, idempotencyKey: input.userIdempotencyKey, assistant: false },
          { message: input.assistantMessage, idempotencyKey: input.assistantIdempotencyKey, assistant: true },
        ]
        for (const candidate of candidates) {
          if (candidate.message === undefined) continue
          if (state.idempotencyKeys.has(candidate.idempotencyKey)) {
            if (candidate.assistant) assistantOwned = true
            continue
          }
          const rewritten = runAgentHarnessBeforeMessageWriteHook({
            message: { ...candidate.message, idempotencyKey: candidate.idempotencyKey },
            agentId: input.params.agentId,
            sessionKey: target.sessionKey,
          })
          if (rewritten === null) {
            if (candidate.assistant) assistantOwned = true
            continue
          }
          const appended = await transcript.appendMessage({
            message: { ...rewritten, idempotencyKey: candidate.idempotencyKey },
            idempotencyLookup: 'caller-checked',
            ...(nonEmpty(input.params.cwd) ? { cwd: input.params.cwd } : {}),
          })
          if (appended === undefined) continue
          state.idempotencyKeys.add(candidate.idempotencyKey)
          sequence += 1
          await transcript.publishUpdate({
            agentId: input.params.agentId,
            sessionKey: target.sessionKey,
            message: appended.message,
            messageId: appended.messageId,
            messageSeq: sequence,
          })
          if (candidate.assistant) assistantOwned = true
        }
      })
      return { assistantOwned }
    },
  }
}

function transcriptState(events) {
  const idempotencyKeys = new Set()
  let messageCount = 0
  if (!Array.isArray(events)) return { idempotencyKeys, messageCount }
  for (const event of events) {
    if (!isObject(event)) continue
    if (event.type === 'message') messageCount += 1
    if (isObject(event.message) && nonEmpty(event.message.idempotencyKey)) {
      idempotencyKeys.add(event.message.idempotencyKey)
    }
  }
  return { idempotencyKeys, messageCount }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonEmpty(value) {
  return typeof value === 'string' && value.length > 0
}
