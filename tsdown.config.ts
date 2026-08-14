import { defineConfig } from 'tsdown'
import { typertPlugin } from './packages/typert/generator/lib/types/tsdown-plugin.js'

function isBuildFaceClient(value: unknown): boolean {
  if (value === undefined || value === 'host') return false
  if (value === 'client') return true
  throw new Error(`tsdown: --env.DSH_BUILD_FACE must be host or client, received ${String(value)}`)
}

/**
 * The ordinary workspace build consumes JavaScript emitted by the Host
 * TypeScript project and runs Typert. The Client pass selects packages that
 * declare a browser bundle and lets their package-local configs emit both
 * their Node loader entry and browser artifact.
 */
export default defineConfig(({ env }) => {
  const client = isBuildFaceClient(env?.DSH_BUILD_FACE)
  return {
    // ClawDSH: workspace 扫描以"目录"为粒度（不要求有 package.json），
    // packages/openclaw/ 中的目录现均为已实现的 npm 包，直接参与扫描；
    // 模板与组装素材已移至 tools/、决策记录移至 docs/specs/（均不在
    // workspace.include 内，无需排除）。exclude 会整体替换 tsdown 内置
    // 默认值，因此上面四条默认模式必须原样保留。
    workspace: {
      include: ['vendor/*', 'packages/*/*', 'apps/cli'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/test?(s)/**',
        '**/t?(e)mp/**',
      ],
    },
    entry: client ? '' : ['lib/types/{index,invariant,startup}.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    plugins: client ? [] : [typertPlugin({ mode: 'workspace', faces: ['host'] })],
  }
})
