# @clawdsh/dsh-channel-feishu

**定位**：飞书（Lark）渠道适配器——实现 `ChannelAdapter`：`node:http` webhook 明文入站 + im OpenAPI 出站。**发起人第一优先渠道**（2026-08-14 确立）。

**OpenClaw 对应**：✅ 上游官方 `extensions/feishu`——2026-02-03 引入（提交 `2483f26c23` "Channels: add Feishu/Lark support" → `0223416c61` "finish Feishu/Lark integration"），自 v2026.2.12 起随发布。移植时以该扩展为功能参考。

**接缝**：`ctx.channels`（@clawdsh/dsh-channel-core，ADR-0002）。与 Telegram（轮询）形态互补，共同验证 seam。

**规格**：docs/specs/roadmap.md（阶段 2 交付物） · **状态**：implemented

## 设计要点

- **入站**：`node:http` 零依赖 webhook；先 ACK 200 再异步处理（3 秒确认窗口）；URL 校验 challenge 回显；解析 v1（`type:'event_callback'` + `uuid`）与 v2（`schema:"2.0"` + `header.event_id`）两种格式；按 `uuid`/`event_id` 幂等去重（至少一次投递）；`im.message.receive_v1` → `channel/inbound`（群 `threadId` = chat_id，p2p = sender open_id，`sender` = open_id，text 从 `content` JSON 字符串 `{"text":"…"}` 解出）。
- **出站**：`tenant_access_token`（`auth/v3/tenant_access_token/internal`，缓存到 expire）→ `im/v1/messages`（群 `receive_id_type=chat_id`，p2p = `open_id`）。
- **凭证**：`appId`/`appSecret` 经 Config 进入，不私存密钥；接入 `ctx.credentials` 留待真实 e2e 收尾。

## Known Limitations and Deferred Work

- **webhook 加密**：`encryptKey` 配置存在但未实现，配置即 fail-loud；当前仅明文模式。
- **富文本/交互卡片/附件**：仅文本消息；rich-text、interactive card、图片、`reply_in_thread` 引用回复均属阶段 3 渠道扩展。
- **p2p 会话线索**：p2p 以 sender `open_id` 作为 thread id，`open_chat_id` 仅在缺 sender 时兜底。
- **真实 e2e**：Loader 内跑真实 agent turn 的组装测试需真 key（凭证清单见阶段 2 汇总），当前以契约测试 + dump-config 冒烟覆盖。
- **去重集合**：`seen` 以 10000 条为界逐出最旧，长期运行的 bot 不无限增长。
