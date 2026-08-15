# @clawdsh/dsh-channel-telegram

[English](README.md) | 中文

**定位**：基于 `ctx.legacyChannels` 的旧版 Telegram 适配器，以 grammY `Bot` 长轮询接收入站文本（`message:text`），并通过 `bot.api.sendMessage` 发送回复。它只保留到带凭证的 OpenClaw sidecar live-cutover 完成。

**OpenClaw 对应**：Telegram 渠道（OpenClaw 支持矩阵中最早稳定的一批渠道之一）。上游 `extensions/telegram` 同样用 `grammy` + `@grammyjs/runner` + `@grammyjs/transformer-throttler` 封装；本适配器先取最小面（grammY `Bot` 长轮询），runner/throttler 留待阶段 3 按需引入。

**接缝**：仅供旧版使用的 `ctx.legacyChannels`（@clawdsh/dsh-channel-core），不为生产 `ctx.channels` 服务提供兼容 alias。

**规格**：历史阶段 2 交付物 · **状态**：legacy，默认禁用，等待退役；本文不声称 sidecar 已完成 live cutover

## 设计要点

- **入站**：`Bot.on('message:text')` 把每条文本消息映射成 `channel/inbound`（`threadId` = `chat.id`，`sender` = `from.id`）；`bot.start({ allowed_updates:['message'], timeout })` 长轮询，grammY 内部推进 `offset`（至少一次投递幂等）；`bot.catch` 兜底日志。`isGroup` 来自 `chat.type`（`group`/`supergroup`）；`wasMentioned` 来自 `detectBotMention`（bot 真实用户名对 `mention` 实体与 `@username` 文本，加上任意身份模式）。
- **出站**：`bot.api.sendMessage(chat_id, text)`；grammY 在 API 错误时抛 `GrammyError`，fail-loud。
- **ack 表情**：`bot.api.setMessageReaction(chat_id, message_id, [{ type:'emoji', emoji }])`；不支持的 emoji 在运行时被 API 拒绝，作为调用方的警告日志浮出。
- **凭证**：`botToken` 经 Config 进入，不私存密钥；接入 `ctx.credentials` 留待真实 e2e 收尾。
- **轮询 offset 归 grammY**：适配器自身不持有任何可变状态，offset 由 grammY 长轮询循环管理。

## Model Experience

### Inbound message text

#### What the model sees

The adapter maps a Telegram text update to a `channel/inbound` message; the channel-core router writes that message's `text` into the session log as a user message. The adapter registers no prompt or tool schema of its own.

#### Token effect

Only the relayed message text reaches the model, through channel-core's session write.

#### KV Cache effect

Append-only through channel-core's user-message write.

## Known Limitations and Deferred Work

- **退役门禁**：只有使用真实凭证的 Telegram 账号通过 OpenClaw sidecar live-cutover 矩阵后才能删除该适配器；单元测试和契约测试不能替代该门禁。

- **真实 e2e**：需真 `botToken` + key 才能跑通真实闭环，当前以契约测试（协议映射 + `send` 载荷 + 启动/停轮询）覆盖。
- **引用回复/附件**：`reply_parameters` 引用、图片/富文本一律推迟（阶段 3 渠道扩展）。
- **runner/throttler**：`@grammyjs/runner`（高负载并发）与 `@grammyjs/transformer-throttler`（限流）上游有采用，本适配器先以 `bot.start()` 长轮询最小面，需要时再引入。
- **提及检测依赖 getMe**：bot 真实用户名取自 grammY `init()` 之后的 `bot.botInfo?.username`；在此之前（或没有用户名）只能靠身份模式检测提及，两者皆无时适配器省略 `wasMentioned`（fail-open，不 ack）。
