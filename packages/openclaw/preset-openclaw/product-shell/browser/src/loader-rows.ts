import type { BootManifest } from '@deepseek-ai/dsh-client-modules/client'

/** Reserved static Loader entry owned by the ClawDSH browser kernel. */
export const CLAWDSH_APP_SHELL_ID = '@clawdsh/dsh-client-product-shell'

/** Bootstrap identity: the browser module system must adopt its own wrapper. */
export const CLIENT_MODULES_ID = '@deepseek-ai/dsh-client-modules'

/**
 * Complete Loader entry list: the modules wrapper first, every Host-composed
 * plugin exactly once, then the ClawDSH-owned assembly entry.
 */
export function clawdshLoaderRows(manifest: BootManifest): readonly string[] {
  if (manifest.plugins.some(row => row.id === CLAWDSH_APP_SHELL_ID)) {
    throw new Error(`ClawDSH browser: boot manifest must not claim reserved entry ${CLAWDSH_APP_SHELL_ID}`)
  }
  return [
    CLIENT_MODULES_ID,
    ...manifest.plugins.map(row => row.id).filter(id => id !== CLIENT_MODULES_ID),
    CLAWDSH_APP_SHELL_ID,
  ]
}
