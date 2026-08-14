# Feature spec: Skills hub (ClawHub-compatible skill loading)

English | [中文](feature-skills-hub.zh.md)

- **Status**: implemented (Phase 3 ✅, 2026-08-14)
- **Implementation package**: `packages/openclaw/skills-hub` (`@clawdsh/dsh-skills-hub`)
- **OpenClaw counterpart**: Skills / ClawHub (v2026.1.5 top-level `skills/` + `src/agents/skills.ts` + `docs/skills.md`): per-directory `SKILL.md` declarations, AgentSkills-compatible frontmatter, `metadata.clawdbot` gating, bodies never inline in the prompt.
- **Decision record**: Agent Note [2026-08-14-openclaw-skills-domain-mapping](../../.agents/notes/implemented/architecture/2026-08-14-openclaw-skills-domain-mapping.md)

## Goals

- Load OpenClaw-ecosystem skills directly as dsh skills: a directory with one `SKILL.md` under a workspace `skills/` dir, the legacy `~/.clawdbot/skills` dir, or configured extra dirs;
- Evaluate `metadata.clawdbot.requires.{bins,anyBins,env}` at catalog time and exclude gated-out skills;
- Accept `metadata` as a record or the single-line JSON string OpenClaw writes;
- Reuse the existing skill seam end to end: registry merging, model catalog, load-by-name, disposal.

## Non-goals

- No ClawHub install execution (`metadata.clawdbot.install` specs are ignored) — the baseline distributes via an external CLI, and running installers is a new surface;
- No remote ClawHub registry (pull, version locking, rollback) — v2026.1.5 has no in-process registry;
- No fs watcher for the hub roots — changes appear on the next catalog collect;
- No port of OpenClaw's prompt snapshot injection (paths in the system prompt) — dsh's `tool-skill` catalog + load-by-name is the model contract and is strictly stronger;
- No port of OpenClaw's config-driven gates (`requires.config`, `os`) — PATH/env gates cover the batch-1 scope.

## Seam (written down)

- `ctx.skills` (declared inject): one `SkillProvider` (`name: 'clawhub'`) registered via `registerProvider`; the registry merges its candidates with every other provider, resolves duplicates (nearest layer, then rank, then registration order), and owns cache invalidation and disposal;
- Rank contract: workspace `<cwd>/skills` = 300 (the custom slot: below dsh-native project dirs, above user dirs), extra dirs = 350, managed `~/.clawdbot/skills` = 450 (below dsh-native user dirs);
- Model surface: no new tool or event — `tool-skill` publishes the merged catalog and loads bodies by name; the logging invariant holds through existing paths.

## Config surface

```yaml
skills-hub:
  workspaceDir: /abs/path   # 固定 workspace 技能目录；缺省按 lookup cwd 扫 <cwd>/skills
  managedDir: /abs/path     # 缺省 ~/.clawdbot/skills（legacy OpenClaw 目录）
  extraDirs: [/abs/path]    # 附加目录，rank 350
  gating: true              # 求值 metadata.clawdbot.requires.{bins,anyBins,env}
```

## Acceptance criteria

1. ✅ A workspace `skills/<name>/SKILL.md` lists as a dsh skill with the workspace rank and source, and invalid files (no name/description, no `SKILL.md`) are skipped (test: `lists SKILL.md directory skills from the workspace root and skips invalid files`);
2. ✅ Duplicate names resolve by rank: workspace (300) beats managed (450); a same-rank dsh-native custom dir beats the hub candidate via registration order (tests: `resolves a duplicate name by rank`, `lets a same-rank skill-filesystem custom dir beat the hub workspace candidate`);
3. ✅ `metadata.clawdbot` gating excludes skills with missing bins/env vars, `anyBins` passes when one bin exists, and `gating: false` lists everything (tests: `evaluates metadata.clawdbot gating`, `passes an anyBins gate`);
4. ✅ Single-line JSON metadata normalizes into the candidate and the loaded definition; definitions load without frontmatter and keep the dsh invocation-policy keys (tests: `normalizes single-line JSON metadata`, `keeps the dsh invocation-policy keys`);
5. ✅ Registration is reversible: disposing the plugin fiber unregisters the provider (test: `unregisters the provider when the plugin fiber is disposed`).
