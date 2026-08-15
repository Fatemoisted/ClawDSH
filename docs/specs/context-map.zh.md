# 上下文地图——构建什么，跳过什么

[English](context-map.md) | 中文

- **状态**：阶段 4 产品化；产品壳与只读能力总览已经实现
- **用途**：ClawDSH 所有权、包角色与实现所需上游材料的入口
- **配套文档**：[文档清单](doc-inventory.md) · [路线图](roadmap.md) · [GUI 规格](feature-gui-web.md) · [渠道 bridge 规格](feature-channel-plane-bridge.md)

## 1. 自有构建范围

| 位置 | 所有权 |
|---|---|
| `packages/openclaw/` | ClawDSH 包、产品组装、嵌套 GUI/runtime 源码与包模板 |
| `docs/{adr,specs,matrix,standards,journal,upstream-proposal}/` | ClawDSH 决策、当前要求、状态、运维与历史 |
| `tools/` | ClawDSH 安装、校验、迁移、e2e driver 与 OpenClaw host lock |
| `.github/workflows/clawdsh-*` | ClawDSH 专用 CI 与发布 workflow |
| `.agents/notes/` 下新的日期文件 | ClawDSH 决策；archived note 保持冻结 |

### 自有包与组装目录

| 目录 | 角色 | 消费 | 提供或执行 |
|---|---|---|---|
| `channel/` | Service Definition | Cordis lifecycle | 当前 `ctx.channels` V1 协议；一个 Provider 与一个 Driver |
| `channel-agent/` | Consumer / Driver | channels、Agents、Sessions、presets、attachments、storage、tools | 持久 route binding、幂等、Agent turn、logging、media import、route-scoped `message` tool |
| `channel-openclaw/` | Service Provider | channels、subprocess、storage | 锁定 OpenClaw supervision、认证 IPC、health、actions、delivery ledger |
| `channel-core/` | legacy Service | Agents、Sessions、default model | `ctx.legacyChannels` 下已取代的进程内 registry；为替换验证保留 |
| `channel-telegram/` | legacy adapter | legacy channel service | Telegram polling adapter；没有当前认证 |
| `channel-feishu/` | legacy adapter | legacy channel service | Feishu long-connection adapter；没有当前认证 |
| `channel-wechat/` | 历史决策记录 | — | 不可执行记录；可用性说明已被锁定 catalog 取代 |
| `soul/` | function plugin | system prompt | replace 或 append persona section |
| `memory/` | function plugin | tools、system prompt、filesystem、optional embeddings | memory tools、recall section、indexing、flush |
| `embeddings/` | Service Definition | Cordis lifecycle | 自有 `ctx.embeddings` seam |
| `embeddings-ark/` | Service Provider | embeddings | Volcano Ark embeddings |
| `skills-hub/` | Service Provider | skills | ClawHub-compatible skill directory |
| `automation/` | function plugin | Agents、Sessions、default model | opt-in scheduled Agent turns |
| `preset-openclaw/` | 产品组装 | 公开 dsh Web 与 Host API | `clawdsh` profile 与 preset，以及嵌套的 product-shell browser、Host runtime、shared protocol、只读 Settings 总览与 Activity 空状态 |
| `preset-clawdsh-messaging-safe/` | preset carrier | soul | 以 `clawdsh-messaging-safe` 安装的受限渠道 preset |
| `_template/` | skeleton | — | 新自有 plugin 的起点 |

物理目录名 `preset-openclaw/` 仅因既有仓库检查对该路径提供窄例外而保留。安装 id 与产品文案使用 `clawdsh`。旧渠道服务与当前服务可以作为包共存，但部署不得让两条路径连接同一平台账号。

## 2. 上游只读范围

| 位置 | 规则 |
|---|---|
| `vendor/` | 只通过其 manifest procedure 同步 |
| `packages/*`（`packages/openclaw/` 除外） | 仅在 seam 相关时读取 Service Definition；不在其中实现 ClawDSH behavior |
| `apps/`、`website/`、`native/`、`python/`、`examples/`、`assets/`、`patches/`、`scripts/` | 上游 application、runtime、example、asset 与检查；不进行 ClawDSH feature 编辑 |
| `docs/` 下上游页面 | architecture 与 generated catalog；只作参考，不作为 ClawDSH rewrite surface |
| Root configuration | 上游拥有；只允许有 ADR 支撑的品牌或 additive workspace registration |

OpenClaw 是渠道平面的独立外部上游，不是可写子树。已批准 artifact 与 catalog 记录在 `tools/openclaw-channel-host/`；不要把 checkout vendor 到 `packages/openclaw/`。

## 3. 一次读懂架构

### Cordis lifecycle

dsh runtime 是 plugin tree。Service、event 与 registration 都是随 plugin 回卷的 scoped effect。跨包工作使用 typed Service Definition 与 declared injection，不导入另一 package 的 implementation。

### ClawDSH 产品壳

本地 GUI 是公开 dsh Web runtime 之上的 ClawDSH 产品，不是另一个 dsh agent preset。`/clawdsh/` 拥有产品导航——对话、ClawDSH 设置、ClawDSH 活动与 Harness 高级——而 `/` 保留原生 dsh Web GUI。「对话」复用公开 client module graph、Loader、Slot renderer 与完整 `buildRenderApp()` root。`preset-openclaw/product-shell/` 下的嵌套非 workspace build 拥有外层 shell、静态路由、Host runtime、shared DTO 与 `/clawdsh-rpc` Connection channel。

控制 channel 当前只实现 loopback-authorized `bootstrap/get` 与 `capabilities/list`。Settings 是只读能力与 Loader projection，Activity 是明确空状态；setting mutation、credential operation、语义记录与 sidecar 存储不属于当前 runtime。该组装不注册新的 Client Slot，也不修改 `api-proxy`、Client Catalog、Agent Loop、上游 generated file 或上游 GUI source。`dsh --profile web` 保持纯 Harness 入口。

### Profile layering 与 identity

`dsh --profile <name>` 依次叠加 profile bundles、其 `cordis.patch.yml`、home-level patch 与后续 `--patch` overlay。`tools/link-clawdsh.sh` 把内部 profile source 安装为 `clawdsh`，把 `clawdsh` 与 `clawdsh-messaging-safe` preset 安装到 dsh user preset root，并为开发链接自有 package。

Clean-install profile 保持完整的 `channel → channel-agent → channel-openclaw` group 与 Automation 关闭，因此 Web Host 无平台凭证也能启动。旧 `openclaw` profile 与 preset directory 只是 warning-only input，保持不变；不会安装 compatibility alias。公共 CLI 拥有 managed manifest、integrity repair 与 `clawdsh doctor` flow。

### 完整能力 seam

能力 seam 包含 Service Definition、Service Provider 与 Consumer。ClawDSH 拥有 `ctx.embeddings` 与当前 `ctx.channels`。渠道方面，`channel` 是 definition，`channel-openclaw` 是 communication Provider，`channel-agent` 是 Agent Consumer/Driver。

### 模型可见即有日志

任何进入模型请求的内容都必须能从 Session log 重建。Channel Agent input 使用已知 `user/message` event，并携带完整且净化后的 `source.kind = 'channel'` 来源；admission、idempotency 与 delivery 权威留在持久 channel ledger。已声明的 `channel/*` Session event 保持禁用，因为下游代码不能将其标记为 ignorable，persistence resume 会拒绝其未知名称。仅通信侧 health 与 transport bookkeeping 不进入 model context。

### 相关 seam

| Seam | Owner | ClawDSH consumer | 此处用途 |
|---|---|---|---|
| `ctx.systemPrompt` | dsh | soul、memory | 有序 prompt section |
| `ctx.tools` | dsh | memory、channel-agent | tool registry 与 route-scoped `message` tool |
| `ctx.fs` | dsh | memory | policy-controlled filesystem access |
| `ctx.sessions` | dsh | channel-agent、legacy channel-core、automation、Activity | append-only event、projection 与 durable flush |
| `ctx.agents` | dsh | channel-agent、legacy channel-core、automation | 创建、恢复并驱动 Agent Session |
| `ctx.attachments` | dsh | channel-agent | durable image；尚无 general-file seam |
| `ctx.storageDomain` | dsh | channel-agent、channel-openclaw | durable route、execution 与 delivery ledger |
| `ctx.subprocess` | dsh | channel-openclaw | supervised Gateway lifecycle |
| Settings 与 Credentials | dsh | 后续 ClawDSH Settings 控制面 | 可用公开 API；当前只读 runtime 尚不消费 |
| Connection RPC | dsh | ClawDSH Control Runtime 与产品壳 | loopback-only `/clawdsh-rpc`，包含 `bootstrap/get` 与 `capabilities/list` |
| `ctx.skills` | dsh | skills-hub | skill Provider registry |
| `ctx.subagents` | dsh | future federation | delegation transport |
| `ctx.channels` | ClawDSH，ADR-0008 | channel-openclaw、channel-agent | bidirectional channel V1 dispatch |
| `ctx.embeddings` | ClawDSH，ADR-0003 | memory、embeddings-ark | text embeddings |

上游 service catalog 仍是完整 dsh seam 列表的权威。读取 package implementation 前，先查阅 `docs/capability-seams.md` 或 generated API catalog。

## 4. 权威引用

| 需求 | 阅读 |
|---|---|
| GUI 形态、route 与禁止的上游变更 | [ADR-0007](../adr/0007-clawdsh-local-gui-product.md) |
| GUI 页面与验收行为 | [本地 GUI 规格](feature-gui-web.md) |
| 渠道架构与所有权 | [ADR-0008](../adr/0008-openclaw-channel-plane.md) |
| 当前渠道协议与缺口 | [渠道 bridge 规格](feature-channel-plane-bridge.md) |
| 精确 host 与 channel identity | `tools/openclaw-channel-host/*.json` |
| 渠道更新与认证流程 | [OpenClaw 渠道同步规范](../standards/openclaw-channel-sync.md) |
| 当前产品与支持投影 | [parity matrix](../matrix/parity.md) |
| 所需 OpenClaw AgentHarness host semantics | [OpenClaw proposal](../upstream-proposal/openclaw-agent-harness-channel-seams.md) |
| 所需 downstream Session-event support | [dsh proposal](../upstream-proposal/session-plugin-events.md) |

ADR-0002、`feature-channel-core` 与 `channel-wechat` 解释 legacy path；它们不是当前 channel availability guidance。

## 5. 阅读策略

| 任务 | 阅读 | 跳过 |
|---|---|---|
| 任何 ClawDSH 变更 | 本页、owning feature spec 与 parity row | 广泛重读上游源码 |
| Product-shell 变更 | ADR-0007、GUI spec 与公开 dsh Web entry API | Client Catalog、generated GUI file 与未批准 Slot |
| Settings 或 Activity 变更 | GUI spec、owning Config schema、Settings/Credentials/Session API 与当前 `/clawdsh-rpc` protocol | 任意 Loader control 与上游 SessionEventMap 修改 |
| Channel protocol 变更 | channel package source、ADR-0008、bridge spec、sync standard | 除非 locked-host compatibility 改变，否则跳过 platform SDK implementation |
| OpenClaw release 更新 | machine lock/catalog、release artifact、精确 compatibility input | 解析批准 commit 后的 floating `main` |
| 新 dsh seam | 对应 upstream Service Definition 与 complete-seam rule | 无关 package |
| dsh rebase | `docs/standards/upstream-sync.md` | ad hoc 编辑 upstream package |
| Legacy channel 删除 | ADR-0008 替换条件与 legacy Agent Note | 在代码删除前归档 note |
