# @clawdsh/dsh-channel-telegram

[English](README.md) | 中文

**定位**：Telegram 渠道适配器——grammY `Bot` 上的一层薄 `ChannelAdapter`：以可排空的长轮询接收文本/caption，并以带重试的原生 topic、引用回复、reaction 与 Unicode-safe 4096-unit 分片出站。

**OpenClaw 对应**：Telegram 渠道（OpenClaw 支持矩阵中最早稳定的一批渠道之一）。上游 `extensions/telegram` 同样组合 grammY 组件；本适配器使用 grammY 长轮询与官方 `@grammyjs/auto-retry`，轮询本身退出后由 Harness timer 负责有界外层重启。

**接缝**：`ctx.channels`（@clawdsh/dsh-channel-core）。

**规格**：阶段 2 交付物 · **状态**：implemented

## 设计要点

- **入站**：`Bot.on('message')` 接受 `text` 与媒体 `caption`，用 Telegram `mention`/`text_mention` 的 UTF-16 entity 范围和 reply-to-bot 身份做结构化群聊门控，并把 `message_thread_id` 保留为 Harness topic key。`/help@ClawBot` 一类 `bot_command` 也算明确指向当前 bot：只移除 `@ClawBot` 后缀，模型仍收到 `/help`；
- **可等待准入**：grammY handler 会等待 `ctx.parallel('channel/inbound', inbound)`，直至 channel-core 的 FIFO 回合、`sessions.flush` 与出站发送结束，不会在持久化检查点前提前确认 update；
- **出站**：长回复按 Telegram 的 4096 个 UTF-16 unit 上限分片，且绝不切断 surrogate pair；每片都保留 `message_thread_id`，只有首片通过 `reply_parameters` 引用触发消息。`setMessageReaction` 提供配置的 ack 表情；官方 auto-retry transformer 会对 API 限流和服务端错误最多重试三次，单次等待上限 30 秒。网络 `HttpError` 会立即上抛，因为 2.0.2 插件默认会在不受次数上限约束的内层循环中重试；最终失败再经 channel-core reject；
- **凭证**：`botToken` 经 Config 进入，不私存密钥；接入 `ctx.credentials` 留待真实 e2e 收尾。
- **轮询生命周期**：适配器自身不持有 offset 状态；dispose 会取消 Harness 重试 timer、等待 `bot.stop()`，再等待保存的 `bot.start()` task（grammY 的 middleware 排空屏障）。瞬时退出按有上限的指数退避重启；401 会把 receive capability 标成不可用，而不是拿坏 token 永久重试。

## Model Experience

### Inbound message text

#### What the model sees

适配器把 Telegram 文本或媒体 caption 映射成 `channel/inbound`，只移除 bot 的结构化 mention 范围；channel-core 再把接受的文本写进持久 session log。适配器自身不注册 prompt 或 tool schema。

#### Token effect

只有转发后的消息文本经 channel-core 的 session 写入触达模型。

#### KV Cache effect

经 channel-core 的 user-message 写入保持 append-only。

## Known Limitations and Deferred Work

- **带凭证 e2e**：无密钥测试已覆盖 entity/caption/`bot_command` 映射、可等待入站、Unicode-safe 4096-unit 分片、topic、原生引用、reaction 与轮询启停失败；部署闭环仍需真实 `botToken` 与模型 key。
- **二进制附件**：已处理媒体 caption，但尚未把 photo/document/audio 字节下载进 Harness `ctx.attachments`。
- **投递模式**：尚未接 webhook；当前每个适配器实例运行一个 grammY 长轮询进程。
- **跨聊天轮询并发**：grammY simple polling 会串行等待 middleware，因此慢模型回合仍会延后其他会话的 update，即使 channel-core 本可并发运行不同会话。切换 `@grammyjs/runner` 必须与持久 ingress queue 一起做：runner 会在并发 middleware 完成前推进 fetch offset，否则崩溃会静默丢 update。
- **崩溃/投递幂等**：目前还没有基于 provider `messageId` 的持久 inbox 或出站 outbox。Telegram offset 确认窗口中的崩溃可能重放回合；provider 有界重试耗尽后，session 已记录 assistant answer，但回复仍可能丢失。
