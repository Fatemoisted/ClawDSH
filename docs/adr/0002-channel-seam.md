# ADR-0002：渠道网关 seam（`ctx.channels`）——ClawDSH 唯一新增接缝

- **状态**：Accepted（阶段 2 双渠道验证通过，2026-08-14）
- **日期**：2026-08-14
- **依赖**：ADR-0001

## 上下文

OpenClaw 的核心价值是"个人助手活在消息渠道里"（WhatsApp/Telegram/Email/Web Chat…），而 dsh 是编码代理形态：有 `ctx.sessions`（append-only log）、`ctx.tools`、`ctx.llm` 等接缝，但**没有消息渠道概念**。要把 OpenClaw 搬上 dsh，渠道接入是唯一必须新增的 seam——其余功能域都能挂到既有接缝上（见 `docs/matrix/parity.md`）。

新增 seam 是最高成本的变更。项目早期纪律原拟 upstream-first（先向上游提 PR、本地 patch 过渡），但发起人 2026-08-14 决定**跳过上游 PR、快速推进**——`ctx.channels` 作为 ClawDSH 自有 seam 直接落地（决策见下）。上游 `packages/`/`vendor/` 等文件仍保持只读，本 seam 只落在 `packages/openclaw/`。

## 决策

1. **新增 `ctx.channels` 服务**，职责：
   - 渠道适配器注册表：每个渠道插件注册一个 `ChannelAdapter`；
   - 入站路由：渠道消息 → 定位/创建 agent 会话 → 写入 session log → 驱动 agent loop；
   - 出站投递：agent 回复 → 对应渠道推送（含消息分组/引用等渠道特性映射）。
2. **渠道插件只实现适配器**：`receive`（入站事件）与 `send`（出站投递）两个能力面，路由、会话绑定、重试策略全部归 `channel-core`。
3. **契约继承 dsh 不变式**：一切入站消息与出站回复必须写进 session log（"model-visible means logged"），否则不得触达模型。
4. **长期自有 seam**：`ctx.channels` 作为 ClawDSH 自有 seam 长期保留，**不向上游提 PR**（发起人 2026-08-14 决定——快速开发优先，上游无暇回应）。`channel-core` 即该 seam 的实现，不视为临时 patch；未来若上游自建等价能力再评估去留，差异记录回本 ADR。

## 契约（阶段 2 定稿）

```ts
// channel-core/src/types.ts（仅类型，无运行时代码）
import type { Context } from '@deepseek-ai/cordis'

export interface ChannelCapabilities { receive: boolean; send: boolean }

export interface ChannelMessage {
  channel: string                    // 适配器 id，如 'telegram' | 'feishu'
  direction: 'in' | 'out'
  threadId?: string                  // 渠道侧会话线索（群 chat_id / p2p open_chat_id / TG chat.id）
  sender?: string                    // 发送者身份（open_id / from.id）
  text: string
}

export interface ChannelAdapter {
  id: string
  capabilities: ChannelCapabilities
  start(ctx: Context): () => void           // 订阅平台事件，emit 'channel/inbound'；返回 disposer
  send(msg: ChannelMessage): Promise<void>  // 出站投递
}
```

**事件名定稿**：`channel/inbound`（入站，adapter → core）、`channel/outbound`（出站，core 投递回复后）。

**入站链路**：adapter `start()` 收到平台消息 → `ctx.emit('channel/inbound', msg)` → `channel-core` 监听 → 路由到 per-thread agent 会话（`ctx.agents.create` + `followup` + `whenIdle` + `sessions.flush`）→ 扫 `assistant/message` 读回复 → `adapter.send(outMsg)` + `emit('channel/outbound', outMsg)`。per-thread 会话按 `${channel}\0${threadId ?? ''}` 键复用，入站 turn 以 per-thread tail-chain 串行化，避免并发交错。

**最小面**：附件/引用/富文本/交互卡片一律推迟（阶段 3 渠道扩展）。

## 后果

- ✅ 所有渠道共享同一路由/会话/日志语义，新增渠道成本 = 一个适配器包；
- ⚠️ 若上游不接受此 seam，本地分叉面 +1，需要持续跟踪上游会话/渠道相关演进以避免撞车；
- ⚠️ 渠道特性差异（如 Telegram 的回复引用、飞书的交互卡片）可能侵蚀统一契约，Spike 必须用 2 个差异较大的渠道验证。**备选渠道已定为飞书（Lark）**（2026-08-14）：发起人第一优先 + OpenClaw 上游有出处（`extensions/feishu`，v2026.2.12 起），与 Telegram 在身份模型/事件推送/富文本上差异足够大。

## 备选方案

- **每个渠道各自直连 `ctx.sessions`（被否决）**：路由/绑定逻辑会在每个渠道重复，重蹈 OpenClaw 覆辙。
- **外部网关进程（sidecar）对接 dsh API（暂缓）**：更解耦但引入跨进程状态与部署复杂度，作为阶段 3 之后的联邦/多机形态再评估。

## 结论（阶段 2 验证，2026-08-14）

`ctx.channels` 契约已同时通过 **Telegram（getUpdates 长轮询）** 与 **飞书（node:http webhook + im OpenAPI）** 两个形态差异足够大的适配器验证：两者都只实现 `ChannelAdapter` 契约，路由/会话绑定/回复回投由 `channel-core` 统一承担，核心无渠道特判。契约测试（MockAdapter 验证「入站 → 真 agent turn → 回复出」闭环）+ 全量 typecheck + `--dump-config` 冒烟全绿。真实 e2e（真 key + 真 bot）留待凭证到位后的收尾项。seam 契约与装配语义的内部设计记录见 `docs/upstream-proposal/ctx-channels.md`（不再作为待提交 PR）。
