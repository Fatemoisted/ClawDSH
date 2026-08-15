# packages/openclaw — ClawDSH owned plugin domain

English | [中文](README.zh.md)

This directory is the **only place ClawDSH may freely rewrite code** (upstream discipline is in the root `AGENTS.md`).

## Why the skeleton directory has no package.json

The pnpm workspace and tsdown build both use `packages/*/*` as their glob, and tsdown's scan is **directory-granular** (a directory without a package.json resolves upward to the root package and reports `Cannot find entry`). An unimplemented skeleton therefore uses a double guard:

1. **No `package.json` placed** → invisible to pnpm;
2. **Explicit tsdown exclusion** → the root `tsdown.config.ts` workspace `exclude` list names that skeleton path (see ADR-0001 decision 4's build-orchestration exemption).

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
| `preset-openclaw/` | internal source for the `clawdsh` profile, preset, product shell, and Control Runtime | overall assembly | profile, patch, and public dsh Web assembly | **implemented** |
| `preset-openclaw/distribution/bundle/` | public ClawDSH composition bundle | managed product assets | dsh bundle patch and exact package dependencies | **`0.1.0-rc.1` candidate prepared; bootstrap required; unpublished** |
| `preset-openclaw/distribution/cli/` | managed installer, launcher, doctor, and explicit Channel installer | local product installation | exact dsh CLI dependency and managed filesystem assets | **`0.1.0-rc.1` candidate prepared; bootstrap required; unpublished** |
| `preset-clawdsh-messaging-safe/` | restricted Channel Session preset | OpenClaw non-owner/group isolation | agent preset composition | **implemented** |
| `channel/` | provider-neutral Channel Service Definition | Gateway channel protocol | owned `ctx.channels` (ADR-0008) | **V1 implemented** |
| `channel-agent/` | durable Agent-plane Driver | Gateway-to-Agent execution | `ctx.channels`, Agents, Sessions, attachments | **foundation implemented; certification incomplete** |
| `channel-openclaw/` | locked OpenClaw communication Provider | Gateway and channel plugin catalog | `ctx.channels`, subprocess, storage | **foundation implemented; disabled by default** |
| `channel-wechat/` | historical unimplemented skeleton | — | — | excluded; availability is owned by the locked OpenClaw catalog |
| `soul/` | persona / Soul | Soul system | system-prompt assembly | **implemented** |
| `memory/` | Markdown fact source and semantic recall | Memory | `ctx.fs`, `ctx.tools`, system prompt, `ctx.embeddings` | **implemented** |
| `embeddings/` | text-embedding Service Definition | Memory embedding backends | owned `ctx.embeddings` (ADR-0003) | **implemented** |
| `embeddings-ark/` | Volcano Ark text-embedding provider | remote embedding provider | `ctx.embeddings` | **implemented** |
| `skills-hub/` | ClawHub-compatible skill loading | Skills / ClawHub | `ctx.skills` | **implemented** |
| `automation/` | scheduled Agent turns | Cron / Automation | `ctx.agents`, `ctx.sessions` | **implemented; disabled by default** |
| `activity/` | privacy-limited semantic Activity | ClawDSH-native observability | standard Session history plus optional `ctx.clawdshActivity` sidecars | **implemented; required in the product profile** |

The clean-install `clawdsh` profile always mounts each capability so Settings and health remain available. OpenClaw Gateway and Automation default to business-level `enabled: false`; no OpenClaw artifact, platform credential, or model key is required to start the Web Host. OpenClaw owns all platform adapters and credentials. ClawDSH ships no direct Telegram or Feishu adapter and no `ctx.legacyChannels` runtime.

## Public release set

The public release allowlist is exactly 13 packages at `0.1.0-rc.1`: `@clawdsh/dsh-soul`, `@clawdsh/dsh-embeddings`, `@clawdsh/dsh-embeddings-ark`, `@clawdsh/dsh-memory`, `@clawdsh/dsh-skills-hub`, `@clawdsh/dsh-automation`, `@clawdsh/dsh-channel`, `@clawdsh/dsh-channel-agent`, `@clawdsh/dsh-channel-openclaw`, `@clawdsh/dsh-activity`, `@clawdsh/dsh-preset-messaging-safe`, `@clawdsh/dsh-bundle`, and `@clawdsh/cli`. The machine-readable order lives in [`release-contract.mjs`](preset-openclaw/distribution/release-tools/release-contract.mjs); its denylist rejects the removed direct-adapter package names, and the nested product runtime is not a public package.

The release tooling builds real tarballs, converts owned `workspace:` relations to exact `0.1.0-rc.1` dependencies, rejects local protocols, symlinks, undeclared files, and private registry URLs, and exercises the packages through a temporary registry and isolated dsh home. The current registry state is `bootstrap-required`, not `OIDC-ready`: none of the thirteen names exists, so a separately authorized interactive 2FA publication must create them before per-package npm trust can be configured; staged publishing cannot create a brand-new package. After creation, every trust record must match `clawdsh-publish.yml`, GitHub environment `npm`, and `npm publish`; that environment must admit only branch `clawdsh`, and release readiness requires `refs/heads/clawdsh`. [ADR-0009](../../docs/adr/0009-public-npm-distribution.md) owns the bootstrap and publication conditions. This repository does not perform the bootstrap, change repository visibility, configure trust, or publish the candidate.
