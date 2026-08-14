# Agent Note: OpenClaw skills domain → dsh skills-hub mapping

Status: implemented

English | [中文](2026-08-14-openclaw-skills-domain-mapping.zh.md)

## Problem

The parity matrix's Skills row (source: OpenClaw top-level `skills/`, seam: `ctx.skills` provider merge) was planning. dsh already ships a complete skill seam — `SkillRegistry` with layered provider merging, `skill-filesystem` with SKILL.md + YAML frontmatter discovery, and `tool-skill` with model-facing catalog publication and load-by-name. The question for the skills-hub package: what is the actual increment on top of that seam, and where exactly does the OpenClaw/ClawHub format differ from what dsh already parses?

## Decision

A deep-read of OpenClaw `v2026.1.5` (`197b8f7c3b`) settles it: **skills-hub is a thin `SkillProvider` registered on `ctx.skills` — nothing more**. No new seam, no new tool, no reimplementation of discovery.

The OpenClaw side (top-level `skills/`, `src/agents/skills.ts`, `docs/skills.md`):

- **Declaration**: 45 built-in skills, each a directory with one `SKILL.md`; "AgentSkills-compatible" YAML frontmatter with required `name` + `description`, optional `homepage`, and optional `metadata` — a single-line JSON string whose `clawdbot` key carries gating (`requires.bins` / `requires.anyBins` / `requires.env`) and install specs. Body is free-form markdown.
- **Model access**: no load-by-name tool at this tag. A per-session snapshot injects only each skill's name, description, and absolute SKILL.md path into the prompt; the model reads bodies itself via filesystem tools. Gating (`requires.*`, config, os) is evaluated once at snapshot build.
- **Discovery precedence**: `extraDirs < bundled < managed (~/.clawdbot/skills) < workspace (<workspaceDir>/skills)`.
- **ClawHub distribution**: no in-process registry or remote fetch at this tag — an external npm CLI (`clawdhub search/install/update/publish`) wrapped as a bundled skill, with install execution (brew/node/go/uv) in `skills-install.ts`.

The dsh mapping:

| OpenClaw skills part | dsh realization |
|---|---|
| Per-directory `SKILL.md` declaration | Already covered: `skill-filesystem` discovery parses the same shape (name/description required, `isSkillName`-validated) |
| Name + description + path in the prompt, bodies never inline | Already covered and stronger: `tool-skill` publishes a digest-deduped `<available_skills>` catalog per pre-step and loads bodies by name via the `skill` tool — bodies still never inline |
| Workspace `<cwd>/skills` dir | skills-hub scans `<cwd>/skills` per lookup, rank 300 (the `custom` slot: below dsh-native project dirs, above user dirs) |
| Managed `~/.clawdbot/skills` dir | skills-hub scans it by default, rank 450 (below dsh-native user dir 400: the native dir outranks the legacy clawdbot dir) |
| Extra dirs from config | skills-hub `extraDirs`, rank 350 |
| `metadata` single-line JSON string | skills-hub normalizes a record **or** a JSON string into a parsed record (skill-filesystem's parser ignores string metadata) |
| Gating at snapshot build (`requires.bins/anyBins/env`) | skills-hub evaluates `metadata.clawdbot.requires.*` at `list()` time — bins probed on PATH, env checked against `process.env`; gated-out skills are excluded from the catalog |
| Install specs (`install: [{kind: brew/node/go/uv, …}]`) | Not ported in this batch — no install execution, no ClawHub CLI invocation; recorded as Known Limitation |
| Bundled skills dir | Not applicable — dsh ships its own bundled skills via `skill-badge` |
| Snapshot cache per session | Not needed — the registry caches collected catalogs per cwd/provider and invalidates on `skills/change` |

Why a provider and not a reimplementation: the skill seam already owns discovery merging, duplicate resolution (nearest layer wins, then rank, then registration order), cache invalidation, disposal, and the whole model surface. Rebuilding any of that in skills-hub would violate the reuse rule and duplicate code the registry guarantees.

## Alternatives considered

**Port OpenClaw's snapshot prompt injection (paths in the system prompt).** Rejected: dsh's model contract for skills is the `tool-skill` catalog + load-by-name tool, which already keeps bodies out of the prompt and is strictly more capable than path-listing; injecting paths twice would pollute the prompt.

**A ClawHub registry client (remote fetch, version locking, rollback).** Rejected for this batch: `v2026.1.5` itself has no in-process registry — distribution is an external CLI. Local-directory loading is the complete feature at this tag; a remote registry would be inventing a surface the baseline never had.

**A standalone discovery seam (`ctx.skillsHub`).** Rejected: the increment is one provider on the existing seam; a new service would carry zero capability the registry does not already provide.

**Reuse `skill-filesystem`'s parser by importing it.** Rejected: cross-package import of a concrete implementation is forbidden; the provider contract (`SkillProvider`/`SkillCandidate`/`SkillDefinition`) is the only shared surface. The local parser is deliberately small (frontmatter + metadata normalization + gating), using the same `yaml` dependency.

## Consequences

- skills-hub mounts host-plane, enabled in the openclaw preset: purely additive catalog merge, absent directories yield empty lists, no credentials, no install execution — existing OpenClaw users' `~/.clawdbot/skills` works out of the box.
- Rank choice is a contract: 300 (workspace) / 350 (extra) / 450 (managed) sit between dsh-native project (100–200) and user (400–500) slots; same-rank ties resolve by provider registration order, so skill-filesystem wins 300-ties.
- Gating is best-effort (PATH probe, no child processes); the parity spec records this as a limitation, not a guarantee.
- Install execution and any future ClawHub remote registry revisit this note rather than assuming structure.
