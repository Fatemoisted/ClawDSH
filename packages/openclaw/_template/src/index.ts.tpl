/**
 * ClawDSH 插件模板（Cordis 插件最小形态）。
 *
 * 实现要点（详见 docs/standards/plugin-contract.md）：
 * - 用 `inject` 声明依赖的 seam 服务，挂载顺序由依赖自动推导，禁止手动排序；
 * - 所有注册（事件监听、effect）必须可逆：返回 disposer，卸载时自动回卷；
 * - 服务用类型化 key 暴露（ctx.<key>），禁止跨包直接 import 实现；
 * - 事件分流：观察用 emit，拦截/策略用 waterfall/serial，分发用 parallel。
 */
import { Context, Service } from '@deepseek-ai/cordis'

// 若本插件提供新的 seam 服务：在这里声明接口并做 declaration merging
// （新 seam 必须先过 ADR，且优先上游化，见 docs/adr/0002-channel-seam.md）
declare module '@deepseek-ai/cordis' {
  interface Context {
    // clawdshExample: ExampleService
  }
}

export const name = 'clawdsh-example'

export const inject = ['tools'] // 依赖的 seam，缺一不可才会被挂载

export interface Config {
  enabled?: boolean
}

export function apply(ctx: Context, config: Config = {}) {
  // 1. 提供服务/能力到 seam
  // 2. 监听事件、注册 effect（全部可逆）
  ctx.effect(() => {
    return () => {
      // 卸载清理
    }
  })
}
