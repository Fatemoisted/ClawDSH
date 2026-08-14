# ADR-0002：渠道网关 seam（`ctx.channels`）——ClawDSH 唯一新增接缝

[English](0002-channel-seam.md) | 中文

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
   - 出站投递：agent 回复 → 携带归一化引用/topic 元数据推送到对应渠道。
2. **渠道插件只实现适配器**：能力面为 `receive`（入站事件）、`send`（出站投递）与可选 `react`。路由、会话绑定、群聊/ack 策略及 turn 串行归 `channel-core`；provider 传输重试仍归 adapter 及其官方 SDK。
3. **契约继承 dsh 不变式**：一切入站消息与出站回复必须写进 session log（"model-visible means logged"），否则不得触达模型。
4. **长期自有 seam**：`ctx.channels` 作为 ClawDSH 自有 seam 长期保留，**不向上游提 PR**（发起人 2026-08-14 决定——快速开发优先，上游无暇回应）。`channel-core` 即该 seam 的实现，不视为临时 patch；未来若上游自建等价能力再评估去留，差异记录回本 ADR。

## 契约（阶段 2 定稿）

```ts
// channel-core/src/types.ts（仅类型，无运行时代码）
import type { Context } from '@deepseek-ai/cordis'

export interface ChannelCapabilities { receive: boolean; send: boolean; react: boolean }

export interface ChannelMessage {
  channel: string                    // 适配器 id，如 'telegram' | 'feishu'
  direction: 'in' | 'out'
  conversationId?: string            // 平台会话/发送目标
  threadId?: string                  // 会话内可选 topic/thread
  sender?: string                    // 发送者身份（open_id / from.id）
  messageId?: string
  replyToMessageId?: string
  chatType?: 'direct' | 'group'
  mention?: { detectable: boolean; botMentioned: boolean }
  text: string
}

export interface ChannelAdapter {
  id: string
  capabilities: ChannelCapabilities
  start(ctx: Context): () => void | Promise<void> // subscribe; return a drain-aware disposer
  send(msg: ChannelMessage): Promise<void>  // 出站投递
  react?(msg: ChannelMessage, emoji: string): Promise<void>
}
```

**事件名定稿**：`channel/inbound`（parallel 入站，adapter → core）、`channel/outbound`（仅 emit 出站，core 投递回复后）。新 adapter 必须等待 `ctx.parallel('channel/inbound', msg)`；listener 仍兼容旧 `ctx.emit` producer，但后者无法观察完成。

**入站链路**：adapter `start()` 接收并结构化归一平台消息 → `await ctx.parallel('channel/inbound', msg)` → `channel-core` 执行群聊/ack 策略 → 从 `(channel, conversationId, threadId)` 生成不透明的确定性 session id → 经 Harness persistence/agent/preset 服务恢复或创建 → `followup` + `whenIdle` + `sessions.flush` → `adapter.send(outMsg)` + `emit('channel/outbound', outMsg)`。返回的 parallel Promise 覆盖持久化检查点与投递，失败会 reject；内部已吸收的 tail 让后续 FIFO 回合仍可运行。adapter teardown 会排空 provider middleware，core teardown 会先排空已准入回合再释放 Agent。首次创建 single-flight；Harness timer 回收空闲 live handle，但不删除持久历史。

**地址兼容**：`conversationId` 是平台会话/发送目标，`threadId` 是其中可选 topic。仍接受只提供 `threadId` 的 legacy adapter：core 把它当作 conversation id，并在出站 `threadId` 中回填同一值。这种 source 兼容不迁移旧的持久会话；其随机 id 从未记录平台地址。

**当前能力面**：已实现结构化 mention 与 Telegram 定向 bot command、ack reaction、原生引用/topic、caption、Unicode-safe 平台上限分片及平台归一后的富文本；Telegram 使用 grammY 官方有界 auto-retry。二进制附件字节、交互卡片/action 事件及持久 provider outbox 仍不在文本型契约内。飞书 SDK 1.73 关闭 queue 后会异步启动可等待 callback，并把最终失败的 callback 标为 seen，因此其 WebSocket 入站确认本身不是持久化屏障。

## 后果

- ✅ 所有渠道共享同一路由/会话/日志语义，新增渠道成本 = 一个适配器包；
- ⚠️ 若上游不接受此 seam，本地分叉面 +1，需要持续跟踪上游会话/渠道相关演进以避免撞车；
- ⚠️ 渠道特性差异（如 Telegram 的回复引用、飞书的交互卡片）可能侵蚀统一契约，Spike 必须用 2 个差异较大的渠道验证。**备选渠道已定为飞书（Lark）**（2026-08-14）：发起人第一优先 + OpenClaw 上游有出处（`extensions/feishu`，v2026.2.12 起），与 Telegram 在身份模型/事件推送/富文本上差异足够大。

## 备选方案

- **每个渠道各自直连 `ctx.sessions`（被否决）**：路由/绑定逻辑会在每个渠道重复，重蹈 OpenClaw 覆辙。
- **外部网关进程（sidecar）对接 dsh API（暂缓）**：更解耦但引入跨进程状态与部署复杂度，作为阶段 3 之后的联邦/多机形态再评估。

## 结论（阶段 2 验证，2026-08-14）

`ctx.channels` 契约已通过 **Telegram（grammY 长轮询）** 与 **飞书（官方 SDK 1.73 `LarkChannel` WebSocket）** 两种形态验证。核心没有 provider 分支：session、持久化、模型选择、preset/Soul 组合与 timer 生命周期都由 Harness 负责，adapter 只做协议归一化和 SDK 投递。无密钥契约测试覆盖失败传播、停机排空、重启恢复、并发准入、legacy thread-only 输入、command/mention、Unicode-safe 引用/topic、reaction、Telegram 有界 API 重试、飞书 WebSocket 前身份退避与失败握手清理；线上 provider 权限仍是带凭证部署检查。内部 seam 记录见 `docs/upstream-proposal/ctx-channels.md`（不再作为待提交 PR）。
