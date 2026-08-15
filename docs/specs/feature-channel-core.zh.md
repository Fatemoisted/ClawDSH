# 历史功能参考：已移除的 channel-core adapter path

[English](feature-channel-core.md) | 中文

- **状态**：已移除；仅作历史参考
- **已移除包**：`channel-core`、`channel-telegram` 与 `channel-feishu`
- **决策历史**：[ADR-0002](../adr/0002-channel-seam.md)
- **当前替代**：[OpenClaw 渠道平面 bridge](feature-channel-plane-bridge.md) / [ADR-0008](../adr/0008-openclaw-channel-plane.md)

## 用途

`channel-core` 是阶段 2 对进程内 `ctx.channels` registry 的可行性实现。它证明 Telegram 与 Feishu adapter 可共享 Session 路由与 Agent 回合逻辑，而不修改上游 dsh。Runtime implementation 已移除；既有本地配置可通过 `tools/openclaw-channel-migration.ts` 盘点，且不会复制 secret value。

当前架构使用 `@clawdsh/dsh-channel`；平台接入属于锁定的 OpenClaw Gateway，而不是 ClawDSH adapter package。

## 旧契约

- `registerAdapter(adapter)` 注册唯一进程内 `ChannelAdapter`，并随贡献它的 Cordis effect dispose。
- Adapter 发出 `channel/inbound`，携带 channel、可选 thread 与 sender 及 text；core 选择或创建内存中的 per-thread Agent Session。
- 同一 thread 的回合被串行化，经 `ctx.agents` 驱动、经 `ctx.sessions` flush，随后通过 `adapter.send` 与 `channel/outbound` 回投文本。
- 身份呈现、mention stripping、response prefix 与 acknowledgement reaction 在旧 adapter path 内解析。
- 契约没有持久 route binding、host identity、idempotency ledger、delivery receipt、capability negotiation、rich action 或 attachment 语义。

## 当前边界

- 没有 package 注册 `ctx.legacyChannels`；`ctx.channels → channel-agent → channel-openclaw` 是唯一 runtime path。
- 不要增加另一套直连 adapter，也不要恢复旧 `ChannelMessage`。所需渠道覆盖属于 sidecar catalog 与 V1 bridge。
- 迁移清单只报告名称；它既不加载 adapter，也不复制 credential value。
- 发行校验 deny-list 已移除的 package name，防止它们进入公共 bundle。
- Legacy identity-presentation 与 acknowledgement-reaction Agent Note 描述历史行为，不定义 sidecar。

## 验证状态

已移除 package 与 adapter contract test 是历史实现证据。早期 Telegram 与 Feishu 开发表明最小契约能 mount；它没有建立当前发布认证。已移除 adapter 没有 support state，其证据不能认证 canonical sidecar。

## 删除结果

三个直连 adapter package 与 `ctx.legacyChannels` 已一并移除。剩余 package-name 引用只用于迁移、发行拒绝和历史文档，不提供 runtime compatibility。
