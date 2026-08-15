# packages/openclaw — ClawDSH owned plugin domain

English | [中文](README.zh.md)

This directory is the **only place ClawDSH may freely rewrite code** (upstream discipline is in the root `AGENTS.md`).

## Why non-package directories have no package.json

Upstream's pnpm workspace and tsdown build both use `packages/*/*` as their glob, and tsdown's scan is **directory-granular**. Every implemented plugin therefore has its own manifest and Host project reference. The remaining non-package directories use a double guard:

1. **No `package.json` placed** → invisible to pnpm;
2. **Explicit tsdown exclusion** → root `tsdown.config.ts` excludes `_template/`, the intentionally unimplemented `channel-wechat/`, and the non-plugin `preset-openclaw/` assembly source.

When implementing a plugin, remove that package from the exclude list and wire it up per the template.

> The sole exception is `_template/`: it holds `.tpl` template files (no real `package.json`), and the whole directory is covered by the exclude list.

## Onboarding flow (when implementing a plugin)

1. Copy `_template/` to the target package directory, strip the `*.tpl` suffixes and fill in the blanks (follow the already-implemented `soul/` package, which is a complete example);
2. Write `docs/specs/feature-<name>.md` (feature spec);
3. Update `docs/matrix/parity.md` (parity matrix status column);
4. Register the build chain: a `tsconfig.base.json` paths entry + a `tsconfig.host.json` reference (or client aggregate, see `docs/development.md`), and remove an existing skeleton exclusion for that path;
5. **Must ship `src/invariant.ts`** (required by vitest's test-invariants, see the soul package), and package.json exports/files must include `./invariant`;
6. A new seam must first be registered in `docs/adr/` (see `docs/standards/plugin-contract.md`).

## Package roster

| Package | Positioning | OpenClaw counterpart | dsh seam | Status |
|---|---|---|---|---|
| `preset-openclaw/` | internal source for the `clawdsh` profile/preset plus the nested product-shell browser, Host runtime, and public-distribution build | overall assembly | public dsh Web/Host APIs and profile/patch mechanism | **product shell, writable Settings, and semantic Activity implemented** |
| `preset-openclaw/distribution/bundle/` | public ClawDSH composition bundle | managed product assets | dsh bundle patch and exact package dependencies | **`0.1.0-rc.1` candidate prepared; bootstrap required; unpublished** |
| `preset-openclaw/distribution/cli/` | managed installer, launcher, doctor, and explicit Channel installer | local product installation | exact dsh CLI dependency and managed filesystem assets | **`0.1.0-rc.1` candidate prepared; bootstrap required; unpublished** |
| `preset-clawdsh-messaging-safe/` | restricted preset for non-owner and group conversations | messaging safety policy | public Harness preset/tool composition | **implemented** |
| `channel/` | canonical platform-independent Channel Service Definition | Gateway channel contract | owned `ctx.channels` | **V1 implemented** (ADR-0008) |
| `channel-agent/` | canonical Harness Driver: admission, durable ledger, Session/Agent execution, and route-scoped tools | Agent bridge | `ctx.channels` plus public Harness services | **foundation implemented; certification incomplete** |
| `channel-openclaw/` | locked OpenClaw Gateway sidecar Provider and authenticated local RPC supervisor | Gateway runtime and channel plugin catalog | provider for `ctx.channels` | **foundation implemented; disabled and uncertified by default** |
| `channel-core/` | isolated pre-sidecar compatibility router | historical gateway seam | `ctx.legacyChannels` only | **legacy, private, and default-disabled** |
| `channel-telegram/` | in-process Telegram compatibility adapter | Telegram adapter | `ctx.legacyChannels` | **historical credentialed legacy evidence; private and default-disabled** |
| `channel-discord/` | in-process Discord compatibility adapter | Discord adapter | `ctx.legacyChannels` | **keyless legacy coverage only; private and default-disabled** |
| `channel-feishu/` | in-process Feishu compatibility adapter | Feishu adapter | `ctx.legacyChannels` | **historical credentialed legacy evidence; private and default-disabled** |
| `channel-wechat/` | historical non-package record; no native adapter | external `@tencent-weixin/openclaw-weixin@2.4.6` | only through locked `channel-openclaw` → `ctx.channels` | **cataloged, uncertified, and default-disabled; see parity matrix** |
| `soul/` | persona / Soul | Soul system | system-prompt assembly | **implemented** |
| `memory/` | Markdown fact source and semantic recall | Memory | `ctx.fs`, `ctx.tools`, system prompt, `ctx.embeddings` | **implemented** |
| `embeddings/` | text-embedding Service Definition | Memory embedding backends | owned `ctx.embeddings` (ADR-0003) | **implemented** |
| `embeddings-ark/` | Volcano Ark text-embedding provider | remote embedding provider | `ctx.embeddings` | **implemented** |
| `skills-hub/` | ClawHub-compatible skill loading | Skills / ClawHub | `ctx.skills` | **implemented** |
| `automation/` | scheduled Agent turns | Cron / Automation | `ctx.agents`, `ctx.sessions` | **implemented; disabled by default** |
| `activity/` | privacy-limited semantic Activity | ClawDSH-native observability | standard Session history plus optional `ctx.clawdshActivity` sidecars | **implemented; required in the product profile** |

The clean-install `clawdsh` profile keeps the canonical sidecar, the complete legacy compatibility group, every legacy adapter, and Automation disabled so the Web Host starts without external credentials. Settings and Activity remain available, while validated `enabled` fields control optional business effects. The canonical `ctx.channels` and private `ctx.legacyChannels` seams never alias each other; legacy opt-in makes canonical Gateway startup and Settings preflight fail loudly before side effects.

New channel work belongs in the locked OpenClaw provider/extension path. The legacy packages are retained only for migration and regression evidence; their live tests do not certify the sidecar implementation.

## Public release set

The public release allowlist is exactly 13 packages at `0.1.0-rc.1`: `@clawdsh/dsh-soul`, `@clawdsh/dsh-embeddings`, `@clawdsh/dsh-embeddings-ark`, `@clawdsh/dsh-memory`, `@clawdsh/dsh-skills-hub`, `@clawdsh/dsh-automation`, `@clawdsh/dsh-channel`, `@clawdsh/dsh-channel-agent`, `@clawdsh/dsh-channel-openclaw`, `@clawdsh/dsh-activity`, `@clawdsh/dsh-preset-messaging-safe`, `@clawdsh/dsh-bundle`, and `@clawdsh/cli`. The first eleven are the ClawDSH dsh package family; the bundle and CLI complete the managed public distribution. The machine-readable order lives in [`release-contract.mjs`](preset-openclaw/distribution/release-tools/release-contract.mjs); the four legacy channel packages and the nested product runtime are not public packages.

The release tooling builds real tarballs, converts owned `workspace:` relations to exact `0.1.0-rc.1` dependencies, rejects local protocols, symlinks, undeclared files, and private registry URLs, and exercises the packages through a temporary registry and isolated dsh home. The current registry state is `bootstrap-required`, not `OIDC-ready`: none of the thirteen names exists, so a separately authorized interactive 2FA publication must create them before per-package npm trust can be configured; staged publishing cannot create a brand-new package. After creation, every trust record must match `clawdsh-publish.yml`, GitHub environment `npm`, and `npm publish`; that environment must admit only branch `clawdsh`, and release readiness requires `refs/heads/clawdsh`. [ADR-0009](../../docs/adr/0009-public-npm-distribution.md) owns the bootstrap and publication conditions. This repository does not perform the bootstrap, change repository visibility, configure trust, or publish the candidate.
