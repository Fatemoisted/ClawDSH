# @clawdsh/dsh-channel-telegram

[English](README.md) | 中文

**定位**：Telegram 渠道适配器——grammY `Bot` 上的一层薄 `ChannelAdapter`：以可排空的长轮询接收文本/caption 与 raster image，并以带重试的原生 topic、引用回复、reaction 与 Unicode-safe 4096-unit 分片出站。

**OpenClaw 对应**：Telegram 渠道（OpenClaw 支持矩阵中最早稳定的一批渠道之一）。上游 `extensions/telegram` 同样组合 grammY 组件；本适配器使用 grammY 长轮询、官方 `@grammyjs/auto-retry` 与官方 `@grammyjs/files`，轮询本身退出后由 Harness timer 负责有界外层重启。

**接缝**：`ctx.channels`（@clawdsh/dsh-channel-core）。

**规格**：阶段 2 交付物 · [ADR-0009](../../../docs/adr/0009-deferred-channel-images-and-address-continuity.md) · **状态**：implemented

## 设计要点

- **入站**：`Bot.on('message')` 接受 `text`、媒体 `caption`、Telegram `photo`，以及声明 MIME 为 PNG、JPEG、WebP 或 GIF 的图片 document。对于 photo，它选择 Telegram 生成的最大尺寸并记为 JPEG。规范化消息在 channel-core 准入前只携带短暂文件元数据。Telegram `mention`/`text_mention` 的 UTF-16 entity 范围与 reply-to-bot 身份提供结构化群聊门控，`message_thread_id` 则保留为 Harness topic key。`/help@ClawBot` 一类 `bot_command` 也算明确指向当前 bot：只移除 `@ClawBot` 后缀，模型仍收到 `/help`；
- **群聊隐私**：Telegram 默认的 Group Privacy Mode 与适配器的定向命令、mention 及 reply-to-bot 路径相容，也是推荐的部署设置；随后由 `channel-core` 再应用自身的 `groupMode` 门控。如需证明该门控会丢弃未 mention 消息，必须先让测试 bot 真正收到普通群消息：将其设为管理员，或关闭 privacy mode 后把 bot 重新加入群聊；
- **可等待准入**：grammY handler 会等待 `ctx.parallel('channel/inbound', inbound)`，直至 channel-core 的 FIFO 回合、`sessions.flush` 与出站发送结束，不会在持久化检查点前提前确认 update；
- **出站**：长回复按 Telegram 的 4096 个 UTF-16 unit 上限分片，且绝不切断 surrogate pair；每片都保留 `message_thread_id`，只有首片通过 `reply_parameters` 引用触发消息。`setMessageReaction` 提供配置的 ack 表情；官方 auto-retry transformer 会对 API 限流和服务端错误最多重试三次，单次等待上限 30 秒。网络 `HttpError` 会立即上抛，因为 2.0.2 插件默认会在不受次数上限约束的内层循环中重试；最终失败再经 channel-core reject；
- **凭证**：`botTokenEnv` 是 Harness 凭证引用，默认为 `TELEGRAM_BOT_TOKEN`；解析使用 `ctx.credentials`，并以 Harness 启动环境作兼容回退。字面量 `botToken` 是编程接入的逃生口，且优先级更高。匹配的 `credentials/updated` 事件会排空旧 bot，再不重启进程地激活新凭证；字面量 token 不热轮换；
- **图片导入**：channel-core 先执行群聊 mention 准入，再通过 Harness `ctx.llm` 解析所选模型。只有声明支持图片输入的路由才调用本 adapter 的 materializer。adapter 在 I/O 前拒绝超出单图/总量声明限制的输入，只使用官方 `@grammyjs/files` hydrate `getUrl`，随后在可取消的 `imageDownloadTimeoutMs` deadline 内通过原生 `fetch` 流式读取，且不越过剩余 Harness 字节上限。它先对全部输入调用 `ctx.attachments.validateImage`，再逐一 `saveImage`；session 只接收持久附件引用。`imageDownloadTimeoutMs` 默认为 30000，可配置范围为 1000 至 2147483647。随附的默认 DeepSeek selection 声明仅支持文本，因此完全不会下载图片：caption 会携带明确的图片省略上下文继续，纯图片消息只收到固定提示；
- **聊天迁移**：`chatIdAliases` 把当前 Telegram 投递 chat id 映射到只供 Harness 会话路由使用的旧稳定 id。`conversationId` 仍是当前 provider 目标，channel-core 则根据 `sessionConversationId` 派生持久会话。没有匹配预配置 alias 的迁移 service message 会把新 chat 加入内存暂停集合，并提示所需 alias/remount。这只是 best-effort 防护，不是自动迁移：Telegram 可能先投递新 chat 的普通消息，重启也会丢失暂停集合。只有预配置 alias 才能保证所有已观察到的新 id 流量复用旧持久身份。冲突 alias、环与非整数 id 都会使配置失败；
- **轮询生命周期**：适配器自身不持有 offset 状态；dispose 会取消 Harness 重试 timer、等待 `bot.stop()`，再等待保存的 `bot.start()` task（grammY 的 middleware 排空屏障）。瞬时退出按有上限的指数退避重启。永久 401 表示凭证无法鉴权任何 Bot API 操作，因此关闭 receive、send 与 react；永久 409 表示另一进程占用 polling，因此只关闭 receive。两种情况都不会重试，直至运维介入。

## 带凭证验证

2026-08-15 的已部署测试完成了以下验证：经 `getMe` 验证 Bot API 身份；私聊 `/start` 与精确回复；Memory 写入后重启回忆，包括 `memory_search` 报告 Ark key 缺失后改用 `memory_get`；群聊未 mention 拒绝、用户名 mention、回复 bot、定向 `/help` 与发给其他 bot 的命令隔离；`web_search`；caption 转发以及当时的无正文媒体忽略行为；离线补收；Unicode-safe 4096-unit 分片；中断回合恢复；以及同一聊天的 FIFO 投递。图片字节 materialize、文本模型图片模态检查、迁移暂停/alias、凭证热切换、forum topic 与 ack reaction 都不是该轮线上通过项；其中已实现的路径按实操手册所述具有无密钥覆盖。可复现步骤与证据边界见[实操手册](../../../docs/cookbook/telegram-e2e.md)与 [2026-08-15 日志](../../../docs/journal/2026-08-15.md)。

## Model Experience

### 入站文本与图片

#### What the model sees

适配器把 Telegram 文本/caption，以及受支持 photo 或图片 document 的元数据映射成 `channel/inbound`，只移除 bot 的结构化 mention 范围；channel-core 准入消息、检查所选模型，并只在 materialize 成功后写入文本与持久 Harness 图片引用。文本模型路由接收 caption 与明确的图片省略上下文；纯图片消息只产生 transport 提示，不创建模型轮次。适配器自身不注册 prompt 或 tool schema。

#### Token effect

转发文本，以及图片模型路由上的持久 image block，会通过 channel-core 的 session 写入触达模型。纯图片固定 transport 提示不消耗模型 token；caption 及其图片省略上下文会消耗。

#### KV Cache effect

经 channel-core 的 user-message 写入保持 append-only；短暂 Telegram file id 与字节永不进入 session log。

## Known Limitations and Deferred Work

- **update 范围**：轮询只请求 `message` update；编辑后的消息、callback query 与 channel post 不在此适配器范围内。
- **附件范围**：只有 Telegram photo 与 PNG/JPEG/WebP/GIF 图片 document 进入 raster-image 路径。音频、视频、sticker、任意文件，以及作为一个原子多消息单元的 album 仍不支持。新图片路径已通过无密钥测试，但尚未在支持图片的模型上完成带凭证真实客户端验证。
- **投递模式**：尚未接 webhook；当前每个适配器实例运行一个 grammY 长轮询进程。
- **跨聊天轮询并发**：grammY simple polling 会串行等待 middleware，因此慢模型回合仍会延后其他会话的 update，即使 channel-core 本可并发运行不同会话。切换 `@grammyjs/runner` 必须与持久 ingress queue 一起做：runner 会在并发 middleware 完成前推进 fetch offset，否则崩溃会静默丢 update。
- **崩溃/投递幂等**：目前还没有基于 provider `messageId` 的持久 inbox 或出站 outbox。Telegram offset 确认窗口中的崩溃可能重放回合；provider 有界重试耗尽后，session 已记录 assistant answer，但回复仍可能丢失。多分片发送不是事务，后续分片可能在早先分片已落地后失败。
- **迁移归属**：alias 是部署状态，不是自动持久化的 provider ledger。service-message 暂停只存在于进程内，而且只在观察到该 update 后开始；新 id 的普通流量可能先到，restart/remount 也会清空暂停。需要持久身份连续性时，应在流量到达前预配置所有已知旧/当前 id 对。
- **真实覆盖边界**：无密钥测试已覆盖 topic 传递与 reaction，但带凭证验证尚未从真实客户端验证 forum topic，也未单独观察 reaction 路径。
