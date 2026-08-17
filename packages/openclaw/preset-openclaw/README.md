# ClawDSH source assembly

English | [中文](README.zh.md)

This directory is the source-development assembly for the ClawDSH application. It combines public dsh bundles, a private development bundle, owned feature packages, two Agent presets, the nested product browser/runtime, and an optional OpenClaw communication plane without modifying upstream source. The physical `preset-openclaw` name is an internal repository exception; installed ids and product copy use `clawdsh`.

End-user npm installation, upgrade, migration, and recovery belong to the [`@clawdsh/cli` reference](distribution/cli/README.md). Product configuration and credentials belong to the [root user guide](../../../README.md#configuration-and-data). This page covers a fresh source checkout and advanced Gateway assembly only.

## Fresh checkout

Use Node.js `22.19.x` or `>=24.0.0` and the repository's pnpm version:

```sh
git clone https://github.com/Fatemoisted/ClawDSH.git
cd ClawDSH
pnpm install
pnpm run build
pnpm --dir packages/openclaw/preset-openclaw/product-shell install --frozen-lockfile
pnpm --dir packages/openclaw/preset-openclaw/product-shell run build
tools/run-clawdsh-dev.sh
```

The nested product shell has its own lockfile because it stays outside the root workspace and Client aggregate. `tools/link-clawdsh.sh` requires both `product-shell/runtime/lib/index.mjs` and `product-shell/runtime/web/index.html`; if either is absent, it exits with the exact product-shell build command.

The wrapper refreshes the source profile, exports its development home as `DSH_HOME`, and starts `pnpm dsh --profile clawdsh`. New Web Sessions use the `clawdsh` preset shown as `ClawDSH 模式`; `clawdsh-messaging-safe` remains the restricted Channel preset. The Web Host starts without a model, Ark, or platform credential. A model key is required only when a conversation makes a model-backed request.

To use another isolated development directory or Web port:

```sh
CLAWDSH_DEV_HOME=/absolute/path/to/clawdsh-dev tools/run-clawdsh-dev.sh --port 3090
```

`CLAWDSH_DEV_HOME` defaults to `~/.clawdsh-dev`. The source tools never fall back to `DSH_HOME`, so a normal public home at `~/.dsh` can coexist with source development.

## Development-home ownership

The source installer writes `.clawdsh-dev.json` schema v1 and owns only the recorded development profile, package symlinks, and two presets. The marker records the repository root, profile and private-bundle integrity, exact home-relative link targets, and preset digests. A public `.clawdsh.json` marker in the selected development home causes an immediate refusal, as do unmarked same-name assets or a marker with an unknown schema or inventory.

The profile has three bundle layers in order:

1. `@deepseek-ai/dsh-base`;
2. `@deepseek-ai/dsh-web-app`;
3. private `@clawdsh/dsh-dev-bundle`.

The private bundle carries ClawDSH product composition and source package dependencies. `$CLAWDSH_DEV_HOME/profiles/clawdsh/cordis.patch.yml` is the user layer: the first install creates the checked empty file, and later refreshes preserve its bytes. The source installer never writes product composition into that user patch.

Package entries below `$CLAWDSH_DEV_HOME/profiles/node_modules/@clawdsh/` are symlinks into one checkout. The two presets are managed copies. A refresh updates unmodified presets and links, but it refuses a user-modified preset, profile manifest, or managed link. Preserve modified development-owned assets explicitly before refresh:

```sh
tools/link-clawdsh.sh --backup-modified
tools/run-clawdsh-dev.sh
```

The first command copies the current development profile, both presets, and link evidence into the owner-only `$CLAWDSH_DEV_HOME/.clawdsh-dev-backups/source-<timestamp>-<digest>/` directory before replacement. It does not copy Settings, credentials, Sessions, Memory, Skills, Activity, or OpenClaw state. Source refresh and public source-to-managed migration are separate lifecycles; use [`clawdsh migrate source`](distribution/cli/README.md#source-installation-migration) only for a historical source-linked layout found in the public `$DSH_HOME`.

## Assembly contents

The source assembly supplies:

- the `clawdsh` Agent preset (`preset.yml`, `agent.cordis.yml`, and `souls/assistant.md`);
- the `clawdsh` profile template and private development bundle;
- the nested browser shell and `@clawdsh/dsh-product-runtime` serving `/clawdsh/` while leaving native Harness at `/`;
- the always-mounted Soul, Memory, Skills, Activity, Automation, Channel Service Definition, Agent Bridge, and OpenClaw Gateway plugins;
- locked OpenClaw host, runtime, bridge, support-catalog, and governance inputs used by explicit Gateway setup.

Memory, Skills Hub, and Activity are enabled. Automation and OpenClaw Gateway are disabled. Ark resolves `ARK_API_KEY` only for an embedding call. The Gateway performs no artifact check, socket bind, process launch, or Provider registration while disabled. OpenClaw remains the only owner of platform accounts, credentials, policy, and state.

The checked Channel catalog is conservative. A catalog entry does not mean Telegram, Feishu, Discord, or another platform is installable, certified, enabled, or supported, and the source assembly ships no direct platform adapter.

## Advanced Gateway assembly

The managed user path is `clawdsh channel install` followed by `clawdsh channel doctor`. Source deployments may instead provision the same immutable inputs explicitly. Before enabling the Gateway, prepare all of these as ordinary files and directories:

- a compatible Node executable;
- the checked production OpenClaw tarball at its locked SHA-512;
- the exact npm runtime tree with lifecycle scripts disabled;
- the stable ClawDSH bridge;
- an isolated state directory and fail-closed OpenClaw configuration.

The Provider never downloads, installs, or updates those assets at runtime. Configure their paths before starting the source profile:

```sh
export CLAWDSH_OPENCLAW_TRACK=production
export CLAWDSH_OPENCLAW_GATEWAY_INSTANCE_ID=personal-gateway
export CLAWDSH_OPENCLAW_ARTIFACT_PATH=/srv/clawdsh/openclaw/openclaw.tgz
export CLAWDSH_OPENCLAW_RUNTIME_ROOT=/srv/clawdsh/openclaw/runtime
export CLAWDSH_OPENCLAW_HOST_ROOT=/srv/clawdsh/openclaw/runtime/node_modules/openclaw
export CLAWDSH_OPENCLAW_STATE_DIR=/srv/clawdsh/openclaw/state
export CLAWDSH_OPENCLAW_CONFIG_PATH=/srv/clawdsh/openclaw/state/openclaw.json
export CLAWDSH_OPENCLAW_STAGING_ROOT=/srv/clawdsh/openclaw/state/staging
export CLAWDSH_OPENCLAW_ENDPOINT=/srv/clawdsh/openclaw/state/clawdsh.sock
export CLAWDSH_CHANNEL_CWD=/srv/clawdsh/workspace

tools/run-clawdsh-dev.sh
```

The default profile uses the WebUI process's Node executable for the Gateway. Set `CLAWDSH_OPENCLAW_NODE_PATH` only to select a separately verified compatible executable. The npm `10.9.7` pin is the deterministic runtime-assembly tool, not a second Node runtime.

Keep platform accounts and credentials inside OpenClaw account setup and the isolated state. Keep DeepSeek and Ark keys in dsh credential sources. The IPC bearer token and startup nonce are generated per launch and are not operator configuration.

External OpenClaw Channel plugins are denied by default. A source deployment that separately verifies one passes an exact lock array through `CLAWDSH_OPENCLAW_EXTENSIONS_JSON`; the isolated npm project and OpenClaw installed-plugin index must match every lock entry before startup. An absent variable means `[]` and admits no external extension.

DM pairing grants ingress, not the owner preset. Because the managed OpenClaw configuration disables runtime config writes, list every human operator in `commands.ownerAllowFrom` with a Channel-qualified native id such as `feishu:<open_id>`. After changing the owner list, restart ClawDSH and send `/new` in the conversation. Owner direct messages then select `clawdsh`; non-owner and group conversations remain on `clawdsh-messaging-safe`.

Enable the Gateway only from ClawDSH Settings after the deployment identities pass preflight. A failed preflight leaves the stored setting and revision unchanged. Authentication, installability, and live platform behavior require separate evidence beyond a healthy local Gateway–Bridge handshake.

## Source verification

Run the nested product checks after browser, runtime, profile, or brand changes:

```sh
pnpm --dir packages/openclaw/preset-openclaw/product-shell run typecheck
pnpm --dir packages/openclaw/preset-openclaw/product-shell run test
pnpm --dir packages/openclaw/preset-openclaw/product-shell run build
tools/link-clawdsh.sh
```

The final refresh proves that the real built runtime and browser assets exist and that the selected development home remains a recognized source-managed layout. Public tarball and clean-install verification belong to the distribution release tools, not this source assembly.
