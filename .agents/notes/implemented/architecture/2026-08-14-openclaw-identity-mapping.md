# Agent Note: OpenClaw identity mechanism → dsh soul mapping

Status: implemented

English | [中文](2026-08-14-openclaw-identity-mapping.zh.md)

## Problem

The parity matrix's soul row left the concrete form open as "具体形态阶段 2 深读" (deep-read in stage 2). The `@clawdsh/dsh-soul` spike (replace/append modes on the system-prompt seam) was built in stage 0 before the OpenClaw identity mechanism had been read in depth. Stage 2 requires deciding the final form: does replace/append fully express OpenClaw's identity mechanism, or does soul need new structure?

## Decision

A deep-read of OpenClaw `v2026.1.5` (`197b8f7c3b`) shows identity is assembled from four layers, all in `src/agents/` — the gateway (`src/gateway/`) contains no prompt assembly:

1. A hardcoded one-line opening in `src/agents/system-prompt.ts` ("You are Clawd, a personal assistant running inside Clawdbot.").
2. Six user-editable workspace files — `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `IDENTITY.md`, `USER.md`, `BOOTSTRAP.md` — written from templates on first boot (`flag: "wx"`, never overwritten) and injected as `## <filename>` sections under `# Project Context`.
3. Config `identity.name/theme/emoji`, which never enters the prompt; it only drives channel presentation (mention patterns, message prefix, ack emoji).
4. Per-run situational text (`extraSystemPrompt`, e.g. a group-chat intro), rendered as its own section.

The final soul form is the existing spike, unchanged. replace/append fully covers the persona-bearing part of the mechanism; the remaining parts map onto seams dsh already has:

| OpenClaw identity part | dsh realization |
|---|---|
| Hardcoded first line | `deployment:persona` section (order 0) — an explicit deployment config, not hardcoded text |
| `SOUL.md` persona | soul `append` — `clawdsh:soul` section at order 10, after the persona and before tool guidance |
| "Soul is the complete system prompt" minimal form | soul `replace` — a `complete` section on `deployment:persona`, sole prompt after assembly |
| `AGENTS.md` operating instructions | No dedicated dsh seam; carried by the preset soul text in ClawDSH (the upstream `agent-instructions` context covers workspace instructions, a different surface) |
| `TOOLS.md` tool-usage preferences | Existing tool-guidance band (order 100–199); each tool package ships its own section, so soul needs no structure for it |
| `IDENTITY.md` name/creature/vibe/emoji | Channel presentation, not prompt — the same split OpenClaw keeps via config identity; ClawDSH channel adapters do not map nick/avatar yet (deferred) |
| `USER.md` user profile | Expressible as preset persona/soul text; no structure needed |
| `BOOTSTRAP.md` first-run ritual | Onboarding nicety; ClawDSH presets ship explicit souls, so no cold-start scenario exists — non-goal |
| Per-run situational section (group intro) | dsh `PromptContext` / channel inbound context, not soul |
| `system-prompt-report.ts` (per-turn record of injected files) | Already holds in dsh: `request/header.header.system` logs the rendered system prompt through agent-loop → session log, so "model-visible means logged" stands without a new event |

Why no structure was added:

- **Template bootstrap (`flag: "wx"`, write-once templates).** OpenClaw needs it because a first-run wizard has no preset. ClawDSH ships souls explicitly through presets/profiles, so ensure-if-missing has no scenario.
- **`[MISSING] Expected at:` placeholders.** A silent placeholder puts a missing identity into the prompt and invites the model to improvise one. dsh's culture is fail-loud on misconfiguration, and the soul spike already throws on empty text or a missing source file — keeping fail-loud.

Soul code is unchanged in this delivery; the mapping is documented in `docs/specs/feature-soul.md`, the parity matrix, and the soul README.

## Alternatives considered

**New identity seam (an identity registry service).** Rejected: every part of OpenClaw's identity maps onto an existing dsh seam (`system-prompt`, `context`, `channels`); there is no missing capability surface for a new seam to own.

**Port template bootstrap and `[MISSING]` placeholders.** Rejected: bootstrap exists for OpenClaw's preset-less first run, which ClawDSH does not have; placeholders conflict with fail-loud, and the spike already fails loudly on empty or missing souls.

**Put `IDENTITY.md` (name/emoji) into the prompt.** Rejected: OpenClaw deliberately keeps identity config out of the prompt and uses it for channel presentation (mention patterns, `[Name]` prefix, ack emoji). ClawDSH keeps the same split; presentation work is deferred to the channel packages.

**Per-request dynamic identity assembly (provider-evaluated sections).** Rejected: breaks KV prefix stability; soul text is read once at mount, like the upstream persona, and switching souls means remounting.

**Upstream-first proposal for an identity seam.** Not applicable: no new seam is needed; the mapping lands entirely on the existing `system-prompt` seam, so the ADR → upstream PR → patch-transition flow does not trigger.

## Consequences

- The mapping table is the identity fact source for the soul package and the channel packages; it is re-checked whenever upstream identity evolves (e.g. `v2026.1.15` per-agent identity and the reworked `src/agents/system-prompt.ts`).
- Channel presentation of identity (name prefix, ack emoji) is explicitly deferred work, recorded in the parity matrix soul row.
- Soul stays a two-mode section plugin; a future need for multi-file identity sections revisits this note instead of assuming structure.
