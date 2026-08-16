# Agent Note: ClawDSH GUI frontend via the dsh web bundle

Status: implemented

English | [中文](2026-08-15-openclaw-gui-dsh-web-app.zh.md)

## Problem

OpenClaw has two usage modes: a local CLI and a Gateway that bridges to messaging apps (Feishu etc.). ClawDSH already ships the channel frontend through `ctx.channels`; the "GUI" mode had no home. DeepSeek Harness ships a full browser GUI (`@deepseek-ai/dsh-web-app`), and because it drives turns through the same `ctx.agents` / `ctx.sessions` / agent-loop seams used by `channel-agent`, the GUI can front OpenClaw's features with no upstream change — it is a composition problem, not a code problem.

## Decision

The physical `preset-openclaw` assembly composes the web bundle and ships the full `clawdsh` agent preset. The public managed launcher and isolated source-development launcher therefore boot the browser GUI with ClawDSH's OpenClaw-derived features. The composition remains in ClawDSH-owned files:

- **source profile and launcher** — `profile/package.template.json` declares `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, and the private `@clawdsh/dsh-dev-bundle`. `tools/run-clawdsh-dev.sh` refreshes that source installation, resolves `CLAWDSH_DEV_HOME` with a default of `~/.clawdsh-dev`, exports the result as `DSH_HOME`, and launches the `clawdsh` profile. Source development never falls back to the public `DSH_HOME`.
- **product and user layers** — `profile/dev-bundle/cordis.patch.yml` owns the product composition, including the `system-prompt` persona and `agent-presets.default: clawdsh`. The installed `profiles/clawdsh/cordis.patch.yml` is an initially empty user layer that source refreshes preserve byte-for-byte. The [source-development and managed-migration decision](../architecture/2026-08-17-clawdsh-source-development-and-managed-migration.md) owns marker, backup, and takeover behavior.
- **agent preset toolset** — `agent.cordis.yml` now mirrors the `standard` preset's full agent-plane toolset (shell, fs, skills, plan, compaction, delegation/workflow, web, todo), with one swap: the `persona` row (`@deepseek-ai/dsh-persona`, "coding agent") is replaced by `@clawdsh/dsh-soul` (`souls/assistant.md`, see [feature-soul](../../../../docs/specs/feature-soul.md)). The web bundle moves model-facing tools behind presets, so without this the GUI agent would see only soul plus the host-plane memory tools.
- **preset installation** — the source installer records digest-verified managed copies of `preset.yml`, `agent.cordis.yml`, and `souls/` below `$CLAWDSH_DEV_HOME/.agent-presets/clawdsh/` (the preset id is the directory name). It refuses modified managed assets unless the operator explicitly requests an owner-only backup before replacement. The [identity and safe-defaults decision](2026-08-15-clawdsh-identity-and-safe-defaults.md) owns the installed names and legacy handling.

## Consequences

- The launcher prints the selected loopback origin; the ClawDSH product entry is `/clawdsh/`, while `/` remains the native Harness surface. A GUI conversation surfaces the same soul persona, `clawdsh:memory-recall` section, `memory_search`/`memory_get` tools, and skills catalog as the channel path does, plus the full standard toolset.
- The Web server starts independently of optional external integrations. The OpenClaw Gateway and Automation are disabled in a clean install; enabling the locked Gateway preserves its fail-closed admission and configuration validation.
- `mode: append` is kept for `soul`; if the web-runtime's "coding agent" section leaks into the assembled prompt, switch `soul` to `mode: replace` (a complete persona suppresses both the host default and the web-runtime section).

## Alternatives considered

**A separate ClawDSH-owned GUI plugin.** Rejected: dsh already ships a complete browser console (webserver, client roster, API gateway); a second GUI would duplicate all of it for no capability gain.

**Keep the `standard` preset and only override its persona.** Rejected: the web bundle disables the host-plane tool rows, so the `standard` preset is the only thing exposing shell/fs/skills under the GUI; copying it into the `clawdsh` preset with soul-for-persona keeps the ClawDSH identity without forking the tool wiring.

**Select the preset per-session in the UI instead of changing the default.** Rejected as the only path: a per-session pick stays available, but setting `default: clawdsh` makes the GUI show `ClawDSH 模式` with no manual step.
