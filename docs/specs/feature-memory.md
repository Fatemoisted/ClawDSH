# Feature spec: Memory (personal-assistant memory)

English | [中文](feature-memory.zh.md)

- **Status**: implemented (Phase 2 gap-fill ✅, 2026-08-14)
- **Implementation package**: `packages/openclaw/memory` (`@clawdsh/dsh-memory`) + `packages/openclaw/embeddings` (`@clawdsh/dsh-embeddings`) + `packages/openclaw/embeddings-ark` (`@clawdsh/dsh-embeddings-ark`)
- **OpenClaw counterpart**: Memory system (long-term memory: people/things/preferences, retrievable across sessions). Baseline source: OpenClaw `v2026.1.15` (`9c4c9c5edd`) `src/memory/` + `src/agents/memory-search.ts` + `src/agents/tools/memory-tool.ts` (baseline v2026.1.5 has no memory; feature-completion reference).
- **Decision record**: docs/adr/0003-embeddings-seam.md · Agent Note [2026-08-14-memory-plugin](../../.agents/notes/implemented/feature/2026-08-14-memory-plugin.md) · [2026-08-14-memory-flush-turn](../../.agents/notes/implemented/feature/2026-08-14-memory-flush-turn.md)

## Goals

- Provide "cross-session long-term memory": the agent can remember people, things, and preferences the user has mentioned (files are the source of fact, retrievable across sessions);
- Semantic recall: `memory_search` returns fragments with source line numbers ranked by embedding cosine; `memory_get` reads back by line;
- Retrieval content injected into a session obeys the logging invariant ("model-visible means logged");
- Storage uses existing seams, no new backend;
- Pre-compaction memory flush: when the context nears its window, a silent plugin-sourced turn asks the model to write durable memories once per compaction cycle (OpenClaw's `memory-flush`).

## Non-goals

- No self-built vector database/retrieval engine: embedding goes through an external OpenAI-compatible endpoint (Ark), chunk + cosine are pure in-package functions, the index is in-memory derived data;
- No local embedding model (OpenClaw's local GGUF branch deferred to Phase 3 evaluation);
- No per-request automatic memory injection (OpenClaw-isomorphic: on-demand tools + static guidance section);
- No multi-user memory isolation (follows dsh's agent/session isolation model, multiple agents = separate roots);
- No flush *before* the compaction that precedes a turn: the flush turn runs between turns and may itself trigger the pressure compaction first (documented degradation, see the [flush Agent Note](../../.agents/notes/implemented/feature/2026-08-14-memory-flush-turn.md)).

## Seam (written down)

- `ctx.fs` (declared inject): storage and reading of `MEMORY.md` + `memory/YYYY-MM-DD.md`. The plugin itself never writes; writes are carried by the model's fs tools + the guidance-section convention; append-only idempotency is backstopped by the observation policy version guard;
- `ctx.tools`: `memory_search` / `memory_get` (generic presentation);
- `ctx.systemPrompt`: `clawdsh:memory-recall` section (order 115, tool guidance band 100–199);
- `ctx.get('embeddings')` (optional read, `@clawdsh/dsh-embeddings` seam): with no provider, `memory_search` fails loud;
- **No new session event**: the guidance section enters the log via `request/header.header.system`, recall content via tool results.

The originally-candidate `ctx.spillStore` / `ctx.sessionPersistence` were rejected after a Spike deep-read (spillStore only stores, doesn't read + session isolation; sessionPersistence is a turn log and carries no memory entries), rationale in ADR-0003 alternatives.

## Config surface

```yaml
memory:
  root: /abs/path/to/memory      # 必配（fail-loud）；preset 用 dshHomePath('memory')
  chunkSizeChars: 1600           # chunk 字符预算
  chunkOverlapChars: 160         # 相邻 chunk 句子对齐重叠
  maxResults: 6                  # 单次召回上限
  minScore: 0.35                 # cosine 阈值
  snippetChars: 700              # 片段字符上限
  timeoutMs: 30000               # 协作超时（透传 embed）
  maxReadLines: 1000             # memory_get 行数硬上限
  flush:
    enabled: true                # 预压缩 flush 回合开关
    reserveTokensFloor: 20000    # 窗口下方保留的 token 余量
    softThresholdTokens: 4000    # 余量之下的软触发带
    prompt: 'Store durable memories now (use memory/YYYY-MM-DD.md; create memory/ if needed). If nothing to store, reply with NO_REPLY.'
```

## Acceptance criteria

1. ✅ Session A writes a memory fact, Session B can retrieve it (test: cross-file recall `recalls related facts`, file written via `ctx.fs` then `memory_search` hits);
2. ✅ Injected retrieval content appears in the session log (tool results enter the log via the tools seam — reconstruction path argued, recorded in `src/invariant.ts`);
3. ✅ Swapping the embedding backend needs no change to other plugins (embeddings seam single-implementation-replaceable; test uses a bag-of-words stub to replace the real provider);
4. ✅ Memory write/update are idempotent events (append-only convention + observation policy version guard; the plugin never writes, so it has no idempotency conflict of its own);
5. ✅ Pre-compaction memory flush: when the measured context crosses `contextWindow − reserveTokensFloor − softThresholdTokens`, a plugin-sourced turn carrying the flush prompt queues once per compaction cycle (tests: threshold, once-per-cycle, re-arm after `compaction/end`, NO_REPLY, failure containment, missing seams, disposal); the flush decision precedes the compaction of its own turn (integration test with the real compaction engine).
