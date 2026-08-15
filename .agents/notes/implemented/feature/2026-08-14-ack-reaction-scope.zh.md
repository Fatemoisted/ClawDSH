# Agent Note: ack 表情 scope 门控与各渠道提及检测

Status: implemented

[English](2026-08-14-ack-reaction-scope.md) | 中文

## 问题

渠道身份呈现 Note 交付了 `ackReaction`/`deriveMentionPatterns`，但留下了它标注为延后的两处缺口：(1) ack 是**恒开**的——凡带平台 `message_id` 的入站都收到表情，因为 OpenClaw 的 `ackReactionScope` 门控需要尚不存在的群聊提及检测；(2) `deriveMentionPatterns` **没有消费者**。飞书也仍声明 `react: false`，因为其 `im.message.reaction.create` node-sdk 面未经验证。

## 决策

**一次性收掉三处，逐语义移植 OpenClaw v2026.1.15 的 `shouldAckReaction`**（`src/agents/identity.ts`/`bot-message-context.ts`）：

- channel-core `presentation.ts` 增 `AckReactionScope = 'all' | 'direct' | 'group-all' | 'group-mentions'`（默认 `group-mentions`）与 `shouldAckReaction(scope, isGroup, requireMention, canDetectMention, wasMentioned)`：`all`/`direct`/`group-all` 无条件；`group-mentions` 仅当 `requireMention` 开启、检测可行、且 bot 被提及时才 ack——`canDetectMention: false` 时 fail-open（不 ack，绝不挡消息）。
- 修正 `resolveAckReaction`：显式 `''` 现在**禁用** ack（原来会回退到 emoji）；z 默认从 `''` 改为 `DEFAULT_ACK_REACTION`（`👀`），使「未设」不再塌缩成「禁用」。
- `ChannelMessage` 增 `isGroup?` / `wasMentioned?`。字段**存在性**即检测能力信号：无法评估提及的适配器省略 `wasMentioned`，门控据此 fail-open。
- Telegram `detectBotMention`（bot 真实用户名对 `mention` 实体与 `@username` 文本，加上身份模式）与飞书的提及映射（`mentions[].name` 匹配身份模式）成为消费者；两个适配器都经 channel-core 的 `registerChannelAdapter` 注册（唯一读 `getPresentation()` → `deriveMentionPatterns` 的地方，取代各适配器复制粘贴）。Telegram 从 `bot.botInfo?.username` 取用户名（grammY 在 `init()` 后填充）。
- 飞书经 `client.im.messageReaction.create({ path:{message_id}, data:{reaction_type:{emoji_type}} })` 实现 `react`，`code !== 0` 抛错，并置 `capabilities.react: true`。

Note 中成文延后（记入 channel-core README）：`shouldBypassMention`（需命令概念）与 `removeAckAfterReply`（需 list-then-delete 表情往返）。

## 备选方案

**保持 ack 恒开。** 否决：`group-mentions` 默认即 OpenClaw 行为，且给每条私聊都打 ack 正是 scope 门控要避免的纸割伤。

**解析飞书 bot open_id 做提及检测。** 延后：`mentions[].name` 匹配身份模式覆盖常见情形且零额外 API 调用；名字无关的 open_id 匹配需额外往返，记为 Known Limitation。

**经飞书 list-then-delete 实现 `removeAckAfterReply`。** 延后：reply 后删除是非对称 seam（Telegram 无对等删除），且不值得为本次引入 list 往返。

**用共享 service 驱动提及检测。** 否决：`deriveMentionPatterns` 是对呈现配置的纯函数；各适配器经 `getPresentation()` 本地消费，这是唯一入口。

## 后果

- channel-core README 移除「ack scope 恒开」与「`deriveMentionPatterns` 无消费者」两条限制；控制命令旁路与 reply 后删除成为 ack scope 仅剩的延后项。
- 飞书 `react: false` 的 Known Limitation 移除；`capabilities.react: true` 现与 Telegram 并列为适配器模板。
- 默认关闭的 `clawdsh-legacy-channel-plane` group 显式携带 `groupMode: mention` + `ackReactionScope: group-mentions`。
- `wasMentioned` 字段存在性契约写入 `ChannelMessage` JSDoc；未来适配器必须遵守（省略 → fail-open）。
- 测试：`presentation.spec`（表驱动 `shouldAckReaction` + `''` 禁用）、`channel-core.spec`（跨 scope 的 ack 门控）、适配器 spec（`detectBotMention`、飞书提及映射与 `react` 载荷）。
- 该策略只属于 legacy `ctx.legacyChannels`；[test1 重建 Note](../architecture/2026-08-15-test1-channel-plane-rebuild.md)负责它与规范 `ctx.channels` 的隔离。
