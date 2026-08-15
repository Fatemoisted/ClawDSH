# 功能规格：保留的旧 Discord adapter

[English](feature-channel-discord.md) | 中文

- **状态**：已实现 compatibility package；只有无密钥验证；未完成带凭证真实服务器 E2E
- **实现包**：`packages/openclaw/channel-discord`（`@clawdsh/dsh-channel-discord`）
- **历史实现使用的 OpenClaw 参考**：v2026.1.5 中的 `src/discord/`
- **兼容 seam**：`ctx.legacyChannels`、Harness credentials / launch environment、Harness timer、Cordis lifecycle
- **Provider 库**：discord.js 14.x
- **当前替代**：[ADR-0008](../adr/0008-openclaw-channel-plane.md) 中锁定的 OpenClaw Gateway sidecar

## 范围与决策

Discord 最初作为早期 `ChannelAdapter` 约定上的 provider-only adapter 实现，没有移植 OpenClaw Agent loop、Session ownership、gateway facade、retry framework 或 permission model。Harness 与保留的 legacy core 拥有这些职责：

| 关注点 | Owner |
|---|---|
| Conversation/topic Session、FIFO 回合、`groupMode`、preset、模型运行、Session flush、出站 event、ack policy | `@clawdsh/dsh-channel-core` |
| Bot token 查找与热切换 | Harness `ctx.credentials`，并以 launch environment 回退 |
| 初次登录退避与 teardown scope | Harness timer 与 Cordis lifecycle |
| Gateway heartbeat/reconnect 与 REST rate-limit handling | discord.js |
| Discord 归一化、channel/thread send、原生 reply、reaction | `@clawdsh/dsh-channel-discord` |

ADR-0008 已把锁定的 OpenClaw Gateway 确立为 canonical 通信平面 owner。本包只为迁移与 compatibility 验证保留在 `ctx.legacyChannels` 下。新的 Discord 功能属于 sidecar；本包的无密钥或未来 live result 都不能认证 sidecar。

## 目标

- 通过 Gateway `MessageCreate` 接收 Discord 私信、guild 文字频道与具体 thread 中的用户文本。
- 不用显示文本启发式解析，而是把 provider 地址与结构化 mention 状态归一化成旧 `ChannelMessage`。
- 把 assistant 文本送到正确 channel/thread，保留一次原生 reply reference，并提供 ack reaction。
- 默认使用 Harness credential reference，避免 secret 进入仓库配置与日志。
- 关闭 provider client 前排空每一个已被 Harness 准入的回合。

## 非目标

- 二进制附件输入、作为模型输入的 embed、sticker、poll、语音、stage channel 或屏幕共享；
- slash command、autocomplete、context menu、button、select、modal 等 Discord interaction；
- webhook 投递、跨进程/shard ownership、持久 provider inbox/outbox 或 exactly-once 投递；
- 直接向 forum 父频道发送；具体 forum thread 是合法目标；
- 用自定义代码替代 discord.js Gateway reconnect 或 REST rate-limit behavior；
- 扩宽 legacy surface 或建立当前 sidecar 支持。

## Profile 激活与凭据

本包嵌套在默认关闭的 `clawdsh-legacy-channel-plane` group 中，且有自己默认关闭的 entry。Compatibility 测试必须同时开启两个 legacy switch，并在 ClawDSH Settings 中保持 OpenClaw Gateway 关闭：

```bash
export CLAWDSH_LEGACY_CHANNELS_ENABLED=1
export CLAWDSH_LEGACY_DISCORD_ENABLED=1
export DISCORD_BOT_TOKEN='<new token>'
```

存在 legacy opt-in 时若请求 canonical enablement，Gateway 启动或 Settings preflight 会拒绝该配置。绝不能让本 adapter 与其他 Discord consumer 使用同一个 bot token。

```ts
interface Config {
  botToken?: string
  botTokenEnv?: string // default: DISCORD_BOT_TOKEN
  messageContentIntent?: boolean // default: false
}
```

`botTokenEnv` 是 Harness credential reference，不是 token 本身，只在打开 Gateway connection 时解析。优先使用 `ctx.credentials`，Harness launch environment 是兼容回退。匹配的 `credentials/updated` event 会先排空再替换 client，无需 restart process。字面量 `botToken` 只供编程组装，禁止出现在受跟踪配置中。

解析后的 token 不得写入日志；错误渲染还会防御性脱敏当前 token。无效 token 与代表无效/未获准 intent 的 Gateway `4013`/`4014` 对当前配置属于永久错误，不能进入无限 retry；其他初次登录失败由 Harness timer 做最长 30 秒的指数退避。

## Intent 与权限 behavior

默认 Gateway intent 为 `Guilds`、`GuildMessages` 与 `DirectMessages`；为 DM 投递启用 `Partials.Channel`。仅当 `messageContentIntent: true` 时增加 `MessageContent`。

该选项为最小权限默认 `false`。Discord 会为 DM 和在 guild 中 mention 应用的消息提供正文，所以 DM 与明确 mention 无需 privileged intent。若要以 legacy `groupMode: always` 读取普通未 mention 的 guild message，operator 必须同时在 Discord Developer Portal 开启 Message Content Intent，并配置 `messageContentIntent: true`；缺少任一侧时，这些正文都会按平台设计不可用。

Bot 不需要 Administrator。只向目标 channel 授予 View Channel、Send Messages 与 Read Message History；thread 出站增加 Send Messages in Threads，ack reaction 增加 Add Reactions。该纯文本 adapter 不申请 member、presence 或 reaction-event intent。

## 归一化 behavior

1. 忽略 bot、webhook、system 与空/非文本消息。
2. DM 映射为 `chatType: 'direct'`，channel id 作为 `conversationId`；DM 无需 mention 即可准入。
3. 普通 guild channel 映射为 `chatType: 'group'`，channel id 作为 `conversationId`。
4. Thread 以父 channel id 作为 `conversationId`、自身 channel id 作为 `threadId`；send/reaction target 为 `threadId ?? conversationId`。
5. 由 discord.js 的结构化 mention data 判断当前 bot 是否被定向：`mentions.users` 含 bot，或 `mentions.repliedUser` 是 bot。这里刻意不用宽泛的 `MessageMentions.has(botId)`，避免 `@everyone` 与 role mention 绕过 group gate。转发文本只删除当前 bot 的精确 `<@id>` 与 `<@!id>` markup。
6. 旧 channel-core 仍独占 `groupMode` 判定、Session 选择、回合串行、preset 挂载、日志写入与出站投递调用。

## 出站与安全 behavior

- 使用共享 legacy splitter，按 Discord 2,000 UTF-16 code unit 上限分片，绝不切断 surrogate pair。
- 只有 discord.js 判定 fetched channel 可发送时才投递；forum parent 会明确失败，不静默丢输出。
- 每个分片都设置 `allowedMentions: { parse: [], repliedUser: false }`，防止模型输出或保留 markup 触发非预期 ping。
- 只有首片带 `reply.messageReference` 与 `failIfNotExists: false`；后续片是普通续文。
- 顺序等待 send，并上抛首个终态失败；不在 discord.js REST behavior 外再加 retry layer。
- 通过目标 channel 的 message manager 添加 ack emoji，不要求目标消息已缓存。

## Lifecycle behavior

Adapter 启动时 receive unavailable，client ready 后才标记 available。每个准入 Gateway message 都创建受跟踪的 legacy inbound promise。凭据替换或 dispose 时，它停止新准入、标记 receive unavailable、等待已准入 legacy turn 完成 Session flush 与 outbound send、销毁 client、收束 login task 并移除 listener。因此正常 shutdown 不会截断 Harness 已接受的回答。

## 验证与证据边界

无密钥 fixture 覆盖 intent construction、DM/guild/thread normalization、bot/webhook/system filtering、structured mention、2,000-unit 与 surrogate-safe splitting、仅首片 reply、禁止 outbound ping、thread target、forum rejection、uncached reaction、failure propagation、readiness、transient backoff、permanent token/intent error、credential rotation、cancellation 与 drain-before-destroy。

带凭证真实服务器 E2E 从未完成。无密钥证据不得描述为 bot installation、guild/channel membership、Developer Portal intent 配置、真实 Gateway ingress 或 REST delivery 的证明。按 ADR-0008 支持词汇，该 compatibility package 至多是 `installable`；它默认关闭，不是 `certified` 或 `enabled`，也不为锁定 sidecar 提供证据。

## 运行安全

Discord bot token 等同密码。应放入 Harness credentials、收紧 server/channel permission、泄漏后立即轮换，并确保不进入 commit、终端输出、日志、issue 或截图。由于旧路径没有持久 ingress/idempotency ledger 或 outbox，即使 Harness Session 本身持久，崩溃窗口仍可能产生重放或丢失。

官方参考：[Gateway 与 intents](https://docs.discord.com/developers/events/gateway)、[消息资源](https://docs.discord.com/developers/resources/message)、[threads](https://docs.discord.com/developers/topics/threads)、[rate limits](https://docs.discord.com/developers/topics/rate-limits)。
