import { defineConfig } from 'tsdown'

/** Build the nested Host runtime while keeping DSH and Cordis singleton packages external. */
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: true,
  dts: true,
  clean: true,
  deps: {
    neverBundle: [
      '@deepseek-ai/cordis',
      '@deepseek-ai/cordis-plugin-include',
      '@deepseek-ai/cordis-plugin-loader',
      '@deepseek-ai/dsh-agent-presets',
      '@deepseek-ai/dsh-client-connection',
      '@deepseek-ai/dsh-credentials',
      '@deepseek-ai/dsh-host-apiproxy',
      '@deepseek-ai/dsh-host-frontend-static',
      '@deepseek-ai/dsh-host-webserver',
      '@deepseek-ai/dsh-settings',
      '@deepseek-ai/schemastery',
      'js-yaml',
    ],
  },
})
