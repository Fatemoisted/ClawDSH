# Agent Note: Text-embedding seam (ctx.embeddings) for memory recall

Status: implemented

English | [中文](2026-08-14-embeddings-seam.zh.md)

## Problem

The memory plugin needs semantic recall — OpenClaw `v2026.1.15`'s `memory_search` ranks chunks by embedding cosine similarity. dsh has no embedding, vector, or semantic-search facility anywhere: `ctx.llm` only streams chat completions, `ctx.sessionQuery` is FTS5 lexical search, `ctx.spillStore` has no read API and is session-scoped, and `tool-fs-search` is ripgrep. Semantic recall is the one capability memory needs that dsh genuinely lacks, so the port must add it — either as a new seam or as plugin-internal code.

## Decision

A new single-implementation service seam `ctx.embeddings` plus a first provider, in three packages mirroring the spill/spill-local layering:

| Package | Role |
|---|---|
| `@clawdsh/dsh-embeddings` | Service Definition: abstract `Embeddings` (`super(ctx, 'embeddings')`), `embed(texts, signal?) → number[][]`, vocabulary types. |
| `@clawdsh/dsh-embeddings-ark` | Provider: Volcano Ark text embeddings through the multimodal endpoint (`type: "text"` inputs only), credential layering per operation, response validation with cross-call dimension-drift detection. |
| `@clawdsh/dsh-memory` | Consumer: Markdown memory files via `ctx.fs`, in-memory derived index, `memory_search`/`memory_get` tools. |

Key design points (full decision record in [ADR-0003](../../docs/adr/0003-embeddings-seam.md)):

- **Single implementation, not a provider registry.** Mixing providers in one context produces incomparable embedding spaces and corrupts cosine ranking; OpenClaw's own embeddings layer is config-select-one. A future multi-provider need upgrades on the consumer side (config-selected provider), leaving this seam unchanged.
- **Per-operation credential resolution, never cached**, following the credentials seam contract and the `web-search-deepseek` layering: literal config `apiKey` → `ctx.get('credentials')` → launch environment. Missing key fails loudly — no silent degradation.
- **Response validation at the operation that makes it**: entry count equals input count, finite non-empty vectors, batch-consistent dimension, and cross-call dimension drift fails the call (a silent server-side model swap must not corrupt consumer cosine ranking).
- **The consumer fails loudly without a provider.** `memory_search` errors naming `@clawdsh/dsh-embeddings-ark` when `ctx.get('embeddings')` is absent; a lexical fallback is deferred because two scoring spaces with different semantics would silently mislead the model.
- **Upstream proposal deferred.** Following the ADR-0002 precedent, the seam lands in the ClawDSH-owned domain now; a proposal to upstream is re-evaluated after the shape stabilizes. The deviation from the default ADR → upstream PR → patch-transition flow is recorded in ADR-0003.

## Alternatives considered

**Use `ctx.sessionQuery` FTS5 for recall.** Rejected for this delivery: lexical search is not semantic recall — paraphrased queries miss — and the acceptance criterion is OpenClaw's embedding-ranked `memory_search`. Kept as the evaluated fallback path for keyless deployments, deferred to stage 3.

**Use `ctx.spillStore` as the memory store.** Rejected: `SpillStore` only saves text, scopes storage per owner session, and returns opaque locators with no programmatic read — `memory_get` cannot read back, cross-session retrieval fails, and the index would have to own the full text, reducing spill to a write-only shadow.

**Auto-inject recalled memories into every request.** Rejected: OpenClaw deliberately does on-demand tool recall plus a static `## Memory Recall` guidance section; auto-injection adds token cost per request and diverges from the ported capability category.

**Propose the seam to upstream first.** Deferred: the upstream PR cycle is too slow and the seam is needed now (ADR-0002 precedent); recorded in ADR-0003 for later re-evaluation.

**Local GGUF embeddings (OpenClaw's `local` branch).** Deferred: pulls in model files and native dependencies; stage 3 evaluates it for offline deployments.

## Consequences

- Memory gets real semantic recall while its storage, tools, guidance section, and logging stay on existing seams (`ctx.fs`, `ctx.tools`, `ctx.systemPrompt`, session log).
- The ClawDSH-owned seam count goes to two (`ctx.channels`, `ctx.embeddings`), both long-term under the same policy; upstream sync reviews whether dsh builds an equivalent.
- Recall depends on an external key (Ark); offline deployments have no retrieval until the deferred lexical fallback lands.
- Embedding dimension is server-defined; the provider's drift guard trades availability for ranking integrity on silent model upgrades.
