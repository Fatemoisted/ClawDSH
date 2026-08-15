# 功能规格：OpenClaw 渠道平面 bridge

[English](feature-channel-plane-bridge.md) | 中文

- **状态**：基础已实现；装配与认证未完成（2026-08-15）
- **决策**：[ADR-0008](../adr/0008-openclaw-channel-plane.md)
- **同步规范**：[openclaw-channel-sync](../standards/openclaw-channel-sync.md)
- **Harness 复用**：[ADR-0010](../adr/0010-harness-contract-first.md)
- **仅 legacy 行为**：[ADR-0011](../adr/0011-deferred-channel-images-and-address-continuity.md)
- **软件包**：`@clawdsh/dsh-channel`、`@clawdsh/dsh-channel-agent`、`@clawdsh/dsh-channel-openclaw`

## 目标

- 复用完整、当前的 OpenClaw 通信平面，不为每个平台复制一个 ClawDSH 软件包实现。
- 把平台凭证、准入、身份规范化、原生动作和投递行为留在锁定的 OpenClaw Gateway 内。
- 让 Gateway-to-Agent 交接具备认证、版本、能力协商、持久化、replay 安全与可观测性。
- 保持 dsh 对 Session、Agent 执行、模型选择、工具和模型可见日志的所有权。
- 把 production 与 canary 作为分离的不可变 track；绝不执行浮动 OpenClaw ref。

## 非目标

- 重写平台 SDK，或声称所有渠道支持一致的动作集合。
- 允许 OpenClaw sidecar 选择独立模型或绕过 ClawDSH fallback。
- 把目录存在、包可安装、包测试或历史 live smoke 当作发布认证。
- 在精确生产组合完成认证前默认启用任何渠道。
- 在 ADR-0008 的替换条件通过前删除 `channel-core`、`channel-telegram`、`channel-discord` 或 `channel-feishu`。

## 运行时装配

```text
platform
  → locked OpenClaw Gateway + channel plugin (authenticate, admit, normalize, stage)
  → authenticated private IPC (`turn.run`)
  → @clawdsh/dsh-channel-openclaw (Provider)
  → ctx.channels
  → @clawdsh/dsh-channel-agent (Driver)
  → durable route/session/idempotency ledger
  → dsh Agent + Session log
  → terminal replayable result
  → Gateway native delivery (+ durable receipt only when a correlated hook is negotiated)
```

`@clawdsh/dsh-channel` 是 Service Definition；它只接受一个 Provider 和一个 Driver，不含任何平台分支。`@clawdsh/dsh-channel-openclaw` 拥有通信侧 Provider、精确 host 身份、私有 IPC、健康与投递账本。`@clawdsh/dsh-channel-agent` 拥有 Agent 侧 Driver、确定性会话绑定、路由 generation、崩溃隔离、模型执行与路由限定的 `message` 工具。

该 canonical 组合只拥有 `ctx.channels`，在完成认证前保持 Gateway setting 关闭。保留的进程内 adapter 只在另一个默认关闭的 compatibility group 中注册 `ctx.legacyChannels`。存在 legacy opt-in 时，canonical Gateway 启动与 Settings preflight 会在产生副作用前拒绝配置，避免同一平台账号同时被两条路径消费。ADR-0010 治理 Harness Agent、Session、attachment、credential、timer 与 Cordis contract 的复用；ADR-0011 只适用于 legacy 图片导入和地址连续性，不能提供 sidecar 证据。

## V1 协议

| 方向 | 方法或通知 | 用途 |
|---|---|---|
| Gateway → Provider | `turn.run` | 提交一个已准入、规范化、幂等的入站回合 |
| Gateway → Provider | `turn.cancel` | 取消一个精确的存活 `turnId` 与 `runId` |
| Gateway → Provider | `session.reset` / `session.close` | 推进或终止一个精确路由 generation |
| Agent → Gateway | `channel.action` | 执行一个已协商的平台原生动作 |
| 任一控制方向 | `health.get` | 返回已净化的 provider、Gateway 与账号健康状态 |
| Provider → Gateway | `turn.progress` | 可选协商的文本、推理、工具或状态进度 |
| Gateway → Provider | `delivery.report` | 可选协商的最终回合投递更新 |

handshake 必须匹配配置的 Gateway instance、启动 nonce、production 或 canary host lock、Node engine、AgentHarness generation 与完整能力列表。严格 schema 拒绝未知字段、含 NUL 的字符串、畸形 opaque id、不连续媒体序号、无效路径、不一致的 route/trust 组合，以及不一致的动作或回执 subject。本地端点只接受一个已认证 peer，ready 还必须等待持久 route 恢复。临时 detach 会拒绝 socket 拥有的等待，但允许已准入 handler 持久化终态结果；shutdown 会在 storage 关闭前中止并排空活动及已 detach handler，progress 也绝不会进入替代 peer。

锁定的 stable 与 canary host 没有公开 hook 可把最终 AgentHarness 回答与平台投递关联起来，因此当前 bridge 不协商 `delivery.report` extension。其本地 `health.get` 能证明已认证 bridge 与 host 身份，但无法通过公开聚合 host API 枚举真实账号连接状态。两个缺失 host seam 都会阻止认证；协议支持并不表示当前 adapter 能提供对应事实。所需 OpenClaw host 契约在 `docs/upstream-proposal/openclaw-agent-harness-channel-seams.zh.md` 中提议。

## 持久执行规则

- 幂等键按 Gateway lineage 限定。用不同内容复用会失败；相同的 in-flight 请求附着；terminal 请求 replay 已存结果。
- 崩溃后观察到的 `running` 记录变成 `needs-recovery`。下一个请求返回不可重试的对账失败，因为 Agent 工具可能已经产生副作用。
- 路由身份包含 Gateway、OpenClaw session key、generation、channel、account、conversation、可选 thread 与 direct/group kind。已关闭或过期 generation 被拒绝。
- Reset 和 close 会在请求 DSH 前持久写入 bridge 侧 transition intent。已确认的 route mutation 与 previous-Session control identity 会先于 intent 删除而 commit，因此启动或下一次 turn 能完成中断的 transition，而不会让 generation 前进两次。
- owner 私聊可选择配置的 owner preset；其他私聊发送者和所有群聊使用配置的 restricted preset。群聊必须携带 OpenClaw 的 `group-allowlisted` 准入分类。
- 已知 `user/message` event 携带完整、已净化的渠道来源。Agent 侧 ledger 在执行前 commit admission 与 idempotency state；Provider 与 Agent ledger 把 delivery authority 留在 Session log 之外。
- 投递状态单调。ambiguous 回执要求操作员或 provider 对账，绝不授权盲目重跑 Agent 或重发。

## Session log 兼容性

已知 `user/message` event 的 source type 可通过 declaration merge 扩展，因此 channel provenance 能进入 model reconstruction，而无需发明 event envelope。持久 admission 与 delivery ledger 对 transport recovery 保持权威，且不是模型输入。

可运行路径不会 append 已声明的 `channel/turn-admitted` 与 `channel/delivery` name。上游 persistence 识别 generated static `KNOWN_SESSION_EVENT_TYPES`，public `Session.append()` surface 不能设置 event envelope 的 `ignorable: true`。因此 downstream namespaced event 会成功写入，却使后续 resume 拒绝该 log。ClawDSH 必须保持该 fail-closed degradation，直到 dsh 接受 ignorable append option 或另一个 composition-independent downstream event seam。提议的上游契约在 `docs/upstream-proposal/session-plugin-events.zh.md`。

## 原生动作与媒体

协议和路由限定的模型工具建模发送、编辑、删除、回应、投票、输入状态、目录 self/peer/group/member 查询和目标解析。handshake 与渠道实现都会缩窄可用集合；锁定 bridge 当前只宣传 send 与 poll，不支持的操作明确失败。

入站图片只有在相对路径仍位于配置的 canonical staging root 内、每级路径都不是符号链接、声明与观察大小符合配置的字节上限、media type 已启用且 SHA-256 匹配后才导入。稳定版 AgentHarness V1 不暴露可信的物化入站媒体事实，因此 production bridge 当前会在进入该 importer 前拒绝全部入站媒体。音频、视频与通用文件在 dsh 拥有持久非图片 attachment service 前会被拒绝。出站媒体在 dsh-to-Gateway staging writer 和消费已认证字节的 adapter path 存在前会被拒绝。ADR-0011 的 deferred import 与地址连续性规则只描述 `ctx.legacyChannels`，不会放宽这些 canonical 媒体门禁。

## Host track 与目录

Production 锁定 OpenClaw `v2026.7.1-2` / commit `0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`，并校验 npm tarball、解包文件树、依赖 lock，以及经评审的 Darwin arm64 与 Linux x64 安装运行时摘要。其公开聊天目录包含 27 项：1 个 core、2 个 bundled、21 个 repo-official 与 3 个 external，约定简写为 **24+3**。精确列表与逐包完整性在 `tools/openclaw-channel-host/channels.production.json`。

Canary 锁定 source commit `f1ced37ce5df8c7bc7f3b46c579e5ce181feaae0`；其 31 项目录是审计输入，不是生产兼容性承诺。因为 canary lock 没有构建后的 host tree，managed execution 必须失败，不能推断产物。

## 支持状态与当前限制

唯一有效的推进是 `cataloged → installable → certified → enabled`，定义见 ADR-0008。批准目录建立 catalog 来源；校验稳定 artifact 且通过兼容 host 装配后可建立 installability。External 包还要求许可证、平台条款和安全审查全部通过。认证还要求精确发布装配、安全检查、投递行为、无密钥装配 transcript，以及需要凭证的平台 live smoke。启用还要求交付 profile 的明确选择。

当前实现证据只建立 `cataloged`。交付 profile 包含 canonical sidecar 组合及其 invariant companion，同时保持 Gateway setting 关闭；另一个 legacy compatibility group 也默认关闭，因此两条路径默认都不启动 transport。自有无密钥冒烟测试会用真实稳定版 schema 校验安全的 Telegram 与 Feishu 配置，贯穿锁定 Gateway、stable bridge 与 DSH Agent，并在 Linux x64 CI 中运行；经评审的 Darwin arm64 assembly 也已在本地通过。当前没有运行新的、带凭证的 Telegram、飞书或 Discord sidecar transport smoke。历史上带凭证的 legacy Telegram 与飞书流量，以及 Discord 无密钥覆盖，只能证明它们实际经过的精确 `ctx.legacyChannels` 路径；不能认证锁定 host、`ctx.channels` 或 sidecar 投递。最终投递、聚合账号健康、stable 入站媒体、Windows ACL 与 external 治理门禁仍未完成。在 downstream-event seam 不可用期间，resume coverage 还必须证明只持久化已知 Session event name。

## 替换门禁

只有生产 lock 满足以下全部条件，才能删除旧适配器：

1. 锁定可复现的 managed host 与 bridge artifact，交付 profile 装配 Service Definition、Provider 与 Driver，且无 OpenClaw 模型 fallback。
2. 契约、完整性、认证、幂等、reset/close、action、delivery、crash recovery、attachment、persistence 与 resume 测试通过，且不使用 downstream `channel/*` Session event。
3. 无密钥的 Gateway-to-Agent 装配 snapshot 或等价自有 snapshot harness 在 CI 中运行。
4. 仍用于 legacy 迁移的每个平台完成新的带凭证入站、Agent、出站、重复投递与失败路径 smoke；其中包括 Telegram 与飞书，活跃 legacy Discord deployment 还包括 Discord。
5. 文档标出已认证组合，profile 只明确启用这些组合。
