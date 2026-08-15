# @clawdsh/dsh-channel-core

[English](README.md) | 中文

**定位**：旧版兼容渠道 seam。它通过 `ctx.legacyChannels` 保留 sidecar 之前的 Telegram、飞书和 Discord 适配器；生产消息则由规范 OpenClaw sidecar 通过 `ctx.channels` 承载。

**OpenClaw 对应**：保留的本地 Gateway 消息接入前身。规范实现现位于 `@clawdsh/dsh-channel`、`@clawdsh/dsh-channel-agent` 与 `@clawdsh/dsh-channel-openclaw`。

**接缝**：仅供旧版兼容使用的 `ctx.legacyChannels`（历史设计见 ADR-0002）。本包有意不提供 `ctx.channels` alias，也不能取代规范 sidecar Service Definition。

**规格**：[ADR-0002](../../../docs/adr/0002-channel-seam.md) · [ADR-0011](../../../docs/adr/0011-deferred-channel-images-and-address-continuity.md) · **状态**：旧版兼容、默认禁用，等待带凭证的 sidecar 切换验证

## 使用

```yaml
- id: channel-core
  name: '@clawdsh/dsh-channel-core'
  config:
    agentPreset: clawdsh        # resolved/mounted by dsh-agent-presets
    groupMode: mention          # mention | always
    ackReactionScope: group-mentions  # all | direct | group-all | group-mentions | off | none
    idleTimeoutMs: 1800000      # Harness timer; 0 disables eviction
    # identity:                 # presentation only; never enters the prompt
    #   name: ClawDSH
    #   emoji: 🐚
    responsePrefix: auto       # 'auto' → [name]; explicit '' disables the prefix
    ackReaction: '👀'          # fallback: identity.emoji → 👀; explicit '' disables ack
```

## 设计要点（详见 ADR-0002）

- 渠道 = provider，统一实现 `ChannelAdapter`：`receive`（入站）、`send`（出站）与 `react`（入站消息的可选 ack 表情）三类能力；
- provider 回调会 `await ctx.parallel('channel/inbound', message)`；返回的 Promise 覆盖准入、FIFO Agent 回合、`sessions.flush`、出站投递，以及并发启动的 ack reaction 完成。ack 失败只记 warning；回合失败会 reject 给 adapter，而内部已吸收的 tail 让同会话下一条消息仍可运行。listener 仍兼容旧的 `ctx.emit` producer，但 `emit` 本身无法提供完成背压；
- 入站消息先走 dsh 的 session 机制（append-only log），再进 agent loop——"model-visible means logged" 不变式自然继承；
- 平台会话/话题确定性映射到不泄露原始平台 id 的 `channel:v1:<sha256>` session id；路由直接复用 Harness 的 `sessionPersistence` 与 `agents.resume/create`，daemon 重启后继续同一段历史；
- 当前地址契约把 `conversationId` 与可选 `threadId` 分开。为兼容旧 source，只发送 `threadId` 的 legacy adapter 会被视为一个 conversation，出站时同一值也会回填到 `threadId`；新 adapter 必须使用结构化双字段；
- 可选的 `sessionConversationId` 只影响持久 session 与 FIFO key 的派生；出站投递仍使用 provider 的真实 `conversationId`。这样 adapter 能在平台侧 chat id 迁移前后保持同一份持久身份，同时不会把回复发往已退役的 id；
- 可选的 `images` 只携带 provider 自有的文件元数据，并且仅作为短暂路由输入：provider file id、URL 与字节都不会进入持久 session log。通过群聊 mention 准入后，channel-core 通过 Harness `ctx.llm` 解析准确的所选模型；只有支持图片的路由才会在该聊天 FIFO 内调用 adapter 的 `materializeImages`。该钩子返回持久 Harness `ImageAttachmentRef`，因此被接受的 user event 只包含附件引用，不包含 provider 数据；
- 未声明图片输入的模型路由不会 materialize 或下载图片。非空 caption 会继续成为文本轮次，并附加一段明确说明图片已省略的模型可见上下文；纯图片消息只收到固定 transport 提示，不创建模型轮次。导入失败同样只返回固定提示，不会追加不完整的 user event；
- Agent 组合交给 Harness 的 `agentPresets.resolve/mount`；所选 preset 写进 session header，恢复时继续使用。channel-core 不重新实现 Soul、工具、Memory 或模型配置；
- 并发首条消息走 single-flight，每个会话/话题维持一条 FIFO turn chain；adapter dispose 会排空 provider middleware，registry dispose 会先排空已准入回合再释放 Agent；空闲 live handle 由 Harness timer 回收，持久会话仍可恢复；
- 每个渠道插件（telegram/whatsapp/…）只实现适配器，不碰路由逻辑；
- 群聊路由读取规范化的 `chatType` 与结构化 `mention.{detectable,botMentioned}` 契约。内置 provider 通过 `registerLegacyChannelAdapter` 共用生命周期接线；没有结构化 mention 元数据的 adapter 可使用它提供的 identity 派生模式作回退。路由不会从私聊普通文本中剥离 identity 名称；
- 身份呈现（`identity.{name,theme,emoji}`、`responsePrefix`、`ackReaction`、mention 正则）落在这里而非 prompt。route 会给回复加前缀，并应用 OpenClaw 的 `all`/`direct`/`group-all`/`group-mentions` ack 范围；`off`/`none` 为兼容配置而禁用 ack，显式空 `ackReaction` 同样禁用 ack，显式空 `responsePrefix` 则禁用前缀。

## Model Experience

### 入站文本与图片

#### What the model sees

路由先执行群聊 mention 策略，按需移除呈现层 mention，再把接受的文本作为 user message 写入该会话/话题的 session。在支持图片的模型路由上，成功 materialize 的图片会以持久 Harness image block 加入同一条 user message。文本模型路由会保留 caption，并明确告诉模型图片已省略；纯图片消息不会到达模型。回复从同一 session 的 `assistant/message` 文本块读取。

#### Token effect

入站文本以及暴露给图片模型的附件元数据会进入对应 conversation/topic 的历史并保留至压缩。纯图片与导入失败的固定 transport 提示不是模型输入，不消耗模型 token。

#### KV Cache effect

Append-only；每个被接受的文本/图片回合只向可复用请求前缀追加一条 user message，不修改既有条目。

## Known Limitations and Deferred Work

- **退役门槛**：只有等价的 Telegram、飞书和 Discord 带凭证流量都通过规范 OpenClaw sidecar 后，才能移除该 registry 及其适配器；单元覆盖与历史 direct-adapter E2E 均不满足此门槛。
- **带凭证 e2e**：无密钥测试已覆盖路由、重启恢复、preset 挂载、并发、群聊 mention 策略、ack 范围、模型模态检查与图片 materialize 顺序。带凭证部署已跑通飞书文本路径与 Telegram 私聊/群聊文本/caption 路径，包括确定性重启恢复、中断回合恢复与同一聊天 FIFO。Telegram 图片字节导入已通过无密钥测试，但尚未完成真实客户端/模型验证。各 provider 的真实覆盖边界仍由对应适配器 README 记录。
- **富渠道载荷**：规范化 seam 已支持文本，以及可由 adapter materialize 成 Harness attachment 的短暂 raster-image source。引用、卡片、音频、视频、文件和 provider 特有富文本仍不在规范化输入契约内。
- **旧持久会话**：运行时仍兼容 thread-only 消息形态，但迁移前落盘会话使用随机 id，且日志里没有持久的平台地址映射；这些 artifact 无法自动关联到新的确定性 id，仍可单独读取。
- **单 daemon 写者**：FIFO/single-flight 只在进程内成立；多个 daemon 共用同一 bot 与持久化根时还需要外部 owner/lease。
- **无持久 provider outbox**：adapter/SDK 重试会覆盖瞬时发送失败，最终失败也会 reject 并记录；但重试后仍失败的回复不会进入一份可独立重放的持久 outbox。
- **ack 门控的控制命令旁路推迟**：OpenClaw 的 `shouldBypassMention`（控制命令无需提及也 ack）依赖渠道 seam 尚未建模的命令概念；在此之前 `group-mentions` 要求检测到提及。`removeAckAfterReply`（回复落地后删除 ack）同样推迟——需要 list-then-delete 表情往返，不值当非对称 seam。
