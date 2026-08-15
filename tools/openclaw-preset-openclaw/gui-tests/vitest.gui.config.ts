import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const repositoryRoot = resolve(import.meta.dirname, '../../..')

export default defineConfig({
  root: repositoryRoot,
  test: {
    include: [
      'tools/openclaw-preset-openclaw/gui-tests/identity.spec.ts',
      'tools/openclaw-preset-openclaw/gui-tests/real-profile.e2e.ts',
    ],
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 180_000,
  },
})
