# ADR-0001：项目基座形态——非 Fork 的本地克隆 + upstream 远程 + monorepo 扩展

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
3. **物理隔离**：自有代码只出现在 `packages/openclaw/`、`docs/{adr,specs,matrix,standards,journal}/`、`tools/`、`.github/workflows/clawdsh-*`。上游其余文件只读。
4. **品牌层 overlay + 构建编排最小豁免**：上游文件仅允许两类改动——① 置顶品牌段（README/CLAUDE.md→AGENTS.md 符号链接）；② 根级元数据与构建编排：根 `package.json` 的 name 改为 `clawdsh`；`tsdown.config.ts` 的 workspace 排除名单管理 `packages/openclaw/*`（tsdown 以目录粒度扫描、骨架包会被误扫）；**新包接入的注册点**（`tsconfig.base.json` 的 paths 映射、`tsconfig.host.json` 的 references）只允许追加 `@clawdsh/*` 条目、不得改动既有条目。以上改动均为附加性/替换性最小豁免，rebase 冲突时取上游版本、再重放品牌段与注册条目。上游内部包名保持 `@deepseek-ai/*` 不动（改名会摧毁同步能力）。
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
