#!/usr/bin/env bash
# Build-linked ClawDSH source launcher. All development state stays in CLAWDSH_DEV_HOME.
set -euo pipefail

CALLER_DIRECTORY="$PWD"
REPOSITORY_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"

if [ -z "${CLAWDSH_DEV_HOME+x}" ] || [ -z "${CLAWDSH_DEV_HOME//[[:space:]]/}" ]; then
  CLAWDSH_DEV_HOME_CANDIDATE="$HOME/.clawdsh-dev"
elif [ "$CLAWDSH_DEV_HOME" = '~' ]; then
  CLAWDSH_DEV_HOME_CANDIDATE="$HOME"
elif [[ "$CLAWDSH_DEV_HOME" = '~/'* ]]; then
  CLAWDSH_DEV_HOME_CANDIDATE="$HOME/${CLAWDSH_DEV_HOME#'~/'}"
elif [[ "$CLAWDSH_DEV_HOME" = /* ]]; then
  CLAWDSH_DEV_HOME_CANDIDATE="$CLAWDSH_DEV_HOME"
else
  CLAWDSH_DEV_HOME_CANDIDATE="$CALLER_DIRECTORY/$CLAWDSH_DEV_HOME"
fi
"$REPOSITORY_ROOT/tools/link-clawdsh.sh"
CLAWDSH_DEV_HOME_RESOLVED="$(cd "$CLAWDSH_DEV_HOME_CANDIDATE" && pwd -P)"
export DSH_HOME="$CLAWDSH_DEV_HOME_RESOLVED"
export TSX_TSCONFIG_PATH="$REPOSITORY_ROOT/tsconfig.json"
exec node \
  --import "$REPOSITORY_ROOT/node_modules/tsx/dist/esm/index.mjs" \
  "$REPOSITORY_ROOT/apps/cli/src/bin.ts" \
  --profile clawdsh \
  "$@"
