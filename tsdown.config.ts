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
    // packages/openclaw/ 中尚未实现的骨架包会被误扫而报 Cannot find entry，
    // 故显式排除。exclude 会整体替换 tsdown 内置默认值，因此上面四条
    // 默认模式必须原样保留。插件包实现并接入构建时（参考 soul 包），
    // 逐个移出排除名单（见 docs/adr/0001-project-foundation.md 决策 4）。
    workspace: {
      include: ['vendor/*', 'packages/*/*', 'apps/cli'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/test?(s)/**',
        '**/t?(e)mp/**',
        'packages/openclaw/_template/**',
        'packages/openclaw/automation/**',
        'packages/openclaw/channel-core/**',
        'packages/openclaw/channel-feishu/**',
        'packages/openclaw/channel-telegram/**',
        'packages/openclaw/channel-wechat/**',
        'packages/openclaw/memory/**',
        'packages/openclaw/preset-openclaw/**',
        'packages/openclaw/skills-hub/**',
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
