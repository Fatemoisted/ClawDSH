#!/usr/bin/env bash
# ClawDSH source-development installer. Usage: tools/link-clawdsh.sh [--backup-modified]
# CLAWDSH_DEV_HOME defaults to ~/.clawdsh-dev and never falls back to the public DSH_HOME.
set -euo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"

PRODUCT_SHELL_DIR="$REPOSITORY_ROOT/packages/openclaw/preset-openclaw/product-shell"
PRODUCT_RUNTIME_DIR="$PRODUCT_SHELL_DIR/runtime"
PRODUCT_RUNTIME_ENTRY="$PRODUCT_RUNTIME_DIR/lib/index.mjs"
PRODUCT_BROWSER_INDEX="$PRODUCT_RUNTIME_DIR/web/index.html"

echo '==> 校验 ClawDSH 产品 runtime 与 browser assets'
if [ ! -f "$PRODUCT_RUNTIME_ENTRY" ] || [ ! -f "$PRODUCT_BROWSER_INDEX" ]; then
  echo '错误：ClawDSH 产品 runtime 或 browser assets 尚未构建。' >&2
  echo '请先运行：pnpm --dir packages/openclaw/preset-openclaw/product-shell run build' >&2
  exit 1
fi

node "$REPOSITORY_ROOT/tools/clawdsh-dev-install.mjs" "$@"
echo '开发刷新完成。本脚本不读取或复制凭据。'
