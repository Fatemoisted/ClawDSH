/**
 * Best-effort semantic Activity service backed by bounded owner-private sidecars.
 * Producers submit typed domain facts; this package owns all summaries and metadata selection.
 * @module @clawdsh/dsh-activity
 */

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { createActivityRecord } from './records.ts'
import { createActivityPage } from './pagination.ts'
import { ActivitySidecarStore } from './storage.ts'
import type {
  AutomationRunActivity,
  ChannelDeliveryActivity,
  ChannelReceivedActivity,
  ClawdshActivityReadRequest,
  ClawdshActivityReadResult,
  ClawdshActivityHistorySources,
  ClawdshActivityPage,
  ClawdshActivityPageRequest,
  ClawdshActivityWriteResult,
  MemoryActivity,
  PromptContributionActivity,
  SkillCatalogActivity,
  SkillInvokedActivity,
  SkillLoadedActivity,
} from './types.ts'

export {
  ACTIVITY_CATEGORIES,
  ClawdshActivityQueryError,
  DEFAULT_ACTIVITY_PAGE_LIMIT,
  MAX_ACTIVITY_PAGE_LIMIT,
} from './pagination.ts'
export { projectSessionHistory } from './projector.ts'
export {
  ACTIVITY_PRODUCERS,
  MAX_ACTIVITY_FILE_BYTES,
  MAX_ACTIVITY_RECORD_BYTES,
} from './storage.ts'
export type * from './types.ts'

/** User-settings namespace for the required Activity capability. */
export const ACTIVITY_SETTINGS_NAMESPACE = settingsNamespace('clawdsh-activity')

/** Managed Activity configuration. */
export interface Config {
  /** Activity is a required product capability and cannot be disabled. */
  readonly enabled?: true
}

/** Runtime schema for the required managed Activity capability. */
export const Config: z<Config> = z.object({
  enabled: z.const(true).default(true),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional semantic Activity sink; producers discover it with `ctx.get`. */
    clawdshActivity: ClawdshActivity
  }
}

/** Typed semantic Activity sink and safe sidecar reader. */
export class ClawdshActivity extends Service {
  static inject = ['settings']
  static Config: z<Config> = Config

  private readonly sidecars: ActivitySidecarStore

  /**
   * Register the service, required managed settings, and quiescent teardown.
   * @param ctx - Host context that owns this Activity lifecycle.
   * @param config - Composition base; `enabled` accepts only the managed value `true`.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'clawdshActivity')
    ctx.get('settings')?.register(ACTIVITY_SETTINGS_NAMESPACE, Config, {
      base: config,
      applies: 'restart',
    })
    this.sidecars = new ActivitySidecarStore(
      join(resolveDshHome(), 'clawdsh', 'activity', 'v1'),
    )
    ctx.effect(() => async () => { await this.sidecars.dispose() }, 'clawdsh-activity.sidecars()')
  }

  /**
   * Record a ClawDSH prompt section proven to have entered a request header.
   * @param input - Section identity, append/replace mode, byte-independent character count, digest, and Session sequence.
   * @returns sanitized best-effort append outcome.
   */
  promptContribution(input: PromptContributionActivity): Promise<ClawdshActivityWriteResult> {
    return this.sidecars.append(input.producer, createActivityRecord(
      this.envelope(String(input.sessionId)),
      'prompt.contribution',
      {
        producer: input.producer,
        section: input.section,
        mode: input.mode,
        characters: input.characters,
        sha256: input.sha256,
        seq: input.seq,
      },
      'succeeded',
    ))
  }

  /**
   * Record one Memory search lifecycle state without query or result content.
   * @param input - Session sequence and sanitized lifecycle state.
   * @returns sanitized best-effort append outcome.
   */
  memorySearch(input: MemoryActivity): Promise<ClawdshActivityWriteResult> {
    return this.memory(input, 'memory.search')
  }

  /**
   * Record one Memory read lifecycle state without a path or returned content.
   * @param input - Session sequence and sanitized lifecycle state.
   * @returns sanitized best-effort append outcome.
   */
  memoryRead(input: MemoryActivity): Promise<ClawdshActivityWriteResult> {
    return this.memory(input, 'memory.read')
  }

  /**
   * Record one Memory flush lifecycle state without prompt or reply content.
   * @param input - Session sequence and sanitized lifecycle state.
   * @returns sanitized best-effort append outcome.
   */
  memoryFlush(input: MemoryActivity): Promise<ClawdshActivityWriteResult> {
    return this.memory(input, 'memory.flush')
  }

  /**
   * Record one admitted inbound channel message without platform identities or text.
   * @param input - Adapter, direct/group class, mention fact, and Session sequence.
   * @returns sanitized best-effort append outcome.
   */
  channelReceived(input: ChannelReceivedActivity): Promise<ClawdshActivityWriteResult> {
    return this.sidecars.append('channels', createActivityRecord(
      this.envelope(String(input.sessionId)),
      'channel.received',
      channelMetadata(input),
    ))
  }

  /**
   * Record one newly committed delivery state without delivery or platform identities.
   * @param input - Adapter, conversation class, mention fact, Session sequence, and sanitized state; omit state for an ambiguous receipt.
   * @returns sanitized best-effort append outcome.
   */
  channelDelivery(input: ChannelDeliveryActivity): Promise<ClawdshActivityWriteResult> {
    return this.sidecars.append('channels', createActivityRecord(
      this.envelope(String(input.sessionId)),
      'channel.delivery',
      channelMetadata(input),
      input.status,
    ))
  }

  /**
   * Record a skill catalog projection without catalog entries or provider locations.
   * @param input - Visible entry count and source Session sequence.
   * @returns sanitized best-effort append outcome.
   */
  skillCatalog(input: SkillCatalogActivity): Promise<ClawdshActivityWriteResult> {
    return this.sidecars.append('skills', createActivityRecord(
      this.envelope(String(input.sessionId)),
      'skill.catalog',
      { count: input.count, seq: input.seq },
      'succeeded',
    ))
  }

  /**
   * Record a selected skill identity without skill text or provider location.
   * @param input - Skill identity and source Session sequence.
   * @returns sanitized best-effort append outcome.
   */
  skillLoaded(input: SkillLoadedActivity): Promise<ClawdshActivityWriteResult> {
    return this.sidecars.append('skills', createActivityRecord(
      this.envelope(String(input.sessionId)),
      'skill.loaded',
      { skill: input.skill, seq: input.seq },
      'succeeded',
    ))
  }

  /**
   * Record a skill invocation lifecycle state without arguments, output, or errors.
   * @param input - Skill identity, source Session sequence, and sanitized lifecycle state.
   * @returns sanitized best-effort append outcome.
   */
  skillInvoked(input: SkillInvokedActivity): Promise<ClawdshActivityWriteResult> {
    return this.sidecars.append('skills', createActivityRecord(
      this.envelope(String(input.sessionId)),
      'skill.invoked',
      { skill: input.skill, seq: input.seq },
      input.status,
    ))
  }

  /**
   * Record one automation run state without prompt, model output, or error text.
   * @param input - Rule identity, schedule time, source Session sequence, and sanitized lifecycle state.
   * @returns sanitized best-effort append outcome.
   */
  automationRun(input: AutomationRunActivity): Promise<ClawdshActivityWriteResult> {
    return this.sidecars.append('automation', createActivityRecord(
      this.envelope(String(input.sessionId)),
      'automation.run',
      { ruleId: input.ruleId, scheduledAt: input.scheduledAt, seq: input.seq },
      input.status,
    ))
  }

  /**
   * Read bounded package-owned sidecars without exposing physical paths or filesystem diagnostics.
   * @param request - Session and optional fixed producer subset.
   * @returns canonical records with sanitized availability/degradation state.
   */
  list(request: ClawdshActivityReadRequest): Promise<ClawdshActivityReadResult> {
    return this.sidecars.read(String(request.sessionId), request.producers)
  }

  /**
   * Merge standard Session history with sidecars and return one cursor-paginated semantic page.
   * @param request - Session, category filter, ordering, limit, and optional continuation.
   * @param history - Live events or persisted inspection supplied by the trusted Host caller.
   * @returns a stable page with sanitized source availability and warnings.
   */
  async page(
    request: ClawdshActivityPageRequest,
    history: ClawdshActivityHistorySources = {},
  ): Promise<ClawdshActivityPage> {
    const sidecars = await this.sidecars.read(String(request.sessionId))
    return createActivityPage(request, history, sidecars)
  }

  private memory(
    input: MemoryActivity,
    kind: 'memory.search' | 'memory.read' | 'memory.flush',
  ): Promise<ClawdshActivityWriteResult> {
    return this.sidecars.append('memory', createActivityRecord(
      this.envelope(String(input.sessionId)),
      kind,
      { seq: input.seq },
      input.status,
    ))
  }

  private envelope(sessionId: string): { readonly id: string; readonly timestamp: string; readonly sessionId: string } {
    return { id: randomUUID(), timestamp: new Date().toISOString(), sessionId }
  }
}

function channelMetadata(input: ChannelReceivedActivity): {
  readonly adapter: string
  readonly conversation: 'direct' | 'group'
  readonly mention: boolean | null
  readonly seq: number
} {
  return {
    adapter: input.adapter,
    conversation: input.conversation,
    mention: input.mention,
    seq: input.seq,
  }
}

export default ClawdshActivity
