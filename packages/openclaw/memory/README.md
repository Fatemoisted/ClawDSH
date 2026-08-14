# @clawdsh/dsh-memory

English | [中文](README.zh.md)

**Positioning**: long-term memory for a personal assistant — an OpenClaw-style "files are the source of truth" memory system built on dsh's existing seams: `MEMORY.md` (stable facts) + `memory/YYYY-MM-DD.md` (journal-style append) are plain Markdown files, cross-session and human-editable; `memory_search` ranks snippets by semantic recall, `memory_get` reads them back by line number. The index is in-memory derived data, rebuilt incrementally from the files and never persisted to disk.

**OpenClaw counterpart**: the Memory system (v2026.1.15 `src/memory/` + `src/agents/memory-search.ts` + `src/agents/tools/memory-tool.ts`). Aligned to its shape: no dedicated write tool (the model writes via file tools, see below), on-demand tool recall (no per-request auto-injection), the `## Memory Recall` guidance section, and the minScore 0.35 / maxResults 6 defaults.

**Seams** (all pre-existing, none added):
- `ctx.fs` (declared inject): storage and reads — **the plugin itself performs zero writes**, writes are carried by the model's fs tools + the guidance-section convention (isomorphic with OpenClaw); append-only idempotency is guaranteed by the fs observation policy's version guard;
- `ctx.tools`: the `memory_search` / `memory_get` tools (generic presentation, no presentCall);
- `ctx.systemPrompt`: the `clawdsh:memory-recall` section (order 115, tool guidance carries 100–199);
- `ctx.get('embeddings')` (optional read): semantic vectors come from the `@clawdsh/dsh-embeddings` seam; **with no provider, `memory_search` fails loud** (the error names `@clawdsh/dsh-embeddings-ark`), no lexical fallback (the two scoring spaces are semantically different, and a silent switch would mislead the model);
- **no new session event**: the guidance section reaches the log via `request/header.header.system`, and recalled content reaches the transcript as tool results — both reconstruction paths are existing mechanisms, so "model-visible means logged" needs no new event (argument in `src/invariant.ts`).

**Spec**: docs/specs/feature-memory.md · docs/adr/0003-embeddings-seam.md · **Status**: implemented

## Usage

```yaml
- id: memory
  name: '@clawdsh/dsh-memory'
  config:
    root: /abs/path/to/memory      # 必配：记忆根目录（fail-loud）
    # chunkSizeChars: 1600          # chunk 字符预算
    # chunkOverlapChars: 160        # 相邻 chunk 句子对齐重叠
    # maxResults: 6                 # 单次召回上限
    # minScore: 0.35                # cosine 阈值
    # snippetChars: 700             # 片段字符上限
    # timeoutMs: 30000              # 协作超时（透传 embed）
    # maxReadLines: 1000            # memory_get 行数硬上限
```

Write convention (taught to the model by the guidance section): stable facts go into `MEMORY.md`, runtime notes are appended to `memory/YYYY-MM-DD.md`, only via file tools, append-only and never rewriting history.

## Design notes

- **Files are the sole source of truth**: the plugin only reads files and only maintains the derived index; the index detects changed files by `(version, size)` and rebuilds incrementally before each search (negligible cost at personal-memory scale; chokidar watch is deferred);
- **One embed batch**: each search's embed calls = the query + all un-embedded chunks, one HTTP call on cold start, one HTTP call on incremental edits;
- **Path allowlist + double safety**: `isMemoryPath` (`MEMORY.md` | `memory/<file>.md`, rejecting absolute paths and `..`) + `fs.contains(root, target)` enforced at the resolution operation;
- **Fail-loud culture**: root required, no embeddings provider, path escape, dimension drift (provider-side) all fail loudly;
- **Dispose rollback**: the section and both tool registrations all go through `ctx.effect`, removed on unload (test-covered).

## Changelog

- 0.1.0: first release (chunk + incremental index + two tools + guidance section; 13 contract tests, keyless bag-of-words stub).

## Model Experience

### The recall guidance section

#### What the model sees

A fixed `## Memory Recall`-style guidance section on every request: how to use `memory_search`/`memory_get` and the append-only write convention.

#### Token effect

Constant per mounted plugin: the section's tokens appear on every request; the section text never changes at runtime.

#### KV Cache effect

Prefix-stable: static text, registered at mount.

### Recalled memories (tool results)

#### What the model sees

Only when the model calls `memory_search`/`memory_get`: ranked snippets with path, source lines, and cosine score, or line slices of one memory file. Recalled text enters the transcript as a tool result, never pre-injected.

#### Token effect

Proportional to what the model retrieves (bounded by `maxResults`/`snippetChars`/`maxReadLines`), not to the size of the memory corpus.

#### KV Cache effect

Tool results land mid-transcript, like any tool output; no system-prompt prefix changes.

## Known Limitations and Deferred Work

- **No dedicated write tool**: writes rely on the model following the convention (isomorphic with OpenClaw); the pre-compaction memory flush round (OpenClaw's existing-write driver) is deferred to phase 3, hanging on the dsh compaction hook;
- **No chokidar watch**: changes rely on pre-search incremental rebuild, no proactive push;
- **Lexical fallback** (retrieval without embeddings) is deferred — evaluated in phase 3 offline scenarios;
- **Spill of oversized retrieval results** (hanging on `ctx.spillStore`) is deferred;
- **Multi-agent isolation**: each needs its own `root`; shared-memory semantics deferred to phase 3;
- **Sandbox backend**: when `root` is outside the workspace, the model's fs tools may not write there; phase 3 evaluates a memory-specific write tool or sandbox exemption;
- **Real e2e verified**: tools/ark-e2e.ts runs the "write memory → real embedding recall" loop against a real ARK endpoint (2048 dims, top hit 0.648, unrelated-query filtering); contract tests still stay keyless with a deterministic bag-of-words stub.
