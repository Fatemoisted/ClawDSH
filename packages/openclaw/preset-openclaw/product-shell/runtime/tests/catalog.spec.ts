import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PRODUCTION_CHANNEL_CATALOG } from '../src/production-channel-catalog.ts'

interface ProductionCatalog {
  readonly expectedCount: number
  readonly channels: readonly {
    readonly id: string
    readonly label: string
    readonly status: 'core' | 'bundled' | 'repo-official' | 'external'
  }[]
}

describe('ClawDSH product channel catalog', () => {
  it('matches the checked production lock without promoting support evidence', () => {
    const source = JSON.parse(readFileSync(
      resolve(process.cwd(), '../../../../../tools/openclaw-channel-host/channels.production.json'),
      'utf8',
    )) as ProductionCatalog
    expect(PRODUCTION_CHANNEL_CATALOG).toHaveLength(source.expectedCount)
    expect(PRODUCTION_CHANNEL_CATALOG.map(({ id, label, provenance }) => ({ id, label, status: provenance })))
      .toEqual(source.channels.map(({ id, label, status }) => ({ id, label, status })))
    expect(new Set(PRODUCTION_CHANNEL_CATALOG.map(channel => channel.support))).toEqual(new Set(['cataloged']))
  })
})
