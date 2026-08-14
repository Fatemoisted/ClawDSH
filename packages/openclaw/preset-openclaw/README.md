# @clawdsh/dsh-preset-openclaw

English | [中文](README.zh.md)

**Positioning**: ClawDSH's assembly layer — composes dsh's existing capabilities with the `packages/openclaw/*` plugins into an "OpenClaw-shaped" personal assistant. Modifies no upstream code; only overlays via dsh's profile / bundle / preset / patch mechanisms.

**OpenClaw counterpart**: the overall product shape (the default combination of gateway + channels + soul + memory + automation).

**Seam**: not a plugin, an assembly config. This directory now delivers three things:
1. **agent preset** (`preset.yml` + `agent.cordis.yml`) — mounts the `@clawdsh/dsh-soul` row, discoverable by dsh's agent-presets discovery (the user preset root is `.agent-presets/`);
2. **example soul** (`souls/assistant.md`);
3. **profile template** (`profile/`) — copying it to `$DSH_HOME/profiles/openclaw/` makes it the assembly base of `--profile openclaw` (bundles: `dsh-base`, the resident daemon; no `dsh-headless`, which is the one-shot task runner).

**Spec**: docs/specs/roadmap.md (phase 0/2 deliverables) · **Status**: phase-2 e2e-verified (Feishu message → personalized agent → reply, real loop verified)

## Phase 0 verified / Phase 2 pending

- ✅ (phase 0) soul row mount semantics in agent scope — covered by 10 contract tests in `../soul/tests/soul.spec.ts`;
- ✅ (phase 0) profile parsing and layering — `pnpm dsh --profile openclaw --dump-config` resolves once `DSH_HOME` points at a directory containing this template profile;
- ✅ (phase 2) channel-row wiring — `profile/cordis.patch.yml` `insert`s the `channel-core` + `channel-telegram` + `channel-feishu` rows; `channel-core` + `channel-feishu` enabled (Feishu credentials via env), `channel-telegram` stays `disabled: true` (no account);
- ✅ (phase 2) Feishu real e2e — `channel-feishu` (long-connection inbound) → `channel-core` (per-thread agent turn) → DeepSeek agent reply → `im.message.create` outbound, user confirmed receipt in Feishu;
- ✅ (phase 2 catch-up) memory-row wiring — `profile/cordis.patch.yml` `insert`s `memory` (root defaults to `dshHomePath('memory')`) + `embeddings-ark` (**enabled**: missing ARK_API_KEY is invisible at boot, only fails loud on a `memory_search` call; key in root `.env` or `$DSH_HOME/.env`);
- ✅ (phase 2 wrap-up) soul file path resolved relative to the preset directory — relative `source` resolves against the mounted tree's `ctx.baseUrl`; `agent.cordis.yml` now uses `source: ./souls/assistant.md`;
- ✅ (phase 2 wrap-up) symlink transition scripted — `tools/link-openclaw.sh` copies the profile and creates 6 `@clawdsh/*` symlinks in one step (replacing the manual four steps);
- ⏳ (phase 3) headless one-shot task shape mounting the openclaw preset (the Feishu daemon already verifies the preset+agent composition; headless preset selection wiring deferred to phase 3);
- ⏳ (phase 3) `@clawdsh/*` packages formal publishing / resolution plan (symlink is a pre-publish transition).

## Usage (Feishu daemon, local development)

```bash
# 1. 安装/刷新 profile + @clawdsh symlink 过渡（幂等）
tools/link-openclaw.sh

# 2. 凭证走环境变量（不落盘；ARK_API_KEY 放根 .env 或 ~/.dsh/.env，永不入仓库）
export FEISHU_APP_ID=cli_xxx
export FEISHU_APP_SECRET=xxx
export DEEPSEEK_API_KEY=sk-xxx

# 3. 起 daemon（常驻长连接，等飞书消息）
pnpm dsh --profile openclaw
```

Boot fails loud (with `appId`/`appSecret` required) when `FEISHU_APP_ID` / `FEISHU_APP_SECRET` are unset, never silently missing messages.
