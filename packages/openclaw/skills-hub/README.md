# @clawdsh/dsh-skills-hub

English | [中文](README.zh.md)

**Positioning**: ClawHub-compatible skill loader — lets existing OpenClaw-ecosystem Skills (Markdown + config header) be loaded directly as dsh skills, delivering a smooth skill-market migration.

**OpenClaw counterpart**: Skills / ClawHub (skill catalog, market, version locking).

**Seam**: `ctx.skills` (dsh natively supports provider merging — multiple skill sources coexist naturally).

**Spec**: phase 3 deliverable · **status**: planning

## Notes

- dsh's `ctx.skills` is itself designed to "merge skill catalogs from multiple providers"; ClawHub is simply one more provider: the architectural payoff cashes out directly;
- ClawHub's "publish as an immutable snapshot, `latest` is rollbackable" semantics can be achieved with dsh's config locking, no self-built registry needed.
