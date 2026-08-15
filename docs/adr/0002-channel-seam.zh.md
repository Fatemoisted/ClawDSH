# ADR-0002：旧进程内渠道适配器 seam

[English](0002-channel-seam.md) | 中文

- **状态**：已被 [ADR-0008](0008-openclaw-channel-plane.md) 取代（2026-08-15）
- **日期**：2026-08-14
- **依赖**：ADR-0001

## 上下文

ClawDSH 最初需要证明：消息输入可以选择 dsh Session、进入 append-only log、驱动 Agent 回合并回投回复，且不修改上游 `agent-loop`。DeepSeek Harness 没有消息渠道 Service Definition，因此阶段 2 spike 引入自有 `ctx.channels` 服务，并用 Telegram 和 Feishu 包进行测试。

该实验有意使用最小纯文本 adapter。它回答了可行性问题，但没有保留 OpenClaw 当前通信平面：每新增一个渠道，ClawDSH 仍需复制平台认证、传输生命周期、身份与准入规则、附件、原生动作和投递行为。

## 历史决定

`@clawdsh/dsh-channel-core` 注册多个进程内 `ChannelAdapter` 实现。Adapter 发出 `channel/inbound` 并实现文本 `send`；core 保存内存中的 per-thread Session map，串行化回合，驱动 `ctx.agents`，flush `ctx.sessions`，提取 assistant reply，发送并发出 `channel/outbound`。`channel-telegram` 与 `channel-feishu` 用各自平台 SDK 实现该契约。

该 seam 要求模型可见渠道文本进入 Session log，并把平台凭证留在 adapter config。附件、回复引用、富文本、交互卡、持久路由绑定、crash recovery、delivery receipt 与原生动作 capability negotiation 都不在契约内。

## 取代决定

ADR-0008 用锁定的 OpenClaw Gateway sidecar 与 provider-neutral V1 `ctx.channels` Service Definition 取代该架构。OpenClaw 拥有通信平面；`@clawdsh/dsh-channel-openclaw` 是已认证 Provider，`@clawdsh/dsh-channel-agent` 是持久 Agent 平面 Driver。旧 registry 保留在 `ctx.legacyChannels` 下；部署绝不能让两条路径连接同一平台账号。

`channel-core`、`channel-telegram` 与 `channel-feishu` 作为 legacy compatibility package 保留到 ADR-0008 替换条件通过。它们的软件包测试与历史传输工作只表明旧路径曾有何行为。没有当前带凭证证据时，两个 adapter 都不是 `certified` 或 `enabled`。

## 影响

- 本 ADR 保留为阶段 2 adapter 实验的历史记录，不是当前实现指南。
- 新渠道工作面向 ADR-0008 的 Gateway sidecar、bridge protocol 与锁定 catalog，不再增加原生 adapter。
- 旧 identity-presentation 与 acknowledgement-reaction Agent Note 只在该代码删除前对 legacy path 有效；它们不定义 sidecar 行为。
- 删除 legacy package 要求装配好的 production sidecar、自有无密钥 snapshot path，以及新的 Telegram 与 Feishu live certification。

## 曾考虑的替代方案

- **继续扩展文本 adapter**：已被取代，因为它会长成第二套不完整 OpenClaw 渠道子系统。
- **让每个平台直连 dsh Session**：拒绝，因为每个 adapter 都会复制 route 与 lifecycle logic。
- **使用外部 Gateway sidecar**：最初暂缓；当前生态覆盖使整体复用成为更低风险设计后，由 ADR-0008 接受。
