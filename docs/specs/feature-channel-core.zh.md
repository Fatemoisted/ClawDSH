# 功能规格：旧 channel-core 适配器路径

[English](feature-channel-core.md) | 中文

- **状态**：已实现 legacy compatibility path；新开发已被取代
- **实现包**：`packages/openclaw/channel-core`（`@clawdsh/dsh-channel-core`）
- **决策历史**：[ADR-0002](../adr/0002-channel-seam.md)
- **当前替代**：[OpenClaw 渠道平面 bridge](feature-channel-plane-bridge.md) / [ADR-0008](../adr/0008-openclaw-channel-plane.md)

## 用途

`channel-core` 是阶段 2 对进程内 `ctx.channels` registry 的可行性实现。它证明 Telegram 与 Feishu adapter 可共享 Session 路由与 Agent 回合逻辑，而不修改上游 dsh。它被暂时保留，避免 sidecar 替代方案获得等价证据前删除既有本地配置。

该包不再拥有当前渠道架构。新 consumer 使用 `@clawdsh/dsh-channel`；新平台接入属于锁定的 OpenClaw Gateway，而不是新的 ClawDSH adapter package。

## 旧契约

- `registerAdapter(adapter)` 注册唯一进程内 `ChannelAdapter`，并随贡献它的 Cordis effect dispose。
- Adapter 发出 `channel/inbound`，携带 channel、可选 thread 与 sender 及 text；core 选择或创建内存中的 per-thread Agent Session。
- 同一 thread 的回合被串行化，经 `ctx.agents` 驱动、经 `ctx.sessions` flush，随后通过 `adapter.send` 与 `channel/outbound` 回投文本。
- 身份呈现、mention stripping、response prefix 与 acknowledgement reaction 在旧 adapter path 内解析。
- 契约没有持久 route binding、host identity、idempotency ledger、delivery receipt、capability negotiation、rich action 或 attachment 语义。

## 兼容规则

- 旧 service 注册为 `ctx.legacyChannels`。不要让它和当前 `ctx.channels` 路径连接同一平台账号。
- 不要再加 adapter，也不要扩宽 `ChannelMessage`。所需渠道覆盖属于 sidecar catalog 与 V1 bridge。
- Legacy path 仍安装期间，credential 留在环境变量支持的 adapter config 中。
- Legacy identity-presentation 与 acknowledgement-reaction Agent Note 随代码保留到删除时；不要把其行为投射到 sidecar。

## 验证状态

软件包与 adapter contract test 保留为历史实现证据。早期 Telegram 与 Feishu 开发表明最小契约能 mount；它没有建立当前发布认证。没有当前带凭证证据时，按 ADR-0008 状态模型，两个旧 adapter 至多是 `installable`，不是 `certified` 或 `enabled`。

## 删除门禁

只有 production OpenClaw sidecar 可复现装配、自有无密钥 Gateway-to-Agent snapshot 正在运行，且新的 Telegram 与 Feishu 认证覆盖入站准入、Agent 执行、出站投递、重复消息、重连与失败路径后，才能同时删除 `channel-core`、`channel-telegram` 与 `channel-feishu`。只在该删除变更中归档旧 Agent Notes。
