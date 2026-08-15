# packages/openclaw — ClawDSH owned plugin domain

English | [中文](README.zh.md)

This directory is the **only place ClawDSH may freely rewrite product code** (upstream discipline is in the root `AGENTS.md`). The [Harness reuse map](../../docs/matrix/harness-reuse.md) records how these packages use existing services, events, libraries, and platform SDKs.

## Directory layout

Every directory here is a **publishable npm package**: the workspace-constraints gate requires each `packages/openclaw/*` to carry a manifest with `publishConfig.access: public` and a `repository` field, so non-package material lives outside this tree:

- `tools/openclaw-plugin-template/` — the `.tpl` skeleton for new plugins;
- `tools/openclaw-preset-openclaw/` — the ClawDSH assembly (agent preset + profile template), installed by `tools/link-clawdsh.sh`;
- `docs/specs/feature-channel-wechat.md` — the WeChat-family exclusion decision record.

## Onboarding flow (when implementing a plugin)

1. Copy `tools/openclaw-plugin-template/` to the target package directory, strip the `*.tpl` suffixes and fill in the blanks (follow the already-implemented `soul/` package, which is a complete example);
2. Write `docs/specs/feature-<name>.md` (feature spec);
3. Update `docs/matrix/parity.md` (parity matrix status column);
4. Register the build chain in the **openclaw aggregate**: the package's own tsconfig (extends `../../tsconfig.base.json`, references each workspace dependency) plus a `{ "path": ... }` entry in `packages/openclaw/tsconfig.json`. openclaw packages deliberately stay **out** of the upstream `tsconfig.host.json` — the cordis-catalog gate is fail-closed over the host face (see the comments in both files). Test typechecking runs through `packages/openclaw/tsconfig.check.json`, which globs `*/tests/**` and redirects the vendored paths to their built `lib/types`;
5. **Must ship `src/invariant.ts`** (required by vitest's test-invariants, see the soul package), and package.json exports/files must include `./invariant`;
6. A new seam must first be registered in `docs/adr/` (see `docs/standards/plugin-contract.md`).

## Package roster

| Package | Positioning | OpenClaw counterpart | Integration boundary |
|---|---|---|---|
| [`channel-core/`](channel-core/README.md) | durable channel gateway | channel Gateway | ClawDSH `ctx.channels`; Harness agents/presets/persistence/timer |
| [`channel-telegram/`](channel-telegram/README.md) | Telegram channel | channel adapter | ClawDSH `ctx.channels`; Harness credentials/LLM/attachments/timer; grammY |
| [`channel-discord/`](channel-discord/README.md) | Discord channel | OpenClaw `src/discord/` | ClawDSH `ctx.channels`; Harness credentials/timer; discord.js |
| [`channel-feishu/`](channel-feishu/README.md) | Feishu channel (**initiator first priority**) | OpenClaw `extensions/feishu` | ClawDSH `ctx.channels`; Harness credentials/timer; official `LarkChannel` |
| [`soul/`](soul/README.md) | persona / Soul | Soul system | Harness system-prompt assembly and scope |
| [`memory/`](memory/README.md) | memory (Markdown fact source + semantic recall) | Memory (v2026.1.15) | Harness fs/sandbox/tools/system prompt; optional ClawDSH embeddings and Harness LLM lifecycle |
| [`embeddings/`](embeddings/README.md) | text-embedding Service Definition | choose one of memory's embeddings backends | ClawDSH `ctx.embeddings` (ADR-0003); Harness Cordis service base |
| [`embeddings-ark/`](embeddings-ark/README.md) | Volcano Ark text-embedding provider | openai-remote branch slot | ClawDSH `ctx.embeddings`; optional Harness credentials/launch environment |
| [`skills-hub/`](skills-hub/README.md) | ClawHub-compatible skill loading | Skills/ClawHub | Harness `ctx.skills` provider contract |
| [`automation/`](automation/README.md) | scheduled durable agent turns | Cron/Automation | Harness agents/sessions/model selection and optional persistence; croner/Node timer |

The non-package assembly at `tools/openclaw-preset-openclaw/` composes `dsh-base`, `dsh-web-app`, and these plugins into the `clawdsh` profile and `clawdsh` preset displayed as `ClawDSH 模式`. This stock dsh Web GUI baseline is implemented; the separate ClawDSH product shell, capability Settings, semantic Activity, and Harness Advanced route remain pending under [ADR-0007](../../docs/adr/0007-clawdsh-local-gui-product.md).

The clean-install `clawdsh` profile keeps Feishu, Telegram, Discord, and Automation disabled so the Web Host starts without channel or automation credentials. These defaults temporarily use Loader `disabled` rows; the capability Settings increment replaces them with business-level `enabled` fields.

The channel list is not limited to Telegram and Discord: WhatsApp, Email, Web Chat, and others are added one by one following the same template (one package per channel, mutually non-blocking).

Each linked package README owns its configuration, failure behavior, and known limitations. The [Harness reuse map](../../docs/matrix/harness-reuse.md) is the cross-package dependency view; the [feature matrix](../../docs/matrix/parity.md) owns completion status.

## Release status

All ten packages form the independent `clawdsh` release family: they share one version and `clawdsh-v*` tag without being coupled to the root dsh or vendor versions. The bump/verify/pack/publish scripts, synchronized profile ranges, workspace constraints, pack artifacts, fresh packed-install verification for the main and invariant paths, and `.github/workflows/clawdsh-publish.yml` are implemented. Pull requests and `clawdsh` pushes can build and verify tarballs without registry credentials; publication to the private registry configured by the protected `npm-publish` environment's `NPM_REGISTRY_URL` variable is a protected manual action from a `clawdsh-v*` tag.

No ClawDSH npm publication has been executed from this worktree yet. Local development therefore continues to use `tools/link-clawdsh.sh` and its profile symlinks until a release is deliberately published.
