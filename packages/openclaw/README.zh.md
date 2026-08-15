# packages/openclaw — ClawDSH 自有插件域

[English](README.md) | 中文

本目录是 ClawDSH **唯一允许自由改写代码的地方**（上游纪律见根 `AGENTS.md`）。

## 为什么非 package 目录里没有 package.json

上游的 pnpm workspace 与 tsdown 构建都以 `packages/*/*` 为通配符，且 tsdown 的扫描**以目录为粒度**。所有已实现 plugin 都有自己的 manifest 与 Host project reference；余下非 package 目录采用双保险：

1. **不放置 `package.json`** → pnpm 完全不可见；
2. **tsdown 显式排除** → 根 `tsdown.config.ts` 排除 `_template/`、原则上不实现的 `channel-wechat/` 以及非 plugin 的 `preset-openclaw/` 组装源。

实现某个插件时，把该包从排除名单中移出并按模板接入。

> 唯一例外是 `_template/`：它存放的是 `.tpl` 模板文件（无 `package.json` 实体文件），且整个目录被排除名单覆盖。

## 接入流程（实现某个插件时）

1. 复制 `_template/` 到目标包目录，把 `*.tpl` 后缀去掉并填空（参照已实现的 `soul/` 包，它是完整范例）；
2. 写 `docs/specs/feature-<name>.md`（功能规格）；
3. 更新 `docs/matrix/parity.md`（对齐矩阵状态列）；
4. 注册构建链：`tsconfig.base.json` paths 条目 + `tsconfig.host.json` references（或 client 聚合，见 `docs/development.md`），并移除该路径已有的骨架排除项；
5. **必须配套 `src/invariant.ts`**（vitest 的 test-invariants 强制要求，参照 soul 包），package.json 的 exports/files 带上 `./invariant`；
6. 新增 seam 必须先在 `docs/adr/` 立项（见 `docs/standards/plugin-contract.md`）。

## 包清单

| 包 | 定位 | OpenClaw 对应 | dsh 接缝 | 状态 |
|---|---|---|---|---|
| `preset-openclaw/` | `clawdsh` profile/preset、嵌套 product-shell browser、Host runtime 与公共发行 build 的内部源码 | 整体组装 | 公开 dsh Web/Host API 与 profile/patch 机制 | **产品壳、可写 Settings 与语义 Activity 已实现** |
| `preset-openclaw/distribution/bundle/` | 公共 ClawDSH 组合包 | 托管产品资产 | dsh bundle patch 与精确包依赖 | **`0.1.0-rc.1` 候选版本已准备；需要 bootstrap；未发布** |
| `preset-openclaw/distribution/cli/` | 托管安装器、launcher、doctor 与显式 Channel 安装器 | 本地产品安装 | 精确 dsh CLI 依赖与托管文件系统资产 | **`0.1.0-rc.1` 候选版本已准备；需要 bootstrap；未发布** |
| `preset-clawdsh-messaging-safe/` | non-owner 与 group conversation 的受限 preset | messaging safety policy | Harness 公开 preset/tool 组装 | **已实现** |
| `channel/` | canonical 且平台无关的 Channel Service Definition | Gateway channel contract | 自有 `ctx.channels` | **V1 已实现**（ADR-0008） |
| `channel-agent/` | canonical Harness Driver：准入、持久 ledger、Session/Agent 执行与 route-scoped tool | Agent bridge | `ctx.channels` 与 Harness 公开服务 | **基础已实现；认证未完成** |
| `channel-openclaw/` | 锁定 OpenClaw Gateway sidecar Provider 与本地认证 RPC supervisor | Gateway runtime 与 channel plugin catalog | `ctx.channels` provider | **基础已实现；默认关闭且未认证** |
| `channel-core/` | 隔离的 pre-sidecar 兼容 router | 历史 gateway seam | 仅 `ctx.legacyChannels` | **legacy、private 且默认关闭** |
| `channel-telegram/` | 进程内 Telegram 兼容 adapter | Telegram adapter | `ctx.legacyChannels` | **有历史带凭证 legacy 证据；private 且默认关闭** |
| `channel-discord/` | 进程内 Discord 兼容 adapter | Discord adapter | `ctx.legacyChannels` | **仅无密钥 legacy 覆盖；private 且默认关闭** |
| `channel-feishu/` | 进程内飞书兼容 adapter | 飞书 adapter | `ctx.legacyChannels` | **有历史带凭证 legacy 证据；private 且默认关闭** |
| `channel-wechat/` | 历史非 package 记录；不做原生 adapter | 外部 `@tencent-weixin/openclaw-weixin@2.4.6` | 仅经锁定 `channel-openclaw` → `ctx.channels` | **已 catalog、未认证且默认关闭；见对齐矩阵** |
| `soul/` | 人格 / Soul | Soul 系统 | system-prompt 装配 | **已实现** |
| `memory/` | Markdown 事实源与语义召回 | Memory | `ctx.fs`、`ctx.tools`、system prompt、`ctx.embeddings` | **已实现** |
| `embeddings/` | 文本嵌入 Service Definition | Memory embedding backend | 自有 `ctx.embeddings`（ADR-0003） | **已实现** |
| `embeddings-ark/` | 火山方舟 Ark 文本嵌入 provider | remote embedding provider | `ctx.embeddings` | **已实现** |
| `skills-hub/` | ClawHub 兼容技能加载 | Skills / ClawHub | `ctx.skills` | **已实现** |
| `automation/` | 定时 Agent turn | Cron / Automation | `ctx.agents`、`ctx.sessions` | **已实现；默认关闭** |
| `activity/` | 限制隐私的语义 Activity | ClawDSH-native observability | standard Session history 加可选 `ctx.clawdshActivity` sidecar | **已实现；产品 profile 中必需** |

干净安装的 `clawdsh` profile 默认关闭 canonical sidecar、完整 legacy 兼容 group、每个 legacy adapter 与 Automation，使 Web Host 无需外部凭据即可启动。Settings 与 Activity 保持可用，经过校验的 `enabled` 字段控制可选业务 effect。Canonical `ctx.channels` 与 private `ctx.legacyChannels` 永不互相 alias；存在 legacy opt-in 时，canonical Gateway 启动与 Settings preflight 会在产生副作用前 fail-loud。

新渠道开发属于锁定的 OpenClaw provider/extension 路径。Legacy package 仅用于迁移和回归证据；它们的真实平台实测不会认证 sidecar 实现。

## 公共发行集合

公共发行 allowlist 是以下 13 个 `0.1.0-rc.1` 包：`@clawdsh/dsh-soul`、`@clawdsh/dsh-embeddings`、`@clawdsh/dsh-embeddings-ark`、`@clawdsh/dsh-memory`、`@clawdsh/dsh-skills-hub`、`@clawdsh/dsh-automation`、`@clawdsh/dsh-channel`、`@clawdsh/dsh-channel-agent`、`@clawdsh/dsh-channel-openclaw`、`@clawdsh/dsh-activity`、`@clawdsh/dsh-preset-messaging-safe`、`@clawdsh/dsh-bundle` 与 `@clawdsh/cli`。前 11 个构成 ClawDSH dsh package family，bundle 与 CLI 补全托管公共发行。机器可读顺序位于 [`release-contract.mjs`](preset-openclaw/distribution/release-tools/release-contract.mjs)；四个 legacy channel package 与 nested product runtime 都不是公共包。

发行工具构建真实 tarball，把自有 `workspace:` 关系转换为精确 `0.1.0-rc.1` 依赖，拒绝本地协议、symlink、未声明文件与私有 registry URL，并通过临时 registry 与隔离 dsh home 验证这些包。当前 registry 状态是 `bootstrap-required`，而不是 `OIDC-ready`：13 个 package name 均不存在，因此必须先由用户另行授权交互式 2FA 发布来创建它们，才能逐包配置 npm trust；staged publishing 不能创建全新 package。创建后，每条 trust 记录必须匹配 `clawdsh-publish.yml`、GitHub environment `npm` 与 `npm publish`；该 environment 必须只允许 `clawdsh` branch，release readiness 则要求 `refs/heads/clawdsh`。[ADR-0009](../../docs/adr/0009-public-npm-distribution.md)拥有 bootstrap 与发布条件。本仓库不执行 bootstrap、不改变仓库可见性、不配置 trust，也不发布候选版本。
