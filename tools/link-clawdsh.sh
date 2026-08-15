#!/usr/bin/env bash
# ClawDSH 本地开发刷新脚本 —— 用法: tools/link-clawdsh.sh
# 1) 把 preset-openclaw/profile/* 复制到 ~/.dsh/profiles/clawdsh/；
# 2) 为 @clawdsh/* 包建立 ~/.dsh/profiles/node_modules/@clawdsh/ 下的 symlink 过渡
#    （包未发布到 npm 前，healProfilesModuleFallback 只 BFS apps/cli 依赖闭包，解析不到 @clawdsh/*）；
# 3) 把 agent preset（preset.yml + agent.cordis.yml + souls/）复制到 ~/.dsh/.agent-presets/clawdsh/，
#    让 web GUI 能发现并默认挂载「ClawDSH 模式」preset。
# 幂等：重复执行即刷新（cp 覆盖 + ln -sfn）。凭证仍走 env / .env，本脚本不碰。
set -euo pipefail

cd "$(dirname "$0")/.."

DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME_DIR/profiles/clawdsh"
LINK_DIR="$DSH_HOME_DIR/profiles/node_modules/@clawdsh"
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

echo "==> 1/3 复制 profile 模板到 $PROFILE_DIR"
mkdir -p "$PROFILE_DIR"
cp -R packages/openclaw/preset-openclaw/profile/. "$PROFILE_DIR/"

echo "==> 2/3 建立 @clawdsh 包 symlink（过渡，发布后移除）"
mkdir -p "$LINK_DIR"
for pkg in channel-core channel-feishu channel-telegram memory embeddings embeddings-ark skills-hub automation soul; do
  ln -sfn "$PWD/packages/openclaw/$pkg" "$LINK_DIR/dsh-$pkg"
  echo "    $LINK_DIR/dsh-$pkg -> packages/openclaw/$pkg"
done

echo "==> 3/3 安装 agent preset（preset.yml + agent.cordis.yml + souls/）"
mkdir -p "$PRESET_DIR/souls"
cp packages/openclaw/preset-openclaw/preset.yml "$PRESET_DIR/"
cp packages/openclaw/preset-openclaw/agent.cordis.yml "$PRESET_DIR/"
cp packages/openclaw/preset-openclaw/souls/assistant.md "$PRESET_DIR/souls/"

echo "开发刷新完成。凭证设置见 packages/openclaw/preset-openclaw/README.md（FEISHU_*/DEEPSEEK_API_KEY/ARK_API_KEY）。"
