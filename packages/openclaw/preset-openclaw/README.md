# ClawDSH assembly

English | [中文](README.zh.md)

This directory is ClawDSH's application assembly. It composes public dsh capabilities with owned packages through profile, bundle, preset, patch, and nested-build mechanisms without modifying upstream source. The physical `preset-openclaw` directory name remains a narrow repository exception; installed ids and product copy use `clawdsh`.

The directory is not a Cordis plugin. It supplies:

1. the `clawdsh` Agent preset (`preset.yml`, `agent.cordis.yml`, and `souls/assistant.md`), displayed as `ClawDSH 模式`;
2. the `clawdsh` profile template (`profile/`), which composes dsh base and Web bundles with ClawDSH Host plugins;
3. the ClawDSH product shell, Control Runtime, Settings, and Activity nested build as those increments land;
4. the development installation source consumed by `tools/link-clawdsh.sh`.

The OpenClaw Gateway is an external communication-plane provider inside this product. It does not define the product, profile, or Agent preset identity.

## Local development

Install or refresh the profile, owned package links, and both Agent presets:

```bash
tools/link-clawdsh.sh
pnpm dsh --profile clawdsh
```

New Web Sessions default to the `clawdsh` preset shown as `ClawDSH 模式`. The restricted channel preset is installed as `clawdsh-messaging-safe`. A model credential is needed only when a conversation makes a model request; the Web Host itself starts without external credentials.

`tools/link-clawdsh.sh` warns when it finds legacy `openclaw` profile or preset assets and leaves them untouched. It creates no compatibility alias and does not delete, move, rewrite, or adopt user data. Review any legacy `agent-presets.default` override before removing an old preset that saved Sessions may still reference.

## Communication plane

The `clawdsh-communication-plane` group is disabled unless `CLAWDSH_OPENCLAW_CHANNELS_ENABLED=1`. When enabled, it mounts the complete current seam in this order:

1. `@clawdsh/dsh-channel`, the platform-independent Service Definition;
2. `@clawdsh/dsh-channel-agent`, the durable Agent Driver and route-scoped `message` tool;
3. `@clawdsh/dsh-channel-openclaw`, the authenticated IPC Provider and locked Gateway supervisor.

No channel is enabled by the template. The legacy in-process Telegram and Feishu packages are absent from the active profile, and external extension selection defaults to empty. OpenClaw remains the only owner of platform credentials; this profile neither reads nor copies them. Never connect a legacy adapter and the OpenClaw communication plane to the same platform account.

The Provider's configuration, artifact checks, admission defaults, and runtime limitations are documented in the [channel-openclaw README](../channel-openclaw/README.md). The checked support catalog is conservative: presence in OpenClaw's catalog does not mean a channel is installable, certified, or enabled. [ADR-0008](../../../docs/adr/0008-openclaw-channel-plane.md) owns the architecture and replacement conditions.

### Sidecar opt-in

The OpenClaw release artifact and checked npm runtime must be assembled before startup. The Provider never downloads, installs, or updates them at runtime.

```bash
export CLAWDSH_OPENCLAW_CHANNELS_ENABLED=1
export CLAWDSH_OPENCLAW_TRACK=production
export CLAWDSH_OPENCLAW_GATEWAY_INSTANCE_ID=personal-gateway
export CLAWDSH_OPENCLAW_ARTIFACT_PATH=/srv/clawdsh/openclaw/openclaw-2026.7.1-2.tgz
export CLAWDSH_OPENCLAW_RUNTIME_ROOT=/srv/clawdsh/openclaw/runtime
export CLAWDSH_OPENCLAW_HOST_ROOT=/srv/clawdsh/openclaw/runtime/node_modules/openclaw
export CLAWDSH_OPENCLAW_NODE_PATH=/srv/clawdsh/node/bin/node
export CLAWDSH_OPENCLAW_STATE_DIR=/srv/clawdsh/openclaw/state
export CLAWDSH_OPENCLAW_CONFIG_PATH=/srv/clawdsh/openclaw/state/openclaw.json
export CLAWDSH_OPENCLAW_STAGING_ROOT=/srv/clawdsh/openclaw/state/staging
export CLAWDSH_OPENCLAW_ENDPOINT=/srv/clawdsh/openclaw/state/clawdsh.sock
export CLAWDSH_CHANNEL_CWD=/srv/clawdsh/workspace
export DEEPSEEK_API_KEY=sk-xxx

pnpm dsh --profile clawdsh
```

Keep platform credentials in OpenClaw's isolated state and account setup. Keep model and tool credentials in dsh credential sources. The IPC bearer token and startup nonce are generated per launch and are not operator configuration.

To inventory legacy adapter references and credential names without copying secret values, run:

```bash
pnpm exec tsx tools/openclaw-channel-migration.ts --input /absolute/path/to/old-profile-or-env
```

Leaving `CLAWDSH_OPENCLAW_CHANNELS_ENABLED` unset starts the Web profile without the communication sidecar. When enabled, admitted owner direct messages use `clawdsh`; every non-owner or group conversation uses `clawdsh-messaging-safe`.

## Clean-install defaults

Memory and Skills Hub remain enabled. Ark Embeddings resolves `ARK_API_KEY` only when an embedding call needs it. Automation and the complete communication-plane group remain disabled. Disabled capabilities may omit credentials; an enabled capability fails at its earliest validation point when required configuration is absent.

Optional features temporarily use Loader `disabled` rows. The Settings control-plane increment keeps business plugins mounted and moves user control to validated `enabled` settings with desired and runtime revisions, restart requirements, and credential references.

## Product shell target

[ADR-0007](../../../docs/adr/0007-clawdsh-local-gui-product.md) and the [local GUI spec](../../../docs/specs/feature-gui-web.md) define the product shell. `/clawdsh/` owns Conversation, ClawDSH Settings, ClawDSH Activity, and Harness Advanced; `/` retains native dsh Web. Conversation reuses the public dsh client graph and renderer, while ClawDSH owns its outer shell and control pages.

The assembly does not register a new Client Slot and does not modify `api-proxy`, Client Catalog, Agent Loop, generated files, or upstream GUI source. Raw Trajectory remains in Harness Advanced, and `dsh --profile web` remains a pure Harness entry point.

## Managed-preset limitation

The presets currently live in dsh's user preset root because the launcher exposes no installation-owned ClawDSH preset root. The ClawDSH product Settings page will not offer deletion, but Harness Advanced still treats them as user presets. The public-distribution CLI owns the managed manifest, integrity checks, backup-before-reset, and `clawdsh doctor`; until then, rerunning the development installer restores checked-in preset files.

## Verification boundary

The locked production host, local IPC handshake, Provider and Driver ledgers, fail-closed model route, extension-integrity checks, and keyless protocol tests establish the current channel foundation. Real Telegram, Feishu, or other platform certification still requires dedicated accounts, current credentials, and recorded live-smoke evidence. Until that evidence exists, the profile keeps every channel disabled and the support catalog promotes none to `certified` or `enabled`.
