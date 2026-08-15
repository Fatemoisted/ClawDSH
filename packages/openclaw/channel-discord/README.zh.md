# @clawdsh/dsh-channel-discord

[English](README.md) | 中文

**定位**：Discord 渠道适配器——discord.js Gateway/REST 原语上的一层薄 `ChannelAdapter`，支持私信、服务器文字频道、thread、原生引用回复和确认 reaction。

**OpenClaw 对应**：选定的 OpenClaw v2026.1.5 基线中的 `src/discord/`。本实现只保留 provider 边界，不移植 OpenClaw 自带的 gateway/agent 栈。

**接缝**：`ctx.channels`（`@clawdsh/dsh-channel-core`）、Harness 凭证/启动环境与 Harness timer。

**规格**：[English](../../../docs/specs/feature-channel-discord.md) / [中文](../../../docs/specs/feature-channel-discord.zh.md) · **状态**：implemented；无密钥验证已自动化，本次变更不宣称已完成带凭证的 Discord 线上 E2E。

## Harness-first 设计

- **助手能力归 channel-core**：持久 session 绑定、按会话 FIFO 回合、`groupMode`、preset 挂载、模型执行、日志 flush、原生引用元数据与确认策略仍由 `@clawdsh/dsh-channel-core` 负责。本包只归一化 Discord 事件并执行 provider 发送/reaction。
- **凭证归 Harness**：`botTokenEnv` 是 credential reference，默认值为 `DISCORD_BOT_TOKEN`；连接时经 `ctx.credentials` 解析，并以 Harness launch environment 作兼容回退。`botToken` 只是编程接入的逃生口，绝不能把明文 token 提交进配置。对应的 `credentials/updated` 事件会替换 client，轮换凭证无需重启进程。
- **外层重试计时归 Harness**：初次登录失败时用 Harness timer 做有上限的指数退避；无效 token、无效/未获准 intent 会停止，而不是永久重试。连接成功后，Gateway 心跳/重连与 Discord REST 限流均交给 discord.js。
- **生命周期准入归 Harness**：每个已准入的 `MessageCreate` 都等待 `ctx.parallel('channel/inbound', message)`。dispose 先停止新准入，再排空这些回合（包括 session flush 与最终发送），最后销毁 Discord client。

## 配置

```yaml
botTokenEnv: DISCORD_BOT_TOKEN
messageContentIntent: false
```

把 bot token 存在上述 Harness credential 或启动环境引用中。登录前会去掉 Discord API 风格的 `Bot ` 前缀和首尾空白，但推荐直接保存无前缀 token。

`messageContentIntent` 为最小权限而默认 `false`。Discord 仍会为私信以及在服务器中 @ bot 的消息提供正文，足以满足 channel-core 默认的 mention-gated 群聊策略。若要让 `channel-core` 以 `groupMode: always` 读取普通、未提及 bot 的服务器消息，必须同时做到：

1. 在 Discord Developer Portal 为应用启用 **Message Content Intent**；
2. 在本适配器配置中设置 `messageContentIntent: true`。

缺少任一项时，Discord 会有意省略普通服务器消息正文；适配器不会绕过这条边界。

## Discord 设置与权限

以 bot 身份邀请应用进入目标服务器，不需要 Administrator。只对需要服务的频道授予以下实用权限：

- View Channel、Send Messages、Read Message History；
- thread 回复需要 Send Messages in Threads；
- 确认 reaction 需要 Add Reactions。

Gateway intent 固定包含 `Guilds`、`GuildMessages`、`DirectMessages`，只有显式打开时才增加 `MessageContent`。`Partials.Channel` 用于接收私信事件。本纯文本适配器不申请 member、presence 或 reaction-event intent。

## 消息契约

- **入站过滤**：接受用户发送的文本；忽略 bot、webhook、system 与空消息。只删除当前 bot 的精确 `<@bot-id>` / `<@!bot-id>` 标记；其他 mention 仍保留为文字，但出站回复不会把它们解析成 ping。
- **mention 策略**：私信是 direct conversation；服务器中只有直接用户 mention 或回复 bot 才设置 `mention.botMentioned`，`@everyone` 和由 role 推导出的匹配不会绕过 gate；最终 `groupMode` 判定由 channel-core 完成。
- **寻址**：私信或普通服务器频道以 channel id 作为 `conversationId`。thread 以父频道作为 `conversationId`、thread channel id 作为 `threadId`；存在 `threadId` 时，出站回复与 reaction 都以它为目标。
- **出站安全**：按 Discord 的 2,000 个 UTF-16 code unit 上限分片，绝不切断 surrogate pair。每片都禁止解析 mention 和引用 ping，只有首片携带原生消息引用；provider 失败会 reject 回 channel-core，不会伪报成功。
- **Reaction**：确认表情走 Discord message REST 路径，不要求目标消息已在缓存中。

## Model Experience

### Inbound message text

#### What the model sees

适配器不贡献 prompt 或 tool schema。它把归一化的用户文本送入 `channel/inbound`；channel-core 执行群聊策略，并在模型运行前把每个接受的回合写进持久 session log。

#### Token effect

只有通过策略的消息文本会进入模型；本适配器不增加隐藏 prompt token。

#### KV Cache effect

session history 经 channel-core 保持 append-only。

## Known Limitations and Deferred Work

- 把 bot token 当密码处理：放进 Harness credentials、收紧 Discord 频道权限；一旦泄露立即轮换；不要粘贴进受跟踪文件、日志、issue 或截图。
- 自动化测试是无密钥的，并使用确定性 client seam。本变更不宣称已完成带凭证的真实服务器 E2E；服务器成员关系、portal intent 与频道权限仍需在部署环境核验。
- 已支持文本；尚不把二进制附件、embed、sticker、poll、语音作为模型输入，也未实现 slash-command interaction、按钮/modal 与 provider 侧管理能力。
- forum 父频道本身不是可发送的文本目标，必须寻址到具体 forum thread。跨进程 Gateway ownership、持久 provider inbox/outbox 与 webhook 投递也不在本轮范围。
- discord.js 会在内存中处理瞬时重连与 REST 限流。当前没有 provider 级幂等账本/outbox，因此进程崩溃仍可能重放入站事件，或在 assistant 回合已持久化后丢失回复。

官方参考：[Gateway intents 与 Message Content](https://docs.discord.com/developers/events/gateway)、[消息资源与上限](https://docs.discord.com/developers/resources/message)、[threads](https://docs.discord.com/developers/topics/threads)、[rate limits](https://docs.discord.com/developers/topics/rate-limits)。
