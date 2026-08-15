import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    fileParallelism: false,
    pool: 'forks',
  },
})
