# @clawdsh/dsh-channel-feishu

[English](README.md) | 中文

**定位**：基于 `ctx.legacyChannels` 的旧版飞书（Lark）适配器，使用官方 `@larksuiteoapi/node-sdk` 接收 WebSocket 入站事件，并通过 `im.message.create` 发送回复。它只保留到带凭证的 OpenClaw sidecar live-cutover 完成。

**OpenClaw 对应**：✅ 上游官方 `extensions/feishu`——2026-02-03 引入（提交 `2483f26c23` "Channels: add Feishu/Lark support" → `0223416c61` "finish Feishu/Lark integration"），自 v2026.2.12 起随发布。移植时以该扩展为功能参考：它同样用 `@larksuiteoapi/node-sdk` 的长连接模式（`Lark.Client` + `Lark.WSClient` + `Lark.EventDispatcher` 注册 `im.message.receive_v1`）。

**接缝**：仅供旧版使用的 `ctx.legacyChannels`（@clawdsh/dsh-channel-core，历史 ADR-0002），不为生产 `ctx.channels` 服务提供兼容 alias。

**规格**：docs/specs/roadmap.md（历史阶段 2 交付物） · **状态**：legacy，默认禁用，等待退役；本文不声称 sidecar 已完成 live cutover

## 设计要点

- **入站**：`Lark.EventDispatcher` 注册 `im.message.receive_v1`，`Lark.WSClient` 长连接启动（SDK 内部完成鉴权与 ACK，至少一次投递）；按 `message_id` 幂等去重；文本消息 → `channel/inbound`（群 `threadId` = chat_id，p2p/private = sender open_id，`sender` = open_id，text 从 `content` JSON 字符串 `{"text":"…"}` 解出）。`isGroup` 来自 `chat_type === 'group'`；`wasMentioned` 由 `mentions[].name` 与身份派生模式匹配得出（无模式则省略该字段→fail-open）。
- **出站**：`Lark.Client.im.message.create`（`params.receive_id_type` 群 = `chat_id`、p2p = `open_id`，`data.receive_id` + `msg_type:'text'` + `content` JSON）；`tenant_access_token` 由 SDK 的 `tokenManager` 缓存与刷新，适配器不自行管理。
- **ack 表情**：`Lark.Client.im.messageReaction.create`（`path.message_id` + `data.reaction_type.emoji_type`）；非零 `code` 抛错，与 `sendMessage` 对称。
- **凭证**：`appId`/`appSecret` 经 Config 进入，不私存密钥；接入 `ctx.credentials` 留待真实 e2e 收尾。
- **长连接取代 webhook**：无 `verificationToken`/`encryptKey`、无入站 HTTP 端口、无 URL 校验 challenge（这些只在 webhook 模式需要；长连接由 SDK 完成鉴权）。`domain` 选择飞书（默认）或国际版 Lark。

## Model Experience

### Inbound message text

#### What the model sees

The adapter parses a Feishu `im.message.receive_v1` event (delivered over the SDK's WebSocket long-connection) and emits a `channel/inbound` message; the channel-core router writes that message's `text` into the session log as a user message. The adapter registers no prompt or tool schema of its own.

#### Token effect

Only the relayed message text reaches the model, through channel-core's session write.

#### KV Cache effect

Append-only through channel-core's user-message write.

## Known Limitations and Deferred Work

- **退役门禁**：只有使用真实凭证的飞书账号通过 OpenClaw sidecar live-cutover 矩阵后才能删除该适配器；单元测试和契约测试不能替代该门禁。

- **富文本/交互卡片/附件**：仅文本消息；rich-text、interactive card、图片、`reply_in_thread` 引用回复均属阶段 3 渠道扩展。
- **p2p 会话线索**：p2p/private 以 sender `open_id` 作为 thread id，`chat_id` 仅在缺 sender 时兜底。
- **真实 e2e**：Loader 内跑真实 agent turn 的组装测试需真 key（凭证清单见阶段 2 汇总），当前以契约测试（协议映射 + `send` 载荷 + 幂等去重）+ dump-config 冒烟覆盖。
- **去重集合**：`seen` 以 10000 条为界逐出最旧，长期运行的 bot 不无限增长。
- **发送失败即抛**：`im.message.create` 返回非零 `code` 时抛错；重试/限流策略留待阶段 3。
- **按显示名映射提及**：`wasMentioned` 用 `mentions[].name` 匹配身份模式；从 mention `id` 解析 bot 自身 `open_id`（从而名字无关匹配）需要额外 API 往返，留待后续。名字不匹配任何身份模式的提及上报 `wasMentioned: false`。
