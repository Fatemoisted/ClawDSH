# @clawdsh/dsh-channel-core

**定位**：渠道网关 seam——ClawDSH 的**唯一新增 seam**。提供 `ctx.channels` 服务：注册渠道适配器（入站消息→agent 会话、出站回复→渠道推送），并负责会话与渠道的绑定/路由。

**OpenClaw 对应**：Gateway 的消息接入层（WhatsApp/Telegram/Email/Web Chat 等全部渠道的公共骨架）。

**接缝**：**新增** `ctx.channels`（设计见 docs/adr/0002-channel-seam.md）。上游 dsh 没有消息渠道概念，这是本项目的核心增量；契约设计必须 upstream-first（先向上游提 PR，本地用 patch 过渡）。

**规格**：docs/adr/0002-channel-seam.md · **状态**：implemented

## 设计要点（详见 ADR-0002）

- 渠道 = provider，统一实现 `ChannelAdapter`：`receive`（入站）与 `send`（出站）两类能力；
- 入站消息先走 dsh 的 session 机制（append-only log），再进 agent loop——"model-visible means logged" 不变式自然继承；
- 每个渠道插件（telegram/whatsapp/…）只实现适配器，不碰路由逻辑。
