# @clawdsh/dsh-channel-core

[English](README.md) | 中文

**定位**：渠道网关 seam——ClawDSH 的**唯一新增 seam**。提供 `ctx.channels` 服务：注册渠道适配器（入站消息→agent 会话、出站回复→渠道推送），并负责会话与渠道的绑定/路由。

**OpenClaw 对应**：Gateway 的消息接入层（WhatsApp/Telegram/Email/Web Chat 等全部渠道的公共骨架）。

**接缝**：**新增** `ctx.channels`（设计见 docs/adr/0002-channel-seam.md）。上游 dsh 没有消息渠道概念，这是本项目的核心增量；按 ADR-0002，它是 ClawDSH 长期自有 seam，并非临时上游 patch。

**规格**：docs/adr/0002-channel-seam.md · **状态**：implemented

## 使用

```yaml
- id: channel-core
  name: '@clawdsh/dsh-channel-core'
  config:
    agentPreset: openclaw       # resolved/mounted by dsh-agent-presets
    groupMode: mention          # mention | always
    ackReactionScope: group-mentions
    idleTimeoutMs: 1800000      # Harness timer; 0 disables eviction
    # identity:                 # 呈现专属，绝不进 prompt
    #   name: ClawDSH
    #   emoji: 🐚
    responsePrefix: auto       # 'auto' → [name]；无名字时为空
    ackReaction: '👀'          # 缺省回退 identity.emoji → 👀
```

## 设计要点（详见 ADR-0002）

- 渠道 = provider，统一实现 `ChannelAdapter`：`receive`（入站）、`send`（出站）与 `react`（入站消息的可选 ack 表情）三类能力；
- provider 回调会 `await ctx.parallel('channel/inbound', message)`；返回的 Promise 覆盖准入、FIFO Agent 回合、`sessions.flush` 与出站投递。失败回合会 reject 给 adapter，而内部已吸收的 tail 让同会话下一条消息仍可运行。listener 仍兼容旧的 `ctx.emit` producer，但 `emit` 本身无法提供完成背压；
- 入站消息先走 dsh 的 session 机制（append-only log），再进 agent loop——"model-visible means logged" 不变式自然继承；
- 平台会话/话题确定性映射到不泄露原始平台 id 的 `channel:v1:<sha256>` session id；路由直接复用 Harness 的 `sessionPersistence` 与 `agents.resume/create`，daemon 重启后继续同一段历史；
- 当前地址契约把 `conversationId` 与可选 `threadId` 分开。为兼容旧 source，只发送 `threadId` 的 legacy adapter 会被视为一个 conversation，出站时同一值也会回填到 `threadId`；新 adapter 必须使用结构化双字段；
- Agent 组合交给 Harness 的 `agentPresets.resolve/mount`；所选 preset 写进 session header，恢复时继续使用。channel-core 不重新实现 Soul、工具、Memory 或模型配置；
- 并发首条消息走 single-flight，每个会话/话题维持一条 FIFO turn chain；adapter dispose 会排空 provider middleware，registry dispose 会先排空已准入回合再释放 Agent；空闲 live handle 由 Harness timer 回收，持久会话仍可恢复；
- 每个渠道插件（telegram/whatsapp/…）只实现适配器，不碰路由逻辑；
- 身份呈现（`identity.{name,theme,emoji}`、`responsePrefix`、`ackReaction`、mention 正则）落在这里而非 prompt：`driveTurn` 给提取出的回复加前缀、触发 ack 表情，`src/presentation.ts` 的纯函数携带 OpenClaw 语义（`'auto'` → `[name]`、ack 回退 👀）。

## Model Experience

### Inbound message text

#### What the model sees

路由先执行群聊 mention 策略，按需移除呈现层 mention，再把接受的 `channel/inbound` 文本通过 `followup(createUserMessage({ text }))` 写入该会话/话题的 session；回复从同一 session 的 `assistant/message` 文本块读取。

#### Token effect

入站文本为对应 conversation/topic session 增加 prompt token，并保留在该 session 的历史中直至压缩。

#### KV Cache effect

Append-only；每个入站回合只向可复用请求前缀追加一条 user message，不使既有 cache 条目失效。

## Known Limitations and Deferred Work

- **带凭证 e2e**：无密钥测试已覆盖路由、重启恢复、preset 挂载、并发、mention 门控与 ack 范围；飞书/Telegram 的线上权限仍需部署凭证验证。
- **附件**：当前 seam 仍以文本为主。适配器可把富文本压平，但二进制附件写入 Harness `ctx.attachments` 尚未进入 `ChannelMessage` 契约。
- **旧持久会话**：运行时仍兼容 thread-only 消息形态，但迁移前落盘会话使用随机 id，且日志里没有持久的平台地址映射；这些 artifact 无法自动关联到新的确定性 id，仍可单独读取。
- **单 daemon 写者**：FIFO/single-flight 只在进程内成立；多个 daemon 共用同一 bot 与持久化根时还需要外部 owner/lease。
- **无持久 provider outbox**：adapter/SDK 重试会覆盖瞬时发送失败，最终失败也会 reject 并记录；但重试后仍失败的回复不会进入一份可独立重放的持久 outbox。
