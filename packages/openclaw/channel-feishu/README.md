# @clawdsh/dsh-channel-feishu

**定位**：飞书（Lark）渠道适配器——实现 `ChannelAdapter`：飞书开放平台机器人的事件订阅（长连接 WebSocket 或 webhook）入站 + im OpenAPI 出站。**发起人第一优先渠道**（2026-08-14 确立）。

**OpenClaw 对应**：✅ 上游官方 `extensions/feishu`——2026-02-03 引入（提交 `2483f26c23` "Channels: add Feishu/Lark support" → `0223416c61` "finish Feishu/Lark integration"），自 v2026.2.12 起随发布。移植时以该扩展为功能参考（`channel-entry.ts` / `channel-plugin-api.ts` / `openclaw.plugin.json` 的形态），符合项目原则"OpenClaw 有的才实现"。

**接缝**：`ctx.channels`（@clawdsh/dsh-channel-core，ADR-0002）。**ADR-0002 指定的 seam 验证备选渠道**（与 Telegram 差异足够大：应用身份、事件推送、卡片模型、群 thread）——预计**阶段 2 与 Telegram 并行**做 seam 验证。

**规格**：docs/specs/roadmap.md（阶段 2 交付物） · **状态**：planning（Spike 候选 #3，阶段 2）

## 设计要点（草案，Spike 时细化）

- **入站**：飞书开放平台事件订阅（长连接 WebSocket 优先，webhook 兜底）→ `im.message.receive_v1` 事件 → 映射为 `ChannelMessage`（`threadId` = 群 chat_id / p2p open_chat_id，`sender` = open_id，回复引用 = parent message_id）；
- **出站**：`im/v1/messages`（reply/reply_in_thread）；飞书应用机器人有"消息回复窗口"语义，与 dsh 会话状态天然契合；
- **富文本**：第一阶段只做文本 + 图片；interactive card（交互卡片）作为第二里程碑——正好压测 `ctx.channels` 契约的扩展性；
- **凭证**：app_id/app_secret → tenant_access_token，走 dsh 的 `ctx.credentials` 接缝，不私存密钥；
- **日志不变式**：入站消息先写 session log 再进 agent loop（"model-visible means logged"）。
