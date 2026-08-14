#!/usr/bin/env bash
# ClawDSH 本地 profile 安装脚本 —— 用法: tools/link-openclaw.sh
# 1) 构建 @clawdsh/* 包（lib/types，供运行时加载；openclaw 包不进上游
#    tsconfig.host.json，其构建入口是 packages/openclaw/tsconfig.json 自有聚合）；
# 2) 把 profile 与 agent preset 复制到 DSH_HOME；
# 3) 为 @clawdsh/* 与复用的 Harness agent-presets 建立 profile symlink 过渡
#    （包未发布到 npm 前，healProfilesModuleFallback 只 BFS apps/cli 依赖闭包，解析不到它们）。
# 幂等：重复执行即刷新（增量构建 + cp 覆盖 + ln -sfn）。凭证仍走 env / .env，本脚本不碰。
set -euo pipefail

cd "$(dirname "$0")/.."

DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME_DIR/profiles/openclaw"
PRESET_DIR="$DSH_HOME_DIR/.agent-presets/openclaw"
LINK_DIR="$DSH_HOME_DIR/profiles/node_modules/@clawdsh"
HARNESS_LINK_DIR="$DSH_HOME_DIR/profiles/node_modules/@deepseek-ai"

echo "==> 1/3 构建 @clawdsh 包（lib + lib/types）"
pnpm run build:openclaw
pnpm exec tsc -p packages/openclaw/tsconfig.check.json

echo "==> 2/3 复制 profile 与 agent preset"
mkdir -p "$PROFILE_DIR"
cp -R tools/openclaw-preset-openclaw/profile/. "$PROFILE_DIR/"
mkdir -p "$PRESET_DIR"
cp tools/openclaw-preset-openclaw/agent.cordis.yml "$PRESET_DIR/agent.cordis.yml"
cp tools/openclaw-preset-openclaw/preset.yml "$PRESET_DIR/preset.yml"
mkdir -p "$PRESET_DIR/souls"
cp -R tools/openclaw-preset-openclaw/souls/. "$PRESET_DIR/souls/"
# `memory_search` also handles a missing first-run root, while creating it here
# keeps the installed profile immediately inspectable to operators.
mkdir -p "$DSH_HOME_DIR/memory/memory"

echo "==> 3/3 建立 @clawdsh / Harness bridge symlink（过渡，发布后移除）"
mkdir -p "$LINK_DIR"
for pkg in soul channel-core channel-feishu channel-telegram memory embeddings embeddings-ark skills-hub automation; do
  ln -sfn "$PWD/packages/openclaw/$pkg" "$LINK_DIR/dsh-$pkg"
  echo "    $LINK_DIR/dsh-$pkg -> packages/openclaw/$pkg"
done
mkdir -p "$HARNESS_LINK_DIR"
ln -sfn "$PWD/packages/preset/agent-presets" "$HARNESS_LINK_DIR/dsh-agent-presets"
echo "    $HARNESS_LINK_DIR/dsh-agent-presets -> packages/preset/agent-presets"

echo "完成。凭证设置见 tools/openclaw-preset-openclaw/README.md（FEISHU_*/DEEPSEEK_API_KEY/ARK_API_KEY）。"
