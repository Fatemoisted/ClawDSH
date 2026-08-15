/** Generate the four-state OpenClaw Channel projection embedded in parity.md. */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  SUPPORT_STATUSES,
  type ArtifactSet,
  type ChannelSupportCatalog,
  type SupportStatus,
  validateArtifactSet,
} from './schema.ts'
import { loadArtifactSet } from './verify.ts'

const START_MARKER = '<!-- BEGIN GENERATED openclaw-channel-support (generate-parity.ts) — do not edit between markers -->'
const END_MARKER = '<!-- END GENERATED openclaw-channel-support -->'
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const PARITY_DOCUMENTS = [
  resolve(REPOSITORY_ROOT, 'docs/matrix/parity.md'),
  resolve(REPOSITORY_ROOT, 'docs/matrix/parity.zh.md'),
]

/** Count channels by their highest evidenced support state. */
export function supportStateCounts(catalog: ChannelSupportCatalog): Record<SupportStatus, number> {
  const counts: Record<SupportStatus, number> = {
    cataloged: 0,
    installable: 0,
    certified: 0,
    enabled: 0,
  }
  for (const channel of catalog.channels) counts[channel.status] += 1
  return counts
}

/** Render the canonical bilingual-safe four-state table from validated artifacts. */
export function renderParityProjection(artifacts: ArtifactSet): string {
  const rows = [artifacts.productionSupport, artifacts.canarySupport].map(catalog => {
    const counts = supportStateCounts(catalog)
    return `| ${catalog.track} | ${SUPPORT_STATUSES.map(status => counts[status]).join(' | ')} |`
  })
  return [
    START_MARKER,
    `| Locked track | ${SUPPORT_STATUSES.map(status => `\`${status}\``).join(' | ')} |`,
    '|---|---:|---:|---:|---:|',
    ...rows,
    END_MARKER,
  ].join('\n')
}

/** Replace exactly one generated region while preserving all authored prose. */
export function projectParityDocument(document: string, projection: string): string {
  const start = document.indexOf(START_MARKER)
  const end = document.indexOf(END_MARKER)
  if (start < 0 || end < start || document.indexOf(START_MARKER, start + 1) >= 0
    || document.indexOf(END_MARKER, end + 1) >= 0) {
    throw new Error('OpenClaw parity projection requires exactly one ordered marker pair')
  }
  return `${document.slice(0, start)}${projection}${document.slice(end + END_MARKER.length)}`
}

/** Check or rewrite both bilingual parity projections from the locked support catalogs. */
export function generateParity(mode: 'check' | 'write'): string[] {
  const rawArtifacts = loadArtifactSet()
  const errors = validateArtifactSet(rawArtifacts)
  if (errors.length > 0) return errors
  // validateArtifactSet exhaustively validates every durable JSON field before this local assertion.
  const projection = renderParityProjection(rawArtifacts as ArtifactSet)
  const stale: string[] = []
  for (const path of PARITY_DOCUMENTS) {
    const current = readFileSync(path, 'utf8')
    const expected = projectParityDocument(current, projection)
    if (expected === current) continue
    if (mode === 'write') writeFileSync(path, expected)
    else stale.push(`${path}: generated OpenClaw Channel support projection is stale`)
  }
  return stale
}

function main(): void {
  const argument = process.argv[2]
  if ((argument !== '--check' && argument !== '--write') || process.argv.length !== 3) {
    throw new Error('expected exactly --check or --write')
  }
  const mode = argument === '--check' ? 'check' : 'write'
  const errors = generateParity(mode)
  if (errors.length > 0) throw new Error(errors.join('\n'))
  process.stdout.write(`OpenClaw Channel parity projection ${mode === 'check' ? 'verified' : 'written'}.\n`)
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && pathToFileURL(resolve(invokedPath)).href === import.meta.url) {
  try {
    main()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`openclaw-channel-parity: ${message}\n`)
    process.exitCode = 1
  }
}
