/**
 * ClawDSH 插件模板（Cordis 插件最小形态）。
 *
 * 实现要点（详见 docs/standards/plugin-contract.md）：
 * - 用 `inject` 声明依赖的 seam 服务，挂载顺序由依赖自动推导；
 * - 所有注册必须可逆，生命周期交给 `ctx.effect`；
 * - 服务用类型化 `ctx.<key>` 暴露，禁止跨包直接导入实现；
 * - 事件分流：观察用 emit，策略用 waterfall/serial，分发用 parallel。
 * @module @clawdsh/dsh-<pkg-name>
 */

import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin name. */
export const name = 'clawdsh-<pkg-name>'

/** Required seam services. */
export const inject = ['<依赖的 seam key>']

/** Plugin configuration. */
export interface Config {
  enabled?: boolean
}

/** Mount this plugin's reversible contributions. */
export function apply(ctx: Context, config: Config = {}): void {
  if (config.enabled === false) return
  ctx.effect(() => {
    // 注册服务、事件监听或工具，并在 disposer 中对称释放。
    return () => {}
  }, 'clawdsh-<pkg-name>.apply()')
}
