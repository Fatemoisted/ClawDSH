/** ClawDSH-specific workspace publication constraints. */

import { describe, expect, it } from 'vitest'
import {
  checkClawdshVersions,
  checkWorkspace,
  type PackageManifest,
  type WorkspaceManifest,
} from './check-workspace-constraints.ts'

/** A minimal ClawDSH manifest satisfying the shared dsh library policy. */
function clawdshManifest(overrides: Partial<PackageManifest> = {}): PackageManifest {
  return {
    name: '@clawdsh/dsh-channel-core',
    version: '0.1.0',
    type: 'module',
    main: 'lib/index.js',
    types: 'lib/types/index.d.ts',
    exports: {
      '.': {
        types: './lib/types/index.d.ts',
        default: './lib/index.js',
      },
      './invariant': {
        types: './lib/types/invariant.d.ts',
        default: './lib/invariant.js',
      },
    },
    files: ['lib/index.js', 'lib/invariant.js', 'lib/types/**/*.d.ts'],
    publishConfig: { access: 'public' },
    repository: {
      type: 'git',
      url: 'git+https://github.com/Fatemoisted/ClawDSH.git',
      directory: 'packages/openclaw/channel-core',
    },
    peerDependencies: { '@deepseek-ai/cordis': 'workspace:^' },
    devDependencies: { '@deepseek-ai/cordis': 'workspace:^' },
    ...overrides,
  }
}

describe('ClawDSH workspace constraints', () => {
  it('accepts an independently advanced ClawDSH version', () => {
    expect(checkWorkspace({
      dir: 'packages/openclaw/channel-core',
      manifest: clawdshManifest({ version: '0.2.0-rc.1' }),
    })).toEqual([])
  })

  it('requires the ClawDSH repository, directory, and scope', () => {
    const wrongRepository = clawdshManifest({
      repository: {
        type: 'git',
        url: 'git+https://github.com/deepseek-ai/deepseek-harness.git',
        directory: 'packages/openclaw/channel-core',
      },
    })
    const wrongIdentity = clawdshManifest({
      name: '@deepseek-ai/dsh-channel-core',
      version: '0.1.0-rc.5',
    })

    expect(checkWorkspace({ dir: 'packages/openclaw/channel-core', manifest: wrongRepository }).join('\n'))
      .toContain('git+https://github.com/Fatemoisted/ClawDSH.git')
    const identityErrors = checkWorkspace({
      dir: 'packages/openclaw/channel-core',
      manifest: wrongIdentity,
    }).join('\n')
    expect(identityErrors).toContain('must name an @clawdsh/dsh-* package')
  })

  it('requires one publishable version across the ClawDSH family', () => {
    const manifests: WorkspaceManifest[] = [
      { dir: 'packages/openclaw/channel-core', manifest: clawdshManifest({ version: '0.2.0' }) },
      {
        dir: 'packages/openclaw/memory',
        manifest: clawdshManifest({ name: '@clawdsh/dsh-memory', version: '0.2.1' }),
      },
    ]
    expect(checkClawdshVersions(manifests).join('\n')).toContain('must share one version')

    manifests[1]!.manifest.version = 'next'
    const malformed = checkClawdshVersions(manifests).join('\n')
    expect(malformed).toContain('version must be X.Y.Z')
  })

  it('reuses the dsh ESM, exports, files, payload, and Cordis rules', () => {
    const errors = checkWorkspace({
      dir: 'packages/openclaw/channel-core',
      manifest: clawdshManifest({
        type: 'commonjs',
        main: 'src/index.ts',
        types: 'src/index.ts',
        exports: {
          '.': { types: './src/index.ts', default: './src/index.ts' },
          './invariant': { types: './src/invariant.ts' },
        },
        files: ['src'],
        peerDependencies: {},
        devDependencies: {},
      }),
    }).join('\n')

    expect(errors).toContain('@deepseek-ai/cordis must be a peerDependency')
    expect(errors).toContain('@deepseek-ai/cordis must also be a devDependency')
    expect(errors).toContain('must set "type": "module"')
    expect(errors).toContain('must set "main": "lib/index.js"')
    expect(errors).toContain('must set "types": "lib/types/index.d.ts"')
    expect(errors).toContain('exports["."].default must be "./lib/index.js"')
    expect(errors).toContain('exports["./invariant"] must declare both types and default targets')
    expect(errors).toContain('package.json files must not publish "src"')
    expect(errors).toContain('package.json files must be ["lib/index.js","lib/invariant.js","lib/types/**/*.d.ts"]')
  })
})
