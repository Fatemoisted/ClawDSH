# @clawdsh/dsh-channel-telegram

**定位**：Telegram 渠道适配器——实现 `ChannelAdapter`（入站轮询/webhook + 出站推送），是第一个渠道插件，兼作 `ctx.channels` seam 的 spike 载体。

**OpenClaw 对应**：Telegram 渠道（OpenClaw 支持矩阵中最早稳定的一批渠道之一）。

**接缝**：`ctx.channels`（@clawdsh/dsh-channel-core）。

**规格**：阶段 2 交付物 · **状态**：planning

## 备注

- 选它做第一个渠道：API 简单、webhook 与轮询双模式都成熟，能最快跑通"消息进 → 人格化 agent → 回复出"的垂直切片；
- WhatsApp / Email / Web Chat 后续按同一模板新增（见 packages/openclaw/README.md）。
