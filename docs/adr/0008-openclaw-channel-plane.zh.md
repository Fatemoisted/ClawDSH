# ADR-0008：通过锁定的 Gateway sidecar 复用当前 OpenClaw 渠道平面

[English](0008-openclaw-channel-plane.md) | 中文

- **状态**：Accepted（2026-08-15）
- **日期**：2026-08-15
- **取代**：ADR-0002
- **依赖**：ADR-0001
- **相关决策**：ADR-0010（Harness contract-first 复用）；ADR-0011（仅 legacy 路径的图片与地址行为）

## 上下文

ADR-0002 证明了 Cordis 渠道 seam 能驱动 Agent 回合，但它的纯文本 `ChannelAdapter` 设计要求 ClawDSH 重新实现每个平台的传输、身份规则、准入策略、媒体路径和原生动作。这种方案跟不上决定 OpenClaw 生态覆盖面的部分。已批准的生产版 OpenClaw 已编目 27 种公开聊天传输：1 个核心 WebChat、2 个 bundled 渠道、21 个仓库内官方扩展和 3 个外部维护插件。独立重建这些接入会复制成熟代码，并引入平台特有的安全与投递错误。

因此，渠道平面必须采用不同于早期功能基线的版本策略。非渠道对齐仍可使用阶段 1 选定的早期参考；通信兼容性则跟随不可变、分别审计的 OpenClaw host lock。浮动分支、历史适配器测试或仅仅存在软件包，都不构成部署证据。

## 决定

### 1. 让 OpenClaw 渠道平面拥有通信侧职责

ClawDSH 在受监督的本地 sidecar 中复用精确的 OpenClaw Gateway 发行物，而不是逐个移植平台 SDK 接入。OpenClaw 拥有渠道插件发现、平台认证、webhook 或轮询生命周期、发送者与会话身份、配对与 allowlist 准入、入站规范化、原生渠道动作、媒体暂存和最终平台投递。sidecar 必须只选择 ClawDSH AgentHarness；OpenClaw 模型 provider 或 fallback 不得回答渠道回合。

生产 lock 是 OpenClaw `v2026.7.1-2`、解引用 commit `0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`、npm 包 `openclaw@2026.7.1-2`，以及已检入的 archive、解包文件树、依赖 lock 与安装运行时摘要。获批的运行时 assembly 是 Darwin arm64 与 Linux x64；其他平台组合全部 fail closed。批准的 canary 是 commit `f1ced37ce5df8c7bc7f3b46c579e5ce181feaae0`，观测于 2026-08-15，但其 lock 指向 source archive，而不是构建后的部署产物。因此在另行锁定可复现的构建产物之前，canary 只允许隔离的源码审计。机器可读权威是 `tools/openclaw-channel-host/host.production.json`、`host.canary.json`、各自的渠道目录，以及 `packages/openclaw/channel-openclaw/runtime/production-lock.json`。

| Track | 批准的不可变输入 | Runtime 处置 |
|---|---|---|
| Production | Tag object `be8b8a9e8838f832e4fa47cde8bea0a33aec71ba`；commit `0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`；npm SRI `sha512-ycF3yPcbjN6bUPeaUx6Mh6vze1hQWoD3CT/wWcmD7a8xaHHHRUaAlaq+lFxMHf1ssEgODVAwjlzYqp2twkYZ7g==`；8,550 文件 tree SRI `sha512-t7hGQR0QkaIGfP6WS5OV1EOq4KZK6dcHB7nu0B7E6UlxS4UdtuFT6f+E2akFVAii6xjHndlEANWSk9OaZI4Niw==` | Managed host candidate；AgentHarness V1 |
| Canary | Commit `f1ced37ce5df8c7bc7f3b46c579e5ce181feaae0`，观测时间 `2026-08-15T08:18:37Z`；100,754,581-byte source archive SRI `sha512-PEjiTam3vygesQ22Pr0DF51CEqF6d9eCaxhzHxgyOkwKAIWJgoJO1ooskLPMakolKmP6J797QkG5aIyM4B/hRQ==` | 只用于 audit/compatibility；AgentHarness V2；没有 built-artifact lock 时不允许 managed execution |

### 2. 在认证协议处分割所有权

| 所有者 | 权威职责 |
|---|---|
| OpenClaw Gateway 与渠道插件 | 平台 SDK、凭证、入口、准入、平台规范 id、渠道特性映射、传输媒体暂存、原生动作执行与投递尝试 |
| `@clawdsh/dsh-channel-openclaw` | 精确 host 校验与监督、私有本地 IPC、启动认证、handshake lock 校验、provider 健康和权威投递回执账本 |
| `@clawdsh/dsh-channel` | provider-neutral V1 类型与严格校验，以及 `ctx.channels` 中恰好一个通信 provider 和一个 Agent driver |
| `@clawdsh/dsh-channel-agent` | 持久路由 generation、会话绑定、幂等与 replay、Agent 执行、已知 `user/message` event 上的模型可见来源、附件导入、路由限定的 `message` 工具，以及 Agent 侧持久账本 |
| 既有 dsh 服务 | Agent 与 Session 生命周期、持久化、模型选择、工具、storage domain 和持久图片附件 |

V1 bridge 接受 `turn.run`、`turn.cancel`、`session.reset`、`session.close`、`channel.action` 和 `health.get`；可协商 `turn.progress` 通知与 `delivery.report` 扩展。每次 handshake 都锁定协议版本、Gateway lineage、启动 nonce、OpenClaw tag、commit、artifact SHA-512、Node engine、AgentHarness generation 与精确能力列表。handshake 是身份凭据，不是传输授权；provider 还拥有逐次启动密钥和私有端点策略。

Ready 要求已认证 handshake 与持久 route 恢复全部完成。临时 transport detach 会释放 socket 拥有的等待，但允许已准入 Agent 工作到达持久终态；Provider 正式关闭会在 storage 关闭前中止并排空活动和已 detach handler。Progress 保持绑定准入该轮次的 peer。有副作用 action 的恢复使用内部只读 `channel.reconcile` request，绝不重新派发缺失或非终态操作。

`channel.action` 是闭合 union，覆盖发送、编辑、删除、回应、投票、输入状态、目录查询与目标解析。协商出的 capability 只表示已连接 Gateway 接受该动作；所选平台仍可明确返回不支持。投递状态区分 accepted、confirmed、retrying、ambiguous 与 dead-letter。ambiguous 结果绝不允许盲目重跑 Agent 工具或盲目重发。

模型可见 admission provenance 作为 `source.kind = 'channel'` 存储在已知 `user/message` event 上。Admission、idempotency 与 delivery 权威留在持久 channel ledger 中。ClawDSH 当前不 append `channel/turn-admitted` 或 `channel/delivery` Session event：`Session.append()` 不能设置 `ignorable: true`，持久读取器会拒绝不在上游生成 `KNOWN_SESSION_EVENT_TYPES` 中的 downstream event name。Namespaced Session event 需要 `docs/upstream-proposal/session-plugin-events.zh.md` 提议的上游 seam，以及另一次 ADR 更新。

### 3. 使用四个单调支持状态

渠道支持声明只使用 `cataloged → installable → certified → enabled`。

- **Cataloged**：渠道出现在批准的机器目录中，来源已知；不表示能安装或运行。
- **Installable**：精确渠道 artifact 或锁定的仓库内源码能与兼容的锁定 host 装配，并通过完整性与 manifest 检查；不证明凭证、平台流量或 Agent 闭环。
- **Certified**：该精确 host 与渠道组合通过当前发布的契约、装配、安全、投递和所需真实传输 smoke；历史测试和其他渠道的证据都不算。
- **Enabled**：已认证渠道被明确启用于交付的部署 profile。Enabled 是运行状态，不是“代码已实现”的同义词。

每个状态都蕴含其左侧全部状态。生产目录是 24 个 core、bundled 或 repo-official 条目加 3 个 external 条目；external 是 WeChat、Yuanbao 和 Zalo ClawBot。QQ Bot 在生产 lock 中是 repo-official。本 ADR 不把任何渠道声明为 certified 或 enabled。

### 4. 在替换门禁通过前保留旧适配器

`channel-core`、`channel-telegram`、`channel-discord` 与 `channel-feishu` 仍是进程内 legacy compatibility adapter。它们只在默认关闭的 compatibility group 中注册独立的 `ctx.legacyChannels` Service；存在 legacy opt-in 时，canonical Gateway 启动与 Settings preflight 会在产生副作用前失败。它们早期的软件包、无密钥与带凭证测试仍有实现历史价值，但不能认证当前 sidecar 部署。只有 sidecar 装配完成、所需无密钥 snapshot 路径存在，并且仍用于迁移的每个平台都在 production lock 上通过等价 live smoke 后，才能删除它们。ADR-0011 只治理这条保留 legacy 路径的图片导入与地址连续性，ADR-0010 则治理其 Harness contract 复用。本 ADR 取代 ADR-0002 成为当前架构，但不会在该门禁前抹除 legacy 代码及其 Agent Notes。

## 已知缺口

- **Gateway bridge 与部署**：V1 Service Definition、持久 Agent driver、lock 校验、POSIX 认证 IPC provider 和协议支持已实现。生产 profile 包含带 package-filtered invariant registry 的 canonical 组合，同时保持 Gateway setting 关闭；另一个默认关闭的 compatibility group 只拥有 `ctx.legacyChannels`，两条路径默认都不启动 transport。Canary 没有锁定的构建产物。
- **Windows 端点授权**：POSIX 使用私有 `0700` 父目录和 `0600` Unix socket。Windows named-pipe ACL 强制缺少所需 native seam，因此 provider 在 Windows 上 fail closed。
- **附件**：入站暂存图片在进入 dsh attachment store 前校验路径、符号链接、大小、media type 与 SHA-256。音频、视频和通用文件缺少持久的非图片 attachment seam。出站媒体缺少 dsh staging writer，并明确失败。
- **Plugin Session event**：当前安全路径使用已知 `user/message` source 与持久 sidecar ledger。持久化已声明的 `channel/*` event 会使 resume fail closed，因为 downstream code 不能把它们标记为 ignorable；这些 event name 在上游 append seam 出现前保持禁用。
- **装配证据**：自有无密钥冒烟测试会用真实稳定版 schema 校验安全的 Telegram 与 Feishu 配置，并在 Linux x64 上贯穿锁定 Gateway、stable bridge 与 DSH Agent。测试有意终止于最终平台投递之前，因为锁定 host 没有可关联的公共 hook。
- **真实认证**：本次变更没有运行新的、带凭证的 Telegram、飞书或 Discord sidecar 流量。历史上带凭证的 legacy Telegram 与飞书流量，以及 Discord 无密钥证据，都不能认证本次发布、锁定 host 或 `ctx.channels`；不能根据这些证据把 legacy adapter 或 sidecar Channel 标记为 certified 或 enabled。

## 影响

- 渠道生态增长改为更新一个经审计的 OpenClaw host 与目录，而不是把数十个平台实现复制进 ClawDSH。
- 跨进程协议和持久账本增加部署工作，但明确了身份、replay、取消、投递歧义与所有权。
- 生产更新必须遵循 `docs/standards/openclaw-channel-sync.md`；新的上游发行版绝不静默替换批准 lock。
- 平台凭证留在 OpenClaw 通信平面。只有已准入、净化后的身份和经校验的暂存内容进入 Agent 平面。

## 备选方案

- **继续为每个渠道写一个 ClawDSH 原生适配器**：拒绝，因为它复制上游 SDK、准入、身份和投递逻辑，无法安全覆盖目录。
- **把 OpenClaw Gateway 嵌入或 fork 到 dsh 进程**：拒绝，因为会混合依赖与生命周期所有权，也会削弱精确 host 校验。
- **直接跟随 OpenClaw `main`**：拒绝，因为浮动运行时不可复现、不可审计、不可认证。
- **通过可选 OpenClaw hook 准入消息**：拒绝，因为缺失或绕过 hook 时可能 fail open；AgentHarness bridge 必须是唯一配置的执行路径。
