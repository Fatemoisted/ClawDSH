# @clawdsh/dsh-channel-telegram

**定位**：Telegram 渠道适配器——实现 `ChannelAdapter`，用 grammY 封装：`Bot` 长轮询入站（`message:text`）+ `bot.api.sendMessage` 出站，是第一个渠道插件，兼作 `ctx.channels` seam 的 spike 载体。

**OpenClaw 对应**：Telegram 渠道（OpenClaw 支持矩阵中最早稳定的一批渠道之一）。上游 `extensions/telegram` 同样用 `grammy` + `@grammyjs/runner` + `@grammyjs/transformer-throttler` 封装；本适配器先取最小面（grammY `Bot` 长轮询），runner/throttler 留待阶段 3 按需引入。

**接缝**：`ctx.channels`（@clawdsh/dsh-channel-core）。

**规格**：阶段 2 交付物 · **状态**：implemented

## 设计要点

- **入站**：`Bot.on('message:text')` 把每条文本消息映射成 `channel/inbound`（`threadId` = `chat.id`，`sender` = `from.id`）；`bot.start({ allowed_updates:['message'], timeout })` 长轮询，grammY 内部推进 `offset`（至少一次投递幂等）；`bot.catch` 兜底日志。
- **出站**：`bot.api.sendMessage(chat_id, text)`；grammY 在 API 错误时抛 `GrammyError`，fail-loud。
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

- **真实 e2e**：需真 `botToken` + key 才能跑通真实闭环，当前以契约测试（协议映射 + `send` 载荷 + 启动/停轮询）覆盖。
- **引用回复/附件**：`reply_parameters` 引用、图片/富文本一律推迟（阶段 3 渠道扩展）。
- **runner/throttler**：`@grammyjs/runner`（高负载并发）与 `@grammyjs/transformer-throttler`（限流）上游有采用，本适配器先以 `bot.start()` 长轮询最小面，需要时再引入。
