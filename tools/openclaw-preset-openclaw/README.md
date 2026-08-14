# @clawdsh/dsh-preset-openclaw

English | [中文](README.zh.md)

**Positioning**: ClawDSH's assembly layer — composes dsh's existing capabilities with the `packages/openclaw/*` plugins into an "OpenClaw-shaped" personal assistant. Modifies no upstream code; only overlays via dsh's profile / bundle / preset / patch mechanisms.

**OpenClaw counterpart**: the overall product shape (the default combination of gateway + channels + soul + memory + automation).

**Seam**: not a plugin, an assembly config. This directory now delivers three things:
1. **agent preset** (`preset.yml` + `agent.cordis.yml`) — mounts the `@clawdsh/dsh-soul` row, discoverable by dsh's agent-presets discovery (the user preset root is `.agent-presets/`);
2. **example soul** (`souls/assistant.md`);
3. **profile template** (`profile/`) — copying it to `$DSH_HOME/profiles/openclaw/` makes it the assembly base of `--profile openclaw` (bundles: `dsh-base`, the resident daemon; no `dsh-headless`, which is the one-shot task runner).

**Spec**: docs/specs/roadmap.md (phase 0/2 deliverables) · **Status**: locally assembled, e2e-verified, and release-ready; npm publication has not been executed

## Verified assembly

- ✅ (phase 0) soul row mount semantics in agent scope — covered by 10 contract tests in `../../packages/openclaw/soul/tests/soul.spec.ts`;
- ✅ (phase 0) profile parsing and layering — `pnpm dsh --profile openclaw --dump-config` resolves once `DSH_HOME` points at a directory containing this template profile;
- ✅ (phase 2) channel-row wiring — `profile/cordis.patch.yml` `insert`s the `channel-core` + `channel-telegram` + `channel-feishu` rows; `channel-core` + `channel-feishu` enabled (Feishu credentials via env), `channel-telegram` stays `disabled: true` (no account);
- ✅ (phase 2) Feishu real e2e — official SDK `LarkChannel` WebSocket inbound → `channel-core` durable conversation/topic turn → DeepSeek reply → SDK outbound, user confirmed receipt in Feishu;
- ✅ (phase 2 catch-up) memory-row wiring — `profile/cordis.patch.yml` `insert`s `memory` (root defaults to `dshHomePath('memory')`) + `embeddings-ark` (**enabled**: missing ARK_API_KEY is invisible at boot, only fails loud on a `memory_search` call; key in root `.env` or `$DSH_HOME/.env`);
- ✅ (phase 2 wrap-up) soul file path resolved relative to the preset directory — relative `source` resolves against the mounted tree's `ctx.baseUrl`; `agent.cordis.yml` now uses `source: ./souls/assistant.md`;
- ✅ Harness-native per-channel agents — `channel-core` derives a durable opaque session id, resumes it through `sessionPersistence`, and resolves/mounts the recorded `openclaw` composition through `dsh-agent-presets` on both create and resume;
- ✅ Feishu/Telegram channel behavior — channel-core exposes a durable, failure-propagating `ctx.parallel` route and drains admitted turns on shutdown; structured commands/mentions, native replies/topics, acknowledgement reactions, Unicode-safe long-reply chunks, caption/rich-message text, Telegram bounded API retry, and process-restart session continuity are covered by keyless contract tests;
- ✅ memory writes — `memory_append` is the only extra write capability and delegates storage/sandbox enforcement to Harness `ctx.fs`, without widening ordinary file or shell tools; missing first-run roots are empty until append creates them, and flush-cycle ownership survives a memory-plugin remount;
- ✅ symlink transition scripted — `tools/link-openclaw.sh` builds all nine packages, installs the profile plus `.agent-presets/openclaw`, initializes the memory directory, creates 9 `@clawdsh/*` links, and bridges the Harness `dsh-agent-presets` package for a repository checkout;
- ✅ independent release line — the nine packages share the `clawdsh` family version/tag; bump/verify/pack/publish, packed-install verification, and the protected `release-clawdsh` workflow are implemented;
- ⏳ (phase 3) headless one-shot task shape mounting the openclaw preset (the Feishu daemon already verifies the preset+agent composition; headless preset selection wiring deferred to phase 3);
- ⏳ actual npm publication — no `@clawdsh/*` tarball has been deliberately published from this worktree yet, so the symlink path remains the local-development transition.

## Usage (Feishu daemon, local development)

```bash
# 1. Build and refresh profile + agent preset + local package links
tools/link-openclaw.sh

# 2. 凭证走环境变量（不落盘；ARK_API_KEY 放根 .env 或 ~/.dsh/.env，永不入仓库）
export FEISHU_APP_ID=cli_xxx
export FEISHU_APP_SECRET=xxx
export DEEPSEEK_API_KEY=sk-xxx

# 3. 起 daemon（常驻长连接，等飞书消息）
pnpm dsh --profile openclaw
```

Config validation fails loud (with `appId`/`appSecret` required) when `FEISHU_APP_ID` / `FEISHU_APP_SECRET` are unset. After startup, the SDK reports identity/connection failures through the channel log; live platform permissions still need a credentialed deployment check.
