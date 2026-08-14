# ADR-0003: Text embedding seam (`ctx.embeddings`) — the dependency seam for memory semantic retrieval

English | [中文](0003-embeddings-seam.zh.md)

- **Status**: Accepted (2026-08-14)
- **Date**: 2026-08-14
- **Depends on**: ADR-0001 (build-chain exemption), ADR-0002 (own-seam precedent)

## Context

The Memory plugin (deliverable B) needs to "recall memories by semantics": OpenClaw v2026.1.15's `memory_search` uses embedding + cosine ranking (`src/memory/embeddings.ts`, `src/agents/tools/memory-tool.ts`). Deep reading and reconnaissance confirm that dsh has **no embedding/vector/semantic-retrieval facility at all**:

- `ctx.llm` only has chat/completion streams, no embedding endpoint;
- `ctx.sessionQuery` (FTS5) is lexical retrieval, not semantic;
- `ctx.spillStore` only has `saveText`, is isolated per owner session, and has an opaque locator with no read API — semantically mutually exclusive with "a cross-session, readable-back, human-editable memory fact source" (the original handoff preset was falsified by deep reading, recorded in Alternatives);
- `tool-fs-search` is ripgrep file/content search — same domain, different meaning.

Semantic recall is a necessary condition for memory, and it is a real gap in dsh — either add a seam, or forgo semantic retrieval.

## Decision

1. **Add a `ctx.embeddings` single-implementation service** (Service Definition, spill-style): `abstract embed(texts): Promise<number[][]>`, one implementation per context, loading a second throws. **Reject a multi-provider registry** (web-style): mixed providers produce incomparable embedding spaces, making cosine ranking meaningless; OpenClaw's original implementation likewise picks one of two by config (openai-remote / local-gguf). If multiple providers are needed later, the upgrade path lies on the consumer side (select provider by config), keeping the seam unchanged.
2. **Split into a three-package family**: `@clawdsh/dsh-embeddings` (Service Definition) + `@clawdsh/dsh-embeddings-ark` (Provider) + `@clawdsh/dsh-memory` (Consumer), mirroring dsh's spill/spill-local layering.
3. **First provider = Volcano Ark text embedding** (initiator-specified): POST `https://ark.cn-beijing.volces.com/api/v3/embeddings/multimodal`, model `doubao-embedding-vision-251215`, only send `type: "text"` input; the API key is resolved per operation via the credentials seam (the root `.env`'s `ARK_API_KEY`, never committed), fail-loud if unresolvable. **Wire measurement (2026-08-14, tools/ark-e2e.ts)**: the response is a single object `data.embedding` (2048 dims) rather than OpenAI's `data: [{embedding}]` array; this endpoint embeds the entire input array into one multimodal entry and **cannot batch** — the provider sends one request per text in input order.
4. **memory storage = plain Markdown files via `ctx.fs`** (`MEMORY.md` + `memory/*.md`, aligning with OpenClaw's "files are the source of truth"); the index is derived data, in-memory only and not persisted (incrementally rebuilt on file change).
5. **`memory_search` fails loud when no embeddings provider exists** (the error names `@clawdsh/dsh-embeddings-ark` as required); lexical-scoring fallback is listed Deferred (the two scoring spaces have different semantics, and silent switching would mislead the model).
6. **Upstream proposal deferred**: this deviates from the disciplined default flow "ADR → upstream PR → profile patch transition" — the upstream PR cycle is too long and upstream has no time to respond (ADR-0002 already established the precedent). `ctx.embeddings` is kept long-term as ClawDSH's own seam, with no file created under `docs/upstream-proposal/` for now; if upstream later builds an equivalent capability, reevaluate whether to keep it, and record the difference back into this ADR.

## Contract

```ts ignore-check
// @clawdsh/dsh-embeddings（仅类型 + 抽象服务）
export type EmbeddingVector = number[]

export abstract class Embeddings extends Service {
  // super(ctx, 'embeddings') 注册；单实现，重复 load throw
  abstract embed(texts: readonly string[], signal?: AbortSignal): Promise<EmbeddingVector[]>
}
```

Semantics: the output vector count == input count, in input order; dimensions are consistent within a single call (a provider may additionally promise cross-call stability — the ark implementation does and fails loud on drift); any failure rejects the whole call with no partial results; `signal` is passed through for cooperative cancellation. Access: use `ctx.get('embeddings')` for the optional service (returns `undefined` when absent), without declaring an inject.

## Consequences

- ✅ memory gains real semantic recall, and storage (fs), tools (tools), the prompt section (systemPrompt), and the log (session log) all hang off existing seams;
- ⚠️ own seams +1 (kept long-term under the same policy as `ctx.channels`); during upstream sync, watch whether it builds its own embedding capability;
- ⚠️ memory retrieval depends on an external key (Ark), so offline deployments have no retrieval; offline lexical fallback is Deferred rather than silent behavior;
- ⚠️ embedding dimensions are server-authoritative; cross-version drift is intercepted by the provider's fail-loud (better to error than to pollute cosine ranking).

## Alternatives

- **`ctx.sessionQuery` FTS5 lexical retrieval (kept as Deferred)**: zero new seam, but "semantic recall" is a misnomer — memory entries worded differently from the query are missed; kept as a fallback path for keyless environments, evaluated in stage 3.
- **`ctx.spillStore` as storage (rejected)**: the original handoff preset; deep reading confirms SpillStore only has `saveText`, session isolation, and an opaque locator — `memory_get` cannot read back, cross-session acceptance criteria cannot be met, and the index must self-store the full text, reducing spill to a write-only shadow.
- **Auto-inject memory every request (rejected)**: OpenClaw's original implementation deliberately does not auto-inject (on-demand tool + `## Memory Recall` convention section); auto-injection inflates token cost and deviates from the upstream feature category.
- **Propose upstream PR before landing (deferred)**: cycle risk (same reason as ADR-0002); proceed in the own domain first, and evaluate the upstream proposal once the form stabilizes.
- **Local GGUF embedding (deferred)**: OpenClaw's local branch; introduces model files and native dependencies, evaluated on demand in stage 3.
