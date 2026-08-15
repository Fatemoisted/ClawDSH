#!/usr/bin/env bash
# ClawDSH 本地开发刷新脚本 —— 用法: tools/link-clawdsh.sh
# 1) 构建 @clawdsh/* 包（lib/types，供运行时加载）；
# 2) 把 tools/openclaw-preset-openclaw/profile/* 复制到 ~/.dsh/profiles/clawdsh/；
# 3) 为 @clawdsh/* 与复用的 Harness agent-presets 建立 profile symlink 过渡；
# 4) 把 agent preset（preset.yml + agent.cordis.yml + souls/）复制到
#    ~/.dsh/.agent-presets/clawdsh/，让 Web GUI 默认挂载「ClawDSH 模式」。
# 幂等：重复执行即刷新（增量构建 + cp 覆盖 + ln -sfn）。凭证仍走 env / .env，本脚本不碰。
set -euo pipefail

cd "$(dirname "$0")/.."

DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME_DIR/profiles/clawdsh"
LINK_DIR="$DSH_HOME_DIR/profiles/node_modules/@clawdsh"
HARNESS_LINK_DIR="$DSH_HOME_DIR/profiles/node_modules/@deepseek-ai"
PRESET_DIR="$DSH_HOME_DIR/.agent-presets/clawdsh"
LEGACY_PROFILE_DIR="$DSH_HOME_DIR/profiles/openclaw"
LEGACY_PRESET_DIR="$DSH_HOME_DIR/.agent-presets/openclaw"

legacy_found=false
if [ -d "$LEGACY_PROFILE_DIR" ]; then
  echo "警告：检测到旧 profile：$LEGACY_PROFILE_DIR" >&2
  echo '旧 profile 不再维护或刷新；如果其中仍启用飞书，启动它时仍须提供原有飞书凭据。' >&2
  echo '确认不再使用旧 profile 后再人工清理该目录；本脚本不会删除、移动或改写它。' >&2
  legacy_found=true
fi
if [ -d "$LEGACY_PRESET_DIR" ]; then
  echo "警告：检测到旧 agent preset：$LEGACY_PRESET_DIR" >&2
  echo '旧 Session 可能仍引用 preset id "openclaw"；请保留该 preset，直到这些 Session 不再需要恢复。' >&2
  echo '确认无旧 Session 依赖后再人工清理该目录；本脚本不会删除、移动或改写它。' >&2
  legacy_found=true
fi
if [ "$legacy_found" = true ]; then
  echo '请使用新命令 `tools/link-clawdsh.sh` 刷新，并以 `pnpm dsh --profile clawdsh` 启动新 profile。' >&2
fi

if [ "${CLAWDSH_SKIP_BUILD:-0}" != 1 ]; then
  echo '==> 1/4 构建 @clawdsh 包（lib + lib/types）'
  pnpm run build:openclaw
  pnpm exec tsc -p packages/openclaw/tsconfig.check.json
else
  echo '==> 1/4 跳过构建（CLAWDSH_SKIP_BUILD=1）'
fi

echo "==> 2/4 复制 profile 模板到 $PROFILE_DIR"
mkdir -p "$PROFILE_DIR"
cp -R tools/openclaw-preset-openclaw/profile/. "$PROFILE_DIR/"

echo '==> 3/4 建立 @clawdsh / Harness bridge symlink（过渡，发布后移除）'
mkdir -p "$LINK_DIR"
for pkg in soul channel-core channel-discord channel-feishu channel-telegram memory embeddings embeddings-ark skills-hub automation; do
  ln -sfn "$PWD/packages/openclaw/$pkg" "$LINK_DIR/dsh-$pkg"
  echo "    $LINK_DIR/dsh-$pkg -> packages/openclaw/$pkg"
done
mkdir -p "$HARNESS_LINK_DIR"
ln -sfn "$PWD/packages/preset/agent-presets" "$HARNESS_LINK_DIR/dsh-agent-presets"
echo "    $HARNESS_LINK_DIR/dsh-agent-presets -> packages/preset/agent-presets"

echo '==> 4/4 安装 agent preset（preset.yml + agent.cordis.yml + souls/）'
mkdir -p "$PRESET_DIR/souls"
cp tools/openclaw-preset-openclaw/preset.yml "$PRESET_DIR/"
cp tools/openclaw-preset-openclaw/agent.cordis.yml "$PRESET_DIR/"
cp tools/openclaw-preset-openclaw/souls/assistant.md "$PRESET_DIR/souls/"
# `memory_search` handles a missing first-run root; creating it here keeps the
# installed development profile immediately inspectable.
mkdir -p "$DSH_HOME_DIR/memory/memory"

echo '开发刷新完成。凭证设置见 tools/openclaw-preset-openclaw/README.md（FEISHU_*/TELEGRAM_BOT_TOKEN/DISCORD_BOT_TOKEN/DEEPSEEK_API_KEY/ARK_API_KEY）。'
