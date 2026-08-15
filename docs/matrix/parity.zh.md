# OpenClaw ↔ dsh 功能对齐矩阵

[English](parity.md) | 中文

> 本矩阵是 ClawDSH 的状态权威。每个 OpenClaw 派生领域或 ClawDSH 原生产品领域只在此拥有一项分类和当前状态。精确 OpenClaw 渠道产物与名录元数据仍由 `tools/openclaw-channel-host/*.json` 拥有；本页只投影其已批准含义。

## 分类

| 分类 | 含义 |
|---|---|
| Reuse | 直接使用既有 dsh 能力 |
| Plugin | 在既有 seam 上增加 ClawDSH 包 |
| New seam | 通过 ADR 增加完整的 Service Definition、Service Provider 与 Consumer |
| Product assembly | 使用公开 dsh API 构建 ClawDSH 应用或 profile，不修改上游源码 |
| Deferred | 将工作留在当前实现之外，并注明解除阻塞条件 |

渠道支持只使用单调状态 `cataloged → installable → certified → enabled`：cataloged 记录已批准来源；installable 证明精确兼容装配；certified 增加当前协议、安全、投递、快照和所需真实传输证据；enabled 增加明确启用的交付 profile 选择。任何较早状态都不蕴含较晚状态。

<!-- BEGIN GENERATED openclaw-channel-support (generate-parity.ts) — do not edit between markers -->
| Locked track | `cataloged` | `installable` | `certified` | `enabled` |
|---|---:|---:|---:|---:|
| production | 27 | 0 | 0 | 0 |
| canary | 31 | 0 | 0 | 0 |
<!-- END GENERATED openclaw-channel-support -->

## 基线

非渠道功能选择保留阶段 1 参考 OpenClaw `v2026.1.5`、commit `197b8f7c3b`；memory 或后续功能需要补全时使用 `v2026.1.15`。该早期快照不是渠道兼容基线。

Production 渠道平面锁定 OpenClaw `v2026.7.1-2`、commit `0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c` 与 npm 包 `openclaw@2026.7.1-2`，并校验 archive 和解包文件树身份。隔离 canary 审计 lock 是 source commit `f1ced37ce5df8c7bc7f3b46c579e5ce181feaae0`；它没有锁定 built host，不是 managed deployment candidate。[ADR-0008](../adr/0008-openclaw-channel-plane.md) 与 [OpenClaw 渠道同步规范](../standards/openclaw-channel-sync.md)拥有该拆分。

## 功能领域

| 产品或 OpenClaw 领域 | 参考 | dsh seam | 分类 | 落地包 | 当前状态 |
|---|---|---|---|---|---|
| Session / 消息历史 | early baseline sessions | `ctx.sessions` | Reuse | — | 可直接使用 |
| Session tracing / replay / forking | dsh-native | Session projection 与 raw Trajectory | Reuse | — | 可直接使用 |
| 工具执行 | early baseline Agent tools | `ctx.tools`、`ctx.shell`、`ctx.fs`、`ctx.web` | Reuse | — | 可直接使用 |
| Skills | OpenClaw skills / ClawHub conventions | `ctx.skills` | Plugin | `skills-hub` | 已实现 |
| 调度 / automation | early baseline cron | `ctx.agents`、`ctx.sessions` | Plugin | `automation` | 已实现；默认关闭 |
| Persona | early baseline prompt/workspace identity | `ctx.systemPrompt` | Plugin | `soul` | 已实现 |
| Memory | v2026.1.15 memory | `ctx.fs`、`ctx.tools`、`ctx.embeddings` | Plugin + 自有 embeddings seam | `memory`、`embeddings`、`embeddings-ark` | 已实现 |
| Channel Service Definition | current Gateway integration | 自有 `ctx.channels` | New seam | `channel` | V1 已实现 |
| Channel Agent Driver | dsh Session 与 Agent lifecycle | `ctx.channels`、Agents、Sessions、attachments | Plugin | `channel-agent` | 基础已实现；认证未完成 |
| OpenClaw 通信 Provider | 锁定 Gateway 与 plugins | `ctx.channels`、subprocess、storage | Plugin | `channel-openclaw` | 基础已实现；默认关闭 |
| 旧进程内渠道路径 | ADR-0002 实验 | `ctx.legacyChannels` | Deferred removal | `channel-core`、`channel-telegram`、`channel-feishu` | 保留到 ADR-0008 替换条件通过 |
| Approval / security policy | later OpenClaw security reference | approvals 与 guards | Reuse/config | — | 可直接使用 |
| Federation node | outside early baseline | `ctx.subagents` transport | Plugin | `clawd-federation` | 仅 ADR-0005 评估；实现推迟 |
| Smart home | outside selected scope | 无已接受 seam | Deferred | — | 需要经审查的来源与能力设计 |
| 本地浏览器对话 | dsh Web client | `dsh-web-app` + `clawdsh` preset | Reuse/config | 内部 `preset-openclaw` source | 在产品壳内部与原生 `/` route 复用 |
| ClawDSH 产品壳与 Settings | ClawDSH-native | 公开 dsh Web 组装、Settings 与 Credentials | Product assembly | 内部 `preset-openclaw` source | [ADR-0007](../adr/0007-clawdsh-local-gui-product.md) 产品壳与 conflict-safe Settings 已实现 |
| ClawDSH 语义 Activity | ClawDSH-native | standard Session history 加可选 `ctx.clawdshActivity` sidecar | Plugin + product assembly | `activity` 加内部 `preset-openclaw` UI | [语义 Activity](../specs/feature-activity.md) 已实现；在 `clawdsh` profile 中必需 |

Channel Agent 路径把完整且净化后的模型可见来源存储在已知 `user/message.source.kind = 'channel'` 字段中，并把 admission、idempotency 与 delivery 权威留在持久 channel ledger。它不持久化已声明的 `channel/*` Session event，因为下游代码不能将其标记为 ignorable，静态 known-event reader 会使 resume fail closed。

## Production 渠道目录

Stable public chat catalog 含 27 个条目：**1 core + 2 bundled + 21 repository-official + 3 external = 24+3**。精确名称、包版本、integrity、source path 与 observation time 位于 `tools/openclaw-channel-host/channels.production.json`。

| 目录组 | 条目数 | 当前支持状态 | 证据与限制 |
|---|---:|---|---|
| Core + bundled + repository-official | 24 | **cataloged** | 精确 stable host source 与逐条目来源已锁定；逐渠道装配与认证未完成 |
| External | 3 | **cataloged** | WeChat、Yuanbao 与 Zalo ClawBot 有精确包身份；仍需外部审查及相同的装配和认证要求 |
| 旧 Telegram 适配器 | 1 | **installable** | 本地包存在；没有当前带凭证 live smoke 建立认证或启用状态 |
| 旧 Feishu 适配器 | 1 | **installable** | 本地包存在；历史 smoke 不建立当前发布的认证或启用状态 |

Catalog 来源不是运行时支持声明。只有兼容的锁定 host 与 bridge composition 完成装配，已校验 npm integrity 才能使渠道达到 installable。Canary catalog 含 31 个条目，但仍只是 cataloged 审计输入。

## 中国平台投影

| 平台 | 已批准 OpenClaw 来源 | 当前支持状态 | 限制 |
|---|---|---|---|
| Feishu / Lark | production repository-official extension | sidecar **cataloged**；旧包 **installable** | 两条路径都未 certified 或 enabled |
| QQ Bot | production repository-official extension | **cataloged** | 不属于三个 production external plugin |
| WeChat | production external `@tencent-weixin/openclaw-weixin@2.4.6` | **cataloged** | 外部审查与认证未完成 |
| Yuanbao | production external `openclaw-plugin-yuanbao@2.15.0` | **cataloged** | 外部审查与认证未完成 |
| WeCom | canary external `@wecom/wecom-openclaw-plugin@2026.5.7` | 仅 canary **cataloged** | 不在 production lock 中 |
| DingTalk | 两个已批准目录都不存在 | — | 无支持声明 |

旧 `channel-wechat` 排除记录不是当前可用性权威。ClawDSH 不计划原生 WeChat 适配器；复用经锁定的 OpenClaw 通信平面。

## 维护规则

1. 功能领域的增加、删除或重分类要更新本矩阵和其 owning spec。
2. 渠道名录、产物或支持状态变更遵循 OpenClaw 渠道同步规范，并先更新机器目录。
3. Deferred 条目必须注明解除阻塞条件；历史完成描述绝不替代当前证据。
4. 每次 dsh upstream sync 后重新审查非渠道兼容性，每次另行批准 OpenClaw lock 变更后重新审查渠道兼容性。
