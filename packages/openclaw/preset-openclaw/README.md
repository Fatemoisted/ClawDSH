# ClawDSH assembly

English | [中文](README.zh.md)

This directory is ClawDSH's application assembly. It composes public dsh capabilities with owned packages through profile, bundle, preset, patch, and nested-build mechanisms without modifying upstream source. The physical `preset-openclaw` directory name remains a narrow repository exception; installed ids and product copy use `clawdsh`.

The directory is not a Cordis plugin. It supplies:

1. the `clawdsh` Agent preset (`preset.yml`, `agent.cordis.yml`, and `souls/assistant.md`), displayed as `ClawDSH 模式`;
2. the `clawdsh` profile template (`profile/`), which composes dsh base and Web bundles with ClawDSH Host plugins;
3. the nested ClawDSH browser shell and `@clawdsh/dsh-product-runtime`, with the capability overview, editable Settings control plane, and current-Session semantic Activity;
4. the development installation source consumed by `tools/link-clawdsh.sh`;
5. the nested public-distribution source for `@clawdsh/dsh-bundle`, `@clawdsh/cli`, and fail-closed release verification.

The OpenClaw Gateway is an external communication-plane provider inside this product. It does not define the product, profile, or Agent preset identity.

## Local development

Install or refresh the profile, owned package links, and both Agent presets:

```bash
pnpm --dir packages/openclaw/preset-openclaw/product-shell install --frozen-lockfile
pnpm --dir packages/openclaw/preset-openclaw/product-shell run build
tools/link-clawdsh.sh
pnpm dsh --profile clawdsh
```

New Web Sessions default to the `clawdsh` preset shown as `ClawDSH 模式`. The restricted channel preset is installed as `clawdsh-messaging-safe`. A model credential is needed only when a conversation makes a model request; the Web Host itself starts without external credentials.

The product shell has its own lockfile because it stays outside the root workspace and Client aggregate. Install that nested workspace before building it. The development installer requires `product-shell/runtime/lib/index.mjs` and `product-shell/runtime/web/index.html` to exist and fails with the exact build command when either artifact is absent. It links the nested runtime as `@clawdsh/dsh-product-runtime`, warns when it finds legacy `openclaw` profile or preset assets, and leaves them untouched. It creates no compatibility alias and does not delete, move, rewrite, or adopt user data. Review any legacy `agent-presets.default` override before removing an old preset that saved Sessions may still reference.

## Managed installation CLI

`@clawdsh/cli@0.1.0-rc.1` depends exactly on `@clawdsh/dsh-bundle@0.1.0-rc.1` and `@deepseek-ai/dsh@0.1.0-rc.6`.

After the publication conditions pass, the npm entry point is:

```bash
npx --yes @clawdsh/cli@0.1.0-rc.1
```

The installed command set is:

```text
clawdsh
clawdsh init
clawdsh init --reset-preset
clawdsh start
clawdsh start --profile <name>
clawdsh doctor
clawdsh channel install
clawdsh channel doctor
```

With no subcommand, the CLI performs an idempotent managed-profile initialization or upgrade and starts the ClawDSH GUI through its exact dsh dependency. `start` passes through `--host`, `--port`, and `--trusted-host`; a named custom profile is launched without adoption or mutation. Installation builds a complete staging candidate, verifies the bundle order `@deepseek-ai/dsh-base → @deepseek-ai/dsh-web-app → @clawdsh/dsh-bundle`, and atomically publishes the managed profile, presets, and runtime assets with a `.clawdsh.json` manifest. It preserves Settings, Credentials, Memory, Skills, OpenClaw state, and custom profile patches. An unmarked or modified preset blocks silent replacement; `--reset-preset` creates a timestamped, integrity-recorded backup before restoring the managed copy. An unmarked profile with the same name is never adopted, and legacy `openclaw` assets produce warnings without deletion.

Channel acquisition is separate from `init`. `clawdsh channel install` requires the running Node executable to satisfy the locked Gateway engine, accepts only the checked production track, downloads the exact OpenClaw artifact, verifies SHA-512 and every archive member, assembles the checked runtime with lifecycle scripts disabled, and creates a credential-free fail-closed configuration only when none exists. Existing OpenClaw configuration and state remain untouched, and canary stays audit-only. `clawdsh channel doctor` verifies managed identities and delegates the complete fail-closed configuration check to the installed Provider without selecting, returning, or printing platform credentials. The ordinary product install therefore remains small and starts with Gateway disabled even when no OpenClaw artifact exists.

## Communication plane

The profile always mounts the complete communication seam in this order:

1. `@clawdsh/dsh-channel`, the platform-independent Service Definition;
2. `@clawdsh/dsh-channel-agent`, the durable Agent Driver and route-scoped `message` tool;
3. `@clawdsh/dsh-channel-openclaw`, the authenticated IPC Provider and locked Gateway supervisor.

The same always-mounted communication group includes a package-filtered invariant registry plus the Service Definition, Agent, and Provider invariant companions. Enabled deployments therefore validate restored Channel provenance and each seam role's owned runtime relations.

Channel Protocol always provides the Service Definition, and Agent Bridge always registers its network-inert Driver. OpenClaw Gateway remains mounted with its validated `enabled` setting false, so it performs no artifact check, socket binding, process launch, or Provider registration. The legacy in-process Telegram and Feishu packages are absent from the active profile, and external extension selection defaults to empty. OpenClaw remains the only owner of platform credentials; this profile neither reads nor copies them. Never connect a legacy adapter and the OpenClaw communication plane to the same platform account.

The Provider's configuration, artifact checks, admission defaults, and runtime limitations are documented in the [channel-openclaw README](../channel-openclaw/README.md). The checked support catalog is conservative: presence in OpenClaw's catalog does not mean a channel is installable, certified, or enabled. [ADR-0008](../../../docs/adr/0008-openclaw-channel-plane.md) owns the architecture and replacement conditions.

### Managed Gateway deployment

The OpenClaw release artifact and checked npm runtime must be assembled before startup. The Provider never downloads, installs, or updates them at runtime.

```bash
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

The checked deployment paths form the installer-managed profile base and remain read-only in ClawDSH Settings. After the runtime is assembled, enable OpenClaw Gateway from the Settings page; the Host completes deployment preflight before persisting the change. A failed preflight leaves the setting and its revision unchanged. When enabled, admitted owner direct messages use `clawdsh`; every non-owner or group conversation uses `clawdsh-messaging-safe`.

## Clean-install defaults

Memory, Skills Hub, and Activity remain enabled. Activity is required and records only privacy-limited product semantics; its failure cannot block a business capability. Ark Embeddings resolves the fixed `ARK_API_KEY` credential reference only when an embedding call needs it. Automation and OpenClaw Gateway remain disabled. Disabled capabilities may omit credentials; an enabled capability fails at its earliest validation point when required configuration is absent.

Optional business plugins remain mounted and expose their Config schemas. Validated `enabled` settings control their runtime effects, while ClawDSH Settings displays desired and runtime revisions, restart requirements, field ownership, and secret-free credential state. Reset removes only the user layer and restores the profile base plus schema defaults.

## Product shell

[ADR-0007](../../../docs/adr/0007-clawdsh-local-gui-product.md) and the [local GUI spec](../../../docs/specs/feature-gui-web.md) define the product shell. `/clawdsh/` owns Conversation, ClawDSH Settings, ClawDSH Activity, and Harness Advanced; `/` retains native dsh Web. Conversation reuses the public dsh client graph and renderer. ClawDSH Settings combines capability health with allowlisted schema editing, optimistic revisions, managed Gateway deployment, Automation rules, and write-only dsh credential updates. Activity follows the current Session, merges standard history with bounded sidecars, and renders fixed privacy-safe Prompt, Memory, Channel, Skill, and Automation records with filtering and cursor pagination. Unknown product paths render an explicit not-found page instead of falling through to Harness.

The profile suppresses the native `dsh web:` readiness line and mounts `@clawdsh/dsh-product-runtime`. After the Loader settles, that runtime prints `clawdsh web: http://127.0.0.1:<port>/clawdsh/`, owns the product static routes, and leaves the stock fallback at `/` unchanged. The nested browser build writes assets into `product-shell/runtime/web/`; neither nested package enters the root workspace or Client aggregate.

The assembly does not register a new Client Slot and does not modify `api-proxy`, Client Catalog, Agent Loop, generated files, or upstream GUI source. Activity adds no upstream Session event type, Raw Trajectory remains in Harness Advanced, and `dsh --profile web` remains a pure Harness entry point. The [Activity specification](../../../docs/specs/feature-activity.md) owns its storage, privacy, and degradation behavior.

## Managed presets

The launcher exposes no installation-owned ClawDSH preset root, so both presets live in dsh's user preset root. The ClawDSH product Settings page does not offer preset deletion, but Harness Advanced still treats them as user presets. The CLI's managed manifest, integrity checks, backup-before-reset, and `clawdsh doctor` distinguish installed assets from ordinary user presets. The development installer remains a source-tree convenience and restores checked-in preset files without taking ownership of user data.

## Public packaging

The public candidate contains the exact [13-package release set](../README.md#public-release-set) at `0.1.0-rc.1`. `@clawdsh/dsh-bundle` carries the profile patch, primary preset, Control Runtime, built `/clawdsh/` assets, Channel locks and bridge notices, and exact dependencies on the ten runtime feature packages plus the restricted preset. Real tarball verification rejects `workspace:`, `file:`, symlinks, undeclared assets, private registry URLs, unexpected packages, and any dependency version outside the fixed release graph.

The release workflow targets only public npm and the `next` tag. A dry run packs and audits all 13 tarballs, publishes them in dependency order to a temporary loopback registry, and performs a clean installation in an isolated dsh home. The registry state remains `bootstrap-required`: npm trust and staged publishing both require an existing package, but none of the thirteen names exists. A separately authorized interactive 2FA bootstrap must create the package objects before all thirteen trust records can be bound to `clawdsh-publish.yml`, environment `npm`, and `npm publish`. OIDC readiness additionally requires the GitHub `npm` environment to admit only branch `clawdsh` and the workflow's exact `refs/heads/clawdsh` check to pass. This implementation does not choose or publish bootstrap artifacts, configure trust, change repository visibility, or publish the candidate; [ADR-0009](../../../docs/adr/0009-public-npm-distribution.md) owns the complete conditions.

## Verification boundary

The locked production host, local IPC handshake, Provider and Driver ledgers, fail-closed model route, extension-integrity checks, and keyless protocol tests establish the current channel foundation. Real Telegram, Feishu, or other platform certification still requires dedicated accounts, current credentials, and recorded live-smoke evidence. Until that evidence exists, the profile keeps every channel disabled and the support catalog promotes none to `certified` or `enabled`.
