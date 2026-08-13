# ADR-0002：渠道网关 seam（`ctx.channels`）——ClawDSH 唯一新增接缝

- **状态**：Proposed（Spike 验证后转 Accepted）
- **日期**：2026-08-14
- **依赖**：ADR-0001

## 上下文

OpenClaw 的核心价值是"个人助手活在消息渠道里"（WhatsApp/Telegram/Email/Web Chat…），而 dsh 是编码代理形态：有 `ctx.sessions`（append-only log）、`ctx.tools`、`ctx.llm` 等接缝，但**没有消息渠道概念**。要把 OpenClaw 搬上 dsh，渠道接入是唯一必须新增的 seam——其余功能域都能挂到既有接缝上（见 `docs/matrix/parity.md`）。

新增 seam 是最高成本的变更，因此必须 upstream-first：先在 dsh 上游提 PR，本地以 patch 过渡。

## 决策

1. **新增 `ctx.channels` 服务**，职责：
   - 渠道适配器注册表：每个渠道插件注册一个 `ChannelAdapter`；
   - 入站路由：渠道消息 → 定位/创建 agent 会话 → 写入 session log → 驱动 agent loop；
   - 出站投递：agent 回复 → 对应渠道推送（含消息分组/引用等渠道特性映射）。
2. **渠道插件只实现适配器**：`receive`（入站事件）与 `send`（出站投递）两个能力面，路由、会话绑定、重试策略全部归 `channel-core`。
3. **契约继承 dsh 不变式**：一切入站消息与出站回复必须写进 session log（"model-visible means logged"），否则不得触达模型。
4. **上游化策略**：契约设计完成后先向 `deepseek-ai/deepseek-harness` 提 PR；被接受则删除本地 patch 实现，只保留 `channel-core` 作为薄装配层；被拒绝则保留本地实现并把差异写进本 ADR。

## 契约草图（待 Spike 细化）

```ts
interface ChannelAdapter {
  id: string                        // 如 'telegram'
  capabilities: { receive: boolean; send: boolean }
  start(ctx: Context): Disposable   // 订阅渠道事件，emit 到 ctx.channels
  send(msg: ChannelMessage): Promise<void>
}
interface ChannelMessage {
  channel: string
  direction: 'in' | 'out'
  threadId?: string                 // 渠道侧会话线索（群/话题）
  sender?: string
  text: string
  // 附件、引用等渠道特性后续按需扩展，先保持最小面
}
```

## 后果

- ✅ 所有渠道共享同一路由/会话/日志语义，新增渠道成本 = 一个适配器包；
- ⚠️ 若上游不接受此 seam，本地分叉面 +1，需要持续跟踪上游会话/渠道相关演进以避免撞车；
- ⚠️ 渠道特性差异（如 Telegram 的回复引用、飞书的交互卡片）可能侵蚀统一契约，Spike 必须用 2 个差异较大的渠道验证。**备选渠道已定为飞书（Lark）**（2026-08-14）：发起人第一优先 + OpenClaw 上游有出处（`extensions/feishu`，v2026.2.12 起），与 Telegram 在身份模型/事件推送/富文本上差异足够大。

## 备选方案

- **每个渠道各自直连 `ctx.sessions`（被否决）**：路由/绑定逻辑会在每个渠道重复，重蹈 OpenClaw 覆辙。
- **外部网关进程（sidecar）对接 dsh API（暂缓）**：更解耦但引入跨进程状态与部署复杂度，作为阶段 3 之后的联邦/多机形态再评估。
