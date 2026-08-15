# 功能规格：Discord 渠道适配器

[English](feature-channel-discord.md) | 中文

- **状态**：implemented（无密钥验证；带凭证线上 E2E 待完成，2026-08-15）
- **实现包**：`packages/openclaw/channel-discord`（`@clawdsh/dsh-channel-discord`）
- **OpenClaw 对应**：选定的 v2026.1.5 基线中的 `src/discord/`
- **复用的既有接缝**：`ctx.channels`、Harness credentials / launch environment、Harness timer、Cordis 生命周期
- **Provider 库**：discord.js 14.x

## 决策

把 Discord 实现成既有 `ChannelAdapter` 契约上的纯 provider 适配器；不移植 OpenClaw 的 agent loop、session ownership、gateway facade、重试框架或权限模型。对应能力已经由 Harness 提供：

| 关注点 | 归属 |
|---|---|
| 持久 conversation/topic session、FIFO 回合、`groupMode`、preset、模型运行、session flush、出站事件、确认策略 | `@clawdsh/dsh-channel-core` |
| Bot token 查找与热轮换 | Harness `ctx.credentials`，并以 launch environment 回退 |
| 初次登录退避与 teardown scope | Harness timer 与 Cordis 生命周期 |
| Gateway 心跳/重连、REST 限流处理 | discord.js |
| Discord 事件归一化、channel/thread 发送、原生引用、reaction | `@clawdsh/dsh-channel-discord` |

这样可保持 provider 包足够薄，channel-core 中也不出现 Discord 分支。

## 目标

- 通过 Gateway `MessageCreate` 接收 Discord 私信、服务器文字频道与具体 thread 中的用户文本。
- 不用显示文本启发式解析，而是把 provider 地址和结构化 mention 状态归一化成 `ChannelMessage`。
- 把 assistant 文本送到正确 channel/thread，保留一次原生引用，并提供确认 reaction。
- 默认使用 Harness credential reference，避免密钥进入仓库配置与日志。
- 关闭 provider client 前排空每一个已被 Harness 准入的回合。

## 非目标

- 二进制附件输入、作为模型输入的 embed、sticker、poll、语音、stage channel 或屏幕共享；
- slash command、autocomplete、context menu、button、select、modal 等 Discord interaction；
- webhook 投递、跨进程/shard ownership 编排、持久 provider inbox/outbox 或 exactly-once 投递；
- 直接向 forum 父频道发送（具体 forum thread 是合法目标）；
- 用自定义代码替代 discord.js 的 Gateway 重连或 REST 限流行为。

## 配置与凭证

```ts
interface Config {
  botToken?: string
  botTokenEnv?: string // default: DISCORD_BOT_TOKEN
  messageContentIntent?: boolean // default: false
}
```

`botTokenEnv` 是 Harness credential reference，不是 token 本身。它默认指向 `DISCORD_BOT_TOKEN`，仅在打开 Gateway 连接时解析；优先使用 `ctx.credentials`，并保留 Harness launch environment 作为兼容回退。对应的 `credentials/updated` 事件会先排空再替换 client，使凭证轮换无需重启进程。`botToken` 的 secret-role 字段只为编程组装保留，禁止出现在受跟踪配置中。

解析后的 token 不得写入日志，错误渲染还会防御性地脱敏当前 token。无效 token，以及代表无效/未获准 intent 的 Gateway `4013`/`4014`，对当前配置属于永久错误，不能进入无限重试；其他初次登录失败由 Harness timer 做指数退避，最长 30 秒。

## Intent 与权限契约

默认 Gateway intents 为 `Guilds`、`GuildMessages`、`DirectMessages`；为私信投递启用 `Partials.Channel`。仅当 `messageContentIntent: true` 时才增加 `MessageContent`。

`messageContentIntent` 为最小权限而默认 `false`。Discord 会为私信和在服务器中提及应用的消息提供正文，所以私信与明确 @mention 无需 privileged intent，正好匹配 channel-core 默认的 mention-gated 群聊模式。若要以 `groupMode: always` 读取普通、未提及 bot 的服务器消息，operator 必须同时在 Discord Developer Portal 打开 Message Content Intent，并配置 `messageContentIntent: true`；缺少任一侧时，这些正文都会按平台设计不可用。

Bot 不需要 Administrator。只向目标频道授予 View Channel、Send Messages、Read Message History；thread 出站再授予 Send Messages in Threads，确认 reaction 再授予 Add Reactions。本纯文本适配器不申请 member、presence 或 reaction-event intent。

## 归一化契约

1. 忽略 bot、webhook、system 以及空/非文本消息。
2. 私信映射为 `chatType: 'direct'`，channel id 作为 `conversationId`；私信无需 mention 即有资格进入。
3. 普通服务器频道映射为 `chatType: 'group'`，channel id 作为 `conversationId`。
4. thread 以父频道 id 作为 `conversationId`、自身 channel id 作为 `threadId`；发送/reaction 目标为 `threadId ?? conversationId`。
5. 由 discord.js 的结构化 mention 数据判断当前 bot 是否被指向：`mentions.users` 包含 bot，或 `mentions.repliedUser` 是 bot。这里有意不用宽泛的 `MessageMentions.has(botId)`，避免 `@everyone` 或包含 bot 的 role mention 绕过群聊 mention gate。转发文本只删除当前 bot 的精确 `<@id>` 与 `<@!id>` 标记，其他 mention 均保留为模型可见文字。
6. `groupMode` 判定、持久 session 选择、回合串行、preset 挂载、日志写入与出站调用仍全部由 channel-core 独占。

## 出站与安全契约

- 使用 channel-core 共享分片器，按 Discord 的 2,000 个 UTF-16 code unit 上限切分，绝不切断 surrogate pair。
- 只有 discord.js 判定 fetched channel 可发送时才投递；forum 父频道会明确失败，不会静默丢输出。
- 每个分片都设置 `allowedMentions: { parse: [], repliedUser: false }`，因此模型输出与保留的入站 mention 标记都不会触发意外的用户、role、`@everyone` 或引用 ping。
- 只有首片带 `reply.messageReference`，并设置 `failIfNotExists: false`；后续片是普通续文。
- 顺序等待每次发送，首个终态失败直接经 channel-core 上抛；不在 discord.js REST 行为外再套一层重试。
- 确认 emoji 通过目标频道的 message manager 添加，不要求目标消息已缓存。

## 生命周期契约

适配器以 `receive: false` 启动，client ready 后才标记接收可用。每个接受的 Gateway 消息都会创建受跟踪的 `ctx.parallel('channel/inbound', message)` promise。替换或销毁时：

1. 取消待执行的 Harness retry，停止 `MessageCreate` 新准入；
2. 标记接收不可用；
3. 等待全部已准入的 channel-core 回合结束，包括持久 flush 与出站发送；
4. 销毁 discord.js client、收束 login task、移除 listener。

此顺序保证正常关闭不会截断一个 Harness 已接受的回答。

## 验收标准

1. 纯 options 构造测试证明默认 intent 不含 Message Content、显式 opt-in 后包含，且两种模式都有 DM channel partial。
2. 无密钥消息 fixture 覆盖私信、服务器、父频道/thread 寻址，bot/webhook/system 过滤，明确/引用 mention 状态与精确 bot mention 删除。
3. 无密钥 client fixture 覆盖 2,000-unit/surrogate 边界分片、仅首片原生引用、禁止出站 ping、thread 目标、forum 拒绝、无缓存 reaction 与失败上抛。
4. 生命周期 fixture 覆盖 ready capability、瞬时登录退避、不可重试的 token/intent 错误、凭证轮换、取消与 destroy 前排空。
5. workspace typecheck、bundle、invariant、profile install、release family 与双语配对门禁包含新包。
6. 明确暂缓带凭证的真实服务器 E2E：不得把自动化/无密钥证据描述成服务器成员关系、portal intent 配置或真实 Discord 投递的证明。

## 运行安全

Discord bot token 等同密码。operator 必须把它放进 Harness credentials、收紧 server/channel 权限，一旦泄露立即轮换，并确保它不进入 commit、终端输出、日志、issue 描述或截图。由于 provider 边界尚无持久幂等账本/outbox，即使 Harness session 本身已持久化，崩溃窗口仍可能产生入站重放或出站丢失。

官方参考：[Gateway 与 intents](https://docs.discord.com/developers/events/gateway)、[消息资源](https://docs.discord.com/developers/resources/message)、[threads](https://docs.discord.com/developers/topics/threads)、[rate limits](https://docs.discord.com/developers/topics/rate-limits)。
