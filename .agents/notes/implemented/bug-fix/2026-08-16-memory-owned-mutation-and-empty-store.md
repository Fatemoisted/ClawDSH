# Agent Note: Memory-owned mutation and the clean-install empty store

Status: implemented

English | [中文](2026-08-16-memory-owned-mutation-and-empty-store.zh.md)

## Problem

The initial [Memory plugin decision](../feature/2026-08-14-memory-plugin.md) made Markdown the correct cross-session source of truth but delegated writes to general filesystem tools. The ClawDSH profile stores Memory at the private global root under `DSH_HOME`, while an interactive Session receives only workspace-scoped filesystem authority. A user could state a durable identity in Session A, but the model had no authorized operation that could create the missing Memory root or write its files. Session B then called `memory_search` and `memory_get` against an absent directory and could not recall the identity. Unit fixtures pre-created the root and therefore did not exercise the clean-install failure.

The original design also lacked an exact correction or forget operation. Appending a changed fact could preserve a contradiction, while granting the model a free-form path would enlarge the write authority beyond the two Memory-owned targets.

## Decision

Memory owns four tools. `memory_search` and `memory_get` retain their existing read contracts. `memory_write` accepts a fixed `durable` or `daily` scope and writes only `MEMORY.md` or the current `memory/YYYY-MM-DD.md`; it never accepts a path. `memory_update` replaces or removes one exact line in `MEMORY.md` after the model reads the file. Exact durable lines are deduplicated, while daily notes remain append-only.

A missing configured root is the valid empty-store state. Search returns no matches without calling Embeddings, reads report that no stored Memory exists, and the first successful owned write creates the root and fixed target. The system-prompt section tells the model to save stable identities, preferences, relationships, decisions, and long-lived projects proactively, to avoid secrets and transient facts, and to use direct `memory_get` when semantic search is unavailable.

Mutation uses the filesystem seam with capability-owned `workspace-write` authority restricted to the configured Memory root. The operation rejects symbolic-link roots, daily directories, and target files. Per-target in-process serialization and filesystem revision compare-and-swap preserve concurrent host changes; a stale observation retries against the newest contents. Errors returned to the model retain only the stable filesystem code and never disclose the physical root.

The watcher treats an initially absent root as recoverable. After the first write, it closes the incomplete ancestor observation and reopens on the created root. Recovery enables Chokidar's initial events for that handoff and resolves only after the scan reports existing memory files, rather than waiting for a later directory polling notification to rediscover the first write. Disposal waits for recovery and watcher shutdown to settle.

## Alternatives considered

**Keep general filesystem tools as the writer.** Rejected because Session workspace policy correctly denies the global personal-memory root. Expanding every Session's workspace to include `DSH_HOME` would grant unrelated tools much broader private-state access.

**Create the directory during installation and retain general writes.** Rejected because it hides only the first failure. Filesystem authority would still be wrong, and installations, migrations, or user cleanup could recreate the missing-root state.

**Give `memory_write` a model-selected relative path.** Rejected because daily and durable Memory require only two derived targets. A path parameter would add traversal, namespace, and retention policy that the capability does not need.

**Silently fall back from semantic to lexical ranking.** Rejected by the existing Memory decision because it changes scoring semantics. Direct `memory_get` is an explicit, logged fallback for the durable file instead.

## Consequences

The default profile can now establish durable Memory from an empty installation and recall it in a later Session. Writes, corrections, and forget requests are model-visible tool calls and results, so they remain reconstructable from the Session log. Activity projects only privacy-safe outcomes and never the fact text or physical path.

Memory now owns a narrowly scoped mutation surface and its concurrency lifecycle. Host edits remain authoritative, but an unending stream of conflicting host writes can keep a model mutation pending until cancellation; the operation does not overwrite a newer revision after a fixed retry budget.

Ark Embeddings remains optional for product startup. Without a configured or working provider, semantic search fails loudly, while the model can still read the durable file directly. Remote readiness is not inferred from credential presence.

## Verification

Focused tests cover an absent root, cross-call write and recall, exact deduplication, daily append, correction and forget outcomes, concurrent host mutation, symlink rejection, sanitized failures, recovery-time initial-file observation, disposal races, and the fixed prompt guidance. The final product acceptance also creates Memory in the normal ClawDSH profile and recalls it from a separate Web Session.
