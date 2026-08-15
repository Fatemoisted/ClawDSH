# `ctx.channels` seam 设计记录（ClawDSH 自有，不再向上游提 PR）

[English](ctx-channels.md) | 中文

> 本文是 `ctx.channels` 消息渠道 seam 的内部设计记录（属 `docs/upstream-proposal/`，目录名沿用，内容不再作为待提交 PR）。契约已在本地以 `channel-core` 与多个 adapter 验证；[ADR-0002](../adr/0002-channel-seam.md)负责基础 seam 决策，[ADR-0009](../adr/0009-deferred-channel-images-and-address-continuity.md)负责图片/地址连续性。发起人 2026-08-14 决定跳过上游 PR、快速推进——本 seam 作为 ClawDSH 自有能力长期保留，本文仅记录契约与装配语义。

## 动机

dsh 是编码代理形态：有 `ctx.sessions`、`ctx.tools`、`ctx.llm`、`ctx.agents` 等接缝，但**没有「消息渠道」概念**。要把「个人助手活在消息渠道里」（WhatsApp/Telegram/Email/飞书…）这类形态落到 dsh 上，每个渠道接入者都面临同一套问题：

1. 渠道消息进来后，如何定位/创建一条 per-thread 的 agent 会话？
2. 如何把消息写进 session log、驱动 agent turn、再取回复？
3. 回复如何投递回渠道？

若无 seam，这套「路由 + 会话绑定 + turn 驱动 + 回投」逻辑会在每个渠道插件里复制一遍——正是 OpenClaw 因架构无接缝而无法维护的病灶。本提案新增唯一一个 seam：`ctx.channels`。

## 提议的 seam

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'

export interface ChannelCapabilities { receive: boolean; send: boolean; react: boolean }

export interface ChannelImageSource {
  sourceId: string                 // ephemeral provider file id; never persisted
  mediaType: ImageMediaType
  bytes?: number
  name?: string
}

export interface ChannelMessage {
  channel: string                    // adapter id, e.g. 'telegram' | 'feishu'
  direction: 'in' | 'out'
  conversationId?: string           // current provider delivery destination
  sessionConversationId?: string    // optional stable identity after provider id migration
  threadId?: string                 // optional topic inside the conversation
  sender?: string
  messageId?: string
  replyToMessageId?: string
  chatType?: 'direct' | 'group'
  mention?: { detectable: boolean; botMentioned: boolean }
  text: string
  images?: readonly ChannelImageSource[]
}

export interface ChannelAdapter {
  id: string
  capabilities: ChannelCapabilities
  start(ctx: Context): () => void | Promise<void>
  send(msg: ChannelMessage): Promise<void>
  materializeImages?(msg: ChannelMessage): Promise<readonly ImageAttachmentRef[]>
  react?(msg: ChannelMessage, emoji: string): Promise<void>
}
```

- 事件：`channel/inbound`（并行入站，adapter → core）、`channel/outbound`（出站，core 投递回复后）。
- 一个 `ChannelRegistry extends Service`（`ctx.channels`）持有适配器注册表（id 唯一，注销回卷）并提供路由。

## 入站路由 / turn 驱动语义

adapter `start()` 收到平台消息 → `await ctx.parallel('channel/inbound', msg)` → `channel-core` 监听 → 路由：

1. 规范化当前 `conversationId`/可选 `threadId`，应用结构化群聊 mention 策略，再从 `channel`、`sessionConversationId ?? conversationId` 与 `threadId` 派生不透明的确定性 session id。被拒绝的群消息不会触发图片下载；
2. 使用已记录的 Harness agent preset 与当前 Harness 默认模型 selection 恢复或创建准确的持久 session。single-flight map 管理 live handle，每个 session 的 tail chain 串行化已准入 turn；
3. 存在短暂 image source 时，通过 Harness `ctx.llm.resolveModelInfo` 查询该准确 selection。文本模型路由会给 caption 加明确的图片省略上下文，或向纯图片消息返回固定 transport 提示。图片模型路由会在 FIFO 内调用 `adapter.materializeImages`，并且只接受持久 Harness attachment 引用；
4. 追加一条包含已接受文本/image block 的 user message，等待 agent idle，再调用 `ctx.sessions.flush`；
5. 扫 `assistant/message` 文本块取回复 → `adapter.send(outMsg)` + `emit('channel/outbound', outMsg)`。

Ack reaction 在准入后启动，与路由 turn 一同等待完成，但不阻塞每个 session 的 FIFO。所有发送给模型的事实都先写入 session log。纯图片/导入失败的固定 transport 提示刻意不作为模型输入，因此不是 session event。

## 与 `ctx.agents` / `ctx.sessions` 的关系

- 复用 `ctx.agentDefaultModel`、`ctx.agentPresets` 与 `ctx.agents.create/resume` 完成准确 session 组装，不新增 agent 生命周期；
- 复用 `ctx.sessionPersistence` 与确定性不透明 id 实现可跨重启路由，并复用 `ctx.sessions.flush`，不新增持久化语义；
- 复用 `ctx.llm.resolveModelInfo` 获取模型自有的图片能力，并复用 Harness attachment 引用/content block 作为持久模型输入。provider adapter 可通过 `ctx.attachments` 校验并保存字节；channel-core 不实现存储；
- 内存 map 只管理 live handle、FIFO tail 与空闲回收。它不是持久渠道/session 映射，也不修改 `agent-loop`。

## 为何是「薄装配层」

本 seam 只负责 provider-neutral 路由事实与短暂 raster-image 描述。它绝不把 provider URL、file id 或字节写入 session；adapter 负责翻译平台数据，并且只在 channel-core 的群聊准入与模型模态检查后 materialize 已接受图片。引用、卡片、音视频、文件与其他 provider 特有载荷仍不在规范化输入内。路由、模型能力查询、attachment 引用、session 日志与回投均组合 Harness 既有能力，因此新增渠道仍只需一个 `ChannelAdapter`，无需复制 agent/session 逻辑。

## 本地验证状态

- `channel-core` + `channel-telegram`（grammY 长轮询）+ `channel-feishu`（官方 Lark SDK WebSocket）+ `channel-discord`（discord.js Gateway/REST）已实现；
- 无密钥契约测试覆盖「入站 → 真 agent turn → 回复出」闭环、确定性恢复、mention/FIFO/生命周期、投递 id 改变时保持稳定 session 身份、准确模型图片模态检查与 materialize 顺序；
- 飞书文本已通过真实 e2e。Telegram 私聊/群聊文本与 caption 已通过带凭证真实客户端测试；其后新增的图片字节路径已通过无密钥测试，但未线上验证。Discord 的无密钥协议/生命周期覆盖已完成，真实 Gateway e2e 仍待完成。
