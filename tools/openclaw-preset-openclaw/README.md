# ClawDSH assembly

English | [中文](README.zh.md)

This directory is ClawDSH's assembly layer. It composes dsh capabilities with the `packages/openclaw/*` plugins into a personal assistant through profile, bundle, preset, and patch mechanisms without modifying upstream source. The physical `openclaw-preset-openclaw` directory name remains an internal repository exception; installed ids and product copy use `clawdsh`.

The OpenClaw counterpart is the overall personal-assistant combination of gateway, channels, Soul, Memory, Skills, and Automation.

The directory is not a plugin. It supplies:

1. the `clawdsh` agent preset (`preset.yml`, `agent.cordis.yml`, and `souls/assistant.md`), displayed as `ClawDSH 模式` and installed under the dsh user preset root;
2. the `clawdsh` profile template (`profile/`), which composes `dsh-base` and `dsh-web-app` with the ClawDSH Host plugins;
3. the development installer `tools/link-clawdsh.sh`, which builds the local packages, installs the profile and preset, initializes Memory, and links the local `@clawdsh/*` packages plus the Harness `dsh-agent-presets` bridge.

The clean-install profile keeps Feishu, Telegram, Discord, and Automation disabled. It can therefore boot the stock dsh Web GUI without their credentials. Memory and Skills Hub remain enabled; Ark Embeddings resolves the explicit Harness credential reference `ARK_API_KEY` only when an embedding call needs it.

**Spec**: [roadmap](../../docs/specs/roadmap.md) · **Status**: locally assembled with keyless coverage plus credentialed Feishu and Telegram text e2e; npm publication has not been executed

## Verified assembly

- ✅ soul mount semantics in agent scope — covered by the contract tests in `../../packages/openclaw/soul/tests/soul.spec.ts`;
- ✅ profile parsing and layering — `pnpm dsh --profile clawdsh --dump-config` resolves after this template is installed;
- ✅ safe channel wiring — `channel-core` stays enabled while Feishu, Telegram, and Discord start disabled; the Telegram and Discord rows name `TELEGRAM_BOT_TOKEN` and `DISCORD_BOT_TOKEN` through `botTokenEnv` without embedding secrets;
- ✅ ClawDSH GUI identity — the keyless real-profile browser lane boots the Web Host and verifies that new Sessions default to the `clawdsh` preset displayed as `ClawDSH 模式`;
- ✅ Feishu real e2e — official SDK `LarkChannel` WebSocket inbound → `channel-core` durable conversation/topic turn → DeepSeek reply → SDK outbound, with receipt confirmed in Feishu;
- ✅ Telegram real e2e — Bot API authentication, direct/group text routing, native replies, memory and session recovery, web search, captions, offline catch-up, Unicode-safe splitting, interrupted recovery, and same-chat FIFO have run through a credentialed deployment; forum topics remain keyless-only coverage;
- ✅ memory wiring — `memory` uses `dshHomePath('memory')`; `embeddings-ark` explicitly uses `apiKeyEnv: ARK_API_KEY`, so a missing credential is invisible at boot and fails loud only on `memory_search`;
- ✅ Harness-native per-channel agents — `channel-core` derives a durable opaque session id, resumes through `sessionPersistence`, and resolves/mounts the recorded `clawdsh` composition through `dsh-agent-presets` on create and resume;
- ✅ Feishu/Telegram/Discord channel behavior — structured mentions, native replies/topics/threads, acknowledgement reactions, Unicode-safe provider-sized chunks, SDK-owned retry, and process-restart session continuity have keyless contract coverage;
- ✅ Memory writes and host edits — `memory_append` delegates storage and sandbox enforcement to Harness `ctx.fs`; the watcher invalidates changed index entries and flush ownership survives a plugin remount;
- ✅ local installation — `tools/link-clawdsh.sh` builds all ten packages, installs the `clawdsh` profile and preset, initializes Memory, creates ten `@clawdsh/*` links, and bridges Harness `dsh-agent-presets`;
- ⏳ actual npm publication — no `@clawdsh/*` tarball has been deliberately published from this worktree, so symlinks remain the local-development transition.

## Local development

```bash
tools/link-clawdsh.sh
pnpm dsh --profile clawdsh
```

New Sessions default to the `clawdsh` preset shown as `ClawDSH 模式`. A model credential is needed only when a conversation makes a model request; the Web Host itself starts without external credentials.

## Temporary feature opt-in

Until capability Settings ships, use a later `--patch` overlay to enable optional behavior. The rows are independent: remove every capability you do not intend to run, and replace the example Automation rule before use. Feishu keeps its profile-supplied Harness credential references; Telegram and Discord repeat their complete Config because an id-targeted patch replaces the supplied fields.

```yaml
- id: channel-feishu
  disabled: false

- id: channel-telegram
  disabled: false
  config:
    botTokenEnv: TELEGRAM_BOT_TOKEN

- id: channel-discord
  disabled: false
  config:
    botTokenEnv: DISCORD_BOT_TOKEN
    messageContentIntent: false

- id: automation
  disabled: false
  config:
    rules:
      - id: daily-check-in
        schedule:
          kind: cron
          expr: '0 9 * * *'
        message: Review today's priorities.
```

Save the selected rows as `clawdsh-enable.cordis.yml`, supply credentials only for enabled channels, then inspect the effective composition or start it:

```bash
pnpm dsh --profile clawdsh --patch ./clawdsh-enable.cordis.yml --dump-config
pnpm dsh --profile clawdsh --patch ./clawdsh-enable.cordis.yml
```

A disabled row may omit credentials. Once enabled, the owning plugin fails at its earliest validation point when required configuration is absent. Feishu, Telegram, and Discord resolve their named Harness credential references (`FEISHU_APP_ID` / `FEISHU_APP_SECRET`, `TELEGRAM_BOT_TOKEN`, and `DISCORD_BOT_TOKEN`) with launch-environment fallback.

## Current deployment limits

- `tools/link-clawdsh.sh` refreshes assets bound to the current checkout; linking and running must use the same `DSH_HOME`.
- The installer warns when it finds the legacy `openclaw` profile or preset and leaves them untouched. It creates no compatibility alias and does not migrate or delete user data. Review any legacy `agent-presets.default` override before removing old assets.
- The preset currently lives in dsh's user preset root because the launcher exposes no installation-owned ClawDSH preset root. Until the distribution CLI owns repair, rerunning the development installer restores the checked-in preset files.
- Provider-specific credential, lifecycle, and deployed-e2e limits live in the [Telegram](../../packages/openclaw/channel-telegram/README.md), [Discord](../../packages/openclaw/channel-discord/README.md#known-limitations-and-deferred-work), and [Feishu](../../packages/openclaw/channel-feishu/README.md) READMEs. Review the [Automation limitations](../../packages/openclaw/automation/README.md#known-limitations-and-deferred-work) before enabling rules.

The target product shell, capability Settings, Activity view, and Harness Advanced route are specified in the [local GUI feature spec](../../docs/specs/feature-gui-web.md).
