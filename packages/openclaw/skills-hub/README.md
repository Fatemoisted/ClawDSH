# @clawdsh/dsh-skills-hub

English | [中文](README.zh.md)

**Positioning**: ClawHub-compatible skill loading — lets existing OpenClaw-ecosystem Skills (a directory with one `SKILL.md`, AgentSkills-compatible YAML frontmatter) load directly as dsh skills. One thin `SkillProvider` on `ctx.skills`: it adds the OpenClaw source-directory conventions (workspace `skills/`, legacy `~/.clawdbot/skills`, extra dirs) and the `metadata.clawdbot.requires.*` gating; everything else — discovery merging, duplicate resolution, cache invalidation, disposal, and the model surface — is already owned by the dsh skill seam.

**OpenClaw counterpart**: Skills (v2026.1.5 top-level `skills/` + `src/agents/skills.ts` + `docs/skills.md`). Aligned to its shape: `name` + `description` required frontmatter, bodies never inline in the prompt, gating evaluated at catalog time, `metadata` accepted as a record or the single-line JSON string OpenClaw writes. Not ported: install execution (`install: [{kind: brew/node/go/uv, …}]`) and the external ClawHub CLI — v2026.1.5 itself has no in-process registry.

**Seam** (pre-existing, none added):
- `ctx.skills` (declared inject): the provider registers via `registerProvider`; the registry merges its candidates with every other provider, resolves duplicates (nearest layer, then rank, then registration order), and owns disposal and cache invalidation;
- `ctx.subprocess` (declared inject): its execution-world resolver owns PATH lookup, including Windows `PATHEXT` and case-insensitive environment semantics; skills-hub only turns resolution success into a gate result;
- Model surface: `tool-skill` publishes catalog entries and loads bodies by name — no new tool, no new event. The "model-visible means logged" invariant holds through existing paths (catalog injection and tool results).

**Spec**: docs/specs/feature-skills-hub.md · **Status**: implemented (Phase 3 ✅)

## Usage

```yaml
- id: skills-hub
  name: '@clawdsh/dsh-skills-hub'
  config:
    enabled: true                 # false registers no provider
    # workspaceDir: /abs/path      # 固定 workspace 技能目录；缺省按 lookup cwd 扫 <cwd>/skills
    # managedDir: /abs/path        # 缺省 ~/.clawdbot/skills（legacy OpenClaw 目录）
    # extraDirs: [/abs/path]       # 附加目录，rank 350
    # gating: true                 # 求值 metadata.clawdbot.requires.{bins,anyBins,env}
```

The `clawdsh-skills-hub` settings namespace is restart-applied. A disabled startup snapshot leaves `ctx.skills` untouched; changing the stored value does not add a provider until restart.

## Design notes

- **Why a thin provider, not a reimplementation**: the skill registry already owns layered merging, within-layer rank ordering, registration disposal, catalog caching, and the model-facing catalog/load tools. skills-hub contributes only the OpenClaw source conventions and gating (see the [skills-domain mapping Agent Note](../../../.agents/notes/implemented/architecture/2026-08-14-openclaw-skills-domain-mapping.md));
- **Rank contract**: workspace `<cwd>/skills` = 300 (the custom slot: below dsh-native project dirs, above user dirs), extra dirs = 350, managed `~/.clawdbot/skills` = 450 (below dsh-native user dirs: the native dir outranks the legacy clawdbot dir); same-rank ties resolve by provider registration order;
- **Gating at list time**: `requires.bins` (all on PATH), `requires.anyBins` (at least one), `requires.env` (env var set); gated-out skills are excluded from the catalog; bins use the Harness execution-world resolver without spawning them;
- **Directory + SKILL.md only**: matches OpenClaw's convention; a directory without `SKILL.md` is not a skill, a missing root yields no skills (OpenClaw-style silent skip), invalid files warn and are skipped;
- **No install execution, no remote registry**: the OpenClaw baseline distributes ClawHub skills through an external CLI; this package loads what is already on disk.
- **Provider-level disable**: `enabled: false` registers no provider, so no ClawHub root participates in catalog collection.

## Changelog

- 0.1.0: first release (workspace/managed/extra roots, `metadata.clawdbot` gating, JSON-string metadata normalization; 11 contract tests, keyless).

## Model Experience

### Skill catalog entries

#### What the model sees

Each listed skill contributes one catalog line — name, description, and routing guidance — rendered by the `tool-skill` consumer; the body loads only when the model invokes the `skill` tool, never inline.

#### Token effect

One catalog line per skill, proportional to how many skills are on disk and pass gating.

#### KV Cache effect

Catalog entries live in the injected catalog block; adding, removing, or editing a skill changes that block, while an unchanged skill set keeps it reusable.

## Known Limitations and Deferred Work

- **No ClawHub install execution**: `metadata.clawdbot.install` specs (brew/node/go/uv) are ignored; skills must already be present in a scanned directory;
- **No remote ClawHub registry**: no pull, version locking, or rollback (the baseline distributes via an external CLI; a registry client would be a new surface);
- **No fs watcher**: changes appear on the next catalog collect (`skills/change` invalidation covers other providers' mutations; a watcher for these roots is deferred);
- **Gating scope**: bin gates resolve through `ctx.subprocess` (including Windows `PATHEXT`); config-driven OpenClaw gates (`requires.config`, `os`) are not ported;
- **`~/.clawdbot/skills` is the default managed root**: existing OpenClaw installs work out of the box; set `managedDir` to point elsewhere.
