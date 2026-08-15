/** Read-only legacy Telegram/Feishu migration inventory for the OpenClaw Gateway cutover. */

import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const LEGACY_ADAPTERS = {
  telegram: '@clawdsh/dsh-channel-telegram',
  feishu: '@clawdsh/dsh-channel-feishu',
} as const

/** Credential-shaped legacy names whose presence may be reported without exposing values. */
export const LEGACY_CHANNEL_ENV_NAMES = [
  'TELEGRAM_BOT_TOKEN',
  'FEISHU_APP_ID',
  'FEISHU_APP_SECRET',
  'LARK_APP_ID',
  'LARK_APP_SECRET',
] as const

/** One inspected text file with values deliberately omitted. */
export interface MigrationInputReport {
  readonly path: string
  readonly adapters: readonly (keyof typeof LEGACY_ADAPTERS)[]
  readonly environmentNames: readonly string[]
}

/** Safe migration inventory; it never includes credential values. */
export interface ChannelMigrationReport {
  readonly schemaVersion: 1
  readonly inputs: readonly MigrationInputReport[]
  readonly processEnvironmentNames: readonly string[]
  readonly legacyAdaptersDetected: readonly (keyof typeof LEGACY_ADAPTERS)[]
  readonly copiedSecrets: false
  readonly requiresOldAdapterShutdown: boolean
  readonly notes: readonly string[]
}

/** Parse environment assignment names without retaining their values. */
export function environmentNames(text: string): string[] {
  const names = new Set<string>()
  for (const line of text.split(/\r?\n/u)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)
    if (match?.[1] !== undefined) names.add(match[1])
  }
  return [...names].sort()
}

/** Inspect explicit profile or env files and the names present in one environment object. */
export async function inspectLegacyChannelConfiguration(
  paths: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ChannelMigrationReport> {
  const inputs: MigrationInputReport[] = []
  const adapters = new Set<keyof typeof LEGACY_ADAPTERS>()
  for (const path of paths) {
    if (!isAbsolute(path)) throw new Error(`openclaw-channel-migration: path must be absolute: ${path}`)
    const text = await readFile(path, 'utf8')
    const foundAdapters = (Object.entries(LEGACY_ADAPTERS) as Array<[keyof typeof LEGACY_ADAPTERS, string]>)
      .filter(([, packageName]) => text.includes(packageName))
      .map(([name]) => name)
    foundAdapters.forEach(name => adapters.add(name))
    const names = environmentNames(text).filter(name => LEGACY_CHANNEL_ENV_NAMES.includes(name as never))
    for (const name of LEGACY_CHANNEL_ENV_NAMES) {
      if (text.includes(name) && !names.includes(name)) names.push(name)
    }
    inputs.push({ path, adapters: foundAdapters, environmentNames: names.sort() })
  }
  const processEnvironmentNames = LEGACY_CHANNEL_ENV_NAMES.filter(name => environment[name] !== undefined)
  return {
    schemaVersion: 1,
    inputs,
    processEnvironmentNames,
    legacyAdaptersDetected: [...adapters].sort(),
    copiedSecrets: false,
    requiresOldAdapterShutdown: adapters.size > 0 || processEnvironmentNames.length > 0,
    notes: [
      'The report contains names and adapter references only; no credential value was read into the output.',
      'Stop every legacy adapter before enabling the same platform account in OpenClaw Gateway.',
      'Create OpenClaw credentials through its own account setup; do not copy plaintext secrets automatically.',
    ],
  }
}

/** Parse the intentionally small read-only CLI. */
export function parseArguments(argv: readonly string[]): string[] {
  const paths: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument !== '--input') throw new Error(`openclaw-channel-migration: unknown argument ${String(argument)}`)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new Error('openclaw-channel-migration: --input requires a path')
    }
    paths.push(resolve(value))
    index += 1
  }
  if (paths.length === 0) throw new Error('openclaw-channel-migration: pass at least one --input path')
  return paths
}

/** Run the CLI without ever printing inspected file contents. */
async function main(): Promise<void> {
  const report = await inspectLegacyChannelConfiguration(parseArguments(process.argv.slice(2)))
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

const invoked = process.argv[1]
if (invoked !== undefined && pathToFileURL(resolve(invoked)).href === import.meta.url) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
