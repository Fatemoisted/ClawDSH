import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const repositoryRoot = resolve(import.meta.dirname, '../../../..')

export default defineConfig({
  root: repositoryRoot,
  test: {
    include: [
      'packages/openclaw/preset-openclaw/gui-tests/brand-assets.spec.ts',
      'packages/openclaw/preset-openclaw/gui-tests/identity.spec.ts',
      'packages/openclaw/preset-openclaw/gui-tests/real-profile.e2e.ts',
    ],
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 180_000,
  },
})
