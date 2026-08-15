import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { workspaceBrowserAliases } from './vite.config.ts'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: workspaceBrowserAliases },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    restoreMocks: true,
  },
  define: {
    'process.versions.node': '"0.0.0"',
    'process.execArgv': '[]',
    'process.env.CORDIS_SHARED': 'undefined',
  },
})
