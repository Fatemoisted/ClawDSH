#!/usr/bin/env bash
# ClawDSH 本地开发刷新脚本 —— 用法: tools/link-clawdsh.sh
# 1) 校验 nested ClawDSH 产品 runtime 与 browser assets 已构建；
# 2) 把受管 profile patch 与 manifest 模板安装到 ~/.dsh/profiles/clawdsh/；
# 3) 为 @clawdsh/* 包建立 ~/.dsh/profiles/node_modules/@clawdsh/ 下的 symlink 过渡；
# 4) 安装 clawdsh owner preset 与 clawdsh-messaging-safe 受限 preset。
# 幂等：重复执行即刷新。脚本不读取、复制、移动或删除凭据与旧 OpenClaw 资产。
set -euo pipefail

cd "$(dirname "$0")/.."

DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME_DIR/profiles/clawdsh"
LINK_DIR="$DSH_HOME_DIR/profiles/node_modules/@clawdsh"
PRESET_DIR="$DSH_HOME_DIR/.agent-presets/clawdsh"
SAFE_PRESET_DIR="$DSH_HOME_DIR/.agent-presets/clawdsh-messaging-safe"
PRODUCT_SHELL_DIR="$PWD/packages/openclaw/preset-openclaw/product-shell"
PRODUCT_RUNTIME_DIR="$PRODUCT_SHELL_DIR/runtime"
PRODUCT_RUNTIME_ENTRY="$PRODUCT_RUNTIME_DIR/lib/index.mjs"
PRODUCT_BROWSER_INDEX="$PRODUCT_RUNTIME_DIR/web/index.html"
LEGACY_PROFILE_DIR="$DSH_HOME_DIR/profiles/openclaw"
LEGACY_PRESET_DIR="$DSH_HOME_DIR/.agent-presets/openclaw"
LEGACY_SAFE_PRESET_DIR="$DSH_HOME_DIR/.agent-presets/openclaw-messaging-safe"

legacy_found=false
if [ -d "$LEGACY_PROFILE_DIR" ]; then
  echo "警告：检测到旧 profile：$LEGACY_PROFILE_DIR" >&2
  echo '旧 profile 不再维护或刷新；如果其中仍启用渠道，请先停止旧登录再启用 ClawDSH sidecar。' >&2
  echo '确认不再使用后再人工清理；本脚本不会删除、移动或改写它。' >&2
  legacy_found=true
fi
if [ -d "$LEGACY_PRESET_DIR" ]; then
  echo "警告：检测到旧 agent preset：$LEGACY_PRESET_DIR" >&2
  echo '旧 Session 可能仍引用 preset id "openclaw"；请保留到这些 Session 不再需要恢复。' >&2
  echo '确认无旧 Session 依赖后再人工清理；本脚本不会删除、移动或改写它。' >&2
  legacy_found=true
fi
if [ -d "$LEGACY_SAFE_PRESET_DIR" ]; then
  echo "警告：检测到旧受限 preset：$LEGACY_SAFE_PRESET_DIR" >&2
  echo '旧渠道 Session 可能仍引用 preset id "openclaw-messaging-safe"；本脚本不会接管或删除它。' >&2
  legacy_found=true
fi
if [ "$legacy_found" = true ]; then
  echo '请使用 `tools/link-clawdsh.sh` 刷新，并以 `pnpm dsh --profile clawdsh` 启动新 profile。' >&2
fi

echo '==> 1/4 校验 ClawDSH 产品 runtime 与 browser assets'
if [ ! -f "$PRODUCT_RUNTIME_ENTRY" ] || [ ! -f "$PRODUCT_BROWSER_INDEX" ]; then
  echo '错误：ClawDSH 产品 runtime 或 browser assets 尚未构建。' >&2
  echo '请先运行：pnpm --dir packages/openclaw/preset-openclaw/product-shell run build' >&2
  exit 1
fi

echo "==> 2/4 复制 profile 模板到 $PROFILE_DIR"
mkdir -p "$PROFILE_DIR"
cp packages/openclaw/preset-openclaw/profile/cordis.patch.yml "$PROFILE_DIR/cordis.patch.yml"
cp packages/openclaw/preset-openclaw/profile/package.template.json "$PROFILE_DIR/package.json"

echo "==> 3/4 建立 @clawdsh 包 symlink（过渡，发布后移除）"
mkdir -p "$LINK_DIR"
for pkg in channel channel-agent channel-openclaw memory embeddings embeddings-ark skills-hub automation soul; do
  ln -sfn "$PWD/packages/openclaw/$pkg" "$LINK_DIR/dsh-$pkg"
  echo "    $LINK_DIR/dsh-$pkg -> packages/openclaw/$pkg"
done
ln -sfn "$PRODUCT_RUNTIME_DIR" "$LINK_DIR/dsh-product-runtime"
echo "    $LINK_DIR/dsh-product-runtime -> packages/openclaw/preset-openclaw/product-shell/runtime"

echo "==> 4/4 安装 owner 与 messaging-safe agent presets"
mkdir -p "$PRESET_DIR/souls" "$SAFE_PRESET_DIR/souls"
cp packages/openclaw/preset-openclaw/preset.yml "$PRESET_DIR/"
cp packages/openclaw/preset-openclaw/agent.cordis.yml "$PRESET_DIR/"
cp packages/openclaw/preset-openclaw/souls/assistant.md "$PRESET_DIR/souls/"
cp packages/openclaw/preset-clawdsh-messaging-safe/preset.yml "$SAFE_PRESET_DIR/"
cp packages/openclaw/preset-clawdsh-messaging-safe/agent.cordis.yml "$SAFE_PRESET_DIR/"
cp packages/openclaw/preset-clawdsh-messaging-safe/souls/assistant.md "$SAFE_PRESET_DIR/souls/"

echo '开发刷新完成。OpenClaw 平台凭据仍由 Gateway 管理；本脚本不读取或复制凭据。'
