# @clawdsh/dsh-preset-openclaw

English | [中文](README.zh.md)

**Positioning**: ClawDSH's assembly layer — composes dsh's existing capabilities with the `packages/openclaw/*` plugins into an "OpenClaw-shaped" personal assistant. Modifies no upstream code; only overlays via dsh's profile / bundle / preset / patch mechanisms.

**OpenClaw counterpart**: the overall product shape (the default combination of gateway + channels + soul + memory + automation).

**Seam**: not a plugin, an assembly config. This directory now delivers three things:
1. **agent preset** (`preset.yml` + `agent.cordis.yml`) — mounts the `@clawdsh/dsh-soul` row, discoverable by dsh's agent-presets discovery (the user preset root is `.agent-presets/`);
2. **example soul** (`souls/assistant.md`);
3. **profile template** (`profile/`) — copying it to `$DSH_HOME/profiles/openclaw/` makes it the assembly base of `--profile openclaw` (bundles: `dsh-base`, the resident daemon; no `dsh-headless`, which is the one-shot task runner).

**Spec**: docs/specs/roadmap.md (phase 0/2 deliverables) · **Status**: locally assembled with keyless coverage and a prior Feishu text e2e; npm publication has not been executed

## Verified assembly

- ✅ (phase 0) soul row mount semantics in agent scope — covered by 10 contract tests in `../../packages/openclaw/soul/tests/soul.spec.ts`;
- ✅ (phase 0) profile parsing and layering — `pnpm dsh --profile openclaw --dump-config` resolves once `DSH_HOME` points at a directory containing this template profile;
- ✅ channel-row wiring — `profile/cordis.patch.yml` `insert`s `channel-core`, Telegram, Feishu, and Discord; `channel-core` + Feishu are enabled, while Telegram and Discord stay `disabled: true` until explicitly configured;
- ✅ (phase 2) Feishu real e2e — official SDK `LarkChannel` WebSocket inbound → `channel-core` durable conversation/topic turn → DeepSeek reply → SDK outbound, user confirmed receipt in Feishu;
- ✅ (phase 2 catch-up) memory-row wiring — `profile/cordis.patch.yml` `insert`s `memory` (root defaults to `dshHomePath('memory')`) + `embeddings-ark` (**enabled**: missing ARK_API_KEY is invisible at boot, only fails loud on a `memory_search` call; key in root `.env` or `$DSH_HOME/.env`);
- ✅ (phase 2 wrap-up) soul file path resolved relative to the preset directory — relative `source` resolves against the mounted tree's `ctx.baseUrl`; `agent.cordis.yml` now uses `source: ./souls/assistant.md`;
- ✅ Harness-native per-channel agents — `channel-core` derives a durable opaque session id, resumes it through `sessionPersistence`, and resolves/mounts the recorded `openclaw` composition through `dsh-agent-presets` on both create and resume;
- ✅ Feishu/Telegram/Discord channel behavior — channel-core exposes a durable, failure-propagating `ctx.parallel` route and drains admitted turns on shutdown; structured mentions, native replies/topics/threads, acknowledgement reactions, Unicode-safe provider-sized chunks, SDK-owned transport retry, and process-restart session continuity are covered by keyless contract tests;
- ✅ memory writes and host edits — `memory_append` is the only extra model write capability and delegates storage/sandbox enforcement to Harness `ctx.fs`, without widening ordinary file or shell tools; the host watcher invalidates only changed index entries, missing first-run roots are empty until append creates them, and flush-cycle ownership survives a memory-plugin remount;
- ✅ symlink transition scripted — `tools/link-openclaw.sh` builds all ten packages, installs the profile plus `.agent-presets/openclaw`, initializes the memory directory, creates 10 `@clawdsh/*` links, and bridges the Harness `dsh-agent-presets` package for a repository checkout;
- ✅ independent private-registry release line — the ten packages share the `clawdsh` family version/tag; synchronized bump/verify/pack/publish, packed-install verification, and credential-isolated workflows read the registry URL only from the protected `npm-publish` environment's `NPM_REGISTRY_URL` variable (ADR-0004);
- ⏳ (phase 3) headless one-shot task shape mounting the openclaw preset (the Feishu daemon already verifies the preset+agent composition; headless preset selection wiring deferred to phase 3);
- ⏳ actual npm publication — no `@clawdsh/*` tarball has been deliberately published from this worktree yet, so the symlink path remains the local-development transition.

## Current deployment limits

- The default profile is a resident Feishu daemon. It does not start the Web UI or mount the OpenClaw preset into the headless one-shot runner.
- `tools/link-openclaw.sh` refreshes the installed profile and creates symlinks bound to the current checkout; use the same `DSH_HOME` when linking and running.
- Provider-specific credential, lifecycle, and deployed-E2E limits are maintained by the [Telegram](../../packages/openclaw/channel-telegram/README.md), [Discord](../../packages/openclaw/channel-discord/README.md#known-limitations-and-deferred-work), and [Feishu](../../packages/openclaw/channel-feishu/README.md) package READMEs. Automation remains disabled by default; review its [package limitations](../../packages/openclaw/automation/README.md#known-limitations-and-deferred-work) before enabling rules.

## Usage (Feishu daemon, local development)

```bash
# Build and refresh the profile, agent preset, and local package links.
tools/link-openclaw.sh

# Supply credentials through the environment; never commit them.
export FEISHU_APP_ID=cli_xxx
export FEISHU_APP_SECRET=xxx
export DEEPSEEK_API_KEY=sk-xxx

# Start the resident channel daemon.
pnpm dsh --profile openclaw
```

Once the `@clawdsh/*` packages are published to the private registry (ADR-0004), the symlink step above is optional: install them declaratively with `dsh plugin --profile openclaw add @clawdsh/dsh-<pkg>` (one per package) — the user-facing path. The symlink script remains the pre-publish development path.

Config validation fails loud (with `appId`/`appSecret` required) when `FEISHU_APP_ID` / `FEISHU_APP_SECRET` are unset. After startup, the SDK reports identity/connection failures through the channel log; live platform permissions still need a credentialed deployment check.
