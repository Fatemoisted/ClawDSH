# Agent Note: OpenClaw-style memory on dsh seams (memory_search / memory_get)

Status: implemented

English | [中文](2026-08-14-memory-plugin.zh.md)

## Problem

ClawDSH stage 2 needs the Memory row: OpenClaw's long-term memory (people, preferences, decisions, prior work; cross-session retrieval) as a dsh plugin. The handoff's original pointer was `ctx.spillStore` for persistence, but the deep-read of OpenClaw `v2026.1.15` and the dsh seam inventory falsified that: OpenClaw's memory is plain Markdown files as the source of truth (human-editable, cross-session, read back by `memory_get`), while `SpillStore` only saves text, scopes storage per owner session, and returns opaque locators with no programmatic read — it cannot carry the ported capability category. Semantic recall was the one genuine gap: dsh has no embedding facility anywhere.

## Decision

The memory row ships as a function plugin on existing seams only, with the semantic-recall gap covered by the new embeddings seam ([2026-08-14-embeddings-seam](../architecture/2026-08-14-embeddings-seam.md), [ADR-0003](../../../../docs/adr/0003-embeddings-seam.md)):

- **Storage = Markdown files via `ctx.fs`** — `MEMORY.md` for durable facts, `memory/YYYY-MM-DD.md` for append-style running notes. The plugin itself never writes; the model writes through the fs tools under the recall-section convention (OpenClaw's own shape — no dedicated write tool). Append-only idempotence rides the fs observation policy's version guards.
- **Recall = on-demand tools, no per-request injection** — `memory_search` (embedding cosine ranking, `minScore` 0.35 / `maxResults` 6 defaults, snippet with source lines) and `memory_get` (line-slice read with `isMemoryPath` whitelist + `FileSystem.contains` enforcement). Nothing is auto-injected; recalled content enters the transcript as tool results, so "model-visible means logged" holds without a new session event.
- **Index = derived data, in memory only** — rebuilt incrementally per search from `(version, size)` file stamps; chunking (`chunkMarkdown`, sentence-aligned overlap) and cosine are package-local pure functions. One `embed` batch per search covers the query plus any not-yet-embedded chunks.
- **Fail-loud without an embeddings provider** — `memory_search` errors naming `@clawdsh/dsh-embeddings-ark` when `ctx.get('embeddings')` is absent; a lexical fallback is deferred because two scoring spaces with different semantics would silently mislead the model.
- **Static guidance section** — `clawdsh:memory-recall` at order 115 (tool-guidance band), fixed text teaching recall workflow and the append-only write convention, mirroring OpenClaw's `## Memory Recall` section.

## Alternatives considered

**Use `ctx.spillStore` as the store.** Rejected: save-only, session-scoped, opaque locators — `memory_get` cannot read back, the cross-session acceptance criterion fails, and the index would have to own the full text, reducing spill to a write-only shadow. Recorded in ADR-0003.

**Use `ctx.sessionPersistence` with a dedicated memory session.** Rejected: session logs are append-only turn records with header invariants; memory entries are not turns, and treating the log as a database fights the session-load invariants.

**Persist the index on disk (sqlite, like OpenClaw).** Rejected: a durable index is a second copy of the truth that can drift; OpenClaw's sqlite index exists because its files are the only other copy and it watches them. Here the files alone are authoritative and small, so in-memory incremental rebuild is simpler and drift-free. Rebuild cost is bounded by changed files only.

**Lexical keyword fallback when no provider is loaded.** Deferred, not shipped: two scoring spaces would silently change result semantics depending on deployment, which contradicts fail-loud; stage 3 evaluates it for offline deployments.

**Auto-inject recalled memories per request.** Rejected: OpenClaw deliberately does on-demand recall; per-request injection costs tokens and diverges from the ported capability category.

## Consequences

- Memory is fully recoverable from the session log: guidance rides `request/header.header.system`, recalls ride tool results. No new session event type was needed.
- The memory root is deployment-owned (`root` required, fail-loud) — cross-session retrieval works because the files live in one configured place, and multi-agent isolation means separate roots.
- Recall depends on an external embedding provider (Ark); offline deployments have no retrieval until the deferred lexical fallback lands.
- OpenClaw's pre-compaction memory flush turn (the "store durable memories now" driver) is deferred to stage 3 on dsh compaction hooks; until then writes depend on the model following the convention.
