# Agent Note: 渠道身份呈现落在 channel-core

Status: implemented

[English](2026-08-14-channel-identity-presentation.md) | 中文

## 问题

对齐矩阵的 soul 行带着「channel presentation (IDENTITY, Deferred)」：OpenClaw 的 `identity.{name,theme,emoji}` 配置是纯呈现（绝不进 prompt），驱动 ack 表情、`[Name]` 回复前缀与群聊 mention 正则——这些在 dsh 渠道栈里一个都不存在。channel-core 的 `driveTurn` 只发原始提取文本：无前缀、无 ack、无提及处理。

## 决策

**身份呈现落在 legacy channel-core**（`src/presentation.ts` 纯函数 + `LegacyChannelRegistry` Config），逐字移植自 OpenClaw v2026.1.15（`src/agents/identity.ts` + `src/auto-reply/reply/mentions.ts`）：

- `resolveAckReaction`：`ackReaction` → `identity.emoji` → `👀`；
- `resolveResponsePrefix`：`'auto'`（默认）渲染 `[name]`，无名则空；字面量直通；
- `resolveMessagePrefix`：`[name]` 或空；
- `deriveMentionPatterns`：`\b@?<名字各段以 \s+ 连接>\b` 大小写不敏感 + 原始 emoji 字面量模式，含 OpenClaw 的 `→\b` 归一化；`stripMentions` 去除匹配。

接线：`LegacyChannelRegistry` 携带 Config（`identity` / `responsePrefix` / `ackReaction`）；`driveTurn` 给提取回复加前缀、回合前 fire-and-forget 触发 ack；`ChannelMessage.messageId` + `ChannelCapabilities.react` + 可选 `ChannelAdapter.react(message, emoji)` 把 ack 送到适配器。Telegram 经 grammY `setMessageReaction` 实现 `react` 并捕获入站 `message_id`；飞书捕获 `message_id` 并使用官方 SDK 的 `im.messageReaction.create`。默认关闭的 legacy profile 行带 `responsePrefix: auto` + `ackReaction: '👀'`。`agent.cordis.yml` 不动：身份呈现不是 prompt 内容。后续 [ack-reaction scope Note](2026-08-14-ack-reaction-scope.md)负责群提及门控及其当前 adapter consumer。

## 考虑过的替代方案

**agent 面身份配置（每 preset 一行）。** 否决：呈现属于渠道注册表——一个部署身份服务所有渠道，且 prompt/身份切分恰如 OpenClaw 所保持。

**适配器本地呈现（每个适配器自加前缀）。** 否决：前缀逻辑逐渠道重复，绕过 seam 的唯一渲染点（`driveTurn`，回复提取已在此）。

**完整移植 `ackReactionScope`（群提及门控）。** 本增量因需要群聊提及检测而延后；后续 [ack-reaction scope 决策](2026-08-14-ack-reaction-scope.md)已交付该能力。

**新身份服务 seam。** 否决：Config 面上的纯函数模块覆盖全部功能；`ctx.identity` 服务不承载任何额外能力。

## 影响

- 矩阵 soul 行的 `(IDENTITY, Deferred)` 移除；`feature-soul.md` 的映射行指向本 Note；
- `deriveMentionPatterns` 已由后续 ack-scope 决策下的 adapter mention detection 消费；
- 适配器能力 `react` 是 `ChannelAdapter` 契约的一部分；新适配器必须声明，Telegram 与飞书当前都已实现；
- 默认关闭的 legacy group 携带身份呈现；部署改名字/emoji 无需触碰 prompt；
- 该策略只属于 legacy `ctx.legacyChannels`；[test1 重建 Note](../architecture/2026-08-15-test1-channel-plane-rebuild.md)负责它与规范 `ctx.channels` 的隔离。
