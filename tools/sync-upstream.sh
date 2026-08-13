#!/usr/bin/env bash
# ClawDSH 上游同步脚本 —— 用法: tools/sync-upstream.sh [--dry-run]
# 流程见 docs/standards/upstream-sync.md：fetch → master 快进 → clawdsh rebase → 验证
# 注意：本脚本不自动提交、不自动推送；冲突留给人工按规范解决。
set -euo pipefail

cd "$(dirname "$0")/.."

PNPM="$(npm config get prefix 2>/dev/null)/bin/pnpm"
command -v "$PNPM" >/dev/null 2>&1 || PNPM="pnpm"

echo "==> 1/5 拉取上游…"
git fetch upstream

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "clawdsh" ]; then
  echo "!! 当前在 $BRANCH，同步流程要求先切到 clawdsh 分支" >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "!! 工作区不干净，请先提交或暂存改动（上游同步依赖干净工作区）" >&2
  exit 1
fi

echo "==> 2/5 master 快进到 upstream/master…"
git checkout master
git merge --ff-only upstream/master

echo "==> 3/5 clawdsh rebase 到新 master…"
git checkout clawdsh
if ! git rebase master; then
  echo "!! rebase 冲突，按 docs/standards/upstream-sync.md 第 3 步人工解决：" >&2
  echo "   README/AGENTS/package.json → 取上游版本后把品牌段重新置顶；" >&2
  echo "   解决后执行: git add -u && git rebase --continue" >&2
  exit 1
fi

echo "==> 4/5 安装依赖…"
"$PNPM" install >/dev/null

echo "==> 5/5 提醒：请继续执行 pnpm run typecheck 与 profile 冒烟（阶段 2 起），"
echo "    并更新 docs/standards/upstream-sync.md 的基线表 + docs/journal/ 记录。"
