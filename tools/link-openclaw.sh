#!/usr/bin/env bash
# ClawDSH 本地 profile 安装脚本 —— 用法: tools/link-openclaw.sh
# 1) 构建 @clawdsh/* 包（lib/types，供运行时加载；openclaw 包不进上游
#    tsconfig.host.json，其构建入口是 packages/openclaw/tsconfig.json 自有聚合）；
# 2) 把 tools/openclaw-preset-openclaw/profile/* 复制到 ~/.dsh/profiles/openclaw/；
# 3) 为 @clawdsh/* 包建立 ~/.dsh/profiles/node_modules/@clawdsh/ 下的 symlink 过渡
#    （包未发布到 npm 前，healProfilesModuleFallback 只 BFS apps/cli 依赖闭包，解析不到 @clawdsh/*）。
# 幂等：重复执行即刷新（增量构建 + cp 覆盖 + ln -sfn）。凭证仍走 env / .env，本脚本不碰。
set -euo pipefail

cd "$(dirname "$0")/.."

DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME_DIR/profiles/openclaw"
LINK_DIR="$DSH_HOME_DIR/profiles/node_modules/@clawdsh"

echo "==> 1/3 构建 @clawdsh 包（lib/types）"
pnpm exec tsc -b packages/openclaw/tsconfig.json
pnpm exec tsc -p packages/openclaw/tsconfig.check.json

echo "==> 2/3 复制 profile 模板到 $PROFILE_DIR"
mkdir -p "$PROFILE_DIR"
cp -R tools/openclaw-preset-openclaw/profile/. "$PROFILE_DIR/"

echo "==> 3/3 建立 @clawdsh 包 symlink（过渡，发布后移除）"
mkdir -p "$LINK_DIR"
for pkg in channel-core channel-feishu channel-telegram memory embeddings embeddings-ark skills-hub automation; do
  ln -sfn "$PWD/packages/openclaw/$pkg" "$LINK_DIR/dsh-$pkg"
  echo "    $LINK_DIR/dsh-$pkg -> packages/openclaw/$pkg"
done

echo "完成。凭证设置见 tools/openclaw-preset-openclaw/README.md（FEISHU_*/DEEPSEEK_API_KEY/ARK_API_KEY）。"
