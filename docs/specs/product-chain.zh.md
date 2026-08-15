# 产品链与验证状态

[English](product-chain.md) | 中文

- **状态**：阶段 4 当前状态地图
- **用途**：追踪每项 ClawDSH 功能从输入经过 dsh seam 到模型可见或用户可见输出，且不把实现证据转换为认证

| 标记 | 含义 |
|---|---|
| ✅ | 当前代码或自有配置支持所述关系 |
| ⚠️ | 实现或验证缺口；说明范围有意受限 |
| ⏳ | 已接受的后续工作，不是当前行为 |

## 概述

| 功能 | 落地包 | 主要 seam | 当前结果 |
|---|---|---|---|
| ClawDSH 本地 GUI | `preset-openclaw`、`activity` | 公开 dsh Web 组装、Session history、可选 Activity service | ✅ 产品壳、可写 Settings 与语义 Activity |
| 当前渠道平面 | `channel`、`channel-agent`、`channel-openclaw` | 自有 `ctx.channels` V1 | ✅ 基础；⚠️ 没有 certified 或 enabled 渠道 |
| Persona | `soul` | `ctx.systemPrompt` | ✅ 已实现 |
| Memory | `memory`、`embeddings`、`embeddings-ark` | filesystem、tools、system prompt、自有 embeddings seam | ✅ 已实现 |
| Skills | `skills-hub` | `ctx.skills` | ✅ 已实现 |
| Automation | `automation` | Agents 与 Sessions | ✅ 已实现；默认关闭 |
| 产品 identity | 内部 `preset-openclaw` source | `clawdsh` profile 与 presets | ✅ `ClawDSH 模式`；旧 `openclaw` 资产仅 warning-only |
| 公共发行 | `dsh-bundle`、`cli`、十个 runtime feature package 与受限 preset | 托管 dsh profile 安装与固定 npm 发行图 | ✅ `0.1.0-rc.1` 候选版本已准备；⚠️ 未发布 |

## ClawDSH 本地 GUI

### 当前产品增量

nested build 在 `tools/link-clawdsh.sh` 安装 `clawdsh` profile 与 preset 前产出 `@clawdsh/dsh-product-runtime` 及其 browser asset。`pnpm dsh --profile clawdsh` 在 Loader 结算后只打印 `/clawdsh/` 产品 URL；`/` 保留原生 dsh Web client，新 Session 默认使用 `ClawDSH 模式`。OpenClaw Gateway 与 Automation 保持关闭，因此 clean home 无需 platform credential 或 OpenClaw artifact 即可启动。

### 产品链

| 环节 | Owner 与行为 |
|---|---|
| 入口 | `/clawdsh/` 是 ClawDSH 产品 route；`/` 保留原生 dsh Web |
| 对话 | 复用公开 dsh client module graph、loading state 与 chat renderer |
| Settings | capability 与 Loader 证据保持只读；allowlist Config 字段使用 optimistic revision、desired/runtime state、managed Gateway deployment 与不含 secret 的 dsh credential metadata |
| Activity | 当前 Session 的 Prompt、Memory、Channels、Skills 与 Automation 记录合并 standard history 与有界 private sidecar；失败只让该视图降级，raw Trajectory 留在 Harness 高级 |
| Harness 高级 | 显式进入未修改的原生 dsh GUI 与 diagnostics |
| 隔离 | 不新增 Client Slot，也不修改 `api-proxy`、Client Catalog、Agent Loop、generated file 或上游 GUI source |

✅ 产品壳、两个 route、四个目的地、capability overview、conflict-safe Settings、语义 Activity、未知 route 状态与 keyless real-profile snapshot 已实现。`dsh --profile web` 保持纯 Harness 路径。

## 当前 OpenClaw 渠道平面

### 接线

| 环节 | Owner 与行为 |
|---|---|
| 平台传输 | 锁定 OpenClaw Gateway 与 channel plugin 拥有凭证、ingress、admission、canonical id、native action、media staging 与 delivery |
| Host 来源 | `tools/openclaw-channel-host` 锁定 production `v2026.7.1-2` / `0790d9f...` 与 source-only canary；production catalog 为 **24+3** |
| Local Provider | `channel-openclaw` 校验 host identity、认证 private IPC、强制 handshake capability、报告 health、转发 action 并持久化 delivery receipt |
| Service Definition | `channel` 校验 V1 payload，并在恰好一个 Provider 与一个 Driver 之间 dispatch |
| Agent Driver | `channel-agent` 持久化 route generation、Session binding、idempotency 与 recovery state，导入已校验图片，选择 preset，驱动 Agent，并暴露 route-scoped `message` tool |
| Durable output | terminal Agent result 与 delivery receipt 完成 reconciliation，且不把 ambiguous delivery 当作重发许可 |

完整链路是 platform → OpenClaw admission → authenticated `turn.run` → `ctx.channels` → durable Agent driver → dsh Session/Agent → terminal result → OpenClaw delivery。Bridge 会拒绝不同的 host tag、commit、artifact digest、Node engine、Gateway lineage、startup nonce、AgentHarness generation、protocol version 或未协商 capability。OpenClaw 必须只选择 `clawdsh/local`，不能有 model fallback。

### 执行与 replay

- ✅ 一个 Gateway-scoped idempotency key 对应一个 envelope digest。相同 in-flight request 会 attach，terminal record 会 replay，冲突内容会失败。
- ✅ Crash-observed running turn 变为 `needs-recovery`，不会重跑副作用未知的 tool。
- ✅ Route identity 包含 Gateway、OpenClaw Session key、generation、channel、account、conversation、optional thread 与 direct/group kind；reset 和 close 退役精确 generation。
- ✅ Agent ledger 在模型执行前提交 admission，已知 `user/message` event 携带完整且净化后的 channel provenance。
- ✅ Delivery receipt 持久且单调；ambiguous delivery 需要 reconciliation，绝不允许盲目重发。
- ⚠️ 完整 group 默认关闭，且没有渠道拥有认证所需的 assembled 与 live evidence。

### Actions 与 attachments

协议覆盖 send、edit、delete、react、poll、typing、directory query 与 target resolution。已连接 Gateway 广告允许的子集，每个平台仍可明确拒绝操作。

Inbound image 被限制在 canonical staging root，校验 symlink、size、media type 与 SHA-256，随后通过 dsh attachments 存储。Audio、video 与 general file 在 dsh 拥有 durable non-image attachment 前失败。Outbound media 在 dsh 拥有 staging writer 前失败。

### 验证状态

| 声明 | 当前状态 |
|---|---|
| Production roster provenance | **cataloged**：27 个条目，24 个 core/bundled/repository-official + 3 个 external |
| Production sidecar channel | 仅 **cataloged**；没有精确逐渠道 assembly 或 certification |
| Canary | 仅 **cataloged** audit input；其 source archive 不是 runnable built artifact |
| POSIX IPC authorization | private parent、socket mode、token、nonce 与精确 handshake check 已实现 |
| Windows IPC authorization | unsupported 且 fail-closed，直到存在 named-pipe ACL enforcement |
| Plugin Session event | 禁用 `channel/*` 名称，因为 downstream append 不能将其标记为 ignorable |
| Keyless assembled transcript | 缺失，因为 upstream snapshot lane 不发现自有 package |
| Telegram / Feishu live traffic | 没有当前认证证据；canonical sidecar route 处于 disabled 状态 |

## 单一渠道执行路径

ClawDSH 不交付 `channel-core`、`channel-telegram`、`channel-feishu` 或 `ctx.legacyChannels` runtime。每个平台 route 都使用 `ctx.channels → channel-agent → channel-openclaw`；平台 SDK、identity、admission、reaction、media 与 delivery behavior 均由 OpenClaw 拥有。

只读迁移清单会识别旧 package 与 credential name，但不加载 adapter，也不复制 secret value。发行校验继续把这些 package name 放在 denylist 中，阻止它们重新进入公共 bundle。历史直连 adapter test 与 live traffic 不能认证 canonical sidecar。

## Persona、Memory、Skills 与 Automation

| 功能 | 链路 | Logged 或用户可见结果 |
|---|---|---|
| Persona | preset → `soul` → ordered system-prompt section | prompt 通过 logged `request/header` 进入模型 |
| Memory recall | Markdown fact → index → recall prompt section | recall 进入 logged `request/header` |
| Memory tools | `memory_search` / `memory_get` → tool result | 结果是普通 logged tool result；没有 Provider 时 semantic search fail loud |
| Skills | ClawHub-compatible directory → `skills-hub` → `ctx.skills` | mounted skill instruction 与 tool 使用普通 dsh logging |
| Automation | cron/at/every rule → Agent Session → `automation/run` → plugin-sourced turn | event 与 turn 可重建；功能默认关闭 |

✅ 这些功能复用 dsh lifecycle 与 logging。Automation 组合 `ctx.agents` 与 `ctx.sessions`；不声称存在不存在的 scheduling service。

## Profile composition

`preset-openclaw` 是 `clawdsh` Agent preset、example soul 与 profile 的内部源码。Profile 组合 dsh base 与 Web bundle，再挂载 Memory、Embeddings、Skills、opt-in Automation，以及默认关闭的 `channel → channel-agent → channel-openclaw` group。物理 directory name 不会成为用户可见 id。

- ✅ 新 Web Session 默认使用 `clawdsh`，显示为 `ClawDSH 模式`。
- ✅ Owner channel turn 使用 `clawdsh`；每个 non-owner 或 group turn 经 OpenClaw admission 后使用 `clawdsh-messaging-safe`。
- ✅ Disabled channel 与 Automation 可以缺少凭证；mounted plugin 的 validated `enabled` setting 控制 optional runtime effect。
- ✅ `tools/link-clawdsh.sh` 只安装 ClawDSH id，检测到旧 `openclaw` 资产时警告，且不创建 alias 或修改旧资产。
- ⚠️ Channel configuration row 不能建立 `enabled`；ADR-0008 要求先认证。

## 模型可见日志账本

| 功能输入 | 模型可见形式 | Logged as | 状态 |
|---|---|---|---|
| Persona | system prompt | `request/header` | ✅ |
| Memory recall | system prompt | `request/header` | ✅ |
| Memory search | tool result | normal tool-result event | ✅ |
| Automation trigger | plugin-sourced user turn | `automation/run` + normal turn event | ✅ |
| 当前 channel admission | user content 与已校验 image | 已知 `user/message` 携带净化后的 channel source；权威在 Agent ledger | ✅ |
| 当前 delivery update | 不是 model input | Provider 与 Agent delivery ledger | ✅ |
| Channel health 与 IPC bookkeeping | 不是 model input | 仅 Provider health 与 ledger | ✅ |
| Activity semantic record | 不是额外 model input | standard Session history + ClawDSH sidecar projection | ✅ |

## 公共发行

| 环节 | Owner 与行为 |
|---|---|
| 包集合 | 精确 [13 包 allowlist](../../packages/openclaw/README.md#public-release-set) 使用 `0.1.0-rc.1`；已移除的直连 adapter name 进入 denylist，nested product runtime 被排除 |
| Bundle | `@clawdsh/dsh-bundle` 包含 profile patch、presets、Control Runtime、GUI asset、锁定 Channel asset 与精确 feature dependency |
| 托管安装 | `@clawdsh/cli` 固定 bundle `0.1.0-rc.1` 与 dsh `0.1.0-rc.6`，原子安装、记录 `.clawdsh.json`、保留用户数据、带备份修复，并通过自身 dsh binary 启动 |
| Channel 安装 | 显式且仅限 production 的命令校验锁定 SHA-512 archive 与 checked runtime，保留既有 OpenClaw 配置和 state，并且只在配置不存在时创建不含凭证且 fail-closed 的配置；普通初始化不获取 OpenClaw |
| 发行验证 | 真实 tarball 在临时 registry 与隔离 home smoke 前拒绝本地协议、symlink、未声明文件、私有 registry URL 与发行图漂移 |
| 发布 | 已准备 workflow 固定公共 npm `next`、OIDC trusted publishing、provenance、精确 allowlist、dependency-first 顺序与 `refs/heads/clawdsh`；package 创建与 npm trust 仍属于外部步骤 |

✅ Bundle、CLI、Channel 安装器、发行审计与 workflow 已准备，且没有发布 package 或改变仓库可见性。⚠️ Registry 是 `bootstrap-required`，而不是 `OIDC-ready`：13 个 package object 均不存在，npm trust 与 staged publishing 都不能创建它们。必须先由用户另行授权交互式 2FA bootstrap；随后每条 package trust 记录必须匹配 `clawdsh-publish.yml`、environment `npm` 与 `npm publish`，且该 GitHub environment 只允许 `clawdsh` branch。

## 开放条件

1. 增加自有 keyless Gateway-to-Agent snapshot lane，并完成精确逐渠道 assembly evidence。
2. 在 named-pipe ACL enforcement 提供等价 authorization 前保持 Windows fail-closed。
3. 在启用对应 media path 前增加 durable non-image attachment 与 outbound staging。
4. 启用任何路径前运行新的 Telegram 与 Feishu certification。
5. 持久化 namespaced `channel/*` Session event 前获得 ignorable append mechanism。
6. 选择并另行授权 bootstrap archive 与版本，再通过交互式 2FA 创建全部 13 个 package object；本仓库不执行该 bootstrap。
7. 在 OIDC 发布前校验全部 13 条 npm trust 记录、branch-restricted `npm` environment、canonical `refs/heads/clawdsh`、公共仓库批准与精确 dsh compatibility。
