# Agent Note: ack 表情 scope 门控与各渠道提及检测

Status: implemented

[English](2026-08-14-ack-reaction-scope.md) | 中文

## 问题

渠道身份呈现 Note 交付了 `ackReaction`/`deriveMentionPatterns`，但留下了它标注为延后的两处缺口：(1) ack 是**恒开**的——凡带平台 `message_id` 的入站都收到表情，因为 OpenClaw 的 `ackReactionScope` 门控需要尚不存在的群聊提及检测；(2) `deriveMentionPatterns` **没有消费者**。飞书也仍声明 `react: false`，因为其 `im.message.reaction.create` node-sdk 面未经验证。

## 决策

**一次性收掉三处，把 OpenClaw v2026.1.15 的 `shouldAckReaction` 语义保留在集成后的渠道契约中**（`src/agents/identity.ts`/`bot-message-context.ts`）：

- channel-core `presentation.ts` 增 `AckReactionScope = 'all' | 'direct' | 'group-all' | 'group-mentions' | 'off' | 'none'`（默认 `group-mentions`）与 `shouldAckReaction(scope, isGroup, mentionRequired, canDetectMention, wasMentioned)`。兼容参数 `mentionRequired` 为对齐 OpenClaw 调用形状而保留，路由策略则归 `groupMode`：`all` 对全部消息 ack，`direct` 只对私聊，`group-all` 对全部群消息，`group-mentions` 只对可检测且确实提及 bot 的群消息，`off`/`none` 禁用 ack。提及不可检测时 fail-open（不 ack，绝不挡消息）。
- 修正 `resolveAckReaction`：显式 `''` 现在**禁用** ack（原来会回退到 emoji）。schema 刻意让该字段保持可选，因此「未设」会依次回退到 `identity.emoji` 与 `DEFAULT_ACK_REACTION`（`👀`），不再塌缩成「禁用」。
- `ChannelMessage` 增 `chatType: 'direct' | 'group'` 与结构化的 `mention.{detectable,botMentioned}` 元数据。Telegram 从原生实体、回复关系与 bot 身份推导；飞书映射官方 SDK 归一化后的 bot/全体提及标记。适配器若省略结构化元数据，channel-core 才回退到身份派生的 mention pattern；显式 `detectable: false` 仍 fail-open。
- 两个适配器都经 channel-core 的 `registerChannelAdapter` 注册，把生命周期接线与身份 pattern 提供集中在一处；结构化元数据缺失时，channel-core 使用同一套呈现配置派生 pattern。平台原生提及归一化仍留在掌握结构化数据的薄适配器内。
- 飞书经 `client.im.messageReaction.create({ path:{message_id}, data:{reaction_type:{emoji_type}} })` 实现 `react`，`code !== 0` 抛错，并置 `capabilities.react: true`。

Note 中成文延后（记入 channel-core README）：`shouldBypassMention`（需命令概念）与 `removeAckAfterReply`（需 list-then-delete 表情往返）。

## 备选方案

**保持 ack 恒开。** 否决：`group-mentions` 默认即 OpenClaw 行为，且给每条私聊都打 ack 正是 scope 门控要避免的纸割伤。

**解析飞书 bot open_id 做提及检测。** 延后：`mentions[].name` 匹配身份模式覆盖常见情形且零额外 API 调用；名字无关的 open_id 匹配需额外往返，记为 Known Limitation。

**经飞书 list-then-delete 实现 `removeAckAfterReply`。** 延后：reply 后删除是非对称 seam（Telegram 无对等删除），且不值得为本次引入 list 往返。

**让所有 provider 都走共享身份正则。** 否决：平台原生 mention entity 更准确。共享 seam 消费归一化后的结构化元数据，只为无法提供该元数据的通用适配器保留 `deriveMentionPatterns` 回退。

## 后果

- channel-core README 移除「ack scope 恒开」与「`deriveMentionPatterns` 无消费者」两条限制；控制命令旁路与 reply 后删除成为 ack scope 仅剩的延后项。
- 飞书 `react: false` 的 Known Limitation 移除；`capabilities.react: true` 现与 Telegram 并列为适配器模板。
- `clawdsh` preset 的 channel-core 行显式携带 `groupMode: mention` 与 `ackReactionScope: group-mentions`。
- `chatType` 和 `mention.{detectable,botMentioned}` 契约写入 `ChannelMessage` JSDoc；未来结构化适配器必须保留「未提及」与「不可检测」的区别。
- 测试：`presentation.spec`（表驱动 `shouldAckReaction` + `''` 禁用）、`channel-core.spec`（跨 scope 的路由与 ack 门控）、适配器 spec（Telegram 实体/回复映射、飞书归一化提及映射与 reaction 载荷）。
