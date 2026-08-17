import { CLAWDSH_BOOT_FAILURE_CODES, renderFatalBootFailure } from './fatal-boot.ts'

interface BrowserEntry {
  run(): Promise<void>
  dispose(): Promise<void>
}

interface BrowserEntryModule {
  ClawdshWebEntry: new (mount: HTMLElement) => BrowserEntry
}

export type BrowserEntryLoader = () => Promise<BrowserEntryModule>

const loadBrowserEntry: BrowserEntryLoader = async () => import('./ClawdshWebEntry.tsx')

/** Load and run the product browser while retaining a safe failure surface for every asynchronous bootstrap phase. */
export async function bootstrapClawdsh(
  mount: HTMLElement,
  loadEntry: BrowserEntryLoader = loadBrowserEntry,
): Promise<void> {
  let entry: BrowserEntry | undefined
  try {
    const module = await loadEntry()
    entry = new module.ClawdshWebEntry(mount)
    await entry.run()
  } catch {
    console.error(CLAWDSH_BOOT_FAILURE_CODES.bootstrap)
    try {
      await entry?.dispose()
    } catch {
      console.error(CLAWDSH_BOOT_FAILURE_CODES.dispose)
    }
    renderFatalBootFailure(mount)
  }
}
