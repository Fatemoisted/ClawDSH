# @clawdsh/dsh-channel-core

[English](README.md) | 中文

**定位**：旧版实验性渠道 seam。在 Telegram 与飞书完成带凭证的 sidecar live-cutover 验证前，它通过 `ctx.legacyChannels` 暂时承载旧适配器。

**OpenClaw 对应**：早期对 Gateway 消息接入的本地近似；它不实现、也不认证当前 OpenClaw 通信平面。

**接缝**：仅供旧版使用的 `ctx.legacyChannels`（历史设计见 docs/adr/0002-channel-seam.md）。生产 Service Definition 独占 `ctx.channels`；本包有意不为该名称提供 alias。

**规格**：docs/adr/0002-channel-seam.md · **状态**：legacy；默认 profile 已禁用；待 Telegram 与飞书完成带凭证的 sidecar 切换后退役

## 使用

以下配置只为显式旧版部署保留，不能作为 sidecar 已完成切换的证据。

```yaml
- id: channel-core
  name: '@clawdsh/dsh-channel-core'
  config:
    # identity:                 # 呈现专属，绝不进 prompt
    #   name: ClawDSH
    #   emoji: 🐚
    responsePrefix: auto       # 'auto' → [name]；无名字时为空
    ackReaction: '👀'          # 缺省回退 identity.emoji → 👀；显式 '' 禁用 ack
    ackReactionScope: group-mentions  # all | direct | group-all | group-mentions
    requireMention: true       # group-mentions 下群聊须提及才 ack
```

## 设计要点（详见 ADR-0002）

- 渠道 = provider，统一实现 `ChannelAdapter`：`receive`（入站）、`send`（出站）与 `react`（入站消息的可选 ack 表情）三类能力；
- 入站消息先走 dsh 的 session 机制（append-only log），再进 agent loop——"model-visible means logged" 不变式自然继承；
- 每个渠道插件（telegram/whatsapp/…）只实现适配器，不碰路由逻辑；
- 身份呈现（`identity.{name,theme,emoji}`、`responsePrefix`、`ackReaction`、mention 正则）落在这里而非 prompt：`driveTurn` 给提取出的回复加前缀、触发 ack 表情，`src/presentation.ts` 的纯函数携带 OpenClaw 语义（`'auto'` → `[name]`、ack 回退 👀）。

## Model Experience

### Inbound message text

#### What the model sees

The router turns an inbound `channel/inbound` message into a user message (`followup(createUserMessage({ text }))`) in the per-thread agent session; the message `text` reaches the model verbatim through the session log, and the agent's reply is read back from the session's `assistant/message` text blocks.

#### Token effect

Inbound text contributes prompt tokens to the per-thread session and stays in that session's history until compaction.

#### KV Cache effect

Append-only; each inbound turn appends a user message to the reusable request prefix and does not invalidate prior cache entries.

## Known Limitations and Deferred Work

- **退役门禁**：只有 Telegram 与飞书的真实凭证流量通过 OpenClaw sidecar live-cutover 检查后才能删除本包；本文不声称该门禁已通过。

- **真实 e2e**：Loader 内跑真实 agent turn 的组装测试需真 key，当前以 MockAdapter 契约测试 + `--dump-config` 冒烟覆盖。
- **并发**：per-thread tail-chain 串行化兜底；跨消息交错、多 sender 归并留待阶段 3。
- **渠道特性**：附件/引用/富文本/交互卡片一律推迟（阶段 3 渠道扩展）。
- **ack 门控的控制命令旁路推迟**：OpenClaw 的 `shouldBypassMention`（控制命令无需提及也 ack）依赖渠道 seam 尚未建模的命令概念；在此之前 `group-mentions` 要求检测到提及。`removeAckAfterReply`（回复落地后删除 ack）同样推迟——需要 list-then-delete 表情往返，不值当非对称 seam。
