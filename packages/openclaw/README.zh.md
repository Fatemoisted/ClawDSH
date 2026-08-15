# packages/openclaw — ClawDSH 自有插件域

[English](README.md) | 中文

本目录是 ClawDSH **唯一允许自由改写代码的地方**（上游纪律见根 `AGENTS.md`）。

## 为什么骨架目录里没有 package.json

pnpm workspace 与 tsdown 构建都以 `packages/*/*` 为通配符，且 tsdown 的扫描**以目录为粒度**（目录下没有 package.json 会向上游找到根包并报 `Cannot find entry`）。因此未实现骨架采用双保险：

1. **不放置 `package.json`** → pnpm 完全不可见；
2. **tsdown 显式排除** → 根 `tsdown.config.ts` 的 workspace `exclude` 名单明确列出该骨架路径（见 ADR-0001 决策 4 的构建编排豁免）。

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
| `preset-openclaw/` | `clawdsh` profile、preset、产品壳与 Control Runtime 的内部源码 | 整体组装 | profile、patch 与公开 dsh Web 组装 | **已实现** |
| `preset-openclaw/distribution/bundle/` | 公共 ClawDSH 组合包 | 托管产品资产 | dsh bundle patch 与精确包依赖 | **`0.1.0-rc.1` 候选版本已准备；需要 bootstrap；未发布** |
| `preset-openclaw/distribution/cli/` | 托管安装器、launcher、doctor 与显式 Channel 安装器 | 本地产品安装 | 精确 dsh CLI 依赖与托管文件系统资产 | **`0.1.0-rc.1` 候选版本已准备；需要 bootstrap；未发布** |
| `preset-clawdsh-messaging-safe/` | 受限 Channel Session preset | OpenClaw 非 owner / group 隔离 | agent preset composition | **已实现** |
| `channel/` | provider-neutral Channel Service Definition | Gateway channel protocol | 自有 `ctx.channels`（ADR-0008） | **V1 已实现** |
| `channel-agent/` | durable Agent-plane Driver | Gateway-to-Agent execution | `ctx.channels`、Agents、Sessions、attachments | **基础已实现；认证未完成** |
| `channel-openclaw/` | 锁定 OpenClaw communication Provider | Gateway 与 channel plugin catalog | `ctx.channels`、subprocess、storage | **基础已实现；默认关闭** |
| `channel-core/`、`channel-telegram/`、`channel-feishu/` | private legacy 进程内 channel path | 较早的 native adapter | `ctx.legacyChannels` | **只保留到 ADR-0008 替换门槛通过** |
| `channel-wechat/` | 历史未实现骨架 | — | — | 排除；可用性由锁定 OpenClaw catalog 决定 |
| `soul/` | 人格 / Soul | Soul 系统 | system-prompt 装配 | **已实现** |
| `memory/` | Markdown 事实源与语义召回 | Memory | `ctx.fs`、`ctx.tools`、system prompt、`ctx.embeddings` | **已实现** |
| `embeddings/` | 文本嵌入 Service Definition | Memory embedding backend | 自有 `ctx.embeddings`（ADR-0003） | **已实现** |
| `embeddings-ark/` | 火山方舟 Ark 文本嵌入 provider | remote embedding provider | `ctx.embeddings` | **已实现** |
| `skills-hub/` | ClawHub 兼容技能加载 | Skills / ClawHub | `ctx.skills` | **已实现** |
| `automation/` | 定时 Agent turn | Cron / Automation | `ctx.agents`、`ctx.sessions` | **已实现；默认关闭** |
| `activity/` | 限制隐私的语义 Activity | ClawDSH-native observability | standard Session history 加可选 `ctx.clawdshActivity` sidecar | **已实现；产品 profile 中必需** |

干净安装的 `clawdsh` profile 始终挂载各能力，让 Settings 与 health 持续可用。OpenClaw Gateway 与 Automation 的业务级 `enabled` 默认是 `false`；启动 Web Host 不需要 OpenClaw artifact、platform credential 或 model key。OpenClaw 拥有全部 platform adapter 与 credential，legacy package 则保持 private，且不进入 active profile。

## 公共发行集合

公共发行 allowlist 是以下 13 个 `0.1.0-rc.1` 包：`@clawdsh/dsh-soul`、`@clawdsh/dsh-embeddings`、`@clawdsh/dsh-embeddings-ark`、`@clawdsh/dsh-memory`、`@clawdsh/dsh-skills-hub`、`@clawdsh/dsh-automation`、`@clawdsh/dsh-channel`、`@clawdsh/dsh-channel-agent`、`@clawdsh/dsh-channel-openclaw`、`@clawdsh/dsh-activity`、`@clawdsh/dsh-preset-messaging-safe`、`@clawdsh/dsh-bundle` 与 `@clawdsh/cli`。机器可读顺序位于 [`release-contract.mjs`](preset-openclaw/distribution/release-tools/release-contract.mjs)；三个 legacy channel package 与 nested product runtime 都不是公共包。

发行工具构建真实 tarball，把自有 `workspace:` 关系转换为精确 `0.1.0-rc.1` 依赖，拒绝本地协议、symlink、未声明文件与私有 registry URL，并通过临时 registry 与隔离 dsh home 验证这些包。当前 registry 状态是 `bootstrap-required`，而不是 `OIDC-ready`：13 个 package name 均不存在，因此必须先由用户另行授权交互式 2FA 发布来创建它们，才能逐包配置 npm trust；staged publishing 不能创建全新 package。创建后，每条 trust 记录必须匹配 `clawdsh-publish.yml`、GitHub environment `npm` 与 `npm publish`；该 environment 必须只允许 `clawdsh` branch，release readiness 则要求 `refs/heads/clawdsh`。[ADR-0009](../../docs/adr/0009-public-npm-distribution.md)拥有 bootstrap 与发布条件。本仓库不执行 bootstrap、不改变仓库可见性、不配置 trust，也不发布候选版本。
