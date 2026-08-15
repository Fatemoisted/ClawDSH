import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { createRoot, type Root } from 'react-dom/client'
import type {
  BootManifest,
  ClientModuleSystemOptions,
  DshWindow,
} from '@deepseek-ai/dsh-client-modules/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type { LoaderStatusStore, KernelValueSignal } from '@deepseek-ai/dsh-client-web'
import { ClawdshBootRoot } from './ClawdshBootRoot.tsx'
import { ProductShell } from './ProductShell.tsx'
import { createNativeAppPlugin } from './native-app-plugin.tsx'
import {
  createClawdshControlClient,
  type ClawdshControlClient,
} from './control-client.ts'
import { CLAWDSH_APP_SHELL_ID, CLIENT_MODULES_ID, clawdshLoaderRows } from './loader-rows.ts'

/** Test transport seam inherited from the public Client module system. */
export type ClawdshBootSeams = Pick<ClientModuleSystemOptions, 'loadBundle'>

type ModulesClient = typeof import('@deepseek-ai/dsh-client-modules/client')
type WebLibrary = typeof import('@deepseek-ai/dsh-client-web')

interface PublicClientKernel {
  readonly modulesClient: ModulesClient
  readonly web: WebLibrary
}

let cachedPublicClientKernel: Promise<PublicClientKernel> | undefined

/**
 * Materialize the published client-module bundle through its documented
 * registration handoff, then load the ordinary public Web library exports.
 */
async function materializePublicClientKernel(): Promise<PublicClientKernel> {
  const win = globalThis as DshWindow
  if (win.__ModuleLoader__ !== undefined) {
    throw new Error('ClawDSH browser: module registration sink already exists before boot')
  }
  let modulesClient: ModulesClient | undefined
  win.__ModuleLoader__ = {
    load(handoff) {
      if (handoff.id !== CLIENT_MODULES_ID || modulesClient !== undefined) {
        throw new Error(`ClawDSH browser: unexpected bootstrap module ${JSON.stringify(handoff.id)}`)
      }
      modulesClient = handoff.factory((specifier) => {
        throw new Error(`ClawDSH browser: bootstrap module requested unexpected dependency ${JSON.stringify(specifier)}`)
      }) as ModulesClient
    },
  }
  try {
    const web = await import('@deepseek-ai/dsh-client-web')
    if (modulesClient === undefined) {
      throw new Error('ClawDSH browser: published client-module bundle did not register')
    }
    return { modulesClient, web }
  } finally {
    delete win.__ModuleLoader__
  }
}

function loadPublicClientKernel(): Promise<PublicClientKernel> {
  cachedPublicClientKernel ??= materializePublicClientKernel().catch((error: unknown) => {
    cachedPublicClientKernel = undefined
    throw error
  })
  return cachedPublicClientKernel
}

/** Product browser kernel over the full Host-composed DSH Client plugin graph. */
export class ClawdshWebEntry {
  private status!: LoaderStatusStore
  private settled!: KernelValueSignal<boolean>
  private error!: KernelValueSignal<string | undefined>
  private ctx: Context | undefined
  private modules: InstanceType<ModulesClient['ClientModuleSystem']> | undefined
  private manifest!: BootManifest
  private root: Root | undefined
  private web!: WebLibrary
  private control: ClawdshControlClient | undefined

  constructor(
    private readonly mount: HTMLElement,
    private readonly seams?: ClawdshBootSeams,
  ) {}

  /** Parse the Host manifest, boot every Client entry, then reveal the product shell. */
  async run(): Promise<void> {
    const kernel = await loadPublicClientKernel()
    this.web = kernel.web
    this.status = kernel.web.createLoaderStatusStore()
    this.settled = kernel.web.createSignal(false)
    this.error = kernel.web.createSignal<string | undefined>(undefined)
    this.manifest = kernel.modulesClient.parseBootManifest((globalThis as DshWindow).__DSH_BOOT__)
    const modules = new kernel.modulesClient.ClientModuleSystem({
      modules: this.manifest.modules,
      staticModules: kernel.web.getStaticModules(),
      ...this.seams,
    })
    this.modules = modules
    modules.registerStatic(CLIENT_MODULES_ID, kernel.modulesClient)
    modules.registerStatic(CLAWDSH_APP_SHELL_ID, createNativeAppPlugin(kernel.web.buildRenderApp))
    ;(globalThis as DshWindow).__DSH_MODULES__ = modules

    this.ctx = new Context()
    this.root = createRoot(this.mount)
    this.root.render(
      <ClawdshBootRoot
        settled={this.settled}
        status={this.status}
        error={this.error}
        renderProduct={() => {
          const ctx = this.requireContext()
          const shell = ctx.get('clawdshAppShell')
          if (shell === undefined) throw new Error('ClawDSH browser: assembly service missing after settlement')
          const connection = ctx.get('connection') as ConnectionHandle | undefined
          if (connection === undefined) throw new Error('ClawDSH browser: Connection service unavailable')
          const sessions = ctx.get('sessions') as ISessions | undefined
          if (sessions === undefined) throw new Error('ClawDSH browser: Sessions service unavailable')
          this.control ??= createClawdshControlClient(connection)
          return (
            <ProductShell
              renderConversation={shell.renderConversation}
              control={this.control}
              localControlAvailable={connection.isLoopback}
              sessions={sessions}
            />
          )
        }}
      />,
    )

    const prefetching = this.prefetchImmediateTier()
    try {
      await this.runPluginBoot(prefetching)
      this.settled.set(true)
    } catch (reason) {
      console.error(reason)
      this.error.set(reason instanceof Error ? reason.message : String(reason))
    }
  }

  /** Unmount the UI and dispose the complete Client plugin graph. */
  async dispose(): Promise<void> {
    this.root?.unmount()
    this.root = undefined
    const ctx = this.ctx
    this.ctx = undefined
    try {
      await ctx?.fiber.dispose()
    } finally {
      const win = globalThis as DshWindow
      if (this.modules !== undefined && win.__DSH_MODULES__ === this.modules) {
        delete win.__DSH_MODULES__
        delete win.__ModuleLoader__
      }
      this.modules = undefined
      this.control = undefined
    }
  }

  private async prefetchImmediateTier(): Promise<void> {
    const modules = this.requireModules()
    await Promise.all(this.manifest.plugins
      .filter(row => row.immediately)
      .map(row => modules.prefetch(row.id).catch(() => {
        // Entry materialization owns the actionable import failure.
      })))
  }

  private async runPluginBoot(prefetching: Promise<void>): Promise<void> {
    const ctx = this.requireContext()
    await ctx.plugin(Loader)
    const loader = ctx.loader
    loader.internal = this.requireModules() as never

    ctx.on('internal/status', (fiber) => {
      const entry = fiber.entry
      if (entry?.fiber === undefined) return
      this.status.set(entry.options.name, this.web.STATE_LABELS[entry.fiber.state])
    })

    await prefetching
    await Promise.all(clawdshLoaderRows(this.manifest).map(async (name) => {
      this.status.set(name, 'loading')
      const id = await loader.create({ name })
      if (loader.resolve(id).fiber === undefined) this.status.set(name, 'failed')
    }))
    await loader.await()
    this.assertEntriesActive()
  }

  private assertEntriesActive(): void {
    const ctx = this.requireContext()
    const failures = [...ctx.loader.entries()].flatMap((entry): string[] => {
      const fiber = entry.fiber
      if (fiber === undefined) {
        return [`${entry.options.name}: import failed (see console for the import error)`]
      }
      const phase = this.web.STATE_LABELS[fiber.state]
      if (phase === 'active') return []
      if (phase !== 'pending') return [`${entry.options.name}: ${phase}`]
      const missing = Object.keys(fiber.inject).filter(service => ctx.get(service) === undefined)
      const serviceNoun = missing.length === 1 ? 'service' : 'services'
      return [`${entry.options.name}: pending (waiting for ${serviceNoun}: ${missing.join(', ') || 'unknown'})`]
    })
    if (failures.length > 0) {
      throw new Error(`ClawDSH browser: ${String(failures.length)} Loader entries did not activate\n${failures.join('\n')}`)
    }
  }

  private requireContext(): Context {
    if (this.ctx === undefined) throw new Error('ClawDSH browser: Client context is not active')
    return this.ctx
  }

  private requireModules(): InstanceType<ModulesClient['ClientModuleSystem']> {
    if (this.modules === undefined) throw new Error('ClawDSH browser: Client module system is not active')
    return this.modules
  }
}
