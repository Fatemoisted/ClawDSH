# @clawdsh/dsh-channel-core

[English](README.md) | 中文

**定位**：渠道网关 seam——ClawDSH 的**唯一新增 seam**。提供 `ctx.channels` 服务：注册渠道适配器（入站消息→agent 会话、出站回复→渠道推送），并负责会话与渠道的绑定/路由。

**OpenClaw 对应**：Gateway 的消息接入层（WhatsApp/Telegram/Email/Web Chat 等全部渠道的公共骨架）。

**接缝**：**新增** `ctx.channels`（设计见 docs/adr/0002-channel-seam.md）。上游 dsh 没有消息渠道概念，这是本项目的核心增量；契约设计必须 upstream-first（先向上游提 PR，本地用 patch 过渡）。

**规格**：docs/adr/0002-channel-seam.md · **状态**：implemented

## 设计要点（详见 ADR-0002）

- 渠道 = provider，统一实现 `ChannelAdapter`：`receive`（入站）与 `send`（出站）两类能力；
- 入站消息先走 dsh 的 session 机制（append-only log），再进 agent loop——"model-visible means logged" 不变式自然继承；
- 每个渠道插件（telegram/whatsapp/…）只实现适配器，不碰路由逻辑。

## Model Experience

### Inbound message text

#### What the model sees

The router turns an inbound `channel/inbound` message into a user message (`followup(createUserMessage({ text }))`) in the per-thread agent session; the message `text` reaches the model verbatim through the session log, and the agent's reply is read back from the session's `assistant/message` text blocks.

#### Token effect

Inbound text contributes prompt tokens to the per-thread session and stays in that session's history until compaction.

#### KV Cache effect

Append-only; each inbound turn appends a user message to the reusable request prefix and does not invalidate prior cache entries.

## Known Limitations and Deferred Work

- **真实 e2e**：Loader 内跑真实 agent turn 的组装测试需真 key，当前以 MockAdapter 契约测试 + `--dump-config` 冒烟覆盖。
- **并发**：per-thread tail-chain 串行化兜底；跨消息交错、多 sender 归并留待阶段 3。
- **渠道特性**：附件/引用/富文本/交互卡片一律推迟（阶段 3 渠道扩展）。
