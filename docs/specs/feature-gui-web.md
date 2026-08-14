# Feature spec: GUI frontend (dsh-web-app + openclaw preset)

English | [中文](feature-gui-web.zh.md)

- **Status**: implemented (Phase 4 ✅, 2026-08-15)
- **Implementation**: `packages/openclaw/preset-openclaw/` (assembly, not a plugin)
- **OpenClaw counterpart**: the second usage mode — a local GUI console alongside the channel frontend

## Goals

- `pnpm dsh --profile openclaw` boots a browser GUI at `http://127.0.0.1:3080` that fronts the OpenClaw features;
- a GUI conversation surfaces the same soul persona, memory recall/tools, and skills catalog as the channel path;
- new GUI sessions default to the "OpenClaw 形态" agent preset.

## Non-goals

- no ClawDSH-owned GUI code — the dsh `dsh-web-app` bundle is reused wholesale;
- no change to the channel (Feishu/Telegram) frontend path;
- per-session preset selection stays available — only the default is set.

## Assembly

- `profile/package.json` — `dsh.profile.bundles` = `[dsh-base, dsh-web-app]`;
- `profile/cordis.patch.yml` — overrides `agent-presets.default` → `openclaw`;
- `agent.cordis.yml` — mirrors the `standard` preset's full toolset, `soul` replacing `persona`;
- `tools/link-openclaw.sh` — installs the preset into `$DSH_HOME/.agent-presets/openclaw/`.

## Model-visible surface

- persona = host `system-prompt` "personal AI assistant" + the `soul` section (`mode: append`);
- memory recall section + `memory_search` / `memory_get` (host plane);
- skills catalog via `tool-skill` + `skill-filesystem`;
- the full `standard` toolset (shell, fs, web, plan, subagents, workflow).

## Acceptance criteria

1. GUI boots and answers a message (the agent loop runs);
2. a new session's default preset is "OpenClaw 形态";
3. no "coding agent" leakage in the assembled prompt (else flip `soul` to `mode: replace`);
4. `memory_search`/`memory_get` and the skills catalog appear in the tool surface.
