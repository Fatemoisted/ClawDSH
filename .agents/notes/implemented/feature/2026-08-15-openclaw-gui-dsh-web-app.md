# Agent Note: ClawDSH GUI frontend via the dsh web bundle

Status: implemented

English | [中文](2026-08-15-openclaw-gui-dsh-web-app.zh.md)

## Problem

OpenClaw has two usage modes: a local CLI and a Gateway that bridges to messaging apps (Feishu etc.). ClawDSH already ships the channel frontend through `ctx.channels`; the "GUI" mode had no home. DeepSeek Harness ships a full browser GUI (`@deepseek-ai/dsh-web-app`), and because it drives turns through the same `ctx.agents` / `ctx.sessions` / agent-loop seams that `channel-core` uses, the GUI can front OpenClaw's features with no upstream change — it is a composition problem, not a code problem.

## Decision

The physical `preset-openclaw` assembly composes the web bundle and ships the full `clawdsh` agent preset, so `pnpm dsh --profile clawdsh` boots the browser GUI with ClawDSH's OpenClaw-derived features. Four changes, all in ClawDSH-owned files:

- **profile bundles** — `profile/package.json` `dsh.profile.bundles` gains `@deepseek-ai/dsh-web-app` (matching the stock `web` template). The profile's own `cordis.patch.yml` still wins on `system-prompt` persona because profile patches apply after bundle layers.
- **default preset** — `profile/cordis.patch.yml` overrides the web bundle's `agent-presets` `default` from `standard` to `clawdsh`, so new GUI sessions mount `ClawDSH 模式` automatically.
- **agent preset toolset** — `agent.cordis.yml` now mirrors the `standard` preset's full agent-plane toolset (shell, fs, skills, plan, compaction, delegation/workflow, web, todo), with one swap: the `persona` row (`@deepseek-ai/dsh-persona`, "coding agent") is replaced by `@clawdsh/dsh-soul` (`souls/assistant.md`, see [feature-soul](../../../../docs/specs/feature-soul.md)). The web bundle moves model-facing tools behind presets, so without this the GUI agent would see only soul plus the host-plane memory tools.
- **preset installation** — `tools/link-clawdsh.sh` copies `preset.yml` + `agent.cordis.yml` + `souls/` into `$DSH_HOME/.agent-presets/clawdsh/` (the preset id is the directory name). The [identity and safe-defaults decision](2026-08-15-clawdsh-identity-and-safe-defaults.md) owns the installed names and legacy handling.

## Consequences

- `pnpm dsh --profile clawdsh` serves `http://127.0.0.1:3080`; a GUI conversation surfaces the same soul persona, `clawdsh:memory-recall` section, `memory_search`/`memory_get` tools, and skills catalog as the channel path does, plus the full standard toolset.
- The Web server starts independently of optional external integrations. Feishu, Telegram, and Automation are disabled in a clean install; enabling their Loader entries preserves their existing behavior and validation.
- `mode: append` is kept for `soul`; if the web-runtime's "coding agent" section leaks into the assembled prompt, switch `soul` to `mode: replace` (a complete persona suppresses both the host default and the web-runtime section).

## Alternatives considered

**A separate ClawDSH-owned GUI plugin.** Rejected: dsh already ships a complete browser console (webserver, client roster, API gateway); a second GUI would duplicate all of it for no capability gain.

**Keep the `standard` preset and only override its persona.** Rejected: the web bundle disables the host-plane tool rows, so the `standard` preset is the only thing exposing shell/fs/skills under the GUI; copying it into the `clawdsh` preset with soul-for-persona keeps the ClawDSH identity without forking the tool wiring.

**Select the preset per-session in the UI instead of changing the default.** Rejected as the only path: a per-session pick stays available, but setting `default: clawdsh` makes the GUI show `ClawDSH 模式` with no manual step.
