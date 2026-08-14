# packages/openclaw — ClawDSH owned plugin domain

English | [中文](README.zh.md)

This directory is the **only place ClawDSH may freely rewrite code** (upstream discipline is in the root `AGENTS.md`).

## Why the skeleton directory has no package.json

Upstream's pnpm workspace and tsdown build both use `packages/*/*` as their glob, and tsdown's scan is **directory-granular** (a directory without a package.json resolves upward to the root package and reports `Cannot find entry`). The skeleton stage therefore uses a double guard:

1. **No `package.json` placed** → invisible to pnpm;
2. **Explicit tsdown exclusion** → the root `tsdown.config.ts` workspace `exclude` list contains `packages/openclaw/**` (see ADR-0001 decision 4's build-orchestration exemption).

When implementing a plugin, remove that package from the exclude list and wire it up per the template.

> The sole exception is `_template/`: it holds `.tpl` template files (no real `package.json`), and the whole directory is covered by the exclude list.

## Onboarding flow (when implementing a plugin)

1. Copy `_template/` to the target package directory, strip the `*.tpl` suffixes and fill in the blanks (follow the already-implemented `soul/` package, which is a complete example);
2. Write `docs/specs/feature-<name>.md` (feature spec);
3. Update `docs/matrix/parity.md` (parity matrix status column);
4. Register the build chain: a `tsconfig.base.json` paths entry + a `tsconfig.host.json` reference (or client aggregate, see `docs/development.md`), and remove it from the root `tsdown.config.ts` exclude list;
5. **Must ship `src/invariant.ts`** (required by vitest's test-invariants, see the soul package), and package.json exports/files must include `./invariant`;
6. A new seam must first be registered in `docs/adr/` (see `docs/standards/plugin-contract.md`).

## Package roster

| Package | Positioning | OpenClaw counterpart | dsh seam | Status |
|---|---|---|---|---|
| `preset-openclaw/` | openclaw profile + bundles + patches | overall assembly | profile/patch mechanism | **implemented** (phase 2 ✅) |
| `channel-core/` | channel gateway seam | channel gateway Gateway | **new** `ctx.channels` (ADR-0002) | **implemented** (phase 2 ✅) |
| `channel-telegram/` | Telegram channel | channel adapter | `ctx.channels` | **implemented** (phase 2 ✅, e2e pending credentials) |
| `channel-feishu/` | Feishu channel (**initiator first priority**) | OpenClaw `extensions/feishu` (since v2026.2.12) | `ctx.channels` | **implemented** (phase 2 ✅, real e2e passed) |
| `channel-wechat/` | WeChat family — **decision record: not implemented** (no upstream counterpart) | — | — | excluded on principle |
| `soul/` | persona / Soul | Soul system | system-prompt assembly | **implemented** (phase 0 ✅ + phase 2 deep-read finalized ✅) |
| `memory/` | memory (Markdown fact source + semantic recall) | Memory (v2026.1.15) | `ctx.fs` + `ctx.tools` + system-prompt section + `ctx.get('embeddings')` | **implemented** (phase 2 gap-fill ✅) |
| `embeddings/` | text-embedding seam (Service Definition) | choose one of memory's embeddings backends | **new** `ctx.embeddings` (ADR-0003) | **implemented** (phase 2 gap-fill ✅) |
| `embeddings-ark/` | Volcano Ark text-embedding provider | openai-remote branch slot | `ctx.embeddings` | **implemented** (phase 2 gap-fill ✅, e2e pending credentials) |
| `skills-hub/` | ClawHub-compatible skill loading | Skills/ClawHub | `ctx.skills` | planning |
| `automation/` | scheduled tasks / automation | Cron/Automation | `ctx.schedule` / `ctx.jobs` | planning |

The channel list is not limited to Telegram: WhatsApp, Email, Web Chat, and others are added one by one following the same template (one package per channel, mutually non-blocking).
