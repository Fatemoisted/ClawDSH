/**
 * Failure-contained serial maintenance for legacy channel adapters.
 * @module @clawdsh/dsh-channel-core/maintenance
 */

/** One asynchronous lifecycle transition. */
export type ChannelMaintenanceOperation = () => Promise<void>

/** Serial lifecycle queue with ordinary and teardown-specific error reporting. */
export interface ChannelMaintenanceQueue {
  /** Schedule a transition and report any failure without breaking later work. */
  enqueue(operation: ChannelMaintenanceOperation): void
  /** Schedule a final transition, contain its failure, and wait for it to settle. */
  settle(
    operation: ChannelMaintenanceOperation,
    reportFailure?: (error: unknown) => void,
  ): Promise<void>
}

/**
 * Create a failure-contained FIFO for credential rotation and adapter teardown.
 * @param reportFailure - ordinary transition failure reporter.
 * The first transition begins immediately (preserving SDK setup that is
 * synchronous until its first await); later transitions wait for the
 * recovered tail.
 * @returns a queue whose tail always recovers before accepting the next transition.
 */
export function createChannelMaintenanceQueue(
  reportFailure: (error: unknown) => void,
): ChannelMaintenanceQueue {
  let tail: Promise<void> | undefined
  const schedule = (operation: ChannelMaintenanceOperation): Promise<void> => {
    const task = tail === undefined ? operation() : tail.then(operation, operation)
    tail = task.catch(() => undefined)
    return task
  }
  return {
    enqueue: (operation) => {
      void schedule(operation).catch(reportFailure)
    },
    settle: async (operation, finalReporter = reportFailure) => {
      await schedule(operation).catch(finalReporter)
    },
  }
}
