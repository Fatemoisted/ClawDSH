# packages/openclaw — ClawDSH owned plugin domain

English | [中文](README.zh.md)

This directory is the **only place ClawDSH may freely rewrite code** (upstream discipline is in the root `AGENTS.md`).

## Directory layout

Every directory here is a **publishable npm package**: the workspace-constraints gate requires each `packages/openclaw/*` to carry a manifest with `publishConfig.access: public` and a `repository` field, so non-package material lives outside this tree:

- `tools/openclaw-plugin-template/` — the `.tpl` skeleton for new plugins;
- `tools/openclaw-preset-openclaw/` — the openclaw assembly (agent preset + profile template), installed by `tools/link-openclaw.sh`;
- `docs/specs/feature-channel-wechat.md` — the WeChat-family exclusion decision record.

## Onboarding flow (when implementing a plugin)

1. Copy `tools/openclaw-plugin-template/` to the target package directory, strip the `*.tpl` suffixes and fill in the blanks (follow the already-implemented `soul/` package, which is a complete example);
2. Write `docs/specs/feature-<name>.md` (feature spec);
3. Update `docs/matrix/parity.md` (parity matrix status column);
4. Register the build chain in the **openclaw aggregate**: the package's own tsconfig (extends `../../tsconfig.base.json`, references each workspace dependency) plus a `{ "path": ... }` entry in `packages/openclaw/tsconfig.json`. openclaw packages deliberately stay **out** of the upstream `tsconfig.host.json` — the cordis-catalog gate is fail-closed over the host face (see the comments in both files). Test typechecking runs through `packages/openclaw/tsconfig.check.json`, which globs `*/tests/**` and redirects the vendored paths to their built `lib/types`;
5. **Must ship `src/invariant.ts`** (required by vitest's test-invariants, see the soul package), and package.json exports/files must include `./invariant`;
6. A new seam must first be registered in `docs/adr/` (see `docs/standards/plugin-contract.md`).

## Package roster

| Package | Positioning | OpenClaw counterpart | dsh seam | Status |
|---|---|---|---|---|
| `channel-core/` | durable channel gateway | channel Gateway | **new** `ctx.channels` + Harness agents/presets/persistence/timer | **implemented** (awaited durability, deterministic resume, FIFO, legacy address compatibility, `groupMode`/structured-mention + ack policy ✅) |
| `channel-telegram/` | Telegram channel | channel adapter | `ctx.channels` + grammY | **implemented** (commands/mentions/captions/topics/replies/reactions, Unicode-safe 4096 splitting ✅; live e2e needs credentials) |
| `channel-feishu/` | Feishu channel (**initiator first priority**) | OpenClaw `extensions/feishu` | `ctx.channels` + official SDK `LarkChannel` | **implemented** (rich normalization, identity backoff, topic-safe replies, failed-handshake cleanup ✅; prior text e2e passed) |
| `soul/` | persona / Soul | Soul system | system-prompt assembly | **implemented** (phase 0 ✅ + phase 2 deep-read finalized ✅) |
| `memory/` | memory (Markdown fact source + semantic recall) | Memory (v2026.1.15) | Harness `ctx.fs` + sandbox policy + tools/system prompt + embeddings | **implemented** (safe append, configured recall defaults, missing-root startup, durable flush cycle ✅) |
| `embeddings/` | text-embedding seam (Service Definition) | choose one of memory's embeddings backends | **new** `ctx.embeddings` (ADR-0003) | **implemented** (phase 2 gap-fill ✅) |
| `embeddings-ark/` | Volcano Ark text-embedding provider | openai-remote branch slot | `ctx.embeddings` | **implemented** (phase 2 gap-fill ✅, e2e pending credentials) |
| `skills-hub/` | ClawHub-compatible skill loading | Skills/ClawHub | Harness `ctx.skills` provider | **implemented** (phase 3 ✅) |
| `automation/` | scheduled durable agent turns | Cron/Automation | Harness agents/sessions/persistence/model selection | **implemented** (phase 3 ✅; config-declared rules) |

The channel list is not limited to Telegram: WhatsApp, Email, Web Chat, and others are added one by one following the same template (one package per channel, mutually non-blocking).

## Release status

All nine packages form the independent `clawdsh` release family: they share one version and `clawdsh-v*` tag without being coupled to the root dsh or vendor versions. The bump/verify/pack/publish scripts, synchronized profile ranges, workspace constraints, pack artifacts, fresh packed-install verification for the main and invariant paths, and `.github/workflows/clawdsh-publish.yml` are implemented. Pull requests and `clawdsh` pushes can build and verify tarballs without registry credentials; publication to the private registry configured by the protected `npm-publish` environment's `NPM_REGISTRY_URL` variable is a protected manual action from a `clawdsh-v*` tag.

No ClawDSH npm publication has been executed from this worktree yet. Local development therefore continues to use `tools/link-openclaw.sh` and its profile symlinks until a release is deliberately published.
