# 文档与所有权清单——dsh 与 ClawDSH

[English](doc-inventory.md) | 中文

- **状态**：阶段 4 产品化；产品壳、Settings、Activity 与公共发行准备已经实现
- **用途**：识别仓库中哪些位置是上游只读、ClawDSH 自有或有 ADR 支撑的窄增量
- **权威**：root `AGENTS.md`、ADR-0001、ADR-0004、ADR-0006、[GUI ADR-0007](../adr/0007-clawdsh-local-gui-product.md)、[渠道 ADR-0008](../adr/0008-openclaw-channel-plane.md)与[公共发行 ADR-0009](../adr/0009-public-npm-distribution.md)

## 1. 上游只读位置

上游指通过 `upstream` remote 跟踪的 `deepseek-ai/deepseek-harness`。默认禁止直接编辑。品牌段与 additive build metadata 是列明的例外，不代表可以重写文件其余部分。

### 可编辑品牌文件

| 文件 | 允许的 ClawDSH 编辑 |
|---|---|
| `README.md`、`README.zh.md` | 在保留上游正文之上固定 ClawDSH brand section |
| `AGENTS.md`（`CLAUDE.md` symlink） | 在保留上游规则之上固定 ClawDSH 仓库规则 |
| `CONTRIBUTING.md`、`CONTRIBUTING.zh.md` | 按 ADR-0006 增加 ClawDSH contribution section，同时保留上游 attribution |

### 完全由上游拥有的 tree

| 位置 | 处理方式 |
|---|---|
| `vendor/` | 只通过 vendoring procedure 同步 |
| `packages/*`（`packages/openclaw/` 除外） | 不为 ClawDSH behavior 修改 |
| `apps/`、`website/`、`native/`、`python/`、`examples/`、`assets/`、`patches/` | 上游 application、runtime、SDK、example 与 asset source |
| 上游文档与 generated catalog | 只引用，或通过 owning upstream workflow 重新生成 |
| `scripts/` | 上游 check 与 generator；不放 ClawDSH feature implementation |
| `.github/workflows/*`（`clawdsh-*` 除外） | 上游 CI |
| `.agents/skills/` 与既有 `.agents/notes/` | 上游 operational knowledge；archived note 保持冻结 |

## 2. ClawDSH 自有位置

| 位置 | 当前内容 |
|---|---|
| `packages/openclaw/` | 功能包、canonical channel seam、受限 preset、产品组装、嵌套非 workspace GUI/runtime 与 distribution build，以及包模板 |
| `docs/adr/` | ClawDSH 决策；ADR-0007 拥有 GUI 产品形态，ADR-0008 取代 ADR-0002 成为渠道架构，ADR-0009 拥有公共发行 |
| `docs/specs/` | roadmap、context map、inventory、product chain、GUI spec、当前 feature spec 与旧渠道 reference |
| `docs/matrix/parity.md` | 产品与渠道支持投影；精确渠道 artifact 仍在机器 catalog |
| `docs/standards/` | naming、plugin、PR、dsh upstream sync 与 OpenClaw channel sync 规则 |
| `docs/journal/` | 带日期的开发历史，不是当前状态权威 |
| `docs/upstream-proposal/` | dsh Session-event 与 OpenClaw AgentHarness proposal；不表示存在 upstream PR |
| `tools/openclaw-channel-host/` | production 与 canary host lock、channel catalog、schema、verifier 与 test |
| 其他 `tools/` 条目 | ClawDSH installer、migration、verification 与 e2e driver |
| `.github/workflows/clawdsh-*` | ClawDSH 专用 CI 与固定公共 npm OIDC/provenance release workflow |
| `.agents/notes/` 下新的日期文件 | ClawDSH Agent Note；implemented note 跟踪已交付事实，archived note 保持冻结 |

`channel-openclaw` 还在 bridge distribution 旁拥有 `LICENSE.openclaw` 与 `THIRD_PARTY_NOTICES.md`。它们保留 OpenClaw attribution，并随锁定 artifact 或复制的 bridge code 变化。

## 3. 上游文件中的窄 ClawDSH 增量

| 文件 | 增量内容 | 支撑 |
|---|---|---|
| `README*`、`AGENTS.md`、`CONTRIBUTING*` | 有 delimiter 的 ClawDSH brand 或 contribution section | ADR-0001 / ADR-0006 |
| `LICENSE` | 保留上游 notice 并增加 ClawDSH contributor notice | ADR-0006 |
| root `package.json` | project identity 与 repository metadata | ADR-0001 / ADR-0006 |
| `pnpm-lock.yaml` | 自有 workspace package 的 generated dependency graph | package implementation；只生成，不手改 |
| `tsconfig.base.json` | 自有 package 所需精确 `@clawdsh/*` source alias | ADR-0001 additive registration |
| `tsconfig.host.json` | 匹配的自有 package project reference | ADR-0001 additive registration |
| `tsdown.config.ts` | workspace layout 所需自有 package build exclusion 或 registration | ADR-0001 additive registration |
| `scripts/check-workspace-constraints.ts` | 仍需要时保留窄 `@clawdsh/` package rule | ADR-0004 |

Rebase 时先取上游版本，再只重放这些精确增量。例外不会转移文件其余部分的所有权。

## 4. 本地 GUI 所有权

| 主题 | Owner |
|---|---|
| 产品形态、route 与禁止的上游修改 | ADR-0007 |
| 用户可见页面与验收行为 | `feature-gui-web` |
| `/clawdsh/` shell、静态路由、Settings 控制面、语义 Activity、Control Runtime 与 nested build | `preset-openclaw/product-shell` 加 `activity` |
| `/` 下原生 dsh Web GUI 与 raw Trajectory | 上游 dsh，不修改源码直接消费 |
| Profile 与 preset identity | `clawdsh`；物理 `preset-openclaw` source directory 是唯一保留的旧路径名 |
| 开发安装 | `tools/link-clawdsh.sh`；它要求已构建产品 artifact，并把 runtime 链接进托管开发 profile |
| Managed installation、integrity repair 与 `clawdsh doctor` | `preset-openclaw/distribution/cli`；与开发安装器分离 |

当前 ClawDSH GUI 使用公开 dsh Web boot 与 rendering API、Loader observation、静态 Host route、index transform、Settings/Credentials service、Session history、有界 Activity sidecar 与 Connection RPC。它不注册 Client Slot，也不修改 `api-proxy`、Client Catalog、Agent Loop、generated file 或上游 GUI source。`/clawdsh-rpc` 只允许 loopback，并暴露 product identity、capability evidence、allowlist Settings mutation、只写 dsh credential operation 与限制隐私的 `activity/list` query。

## 5. 公共发行所有权

| 主题 | Owner |
|---|---|
| 精确 13 包 allowlist、`0.1.0-rc.1` 版本与 dependency-first 顺序 | `preset-openclaw/distribution/release-tools/release-contract.mjs`；[包域 README](../../packages/openclaw/README.md#public-release-set)是面向人的投影 |
| Profile patch、主 preset、Control Runtime、GUI asset、Channel lock、bridge notice 与精确 feature dependency | `preset-openclaw/distribution/bundle` 及其 staging 和 asset-manifest verifier |
| 托管 profile/preset 安装、`.clawdsh.json`、reset 前备份、启动与 doctor | `preset-openclaw/distribution/cli` |
| 显式 production OpenClaw 获取与 runtime 组装 | `clawdsh channel install`；checked lock 与 bridge 仍由 `tools/openclaw-channel-host` 和 `channel-openclaw` 拥有 |
| 真实 tarball、发布内容审计、临时 registry 安装与隔离 dsh-home smoke | `preset-openclaw/distribution/release-tools` |
| 公共 npm `next` 发布 | `.github/workflows/clawdsh-publish.yml`；固定公共 registry、OIDC trusted publishing、provenance、精确 `refs/heads/clawdsh` 与 GitHub environment `npm` |

Bundle 与 CLI 是已准备但未发布的候选版本。13 个 package name 均不存在，因此当前状态是 `bootstrap-required`：必须由用户另行授权交互式 2FA 发布来创建它们，因为 npm trust 与 staged publishing 都不接受全新 package。创建后，每条 package trust 记录必须匹配 `clawdsh-publish.yml`、environment `npm` 与 `npm publish`；GitHub environment 只允许 `clawdsh` branch，workflow 则要求 `refs/heads/clawdsh`。仓库保持 private，发行工具不授权 bootstrap、trust 变更、仓库可见性变更或真实发布。

## 6. 渠道平面所有权

| 主题 | Owner |
|---|---|
| OpenClaw production 与 canary artifact identity 和 public channel roster | `tools/openclaw-channel-host/*.json` |
| 渠道架构与角色分配 | ADR-0008 |
| 当前 V1 behavior、assembly 与 gap | `feature-channel-plane-bridge` |
| OpenClaw host gap 与提议的 public semantics | `openclaw-agent-harness-channel-seams` |
| Promotion、certification 与 rollback | `openclaw-channel-sync` standard |
| 用户可见支持状态 | parity matrix |
| Runtime protocol 与 ledger | `channel`、`channel-agent` 与 `channel-openclaw` |
| 历史直连 adapter behavior | ADR-0002 与历史 `feature-channel-core` reference |

OpenClaw source archive 与 npm tarball 是外部输入，不是仓库自有 source tree。不要把完整 host 复制到 `packages/openclaw/`。Production bridge 可以分发许可证允许的最小 derived code 与 notice；lock verifier 仍是外部 host 权威。

## 7. 过渡状态

- 不交付直连 adapter package 或 `ctx.legacyChannels` runtime。旧名称只保留在只读迁移清单、发行 denylist 与历史文档中。
- `channel-wechat` 是历史排除记录，其可用性说明已被 production external WeChat catalog 取代。它不是 runtime package 或当前状态权威。
- Production sidecar 未 certified 或 enabled。文档不得把 catalog 或 package evidence 转换为 live support claim。
- Canary 有批准的 source archive，但没有锁定 built artifact，只作为 audit input。
- 上游 snapshot runner 不发现自有 channel package，且上游 `examples/` tree 保持只读。
- Downstream `channel/*` Session event 在可运行路径中保持禁用，直到存在 ignorable append mechanism；持久 channel ledger 与已知 `user/message` source 是当前权威。
- `clawdsh` 与 `clawdsh-messaging-safe` preset 在物理上仍存储为 dsh user preset；ClawDSH CLI 拥有其 managed manifest、integrity repair 与 reset 前备份行为。
- ClawDSH Settings 提供只读 capability 与 Loader 证据，以及 allowlist mutation 和不含 secret 的 dsh credential method。ClawDSH Activity 通过限制隐私的 loopback query 投影 standard Session history 与有界 sidecar。

## 8. Rebase checklist

1. 对上游自有文件取上游版本。
2. 只重放上面列出的 delimited brand section 与精确 additive registration。
3. 保留每个自有 directory 与 active ClawDSH Agent Note；绝不通过编辑 archived note 解决当前变更。
4. OpenClaw host lock 独立于 dsh upstream baseline 校验。
5. 在声明本 inventory 当前有效前，运行 bilingual pairing 与相关 package、build、browser、snapshot 和 documentation check。
