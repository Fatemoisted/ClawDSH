# 上下文地图——构建什么，跳过什么

[English](context-map.md) | 中文

- **状态**：阶段 4 产品化；产品壳、Settings 控制面与语义 Activity 已经实现
- **用途**：ClawDSH 所有权、包角色与实现所需上游材料的入口
- **配套文档**：[文档清单](doc-inventory.md) · [路线图](roadmap.md) · [GUI 规格](feature-gui-web.md) · [Activity 规格](feature-activity.md) · [渠道 bridge 规格](feature-channel-plane-bridge.md)

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
| `channel-wechat/` | 历史决策记录 | — | 不可执行记录；可用性说明已被锁定 catalog 取代 |
| `soul/` | function plugin | system prompt | replace 或 append persona section |
| `memory/` | function plugin | tools、system prompt、filesystem、optional embeddings | memory tools、recall section、indexing、flush |
| `embeddings/` | Service Definition | Cordis lifecycle | 自有 `ctx.embeddings` seam |
| `embeddings-ark/` | Service Provider | embeddings | Volcano Ark embeddings |
| `skills-hub/` | Service Provider | skills | ClawHub-compatible skill directory |
| `automation/` | function plugin | Agents、Sessions、default model | opt-in scheduled Agent turns |
| `activity/` | 可选语义 Activity service | Session history、Settings、filesystem sidecar | 限制隐私的 projection、有界存储与 cursor pagination |
| `preset-openclaw/` | 产品组装 | 公开 dsh Web 与 Host API | `clawdsh` profile 与 preset，以及嵌套的 product-shell browser、Host runtime、shared protocol、可编辑 Settings 控制面与 Activity 视图 |
| `preset-clawdsh-messaging-safe/` | preset carrier | soul | 以 `clawdsh-messaging-safe` 安装的受限渠道 preset |
| `_template/` | skeleton | — | 新自有 plugin 的起点 |

物理目录名 `preset-openclaw/` 仅因既有仓库检查对该路径提供窄例外而保留。安装 id 与产品文案使用 `clawdsh`。渠道执行只有一条路径：`ctx.channels → channel-agent → channel-openclaw`。仓库保留只读迁移清单识别旧配置名称，但不交付任何直连平台 adapter。

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

Loopback-authorized 控制 channel 实现 `bootstrap/get`、`capabilities/list`、Settings describe/mutate/reset、不含 secret 的 dsh credential describe/set/unset，以及 `activity/list`。Settings 保持 capability 与 Loader 证据只读，同时只通过 optimistic revision 暴露 manifest allowlist 中的 Config 字段。Activity 跟随当前 Session，并把隐私安全的 standard-history 事实与有界 sidecar 合并；数据缺失或损坏只让该视图降级。该组装不注册新的 Client Slot，也不修改 `api-proxy`、Client Catalog、Agent Loop、上游 generated file 或上游 GUI source。`dsh --profile web` 保持纯 Harness 入口。

### Profile layering 与 identity

`dsh --profile <name>` 依次叠加 profile bundles、其 `cordis.patch.yml`、home-level patch 与后续 `--patch` overlay。`tools/link-clawdsh.sh` 把内部 profile source 安装为 `clawdsh`，把 `clawdsh` 与 `clawdsh-messaging-safe` preset 安装到 dsh user preset root，并为开发链接自有 package。

Clean-install profile 始终挂载 `channel → channel-agent → channel-openclaw`、Activity 与其他 capability plugin。OpenClaw Gateway 与 Automation 的业务 setting 默认关闭，因此 Web Host 无 platform credential 或 OpenClaw artifact 也能启动。旧 `openclaw` profile 与 preset directory 只是 warning-only input，保持不变；不会安装 compatibility alias。公共 CLI 拥有 managed manifest、integrity repair 与 `clawdsh doctor` flow。

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
| `ctx.sessions` | dsh | channel-agent、automation、Activity | append-only event、projection 与 durable flush |
| `ctx.agents` | dsh | channel-agent、automation | 创建、恢复并驱动 Agent Session |
| `ctx.attachments` | dsh | channel-agent | durable image；尚无 general-file seam |
| `ctx.storageDomain` | dsh | channel-agent、channel-openclaw | durable route、execution 与 delivery ledger |
| `ctx.subprocess` | dsh | channel-openclaw | supervised Gateway lifecycle |
| Settings 与 Credentials | dsh | ClawDSH Settings 控制面 | allowlist Config 字段、optimistic revision 与 dsh 自有 credential reference |
| Connection RPC | dsh | ClawDSH Control Runtime 与产品壳 | loopback-only `/clawdsh-rpc`，包含只读、Settings 与 credential method |
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

[ADR-0002](../adr/0002-channel-seam.md)、[旧 adapter 规格](feature-channel-core.md)与 `channel-wechat` 保留历史决策；它们不是当前 channel availability guidance。

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
| 旧配置迁移 | ADR-0002 与 `tools/openclaw-channel-migration.ts` | 新增另一套直连平台 adapter |
