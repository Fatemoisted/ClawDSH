import { readFileSync } from 'node:fs'
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
      runtimeTrees: [
        {
          platform: 'darwin',
          architecture: 'arm64',
          fileCount: 31_942,
          sha512: '71c4b7b37c79dfa37efb2297c52315786130c5b44ca0fa0469a96e09334f5fbbd027988aac5aa559a7a003a3a002201bbf0231ea27dec30d9817bcb13a40cfb6',
        },
        {
          platform: 'linux',
          architecture: 'x64',
          fileCount: 31_941,
          sha512: '9f2794054de6052b4a8e834c40f3652d17a95b2847289f32cc82c974146e244ca3dddb0cb058c0c395f613570b3516f18171fe663cc283efa0f0cd703c557f82',
        },
      ],
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

  it('keeps the public Channel installer lock identical to the provider lock', () => {
    const installerLock = JSON.parse(readFileSync(
      new URL('../runtime/production-lock.json', import.meta.url),
      'utf8',
    )) as Record<string, unknown>
    expect(installerLock).toEqual({
      schemaVersion: 1,
      track: 'production',
      packageName: 'openclaw',
      packageVersion: PRODUCTION_OPENCLAW_LOCK.packageVersion,
      nodeEngine: PRODUCTION_OPENCLAW_LOCK.nodeEngine,
      artifactUrl: PRODUCTION_OPENCLAW_LOCK.artifactUrl,
      artifactSha512: PRODUCTION_OPENCLAW_LOCK.artifactSha512,
      runtimePackageLockSha512: PRODUCTION_OPENCLAW_LOCK.runtimePackageLockSha512,
      tree: PRODUCTION_OPENCLAW_LOCK.tree,
      runtimeTrees: PRODUCTION_OPENCLAW_LOCK.runtimeTrees,
    })
  })
})
