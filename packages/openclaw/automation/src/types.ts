/**
 * Session event vocabulary for the automation row: per-run status records
 * around the logged agent turn. The turn itself is an ordinary logged turn
 * (`user/message` with a plugin source + the assistant reply), so the run log
 * needs no separate artifact.
 * @module @clawdsh/dsh-automation/types
 */

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Automation run status record appended before (`started`, at-least-once
     * marker) and after (`ok` / `error`) one scheduled turn.
     */
    'automation/run': AutomationRunEvent
  }
}

/** Payload of one `automation/run` record. */
export interface AutomationRunEvent {
  /** Owning rule id (also the session id suffix `automation:<id>`). */
  ruleId: string
  /** ISO timestamp of the occurrence being run; the durable once-guard key for `at` rules. */
  scheduledAt: string
  status: 'started' | 'ok' | 'error'
  /** Failure description when `status` is `error`. */
  error?: string
}
