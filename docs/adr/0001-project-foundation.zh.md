# ADR-0001：项目基座形态——非 Fork 的本地克隆 + upstream 远程 + monorepo 扩展

[English](0001-project-foundation.md) | 中文

- **状态**：Accepted
- **日期**：2026-08-14
- **决策人**：项目发起人

> ADR 约定：一决策一文件，编号递增；必须包含 上下文 / 决策 / 后果 / 备选方案 四节。新增 seam 或架构级变更必须走 ADR。

## 上下文

我们要基于 DeepSeek Harness（dsh）重建 OpenClaw 的功能集。dsh 是 pnpm monorepo（`vendor/` + `packages/*/*` + `apps/`），自有插件需要放入其 workspace 才能复用类型系统、构建链与 profile 机制。

约束：发起人要求**不 Fork**（GitHub Fork 无法设 Private），而是直接克隆官方仓库，之后推送到自己的私有远程。

## 决策

1. **仓库形态**：直接 `git clone` 官方仓库到本地 `/Users/mac/ClawDSH`，将 `origin` 改名为 `upstream`；未来用户自建私有远程时再添加为 `origin`（`git remote add origin <私有仓库> && git push -u origin <分支>`——非 fork 的克隆推送到新建空仓库完全合法且可设 Private）。
2. **分支策略**：`master` 仅做上游镜像（fast-forward，禁止直接提交）；我们的全部工作提交在 `clawdsh` 分支，定期 `rebase upstream/master`。这样上游同步永远是快进，冲突只出现在我们自己的分支上。
3. **物理隔离**：产品运行时代码保持在 `packages/openclaw/`；组装与记录位于 `tools/`、`docs/{adr,specs,matrix,standards,journal}/` 和 `.github/workflows/clawdsh-*`。跨切上游文件只在显式的构建、catalog、约束与发布扩展点上修改，用于让隔离的代码可测、可分发。
4. **品牌层 overlay + 增量编排豁免**：允许置顶品牌段（README/CLAUDE.md→AGENTS.md 符号链接），以及为 `@clawdsh/*` 设置的窄化根/包脚本与注册点，包括 TypeScript/构建输入、生成 catalog/图的根、workspace 约束和独立 `clawdsh` release family（ADR-0004）；不得重命名或语义改写既有上游 family 成员与行为。上游同步冲突时，先以上游版本为基础，再重放下游扩展并重跑门禁。上游内部包名保持 `@deepseek-ai/*` 不动。
5. **基线钉死**：记录当前上游基线 commit（2026-08-14：`47f943859b`，v0.1.0-rc.5），每次同步更新基线记录（见 `docs/standards/upstream-sync.md`）。
6. **骨架阶段不接入 workspace**：`packages/openclaw/*` 骨架不含 `package.json`（模板以 `.tpl` 存放），保证上游 `pnpm install/build/typecheck` 全绿；实现时再按模板接入。

## 后果

- ✅ 上游 rebase 零冲突面最小化；私有化无障碍；构建链永远绿色。
- ⚠️ 品牌段会在每次上游改动 README/AGENTS 时产生一次性冲突，成本低但不可避免。
- ⚠️ 一旦上游结构调整 `packages/*/*` 通配或构建扫描方式，需要复查本决策（检查点：每次同步）。

## 备选方案

- **GitHub Fork（被否决）**：无法设 Private，违反发起人约束。
- **独立仓库依赖已发布 npm 包（被否决）**：dsh 处于 developer preview，发布物 API 漂移比源码同步更难跟踪；且 profile/patch 与类型 system 的复用优势丢失。
- **git subtree/submodule 引入上游（被否决）**：dsh 的 pnpm workspace 需要上下游包同处一个 workspace 解析，subtree 的合并噪音和 submodule 的指针开销都不如"直接 clone + 分支策略"简单可靠。
