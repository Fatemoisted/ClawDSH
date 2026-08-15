import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { createSlotRenderer } from '@deepseek-ai/dsh-client-web-react'
import type { buildRenderApp as BuildRenderApp } from '@deepseek-ai/dsh-client-web'

/** Native DSH application renderer installed after its required services activate. */
export interface ClawdshAppShellService {
  renderConversation(): ReactNode
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    clawdshAppShell: ClawdshAppShellService
  }
}

/** Cordis plugin name. */
export const name = 'clawdsh-product-shell'

/** Native assembly dependencies; lifecycle waiting remains Loader-owned. */
export const inject = ['slots', 'sessions', 'layout']

/** Create the shell-owned plugin after the public Web library has been loaded. */
export function createNativeAppPlugin(buildRenderApp: typeof BuildRenderApp) {
  return {
    name,
    inject,
    /** Install the public slot renderer and expose the native root render closure. */
    apply(ctx: ClientContext): void {
      ctx.slots.install(createSlotRenderer())
      let renderApp: (() => ReactNode) | undefined
      ctx.reflect.provide('clawdshAppShell', {
        renderConversation(): ReactNode {
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
