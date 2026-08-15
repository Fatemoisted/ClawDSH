/**
 * Pre-compaction memory flush turn (OpenClaw `memory-flush` port).
 *
 * When the durable context nears its window (`totalTokens >= contextWindow −
 * reserveTokensFloor − softThresholdTokens`, OpenClaw's defaults 20_000 /
 * 4_000), a silent agent turn queues at `agent/turn-stopping`: the flush
 * prompt asks the model to write durable memories to `memory/YYYY-MM-DD.md`
 * (the convention the recall section already teaches) and to answer
 * `NO_REPLY` when there is nothing to store. The turn is an ordinary logged
 * turn with a plugin source, so "model-visible means logged" holds. Channel
 * delivery remains bound to the exact admitted message's owning turn, so a
 * later flush turn cannot replace its result.
 *
 * The guard fires once per compaction cycle: the newest `compaction/end` seq
 * in the session log is the durable cycle marker, and a flush re-arms only
 * when a newer compaction lands. Failures never block the main turn — the
 * flush turn is queued between turns and its errors are contained by the
 * driver.
 * @module @clawdsh/dsh-memory/flush
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-compaction'
import type {} from '@deepseek-ai/dsh-token-meter'

/** Plugin source label of flush turns, checked by the pending-clear and log observer. */
export const FLUSH_PLUGIN_SOURCE = 'memory-flush'
/** Default context reserve kept below the window for the flush (OpenClaw `reserveTokensFloor`). */
export const DEFAULT_FLUSH_RESERVE_TOKENS_FLOOR = 20_000
/** Default soft band below the reserve where the flush becomes due (OpenClaw `softThresholdTokens`). */
export const DEFAULT_FLUSH_SOFT_THRESHOLD_TOKENS = 4_000
/** Default flush prompt, OpenClaw's semantics verbatim. */
export const DEFAULT_FLUSH_PROMPT = 'Store durable memories now (use memory/YYYY-MM-DD.md; create memory/ if needed). If nothing to store, reply with NO_REPLY.'

/** Flush sub-config of the memory row. */
export interface FlushConfig {
  /** Whether the flush turn participates; defaults to true. */
  enabled?: boolean
  /** Tokens kept free below the context window; the flush becomes due only above `window − reserve − soft`. Defaults to 20000. */
  reserveTokensFloor?: number
  /** Soft band below the reserve; defaults to 4000. */
  softThresholdTokens?: number
  /** The flush turn's prompt; defaults to the OpenClaw wording. */
  prompt?: string
}

/** Runtime schema for the flush sub-config. */
export const FlushConfig: z<FlushConfig> = z.object({
  enabled: z.boolean().default(true),
  reserveTokensFloor: z.number().step(1).min(0).default(DEFAULT_FLUSH_RESERVE_TOKENS_FLOOR),
  softThresholdTokens: z.number().step(1).min(0).default(DEFAULT_FLUSH_SOFT_THRESHOLD_TOKENS),
  prompt: z.string().default(DEFAULT_FLUSH_PROMPT),
})

/** Flush config with defaults applied, for raw (non-Loader) callers. */
export interface ResolvedFlushConfig {
  enabled: boolean
  reserveTokensFloor: number
  softThresholdTokens: number
  prompt: string
}

/**
 * Defensively resolve flush config for callers that bypass schemastery.
 * @param config - raw flush sub-config.
 * @returns the resolved config with defaults applied; invalid field types fail loudly.
 */
export function resolveFlushConfig(config: FlushConfig = {}): ResolvedFlushConfig {
  if (config.enabled !== undefined && typeof config.enabled !== 'boolean') {
    throw new TypeError('memory: flush.enabled must be a boolean')
  }
  const reserveTokensFloor = config.reserveTokensFloor ?? DEFAULT_FLUSH_RESERVE_TOKENS_FLOOR
  const softThresholdTokens = config.softThresholdTokens ?? DEFAULT_FLUSH_SOFT_THRESHOLD_TOKENS
  if (!Number.isSafeInteger(reserveTokensFloor) || reserveTokensFloor < 0) {
    throw new TypeError('memory: flush.reserveTokensFloor must be a non-negative safe integer')
  }
  if (!Number.isSafeInteger(softThresholdTokens) || softThresholdTokens < 0) {
    throw new TypeError('memory: flush.softThresholdTokens must be a non-negative safe integer')
  }
  if (config.prompt !== undefined && (typeof config.prompt !== 'string' || config.prompt.length === 0)) {
    throw new TypeError('memory: flush.prompt must be a non-empty string')
  }
  return {
    enabled: config.enabled ?? true,
    reserveTokensFloor,
    softThresholdTokens,
    prompt: config.prompt ?? DEFAULT_FLUSH_PROMPT,
  }
}

const NO_REPLY_PREFIX = /^\s*NO_REPLY(?=$|\W)/
const NO_REPLY_SUFFIX = /\bNO_REPLY\b\W*$/

/** Per-agent flush state: the compaction cycle already flushed and whether a flush turn is queued. */
interface FlushState {
  /** Seq of the newest `compaction/end` covered by the last flush (−Infinity before the first flush). */
  throughSeq: number
  /** A flush turn is queued or running and must not queue again. */
  pending: boolean
}

/** Resolve the durable provider/model route for the current request header, mirroring compaction-basic. */
function routedTarget(session: Session): { provider: string; model: string } | undefined {
  const config = session.requestHeader()?.config
  if (config === undefined || config.provider.length === 0 || config.model.length === 0) return undefined
  return { provider: config.provider, model: config.model }
}

function isFlushMessage(event: SessionEvent): boolean {
  return event.type === 'user/message'
    && event.data.source.kind === 'plugin'
    && event.data.source.plugin === FLUSH_PLUGIN_SOURCE
}

function newestCompactionEndSeq(session: Session): number {
  const end = session.events.findLast(event => event.type === 'compaction/end')
  return end?.seq ?? -1
}

/**
 * Install the flush turn hooks on the agent event stream.
 * @param ctx - Cordis context; `ctx.get('tokenMeter')` and `ctx.get('llm')` are read at hook time so late mounts enable the flush.
 * @param config - resolved flush config.
 * @returns the disposer removing all flush listeners.
 */
export function installMemoryFlush(ctx: Context, config: ResolvedFlushConfig): () => void {
  if (!config.enabled) return () => {}
  const states = new WeakMap<Agent, FlushState>()
  const contextWindows = new Map<string, number>()
  const lastFlushSeq = new WeakMap<Session, number>()
  let warnedMissingSeams = false
  let warnedNoWindow = false

  const stateFor = (agent: Agent): FlushState => {
    const existing = states.get(agent)
    if (existing !== undefined) return existing
    const created: FlushState = { throughSeq: Number.NEGATIVE_INFINITY, pending: false }
    states.set(agent, created)
    return created
  }

  const disposeObserver = ctx.on('session/event', (session, event) => {
    if (isFlushMessage(event)) {
      lastFlushSeq.set(session, event.seq)
      return
    }
    if (event.type !== 'assistant/message') return
    const flushSeq = lastFlushSeq.get(session)
    if (flushSeq === undefined || event.seq <= flushSeq) return
    const text = event.data.message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    if (NO_REPLY_PREFIX.test(text) || NO_REPLY_SUFFIX.test(text)) {
      ctx.logger.info('memory-flush: flush turn ended with NO_REPLY; nothing stored')
    }
  })

  const disposePreStep = ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
    if (messages.some(message => message.source.kind === 'plugin' && message.source.plugin === FLUSH_PLUGIN_SOURCE)) {
      stateFor(agent).pending = false
    }
    return next()
  })

  const disposeTurnStopping = ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
    const state = stateFor(agent)
    if (state.pending) {
      // Safety net: a flush turn that never reached pre-step (aborted claim) must not wedge the guard.
      const last = agent.session.events.findLast(event => event.type === 'user/message')
      if (last !== undefined && isFlushMessage(last)) state.pending = false
      else return
    }
    const tokenMeter = ctx.get('tokenMeter')
    const llm = ctx.get('llm')
    if (tokenMeter === undefined || llm === undefined) {
      if (!warnedMissingSeams) {
        warnedMissingSeams = true
        ctx.logger.warn('memory-flush: disabled — ctx.tokenMeter and ctx.llm are required to compute flush thresholds')
      }
      return
    }
    if (signal.aborted) return
    let totalTokens: number
    try {
      totalTokens = tokenMeter.measure(agent.session).totalTokens
    } catch (error) {
      ctx.logger.warn(`memory-flush: token measurement failed: ${String(error)}`)
      return
    }
    const target = routedTarget(agent.session)
      ?? (agent.options.provider !== undefined && agent.options.model !== undefined
        ? { provider: agent.options.provider, model: agent.options.model }
        : undefined)
    if (target === undefined) {
      if (!warnedNoWindow) {
        warnedNoWindow = true
        ctx.logger.warn('memory-flush: no routed model target; flush skipped until a request header exists')
      }
      return
    }
    const key = `${target.provider}/${target.model}`
    let contextWindow = contextWindows.get(key)
    if (contextWindow === undefined) {
      try {
        const info = await llm.resolveModelInfo(target.provider, target.model, signal)
        contextWindow = info.context?.contextWindow
      } catch {
        return
      }
      if (contextWindow === undefined) {
        if (!warnedNoWindow) {
          warnedNoWindow = true
          ctx.logger.warn(`memory-flush: model "${key}" declares no contextWindow; flush disabled`)
        }
        return
      }
      contextWindows.set(key, contextWindow)
    }
    const threshold = contextWindow - config.reserveTokensFloor - config.softThresholdTokens
    if (threshold <= 0 || totalTokens < threshold) return
    if (newestCompactionEndSeq(agent.session) <= state.throughSeq) return
    state.pending = true
    state.throughSeq = newestCompactionEndSeq(agent.session)
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: config.prompt }],
      source: { kind: 'plugin', plugin: FLUSH_PLUGIN_SOURCE },
    }))
  })

  return () => {
    disposeTurnStopping()
    disposePreStep()
    disposeObserver()
  }
}
