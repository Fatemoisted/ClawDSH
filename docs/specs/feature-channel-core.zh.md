# 功能规格：旧 channel-core 适配器路径

[English](feature-channel-core.md) | 中文

- **状态**：已实现 legacy compatibility path；新开发已被取代
- **实现包**：`packages/openclaw/channel-core`（`@clawdsh/dsh-channel-core`）
- **决策历史**：[ADR-0002](../adr/0002-channel-seam.md)
- **旧图片/地址决策**：[ADR-0011](../adr/0011-deferred-channel-images-and-address-continuity.md)
- **当前替代**：[OpenClaw 渠道平面 bridge](feature-channel-plane-bridge.md) / [ADR-0008](../adr/0008-openclaw-channel-plane.md)

## 用途

`channel-core` 是阶段 2 对进程内 `ctx.channels` registry 的可行性实现。它证明 Telegram、飞书以及后来的 Discord adapter 可共享 Session 路由与 Agent 回合逻辑，而不修改上游 dsh。它被暂时保留，避免 sidecar 替代方案获得等价证据前删除既有本地配置。

该包不再拥有当前渠道架构。新 consumer 使用 `@clawdsh/dsh-channel`；新平台接入属于锁定的 OpenClaw Gateway，而不是新的 ClawDSH adapter package。

## 旧契约

- `registerAdapter(adapter)` 注册唯一进程内 `ChannelAdapter`，并随贡献它的 Cordis effect dispose。
- Adapter 发出 `channel/inbound`，携带 provider、当前 conversation、可选稳定 Session conversation、可选 thread、sender、text/caption、reply identity 与短暂 image source；core 确定性恢复或创建匹配 Agent Session。
- 同一稳定 conversation/thread 的回合被串行化，经 `ctx.agents` 驱动、经 `ctx.sessions` flush，随后通过 `adapter.send` 与 `channel/outbound` 回投回复。
- 身份呈现、mention stripping、response prefix 与 acknowledgement reaction 在旧 adapter path 内解析。
- 对图片模型，只有通过 mention 准入与准确模型模态解析后才 materialize；Harness 校验并存储所得 attachment reference。纯文本与导入失败 behavior 遵循 ADR-0011。
- 该约定仍没有持久 provider ingress/outbox、精确 host identity、idempotency 或 delivery ledger、capability negotiation 与通用 native-action surface。进程丢失可能重放 ingress，或在 Session 持久化后丢失 delivery。

## 兼容规则

- 旧 service 注册为 `ctx.legacyChannels`。不要让它和当前 `ctx.channels` 路径连接同一平台账号。
- 随附的 `clawdsh-legacy-channel-plane` group 与每个 adapter entry 都默认关闭。存在该 legacy opt-in 时，Gateway 启动与 Settings preflight 会拒绝 canonical enablement。
- 不要再加 adapter，也不要扩宽 `ChannelMessage`。所需渠道覆盖属于 sidecar catalog 与 V1 bridge。
- Legacy path 仍安装期间，credential 留在环境变量支持的 adapter config 中。
- Legacy identity-presentation 与 acknowledgement-reaction Agent Note 随代码保留到删除时；不要把其行为投射到 sidecar。

## 验证状态

Package 与 adapter test 覆盖确定性 Session 复用、per-conversation FIFO、等待式 shutdown、群聊 mention policy、原生 reply/reaction、provider-safe splitting、凭据 lifecycle 与 provider-specific normalization。Telegram 另有 ADR-0011 下的无密钥图片/地址覆盖。

历史带凭证证据范围更窄：飞书文本在 2026-08-14 完成端到端 round trip；Telegram 私聊/群聊文本与 caption 加 recovery/tool 路径在 2026-08-15 完成；Discord 从未完成带凭证真实服务器 E2E。后续 Telegram 图片/轮换/迁移 behavior 与后续飞书凭据引用/热切换 behavior 仍只有无密钥覆盖。这些事实建立 legacy behavior，不建立当前发布认证，更不能认证 sidecar。三个 adapter 都至多是 `installable`、默认关闭，且既不是 `certified` 也不是 `enabled`。

## 删除门禁

只有 production OpenClaw sidecar 可复现装配、自有无密钥 Gateway-to-Agent snapshot 正在运行，且新的认证覆盖仍用于迁移的每个 legacy 平台（包括入站准入、Agent 执行、出站投递、重复消息、重连与失败路径）后，才能同时删除 `channel-core`、`channel-telegram`、`channel-discord` 与 `channel-feishu`。只在该删除变更中归档旧 Agent Notes。
