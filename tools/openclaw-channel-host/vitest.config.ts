import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tools/openclaw-channel-host/tests/**/*.spec.ts'],
    pool: 'forks',
  },
})
