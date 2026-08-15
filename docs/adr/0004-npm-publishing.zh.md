# ADR-0004：npm 发布——`@clawdsh/*` 包的私有 registry 发布面

[English](0004-npm-publishing.md) | 中文

- **Status**: Accepted (2026-08-14)
- **Date**: 2026-08-14
- **Depends on**: ADR-0001（构建链豁免）、ADR-0002（自有接缝先例）、ADR-0003（embeddings 接缝）

## Context

`packages/openclaw/` 下的 ClawDSH 自有包是重建的可复用面：`@clawdsh/dsh-*` 插件（`channel-*`、`memory`、`embeddings`、`embeddings-ark`、`skills-hub`、`automation`、`soul`）由内部 `tools/openclaw-preset-openclaw/` 源组装成 `clawdsh` profile 与 preset。由于上游发布机制（`scripts/release/*`）只认 `@deepseek-ai/*` 序列，开发路径通过 `tools/link-clawdsh.sh` 把它们接入运行时。本决策把这些包发布到**私有 registry**；其 URL 与凭证由受保护的发布 environment 控制，使 `dsh plugin --profile clawdsh add @clawdsh/dsh-memory` 成为声明式路径，symlink 退为开发便利。

首次集成时，`scripts/check-workspace-constraints.ts` 会报错：它把每个 `packages/<group>/<pkg>` 目录都当作上游 release member，并要求 `packages/openclaw/` 下每个目录都有 `package.json`，而当时的 `_template`、`channel-wechat`、`preset-openclaw` 是非 package 子目录。组装层现在位于 `tools/openclaw-preset-openclaw/`，占位目录也已移除；`packages/openclaw/` 当前剩余的每个直接子目录都是 10 个 package manifest 之一，因此临时层级检查绕过不再属于约束设计。既有发布脚本也没有独立 ClawDSH family，直接递归 publish 无法校验共享版本、依赖顺序、打包载荷与可复现性。本 ADR 记录私有 registry 决策及其隔离发布序列。

## Decision

1. **发布目标 = 受保护的私有 registry。** 10 个包（`automation`、`channel-core`、`channel-discord`、`channel-feishu`、`channel-telegram`、`embeddings`、`embeddings-ark`、`memory`、`skills-hub`、`soul`）删 `private: true`，加 `publishConfig.access: "public"`——私有 registry *内部*的 public access，保持约束门 access 检查一致——再加 `repository: { type: "git", url: "git+https://github.com/Fatemoisted/ClawDSH.git", directory: "packages/openclaw/<pkg>" }` 指向私有 origin。registry URL **不**写死在 manifest，也不接受 dispatch 发起人输入；受保护的 `npm-publish` environment 持有 `vars.NPM_REGISTRY_URL`。发布门禁要求不含凭证的 HTTPS URL，明确拒绝 `registry.npmjs.org`，token 单独注入。
2. **独立 release family。** 共享发布机制新增独立 `clawdsh` family，但不与公共 `dsh` 或 vendor 序列耦合。10 个成员共享一个版本和 `clawdsh-v*` tag；bump 同步安装 profile 的依赖范围，verify 校验 tag/版本/范围并要求 tag commit 包含在 `origin/clawdsh` 中，pack 在干净构建后按 workspace 依赖排序，packed-install 在全新 consumer 中逐个导入公开入口与 invariant，publish 只上传这些已验证 tarball。版本基线 = `0.1.0`。
3. **增量 workspace 约束。** `scripts/check-workspace-constraints.ts` 新增 `clawdshRepositoryUrl` 分支（不得设 `private`、`publishConfig.access` 必须 `"public"`、仓库 URL + directory 必须匹配 ClawDSH origin）与独立共享版本约束。`packages/openclaw/` 当前的 10 个子目录都是普通 package 目录，统一通过公共的精确层级规则；不再保留 ClawDSH 专用的非 package allowlist。公共 `dsh` 与 vendor 规则保持不变。
4. **修订 ADR-0001 §4。** constraints 脚本并入构建编排豁免清单（「新增包的注册点」），规则相同：仅增量改、rebase 重放、上游内部不变。
5. **symlink 仅保留开发路径。** `tools/link-clawdsh.sh` 安装 `clawdsh` profile 与 preset，并链接本地包；registry 安装路径为 `dsh plugin --profile clawdsh add @clawdsh/dsh-<pkg>`。脚本检测到旧 `openclaw` profile 与 preset 目录时只警告并保留，不创建兼容别名。脚本不负责托管安装状态或完整性修复；公共发行 CLI 负责 manifest 与 `clawdsh doctor`。
6. **凭证隔离发布工作流。** `.github/workflows/clawdsh-publish.yml` 在 PR 与 `clawdsh` push 上执行 runtime closure 和无凭证的 clean-build/pack/全新安装门禁；这一次只验证 payload，Harness/vendor 依赖由本地 tarball 提供。手动触发默认只 dry-run；实际发布还要求匹配的 `clawdsh-v*` tag 且其 commit 包含在 `origin/clawdsh` 中、受保护 environment 审批、有效的 `NPM_REGISTRY_URL`、只读 `NPM_READ_TOKEN` 与有写权限的 `NPM_TOKEN`。publish job 先安装发布脚本，再配置目标 registry；它下载 pack job 的同一份 artifact 而不重新构建，然后只注入 ClawDSH tarball 重跑全新安装，使所有 Harness/vendor 前置依赖必须从目标 registry 解析。安装后代码 probe 使用无凭证 allowlist 环境，并用 Node 文件权限把读取限制在一次性 consumer 内；写 token 只在最终 publish 步骤出现。最终 publisher 只接受 checkout 所定义、按发布顺序排列的恰好 10 个 family artifact——缺失、额外、重复、路径穿越、包身份或版本错误、payload 非法均拒绝——并且只有最终 registry smoke 与 publish 通过 `NPM_CONFIG_REGISTRY` 访问目标。

## Consequences

- ✅ `@clawdsh/*` 包可从私有 registry 可复现安装；symlink 保留为本地开发过渡。
- ✅ 发布不会再静默留下旧 profile 依赖范围，也不会上传只在 workspace 内成立或已陈旧的载荷。
- ✅ 凭证 job 会在发布任何 ClawDSH tarball 前，证明目标 registry 已具备全部精确版本的 Harness/vendor 前置依赖。
- ⚠️ 开发脚本不提供托管安装状态或完整性修复；这些能力归公共发行 CLI 与 `clawdsh doctor` 所有。
- ⚠️ registry URL 与分离的读/写凭证由受保护 environment 持有，仅实际发布必须配置；普通 CI 与手动 dry-run 均无凭证。
- ⚠️ 上游 workspace-constraints 脚本中的增量 ClawDSH 分支须在上游同步时重放，规则与 tsconfig 注册点相同。
- ⚠️ ClawDSH 虽复用已审计的发布原语，仍与 `@deepseek-ai/*` 序列相互独立；两族版本与 tag 不会隐式联动。

## Alternatives

- **发布到公共 npm registry（否决）**：这些包是发起人的私有面，尚不面向公共消费；决策明确是私有 registry。
- **不建 release family，直接用 `pnpm -r` 递归发布（否决）**：它无法守住统一版本、同步 profile、验证打包后 consumer import，也不能保证发布的就是 CI 测过的 artifact。复用机制但保持独立 family 可获得这些保证，又不并入公共序列。
- **symlink 作为唯一分发手段（否决）**：只对本机有效，无法在别处做可复现的声明式安装；registry 路径才是持久的用户面机制。
- **把私有 registry URL 写死在 manifest，或接受 dispatch 发起人输入（否决）**：受保护 environment 才是信任边界；manifest 占位符非法，而自由输入会把发布 token 与 public-access 包路由到非预期 registry。
