import type { ReactNode } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ClawdshControlClient } from './control-client.ts'
import { SettingsPage } from './pages/SettingsPage.tsx'
import { ClawdshSettingsStore } from './settings-store.ts'

/** Dependencies captured by the native ClawDSH settings registration. */
export interface RegisterClawdshSettingsOptions {
  readonly control: ClawdshControlClient
  readonly localControlAvailable: boolean
}

/** Injected face supplied to the settings.section contribution. */
export interface ClawdshSettingsSectionInjected {
  readonly settingsStore: ClawdshSettingsStore
}

/** Props delivered by the native settings shell and slot injection. */
export type ClawdshSettingsSectionProps = Partial<ClawdshSettingsSectionInjected>
  & Partial<SettingsSectionOwnerProps>

/** Native settings section renderer. */
export function ClawdshSettingsSection({ settingsStore }: ClawdshSettingsSectionProps): ReactNode {
  if (settingsStore === undefined) return null
  return <SettingsPage store={settingsStore} />
}

/**
 * Register the first native Settings section and its plugin-lifetime memory store.
 * @param ctx - Client context exposing the public settings.section Slot.
 * @param options - one shared product-control client and its origin authority.
 * @returns the store retained by the plugin lifecycle; callers need not dispose it.
 */
export function registerClawdshSettings(
  ctx: ClientContext,
  options: RegisterClawdshSettingsOptions,
): ClawdshSettingsStore {
  const settingsStore = new ClawdshSettingsStore(options.control, options.localControlAvailable)
  ctx.effect(() => () => { settingsStore.dispose() }, 'clawdsh-product-shell: settings memory')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'clawdsh',
    order: -100,
    label: 'ClawDSH',
    inject: (): ClawdshSettingsSectionInjected => ({ settingsStore }),
  }, ClawdshSettingsSection))
  return settingsStore
}
