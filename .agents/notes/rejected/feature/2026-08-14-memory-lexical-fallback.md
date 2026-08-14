# Agent Note: Lexical fallback for memory_search when no embeddings provider is loaded

Status: rejected — keep fail-loud: embedding and lexical scoring live in different semantic spaces, and a silent switch would mislead the model

English | [中文](2026-08-14-memory-lexical-fallback.zh.md)

## Problem

`memory_search` fails loud when `ctx.get('embeddings')` is absent (the error names `@clawdsh/dsh-embeddings-ark`). An offline deployment — no Ark key — therefore has no retrieval at all, only `memory_get` by line number. The [memory-plugin note](../../implemented/feature/2026-08-14-memory-plugin.md) recorded this as "deferred, evaluated in stage 3", and [ADR-0003](../../../../docs/adr/0003-embeddings-seam.md) listed a lexical fallback as "Deferred". This note closes that open item: the fallback is rejected, not deferred.

## Proposal

When no embeddings provider is loaded, fall back to a lexical scorer — token overlap, or `ctx.sessionQuery` FTS5 — instead of erroring, so keyless deployments keep some `memory_search` retrieval.

## Alternatives considered

**Keep fail-loud (accepted).** Embedding ranking orders by meaning; lexical ranking orders by token overlap. The same query can return a different top-hit set depending on which backend a deployment happens to load, and the model cannot tell the two apart from the tool result. A silent switch therefore misleads the model into trusting results it has no way to qualify. Fail-loud keeps every `memory_search` result semantically comparable and honest. This is already the shipped behavior in ADR-0003 §5 and the memory-plugin note; this note turns the recorded "deferred" into a definitive rejection.

**Lexical keyword fallback (rejected).** The reason this note exists: the semantic mismatch above, plus the fail-loud culture that governs the memory row (root required, path escape, dimension drift all error loudly).

**`ctx.sessionQuery` FTS5 (rejected).** Same semantic mismatch, and it adds a new seam dependency to the memory row for no correctness gain.

## Revival shape

If an offline deployment ever makes retrieval-without-a-provider a hard requirement, revive it behind an explicit opt-in, never a hidden `?? default`:

- a `lexicalFallback: boolean` (or a `rankBy: 'embedding' | 'lexical'`) config field, default off, so the switch is a deployment decision visible in the config surface;
- a plugin-layer ranker branch in `memory_search` that selects the scorer, keeping embedding and lexical as two distinct rankers rather than one merged path;
- extract `StubEmbeddings`' token-overlap scorer into a package-local pure function so both rankers share one tested scorer;
- a revision to ADR-0003 §5 recording the reopened decision and the deployment evidence that justified it.

Until that requirement appears, keep fail-loud.

## Risks

- Offline deployments have no semantic retrieval; this is a documented, accepted limitation, not a hidden degradation.
