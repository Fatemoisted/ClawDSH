import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type AliasOptions, type Plugin } from 'vite'

const STANDALONE_ERROR = 'ClawDSH browser is not standalone: start it through the ClawDSH profile so the Host can inject window.__DSH_BOOT__.'

/** Refuse a boot-manifest-free development or preview server. */
function rejectStandaloneServe(): Plugin {
  return {
    name: 'clawdsh-reject-standalone-serve',
    config(_config, environment) {
      if (environment.command === 'serve') throw new Error(STANDALONE_ERROR)
    },
  }
}

/** Browser-only replacement for Node's module loader API. */
export const workspaceBrowserAliases: AliasOptions = [
  { find: /^node:module$/, replacement: fileURLToPath(new URL('./src/node-module-stub.ts', import.meta.url)) },
]

export default defineConfig({
  base: '/clawdsh/',
  plugins: [rejectStandaloneServe(), react()],
  resolve: { alias: workspaceBrowserAliases },
  define: {
    'process.versions.node': '"0.0.0"',
    'process.execArgv': '[]',
    'process.env.CORDIS_SHARED': 'undefined',
  },
  build: {
    outDir: '../runtime/web',
    emptyOutDir: true,
    sourcemap: true,
  },
})
