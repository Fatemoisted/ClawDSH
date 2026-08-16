import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { createSlotRenderer } from '@deepseek-ai/dsh-client-web-react'
import type { buildRenderApp as BuildRenderApp } from '@deepseek-ai/dsh-client-web'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { createClawdshControlClient } from './control-client.ts'
import { registerHarnessAdvancedAction } from './harness-advanced-action.tsx'
import css from './ProductShell.module.css'
import { registerClawdshRecords } from './register-clawdsh-records.tsx'
import { registerClawdshSettings } from './register-clawdsh-settings.tsx'

/** Native DSH application renderer installed after its required services activate. */
export interface ClawdshAppShellService {
  renderApp(): ReactNode
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    clawdshAppShell: ClawdshAppShellService
  }
}

/** Cordis plugin name. */
export const name = 'clawdsh-product-shell'

/** Native assembly dependencies; lifecycle waiting remains Loader-owned. */
export const inject = ['slots', 'sessions', 'layout', 'connection']

function ClawdshPresetIdentity(): ReactNode {
  return <span className={css.presetIdentity}>ClawDSH 模式</span>
}

/** Create the shell-owned plugin after the public Web library has been loaded. */
export function createNativeAppPlugin(buildRenderApp: typeof BuildRenderApp) {
  return {
    name,
    inject,
    /** Install the public slot renderer and expose the native root render closure. */
    apply(ctx: ClientContext): void {
      ctx.slots.install(createSlotRenderer())
      const connection = ctx.get('connection') as ConnectionHandle | undefined
      if (connection === undefined) throw new Error('ClawDSH browser: Connection service unavailable')
      const control = createClawdshControlClient(connection)
      const registrationOptions = {
        control,
        localControlAvailable: connection.isLoopback,
      }
      registerHarnessAdvancedAction(ctx)
      registerClawdshSettings(ctx, registrationOptions)
      registerClawdshRecords(ctx, registrationOptions)
      // The product entry has one fixed Agent composition identity; internal
      // channel and legacy presets remain available only in Harness Advanced.
      ctx.slots.inject('conversation.hero.agentPreset', () => ctx.slots.register({
        name: 'conversation.hero.agentPreset',
        priority: -1,
      }, ClawdshPresetIdentity))
      let renderApp: (() => ReactNode) | undefined
      ctx.reflect.provide('clawdshAppShell', {
        renderApp(): ReactNode {
          renderApp ??= buildRenderApp({ ctx })
          return renderApp()
        },
      })
    },
  }
}

// Keep the declaration merge rooted in the public Cordis module while the
// implementation accepts the richer Client face.
export type ClawdshProductContext = Context
