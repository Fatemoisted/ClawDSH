# @clawdsh/dsh-embeddings

English | [中文](README.zh.md)

**Positioning**: the text-embedding capability seam (Service Definition) — the `ctx.embeddings` abstract service: maps text into dense vectors in one comparable embedding space, for consumption by semantic retrieval. Defines the "what", not the "how"; an implementation package (provider) subclasses `Embeddings` and registers on mount.

**OpenClaw counterpart**: the choice of one embeddings backend for OpenClaw memory (v2026.1.15 `src/memory/embeddings.ts`, the openai-remote / local-gguf one-of-two). This seam keeps the same "one implementation per context" semantics; the first provider is `@clawdsh/dsh-embeddings-ark` (Volcano Ark).

**Seam**: adds the `ctx.embeddings` single-implementation service (ADR-0003). Optional-service access uses `ctx.get('embeddings')` (returns `undefined` when absent), no declared inject.

**Spec**: docs/adr/0003-embeddings-seam.md · **Status**: implemented

## Usage

Provider side: subclass `Embeddings`, implement `embed`, and load it as a plugin (the `super(ctx, 'embeddings')` constructor call completes the registration; loading a second implementation throws):

```ts
import { Embeddings } from '@clawdsh/dsh-embeddings'
import type { EmbeddingVector } from '@clawdsh/dsh-embeddings'

export class MyEmbeddings extends Embeddings {
  async embed(texts: readonly string[], signal?: AbortSignal): Promise<EmbeddingVector[]> {
    throw new Error('not implemented')
  }
}
```

Consumer side (e.g. `@clawdsh/dsh-memory`): read via `ctx.get('embeddings')`; with no backend, degrade or fail-loud per the consumer's own contract.

## Design notes

- **Single implementation**: one context has exactly one embedding backend — mixing providers breaks cosine comparability (ranking is meaningless when vectors come from different embedding spaces), which is precisely why OpenClaw's config is one-of-two;
- **In-batch contract**: output vector count == input text count, in input order; all vectors within one call share one dimension; any failure rejects the whole batch, no partial results;
- **Signal passthrough**: cooperative cancellation is passed into the provider via `AbortSignal` (tool timeout and session cancellation ride the same chain);
- **Does not own**: chunking, indexing, and similarity ranking belong to `@clawdsh/dsh-memory`; credentials belong to `@deepseek-ai/dsh-credentials`.

## Changelog

- 0.1.0: seam initial shape (single-implementation `ctx.embeddings` + `embed` in-batch contract + 4 seam contract tests).

## Model Experience

### The embedding service

#### What the model sees

The model never sees vectors directly — they surface only through consumers such as `@clawdsh/dsh-memory`, whose `memory_search` tool result carries matched snippets, paths, and scores into the session transcript.

#### Token effect

The seam itself performs no model request and contributes no prompt section, so it adds no model-facing tokens of its own.

#### KV Cache effect

No prompt text is produced by the seam; per-call embedding payloads are provider-side HTTP bodies and never touch the prompt prefix.

## Known Limitations and Deferred Work

- **Single provider**: `ctx.embeddings` is single-implementation; when a multi-provider need appears, upgrade to a registry on the consumer side (this seam stays unchanged);
- **No dimension negotiation**: the dimension is whatever the provider returns; the seam declares no expected dimension; cross-call dimension drift is fail-loud on the provider side (ark already implements it, measured 2048);
- **No local model**: only a remote HTTP provider this cycle; local GGUF (OpenClaw's local path) is deferred to phase 3;
- **Real e2e verified**: the Ark wire is verified end-to-end via tools/ark-e2e.ts (2026-08-14), see the embeddings-ark README.
