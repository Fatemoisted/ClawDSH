# `ctx.channels` seam 设计记录（ClawDSH 自有，不再向上游提 PR）

[English](ctx-channels.md) | 中文

> 本文是 `ctx.channels` 消息渠道 seam 的内部设计记录（属 `docs/upstream-proposal/`，目录名沿用，内容不再作为待提交 PR）。契约已在本地以 `channel-core` + 双渠道适配器验证（阶段 2，见 docs/adr/0002-channel-seam.md）。发起人 2026-08-14 决定跳过上游 PR、快速推进——本 seam 作为 ClawDSH 自有能力长期保留，本文仅记录契约与装配语义。

## 动机

dsh 是编码代理形态：有 `ctx.sessions`、`ctx.tools`、`ctx.llm`、`ctx.agents` 等接缝，但**没有「消息渠道」概念**。要把「个人助手活在消息渠道里」（WhatsApp/Telegram/Email/飞书…）这类形态落到 dsh 上，每个渠道接入者都面临同一套问题：

1. 渠道消息进来后，如何定位/创建一条 per-thread 的 agent 会话？
2. 如何把消息写进 session log、驱动 agent turn、再取回复？
3. 回复如何投递回渠道？

若无 seam，这套「路由 + 会话绑定 + turn 驱动 + 回投」逻辑会在每个渠道插件里复制一遍——正是 OpenClaw 因架构无接缝而无法维护的病灶。本提案新增唯一一个 seam：`ctx.channels`。

## 提议的 seam

```ts
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

- 事件：`channel/inbound`（入站，adapter → core）、`channel/outbound`（出站，core 投递回复后）。
- 一个 `ChannelRegistry extends Service`（`ctx.channels`）持有适配器注册表（id 唯一，注销回卷）并提供路由。

## 入站路由 / turn 驱动语义

adapter `start()` 收到平台消息 → `ctx.emit('channel/inbound', msg)` → `channel-core` 监听 → 路由：

1. 按 `${channel}\0${threadId ?? ''}` 定位/创建 per-thread agent 会话（首条 `ctx.agents.create`，之后复用）；
2. `followup(createUserMessage({ text }))` → `await agent.whenIdle()` → `await ctx.sessions.flush(session)`；
3. 扫 `assistant/message` 文本块取回复 → `adapter.send(outMsg)` + `emit('channel/outbound', outMsg)`。

per-thread 入站 turn 以 tail-chain 串行化，避免并发交错。**一切入站消息与出站回复都经 session log**（"model-visible means logged"），由 `dsh-agent` 既有不变式覆盖。

## 与 `ctx.agents` / `ctx.sessions` 的关系

- 复用 `ctx.agents.create` 创建会话（`agentOptions` 取自 `ctx.agentDefaultModel.currentSelection()`），不新增会话生命周期；
- 复用 `ctx.sessions.flush` 落盘，不新增持久化语义；
- 路由只是把「渠道线程 ↔ dsh 会话」的绑定关系保存在内存 map，属薄装配层，不改 `agent-loop`。

## 为何是「薄装配层」

本 seam 不引入任何渠道特性语义（附件/引用/富文本/卡片一律不在此层）：`ChannelMessage` 只带 `text`，其余渠道特性由适配器在 `send` 内自行映射。路由/会话/日志/回投是 dsh 既有能力的组合，`channel-core` 只做「装配 + 串行化」，因此对上游侵入面最小，新增一个渠道的成本 = 一个 `ChannelAdapter` 实现。

## 本地验证状态

- `channel-core` + `channel-telegram`（grammY 长轮询）+ `channel-feishu`（官方 Lark SDK WebSocket）+ `channel-discord`（discord.js Gateway/REST）已实现；
- 契约测试（MockAdapter 验证「入站 → 真 agent turn → 回复出」闭环）+ 全量 typecheck + `--dump-config` 冒烟全绿；
- 飞书已通过真实 e2e；Discord 的无密钥协议/生命周期覆盖已完成，真实 Gateway e2e 留待把轮换后的 token 装入 Harness 凭据接缝后收尾。
