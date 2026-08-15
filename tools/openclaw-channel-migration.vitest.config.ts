import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tools/openclaw-channel-migration.spec.ts'],
    environment: 'node',
  },
})
