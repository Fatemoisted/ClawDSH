# ADR-0004：npm 发布——`@clawdsh/*` 包的私有 registry 发布面

[English](0004-npm-publishing.md) | 中文

- **Status**：已被 ADR-0009 取代（2026-08-15）
- **Date**: 2026-08-14
- **Depends on**: ADR-0001（构建链豁免）、ADR-0002（自有接缝先例）、ADR-0003（embeddings 接缝）

ADR-0009 用闭合公共发布集合、托管 CLI、精确候选版本与 trusted publishing 取代本 ADR 的私有 registry 包集合、版本基线、安装路径和 token 工作流。本文件继续作为狭窄 workspace constraint 豁免的历史权威。

## Context

`packages/openclaw/` 下的 ClawDSH 自有包是重建的可复用面：`@clawdsh/dsh-*` 插件（`channel-*`、`memory`、`embeddings`、`embeddings-ark`、`skills-hub`、`automation`、`soul`）由内部 `preset-openclaw` 源组装成 `clawdsh` profile 与 preset。由于上游发布机制（`scripts/release/*`）只认 `@deepseek-ai/*` 序列，开发路径通过 `tools/link-clawdsh.sh` 把它们接入运行时。本决策把这些包发布到**私有 registry**——具体 URL 与凭证在发布时提供——使 `dsh plugin --profile clawdsh add @clawdsh/dsh-memory` 成为声明式路径，symlink 退为开发便利。

`scripts/check-workspace-constraints.ts` 目前对这批包报错：它把每个 `packages/<group>/<pkg>` 目录都当作上游「release member」（要求 `@deepseek-ai` 仓库 URL 且 `private: false`），并要求 `packages/openclaw/` 下每个目录都有 `package.json`（而 `_template`、`channel-wechat`、`preset-openclaw` 刻意没有）。本 ADR 记录发布决策、manifest/registry 形态，以及它所需的唯一上游文件豁免。

## Decision

1. **发布目标 = 私有 registry，参数化。** 9 个包（`automation`、`channel-core`、`channel-feishu`、`channel-telegram`、`embeddings`、`embeddings-ark`、`memory`、`skills-hub`、`soul`）删 `private: true`，加 `publishConfig.access: "public"`——私有 registry *内部*的 public access，保持约束门 access 检查一致——再加 `repository: { type: "git", url: "git+https://github.com/Fatemoisted/ClawDSH.git", directory: "packages/openclaw/<pkg>" }` 指向私有 origin。registry URL 本身**不**写死在 manifest：它参数化，在发布时以工作流的 `registry` 输入 → `NPM_CONFIG_REGISTRY` 注入，源码树里永远不出现占位 URL。
2. **独立发布路径，上游发布脚本不改。** `scripts/release/families.ts` 与 `@deepseek-ai/*` 序列不动；发布走 `pnpm -r --filter './packages/openclaw/*' publish`，拓扑序（`embeddings` Service Definition 先于 `embeddings-ark`/`memory`；`channel-core` 先于渠道适配器）。版本基线 = `0.1.0`（与当前 manifest 一致）。
3. **唯一上游文件直改（豁免）。** `scripts/check-workspace-constraints.ts` 增 `clawdshRepositoryUrl` 常量、仿 `publicLandlockPackages` 先例的 `@clawdsh/` 分支（不得设 `private`、`publishConfig.access` 必须 `"public"`、仓库 URL + directory 必须匹配私有 origin）、以及 `clawdshNonPackageDirs` 集合（`_template`、`channel-wechat`、`preset-openclaw`），层级形状检查在 `packages/openclaw/` 下跳过它们。改动纯增量，便于 rebase 重放。
4. **修订 ADR-0001 §4。** constraints 脚本并入构建编排豁免清单（「新增包的注册点」），规则相同：仅增量改、rebase 重放、上游内部不变。
5. **symlink 仅保留开发路径。** `tools/link-clawdsh.sh` 安装 `clawdsh` profile 与 preset，并链接本地包；registry 安装路径为 `dsh plugin --profile clawdsh add @clawdsh/dsh-<pkg>`。脚本检测到旧 `openclaw` profile 与 preset 目录时只警告并保留，不创建兼容别名。
6. **发布工作流。** `.github/workflows/clawdsh-publish.yml` 为 `workflow_dispatch`（inputs `registry` 与 `dry-run`），checkout → install → build → typecheck → 经 `NPM_CONFIG_REGISTRY` + `NPM_TOKEN` 发布——本仓库自有的最小骨架，与上游发布工作流隔离。

## Consequences

- ✅ `@clawdsh/*` 包可从私有 registry 安装；开发 symlink 路径与上游发布机制相互独立。
- ⚠️ 开发脚本不提供托管安装状态或完整性修复。公共发行 CLI 负责 manifest 与 `clawdsh doctor`，而不是把该过渡脚本扩展成产品安装器。
- ⚠️ registry URL/凭证放在仓库之外，每次发布必须提供；dry-run 模式用于不落盘地校验 tarball。
- ⚠️ 一个上游脚本现在带有 ClawDSH 分支；每次上游同步须重放该 diff（增量形态保证可干净重放），与 tsconfig 注册点同规则。
- ⚠️ 发布是独立于 `@deepseek-ai/*` 序列的路径；两个族系的版本提升互不相关（ClawDSH 保持 `0.1.0`，直到自有序列另行决定）。

## Alternatives

- **发布到公共 npm registry（否决）**：这些包是发起人的私有面，尚不面向公共消费；决策明确是私有 registry。
- **把 `@clawdsh/*` 并入上游 `families.ts` 发布序列（否决）**：会把私有 registry 与版本节奏和公共 `@deepseek-ai/*` 序列纠缠，并把上游文件 diff 扩大到超出单一增量豁免。
- **symlink 作为唯一分发手段（否决）**：只对本机有效，无法在别处做可复现的声明式安装；registry 路径才是持久的用户面机制。
- **把私有 registry URL 写死在 manifest（否决）**：URL 发布时才提供；占位符既非法，又会让 `npm publish` 落入未设置的默认值。
