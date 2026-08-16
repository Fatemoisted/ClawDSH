/** Register the session-scoped ClawDSH semantic record view. */
import type { ReactNode } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ClawdshControlClient } from './control-client.ts'
import { ActivityPage } from './pages/ActivityPage.tsx'

/** Browser-local dependencies retained by the view registration. */
export interface ClawdshRecordsRegistrationOptions {
  readonly control: ClawdshControlClient
  readonly localControlAvailable: boolean
}

/**
 * Contribute ClawDSH records after the native Trajectory tab.
 * @param ctx - Client plugin context that owns the registration lifecycle.
 * @param options - Loopback control client and its availability.
 * @returns Nothing; the Slot injection owns registration disposal.
 */
export function registerClawdshRecords(
  ctx: ClientContext,
  options: ClawdshRecordsRegistrationOptions,
): void {
  function ClawdshRecordsView({ sessionId, useSession }: ConvViewProps): ReactNode {
    const refreshRevision = useSession((snapshot) => {
      let latest = -1
      for (const seq of snapshot.turnEnds.values()) latest = Math.max(latest, seq)
      return latest
    })
    return (
      <ActivityPage
        control={options.control}
        localControlAvailable={options.localControlAvailable}
        refreshRevision={refreshRevision}
        sessionId={sessionId}
      />
    )
  }

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'clawdsh-records',
    order: 20,
    label: 'ClawDSH 记录',
  }, ClawdshRecordsView))
}
