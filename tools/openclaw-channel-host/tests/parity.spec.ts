import { describe, expect, it } from 'vitest'
import type { ArtifactSet, ChannelSupportCatalog } from '../schema.ts'
import {
  projectParityDocument,
  renderParityProjection,
  supportStateCounts,
} from '../generate-parity.ts'

function support(track: 'production' | 'canary', statuses: Array<'cataloged' | 'installable' | 'certified' | 'enabled'>): ChannelSupportCatalog {
  return {
    schemaVersion: 1,
    track,
    hostCommit: 'a'.repeat(40),
    sourceCatalog: `channels.${track}.json`,
    observedAt: '2026-08-15T00:00:00Z',
    expectedCount: statuses.length,
    channels: statuses.map((status, index) => ({
      id: `channel-${index}`,
      status,
      optIn: false,
      installability: null,
      certifications: [],
      enablements: [],
    })),
  }
}

describe('generated parity projection', () => {
  it('counts and renders all four support states in fixed order', () => {
    const production = support('production', ['cataloged', 'cataloged', 'certified'])
    const canary = support('canary', ['installable', 'enabled'])
    expect(supportStateCounts(production)).toEqual({
      cataloged: 2, installable: 0, certified: 1, enabled: 0,
    })
    const projection = renderParityProjection({
      productionSupport: production,
      canarySupport: canary,
    } as ArtifactSet)
    expect(projection).toContain('| production | 2 | 0 | 1 | 0 |')
    expect(projection).toContain('| canary | 0 | 1 | 0 | 1 |')
  })

  it('replaces one marker pair and rejects missing or duplicate markers', () => {
    const projection = '<!-- BEGIN GENERATED openclaw-channel-support (generate-parity.ts) — do not edit between markers -->\nnew\n<!-- END GENERATED openclaw-channel-support -->'
    expect(projectParityDocument(
      'before\n<!-- BEGIN GENERATED openclaw-channel-support (generate-parity.ts) — do not edit between markers -->\nold\n<!-- END GENERATED openclaw-channel-support -->\nafter\n',
      projection,
    )).toBe(`before\n${projection}\nafter\n`)
    expect(() => projectParityDocument('no markers\n', projection)).toThrow(/exactly one/)
    expect(() => projectParityDocument(`${projection}\n${projection}\n`, projection)).toThrow(/exactly one/)
  })
})
