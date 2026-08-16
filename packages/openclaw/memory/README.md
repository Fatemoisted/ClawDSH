# @clawdsh/dsh-memory

English | [中文](README.zh.md)

**Positioning**: long-term memory for a personal assistant — `MEMORY.md` (stable facts) and `memory/YYYY-MM-DD.md` (journal notes) are plain Markdown, cross-session, and human-editable. `memory_write` owns safe creation and append, `memory_update` corrects or forgets an exact durable fact, `memory_search` ranks snippets by semantic recall, and `memory_get` reads them back by line number. The index is in-memory derived data, rebuilt incrementally from the files and never persisted to disk.

**OpenClaw counterpart**: the Memory system (v2026.1.15 `src/memory/` + `src/agents/memory-search.ts` + `src/agents/tools/memory-tool.ts`). Recall remains on demand with the same guidance and scoring defaults. ClawDSH deliberately adds root-owned mutation tools because the normal dsh workspace policy cannot write the global Harness-home memory directory.

**Seams** (all pre-existing, none added):
- `ctx.fs` (declared inject): root-confined reads and guarded mutation. Per-target process serialization preserves concurrent writes, and fs-version compare-and-swap protects against external writers;
- `ctx.tools`: `memory_search`, `memory_get`, `memory_write`, and `memory_update`; mutation arguments never contain a path;
- `ctx.systemPrompt`: the `clawdsh:memory-recall` section (order 115, tool guidance carries 100–199);
- `ctx.get('embeddings')` (optional read): semantic vectors come from the `@clawdsh/dsh-embeddings` seam; **with no provider, `memory_search` fails loud** (the error names `@clawdsh/dsh-embeddings-ark`), no lexical fallback (the two scoring spaces are semantically different, and a silent switch would mislead the model);
- **no new session event**: the guidance section reaches the log via `request/header.header.system`, and recalled content reaches the transcript as tool results — both reconstruction paths are existing mechanisms, so "model-visible means logged" needs no new event (argument in `src/invariant.ts`).

**Spec**: docs/specs/feature-memory.md · docs/adr/0003-embeddings-seam.md · **Status**: implemented

## Usage

```yaml
- id: memory
  name: '@clawdsh/dsh-memory'
  config:
    enabled: true                 # false registers no prompt, tools, watcher, or flush hooks
    root: /abs/path/to/memory      # 必配：记忆根目录（fail-loud）
    # chunkSizeChars: 1600          # chunk 字符预算
    # chunkOverlapChars: 160        # 相邻 chunk 句子对齐重叠
    # maxResults: 6                 # 单次召回上限
    # minScore: 0.35                # cosine 阈值
    # snippetChars: 700             # 片段字符上限
    # timeoutMs: 30000              # 协作超时（透传 embed）
    # maxReadLines: 1000            # memory_get 行数硬上限
    # maxWriteChars: 4000           # 单条写入/更正的字符上限
    # watch: true                   # 宿主文件变更监听（默认开，主动失效）
    # watchStabilityThresholdMs: 200  # 变更稳定阈值 ms
    # watchPollIntervalMs: 100        # 稳定性探测间隔 ms
    # flush:                        # 预压缩 flush 回合（默认启用）
    #   reserveTokensFloor: 20000   # 窗口下方保留 token 余量
    #   softThresholdTokens: 4000   # 软触发带
    #   prompt: 'Store durable memories now with memory_write. If nothing to store, reply with NO_REPLY.'
```

The `clawdsh-memory` settings namespace is restart-applied: startup resolves schema defaults, profile base, then the user section. A committed edit changes the desired value; the running Memory registrations remain unchanged until process restart.

The configured root may be absent on a clean installation. Search then returns an empty result without calling Embeddings; the first successful `memory_write` creates the root and its fixed target. When semantic search is not configured, the model is instructed to fall back to a direct `memory_get` of `MEMORY.md`. Stable facts use `scope: durable`, running notes use `scope: daily`, and corrections or forget requests use `memory_update` after an exact read.

## Design notes

- **Files are the sole source of truth**: the plugin owns only guarded operations on the two fixed Markdown targets and maintains the derived index; the index detects changed files by `(version, size)` and rebuilds incrementally before each search, while a recoverable watcher proactively invalidates host edits;
- **One embed batch**: each search's embed calls = the query + all un-embedded chunks, one HTTP call on cold start, one HTTP call on incremental edits;
- **Path allowlist + symlink safety**: `isMemoryPath`, `fs.contains`, and host `lstat` reject absolute paths, traversal, and symbolic-link roots, daily directories, or memory files;
- **Idempotent durable facts**: exact durable lines are deduplicated across retries; updates remove contradictions or forget an exact line. Daily notes remain append-only;
- **Fail-loud culture**: a missing configured root is a valid empty store, while a missing embeddings provider, path escape, symlink, invalid mutation, or dimension drift fails loudly without exposing a physical path;
- **Dispose rollback**: the section, four tools, watcher recovery, and in-flight watcher lifecycle are quiescent on unload.
- **Fail-closed disable**: `enabled: false` returns before prompt, tools, watcher, index, or flush hooks are created.

## Changelog

- 0.1.0: first release, later hardened for clean-install root creation, four root-owned tools, exact correction/forget, durable deduplication, concurrent host writes, symlink rejection, and quiescent watcher recovery.

## Model Experience

### The recall guidance section

#### What the model sees

A fixed guidance section on every request: recall before answering questions about prior facts, proactively store stable identity/preferences/decisions/projects, correct or forget exact durable facts, and never store secrets or facts the user declines to retain.

#### Token effect

Constant per mounted plugin: the section's tokens appear on every request; the section text never changes at runtime.

#### KV Cache effect

Prefix-stable: static text, registered at mount.

### Recalled memories (tool results)

#### What the model sees

Only when the model calls a Memory tool. Search/read results enter the transcript; write/update results contain only fixed success states and never echo content or physical paths. Nothing is pre-injected.

#### Token effect

Proportional to what the model retrieves (bounded by `maxResults`/`snippetChars`/`maxReadLines`), not to the size of the memory corpus.

#### KV Cache effect

Tool results land mid-transcript, like any tool output; no system-prompt prefix changes.

### The pre-compaction flush turn

#### What the model sees

When the measured context crosses `contextWindow − reserveTokensFloor − softThresholdTokens`, one plugin-sourced message carrying `source: {kind: 'plugin', plugin: 'memory-flush'}` queues once per compaction cycle. Channel delivery stays bound to the exact admitted message's owning turn, so a later flush turn cannot replace its result. The queued prompt is, verbatim:

##### Flush prompt

```markdown
Store durable memories now with memory_write. If nothing to store, reply with NO_REPLY.
```

#### Token effect

One prompt message plus one reply per flush, only on cycles where the threshold is crossed — zero in low-context sessions.

#### KV Cache effect

Append-only: the prompt lands mid-log as an ordinary turn input; no system-prompt prefix changes.

## Known Limitations and Deferred Work

- **The flush runs between turns, not strictly before the main turn**: an inbound queued before the flush completes runs first; and the flush turn's own pre-step may trigger the pressure compaction first, so the flush writes from the compacted summary (with dsh's default compaction threshold below the flush threshold, compaction → flush-from-summary is the common flow; tune `compaction.thresholdRatio` above the flush threshold for the OpenClaw ordering);
- **Flush skip-list is mount-level**: profiles that do not mount the memory row never flush (maps OpenClaw's heartbeat/CLI/sandbox-ro skips);
- **Lexical fallback** (retrieval without embeddings) is rejected: the two scoring spaces are semantically different and a silent switch would mislead the model (see the rejected Note `2026-08-14-memory-lexical-fallback`);
- **Spill of oversized retrieval results** (hanging on `ctx.spillStore`) is deferred;
- **Multi-agent isolation**: each needs its own `root`; shared-memory semantics deferred to phase 3;
- **Real e2e**: `tools/ark-e2e.ts` covers real embedding recall; package tests cover missing-root write → recall with a deterministic keyless provider, and the product profile acceptance covers cross-session Agent use.
