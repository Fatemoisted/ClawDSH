# @clawdsh/dsh-channel-feishu

[English](README.md) | 中文

**定位**：旧版飞书（Lark）适配器——官方 `@larksuiteoapi/node-sdk` 1.73 高层 `LarkChannel` 与 `ctx.legacyChannels` 之间的一层薄桥接。**发起人第一优先渠道**（2026-08-14 确立）。

**OpenClaw 对应**：✅ 上游官方 `extensions/feishu`，自 v2026.2.12 起随发布。ClawDSH 直接把平台机制委托给 SDK 自带 channel 组件，不在本包复制一套。

**接缝**：仅供旧版兼容使用的 `ctx.legacyChannels`（`@clawdsh/dsh-channel-core`，ADR-0002）、Harness credentials / 启动环境与 Harness timer；不为规范生产 `ctx.channels` 服务提供 alias。

**规格**：docs/specs/roadmap.md（历史阶段 2 交付物） · **状态**：旧版兼容、默认禁用，等待 sidecar 切换验证；下述永不结束握手的 timeout 待完成

受跟踪配置只携带引用，不携带值：

```yaml
appIdEnv: FEISHU_APP_ID
appSecretEnv: FEISHU_APP_SECRET
domain: feishu
```

## 设计要点

- **SDK 负责平台层**：`createLarkChannel` 负责接流量前探测 bot `open_id`、WebSocket 重连、过期消息拒绝、TTL 去重、in-flight lock、结构化 mention 移除、富消息归一化、token 刷新、普通出站分片/重试、引用失效回退和 reaction；
- **薄转换**：适配器只把 `NormalizedMessage` 映射成 `ChannelMessage`（`conversationId` = 群 `chatId` 或私聊 sender id、可选 `threadId`、结构化 `mention` 与 SDK 渲染后的文本）。由于 SDK policy 已启用 `respondToMentionAll`，广播提及也会被规范化成 channel-core 群聊门控可接受的 bot mention。callback 会等待 `ctx.parallel('channel/inbound', inbound)` 走完 FIFO 回合、`sessions.flush`、出站发送与 ack 完成。SDK 1.73 在关闭 queue 后会异步启动这个 callback，因此 WebSocket 入站确认本身不是持久化屏障；
- **不跨话题合并**：关闭 SDK `chatQueue` batching，因为它只按 chat id 分组，而 Harness session 还会区分飞书 topic；SDK mention policy 同样关闭，统一交给 channel-core；
- **WebSocket 前身份重试**：WebSocket client 一旦存在，重连仍完全归 SDK；只有创建 WebSocket 前探测 bot 身份的瞬时失败由 adapter 经 Harness timer 重试，指数退避从 1 秒封顶到 30 秒，永久 SDK 错误不进入重试循环；
- **Unicode-safe 出站**：适配器对全部发送按 3500 个 UTF-16 unit 预分片且不切断 surrogate pair，再把每片的鉴权、重试和引用目标消失回退交给 `LarkChannel.send`。topic reply 的每片都携带相同 `replyTo`/`replyInThread`，避免后续片段离开 topic。reaction 仍经 SDK `addReaction`：一张最小明确表把常见便携 ack emoji 映射为飞书 named reaction，未知 identity emoji 则稳定降级成 `EYES`，不再让每次 ack 都失败；
- **排空与已结算失败握手清理**：dispose 会先取消入站订阅并等待适配器跟踪的全部消息 callback，再断开连接。连接尝试已结算但从未达到 `connected=true` 时，dispose 会强制关闭 SDK 1.73 的 `rawWsClient`、排空其 safety timer，再调用公开 disconnect；成功连接完全走公开生命周期。连接尝试永不结算是下述已知例外；
- **凭证归 Harness**：`appIdEnv` 与 `appSecretEnv` 是 credential reference，默认分别为 `FEISHU_APP_ID` 与 `FEISHU_APP_SECRET`。两个字段分别经 `ctx.credentials` 解析；只有未挂载 credentials 服务时才回退 Harness 启动环境。原有字面量 `appId`/`appSecret` 继续作为编程接入兼容覆盖项且优先级更高，但绝不能提交进仓库。任一引用解析不到时不会构造 SDK channel，全部 capability 保持不可用，生命周期日志会明确列出缺失的引用名，发送调用也会拒绝。匹配的 `credentials/updated` 事件会停止并排空旧 SDK channel、重新解析整对凭证并启动新 channel；字面量字段不热轮换；
- **长连接取代 webhook**：无 `verificationToken`/`encryptKey`、无入站 HTTP 端口、无 URL 校验 challenge（这些只在 webhook 模式需要；长连接由 SDK 完成鉴权）。`domain` 选择飞书（默认）或国际版 Lark。

## Model Experience

### Inbound message text

#### What the model sees

SDK 会把 text、post、图片/文件/音频/视频/sticker/card/share/location/calendar 等受支持消息形态转成稳定的归一化文本；本适配器把该文本作为 `channel/inbound` 转交 channel-core。适配器自身不注册 prompt 或 tool schema。

#### Token effect

只有转交的消息文本经 channel-core 的持久 session 写入触达模型。

#### KV Cache effect

经 channel-core 的 user-message 写入保持 append-only。

## Known Limitations and Deferred Work

- **二进制附件**：SDK 已识别资源消息并转成文本，但共享 `ChannelMessage` 契约尚未把字节下载进 Harness `ctx.attachments`；模型看到的是 SDK 的资源标记，不是图片/文件字节。
- **交互事件**：`LarkChannel` 已支持入站卡片 action/comment/reaction 与出站流式卡片，但文本型 `ctx.legacyChannels` 契约尚未投影这些事件。
- **带凭证 e2e 边界**：2026-08-14 的真实飞书部署已通过鉴权、WebSocket 入站、持久 Harness agent 回合、SDK 出站投递，并由用户确认收到回复。该轮早于当前 credential reference 与热轮换适配；这两条路径，以及启动环境回退、缺凭证 fail-loud、归一化映射、可等待入站、WebSocket 前退避、握手拒绝后的清理、Unicode-safe topic 分片、原生引用与 reaction 目前只有无密钥覆盖，credential reference 与轮换路径仍需重新跑一轮真实部署。
- **永不结束的握手**：`LarkChannel` 当前创建时没有配置 SDK handshake timeout，dispose 又会在关闭 socket 前等待活跃 `connect()` promise。DNS/proxy/NAT 路径永不结算时，关停或重载可能因此挂住；配置 SDK timeout 并覆盖此路径后，才能宣称失败握手清理完整。
- **异步 ready**：adapter dispose 已是异步并会排空连接清理，但 `start` 仍没有 ready Promise；SDK 身份探测/握手失败以异步日志暴露，不会让 daemon boot 本身 reject。
- **SDK 入站确认**：SDK 1.73 会在 callback 结束后把已接受事件标为 seen，即使 callback 最终失败。SDK 出站重试覆盖瞬时发送错误，但最终失败后仍没有持久 ingress/outbox 重放。
- **SDK 1.73 兼容 shim**：已结算失败握手后的清理必须触达 SDK 的 `rawWsClient` 与 safety 组件，因为公开生命周期在这条路径上不完整；升级 Lark SDK 时需要重新验证或删除这层窄 shim。
