#!/usr/bin/env bash
# ClawDSH 本地 profile 安装脚本 —— 用法: tools/link-openclaw.sh
# 1) 把 preset-openclaw/profile/* 复制到 ~/.dsh/profiles/openclaw/；
# 2) 为 @clawdsh/* 包建立 ~/.dsh/profiles/node_modules/@clawdsh/ 下的 symlink 过渡
#    （包未发布到 npm 前，healProfilesModuleFallback 只 BFS apps/cli 依赖闭包，解析不到 @clawdsh/*）。
# 幂等：重复执行即刷新（cp 覆盖 + ln -sfn）。凭证仍走 env / .env，本脚本不碰。
set -euo pipefail

cd "$(dirname "$0")/.."

DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME_DIR/profiles/openclaw"
LINK_DIR="$DSH_HOME_DIR/profiles/node_modules/@clawdsh"

echo "==> 1/2 复制 profile 模板到 $PROFILE_DIR"
mkdir -p "$PROFILE_DIR"
cp -R packages/openclaw/preset-openclaw/profile/. "$PROFILE_DIR/"

echo "==> 2/2 建立 @clawdsh 包 symlink（过渡，发布后移除）"
mkdir -p "$LINK_DIR"
for pkg in channel-core channel-feishu channel-telegram memory embeddings embeddings-ark skills-hub automation soul; do
  ln -sfn "$PWD/packages/openclaw/$pkg" "$LINK_DIR/dsh-$pkg"
  echo "    $LINK_DIR/dsh-$pkg -> packages/openclaw/$pkg"
done

echo "完成。凭证设置见 packages/openclaw/preset-openclaw/README.md（FEISHU_*/DEEPSEEK_API_KEY/ARK_API_KEY）。"
