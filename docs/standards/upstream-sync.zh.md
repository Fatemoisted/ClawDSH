# 上游同步规范（upstream-sync）

[English](upstream-sync.md) | 中文

## 远程与分支布局

```
upstream → https://github.com/deepseek-ai/deepseek-harness.git   （官方，只拉不推）
origin   → https://github.com/Fatemoisted/ClawDSH.git            （私有，只推不拉）
master   → 上游镜像：只允许 fast-forward，禁止直接提交
clawdsh  → 我们的开发分支（已推送并跟踪 origin/clawdsh）：全部自有改动提交在这里，定期 rebase
```

> 本项目**不是 GitHub Fork**（发起人要求可设 Private）：直接 clone + 推送到自建私有仓库（2026-08-14 已完成）。GitHub 凭据存储在 macOS 钥匙串（`git credential-osxkeychain`），日常 `git push`/`git fetch origin` 免输 token；移除凭据：`git credential-osxkeychain erase`（输入 host=github.com 后回车两次）。注意：GitHub 个人访问 token 需含 `workflow` scope，否则推送含 `.github/workflows/` 的分支会被拒。

## 基线钉死

| 项 | 值 |
|---|---|
| 上游基线 commit | `47f943859b`（2026-08-14 克隆时） |
| 上游版本 | v0.1.0-rc.5（developer preview，**明示会有破坏性变更**） |
| 引擎要求 | Node ^22.19 或 ≥24；pnpm 11.7.0（corepack / `npm i -g pnpm@11.7.0`） |

dsh 处于 developer preview，上游改动频繁：**基线只向前移动，不跳跃**（每次同步更新上表）。

## 同步流程（tools/sync-upstream.sh）

1. `git fetch upstream`；
2. 检查上游是否有破坏性变更公告（CHANGELOG / release notes / docs 迁移说明），有则先更新受影响的自有插件；
3. `git checkout master && git merge --ff-only upstream/master`；
4. `git checkout clawdsh && git rebase master`——冲突时按优先级解决：
   - `README.md` / `AGENTS.md`（含 CLAUDE.md 符号链接）/ 根 `package.json`：**取上游版本，再把品牌段重新置顶**（品牌段以 `<!-- ════ ClawDSH` 标记为界）；
   - `tsdown.config.ts`：取上游版本后，重新添加 `packages/openclaw/*` 骨架排除（带 ClawDSH 注释标记，见 ADR-0001 决策 4）；
   - `tsconfig.base.json` / `tsconfig.host.json`：取上游版本后，重新追加 `@clawdsh/*` 的 paths 与 references 条目（只追加，不改既有条目）；
   - `packages/openclaw/`、`docs/{adr,specs,matrix,standards,journal}/`、`tools/`：这些目录上游不动，理论上零冲突；若上游恰好新增同名文件，人工合并并记入 `docs/journal/`；
5. 全量验证：`pnpm install && pnpm typecheck`，以及 profile 冒烟（阶段 2 起）；
6. 更新本文件的基线表 + `docs/journal/` 记录。

## 红线

- 永远不 `push` 到 `upstream`；
- 永远不修改上游文件内容（品牌段除外，见上）；
- 上游破坏性变更宁可暂缓同步（钉住旧基线），也不要带病 rebase。
