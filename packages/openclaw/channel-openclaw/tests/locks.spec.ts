import { describe, expect, it } from 'vitest'
import { CANARY_OPENCLAW_LOCK, lockFor, PRODUCTION_OPENCLAW_LOCK } from '../src/locks.ts'

describe('immutable OpenClaw host locks', () => {
  it('selects the complete production and canary identities', () => {
    expect(lockFor('production')).toBe(PRODUCTION_OPENCLAW_LOCK)
    expect(lockFor('canary')).toBe(CANARY_OPENCLAW_LOCK)
    expect(PRODUCTION_OPENCLAW_LOCK).toMatchObject({
      tag: 'v2026.7.1-2',
      commitSha: '0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c',
      packageVersion: '2026.7.1-2',
      agentHarness: 'v1',
      runtimeTrees: [{
        platform: 'darwin',
        architecture: 'arm64',
        fileCount: 31_942,
        sha512: '71c4b7b37c79dfa37efb2297c52315786130c5b44ca0fa0469a96e09334f5fbbd027988aac5aa559a7a003a3a002201bbf0231ea27dec30d9817bcb13a40cfb6',
      }],
      tree: { fileCount: 8550 },
    })
    expect(CANARY_OPENCLAW_LOCK).toMatchObject({
      tag: 'main@f1ced37',
      commitSha: 'f1ced37ce5df8c7bc7f3b46c579e5ce181feaae0',
      agentHarness: 'v2',
      artifactKind: 'source-archive',
    })
    expect(CANARY_OPENCLAW_LOCK.tree).toBeUndefined()
    expect(CANARY_OPENCLAW_LOCK.runtimeTrees).toBeUndefined()
  })
})
