/** Immutable OpenClaw host identities admitted by this provider. @module @clawdsh/dsh-channel-openclaw/locks */

/** Production and isolated canary tracks. */
export type OpenClawTrack = 'production' | 'canary'

/** Installed runtime bytes approved for one operating-system and CPU pair. */
export interface OpenClawRuntimeTreeLock {
  /** Node platform identifier reported by the deployment host. */
  readonly platform: NodeJS.Platform
  /** Node architecture identifier reported by the deployment host. */
  readonly architecture: string
  /** Number of ordinary files in the complete installed npm project. */
  readonly fileCount: number
  /** Lowercase SHA-512 over all installed file bytes, paths, and verified link targets. */
  readonly sha512: string
}

/** Runtime-relevant subset of one checked-in host lock. */
export interface OpenClawRuntimeLock {
  /** Deployment track selected by configuration. */
  readonly track: OpenClawTrack
  /** Stable tag, or the audited source observation label. */
  readonly tag: string
  /** Peeled upstream source commit. */
  readonly commitSha: string
  /** Hex SHA-512 of the downloadable host artifact. */
  readonly artifactSha512: string
  /** Distribution form whose bytes are identified by `artifactSha512`. */
  readonly artifactKind: 'npm-tarball' | 'source-archive'
  /** Immutable upstream download location recorded for acquisition tooling. */
  readonly artifactUrl: string
  /** Exact package version expected in the installed host. */
  readonly packageVersion: string
  /** Version declared by the upstream plugin manifest generation. */
  readonly manifestVersion: string
  /** Exact Node engine declaration copied from the locked host. */
  readonly nodeEngine: string
  /** SHA-512 of the checked npm runtime dependency lock; absent for source-only tracks. */
  readonly runtimePackageLockSha512?: string
  /** Complete installed npm project trees admitted on exact platform and architecture pairs. */
  readonly runtimeTrees?: readonly OpenClawRuntimeTreeLock[]
  /** Extracted ordinary-file tree; absent for source-only Canary. */
  readonly tree?: { readonly fileCount: number; readonly sha512: string }
  /** Public OpenClaw AgentHarness generation implemented by the bridge. */
  readonly agentHarness: 'v1' | 'v2'
}

/** Stable npm release used by production. */
export const PRODUCTION_OPENCLAW_LOCK: OpenClawRuntimeLock = {
  track: 'production',
  tag: 'v2026.7.1-2',
  commitSha: '0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c',
  artifactSha512: 'c9c177c8f71b8cde9b50f79a531e8c87abf37b58505a80f7093ff059c983edaf316871c745468095aabe945c4c1dfd6cb0480e0d50308e5cd8aa9dadc24619ee',
  artifactKind: 'npm-tarball',
  artifactUrl: 'https://registry.npmjs.org/openclaw/-/openclaw-2026.7.1-2.tgz',
  packageVersion: '2026.7.1-2',
  manifestVersion: '2026.7.1',
  nodeEngine: '>=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0',
  runtimePackageLockSha512: 'cbb255ff2de5337f4bc6914a7083948a1ff9df2e30f66a9d86e35efc4c4ec49e703e755dc68f3802a343e3de54949383f40312266e7ab87c6b14cd0b68a92adb',
  runtimeTrees: [{
    platform: 'darwin',
    architecture: 'arm64',
    fileCount: 31_942,
    sha512: '71c4b7b37c79dfa37efb2297c52315786130c5b44ca0fa0469a96e09334f5fbbd027988aac5aa559a7a003a3a002201bbf0231ea27dec30d9817bcb13a40cfb6',
  }, {
    platform: 'linux',
    architecture: 'x64',
    fileCount: 31_941,
    sha512: '9f2794054de6052b4a8e834c40f3652d17a95b2847289f32cc82c974146e244ca3dddb0cb058c0c395f613570b3516f18171fe663cc283efa0f0cd703c557f82',
  }],
  tree: {
    fileCount: 8550,
    sha512: 'b7b846411d1091a2067cfe964b9395d443aae0a64ae9d70707b9eed01ec4e949714b851db6e153e9ff84d9a9055408a2eb18c79dd94400d59293d39a648e0d8b',
  },
  agentHarness: 'v1',
}

/** Audited source snapshot used only by isolated Canary deployments. */
export const CANARY_OPENCLAW_LOCK: OpenClawRuntimeLock = {
  track: 'canary',
  tag: 'main@f1ced37',
  commitSha: 'f1ced37ce5df8c7bc7f3b46c579e5ce181feaae0',
  artifactSha512: '3c48e24da9b7bf281eb10db63ebd03179d4212a17a77d7826b18731f18323a4c0a00858982824ed68a2c90b3cc6a4a252a63fa27bf7b4241b9688c8ce01fe145',
  artifactKind: 'source-archive',
  artifactUrl: 'https://github.com/openclaw/openclaw/archive/f1ced37ce5df8c7bc7f3b46c579e5ce181feaae0.tar.gz',
  packageVersion: '2026.8.1',
  manifestVersion: '2026.8.1',
  nodeEngine: '>=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0',
  agentHarness: 'v2',
}

/**
 * Resolve an immutable track lock.
 * @param track - Production or isolated Canary selection.
 * @returns The checked-in host identity for that track.
 */
export function lockFor(track: OpenClawTrack): OpenClawRuntimeLock {
  return track === 'production' ? PRODUCTION_OPENCLAW_LOCK : CANARY_OPENCLAW_LOCK
}
