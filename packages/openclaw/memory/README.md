# @clawdsh/dsh-memory

English | [中文](README.zh.md)

**Positioning**: long-term memory for a personal assistant — an OpenClaw-style "files are the source of truth" memory system built on dsh's existing seams: `MEMORY.md` (stable facts) + `memory/YYYY-MM-DD.md` (journal-style append) are plain Markdown files, cross-session and human-editable; `memory_append` safely appends notes, `memory_search` ranks snippets by semantic recall, and `memory_get` reads them back by line number. The index is in-memory derived data, rebuilt incrementally from the files and never persisted to disk.

**OpenClaw counterpart**: the Memory system (v2026.1.15 `src/memory/` + `src/agents/memory-search.ts` + `src/agents/tools/memory-tool.ts`). It keeps OpenClaw's file layout, on-demand recall (no per-request auto-injection), `## Memory Recall` guidance, and minScore 0.35 / maxResults 6 default configuration. ClawDSH deliberately adds the narrow `memory_append` capability because dsh's session workspace sandbox may not contain the shared memory root.

**Seams** (all pre-existing, none added):
- `ctx.fs` (declared inject): storage, reads, and the atomic append. `memory_append` preserves the calling session's effective sandbox mode but replaces the writable root for that one operation with the configured memory root; guarded read→write plus per-target serialization prevents lost appends;
- `ctx.tools`: the `memory_append` / `memory_search` / `memory_get` tools (generic presentation, no presentCall);
- `ctx.systemPrompt`: the `clawdsh:memory-recall` section (order 115, tool guidance carries 100–199);
- `ctx.get('embeddings')` (optional read): semantic vectors come from the `@clawdsh/dsh-embeddings` seam; **with no provider, `memory_search` fails loud** (the error names `@clawdsh/dsh-embeddings-ark`), no lexical fallback (the two scoring spaces are semantically different, and a silent switch would mislead the model);
- **no new session event**: the guidance section reaches the log via `request/header.header.system`, and recalled content reaches the transcript as tool results — both reconstruction paths are existing mechanisms, so "model-visible means logged" needs no new event (argument in `src/invariant.ts`).

**Spec**: docs/specs/feature-memory.md · docs/adr/0003-embeddings-seam.md · **Status**: implemented

## Usage

```yaml
- id: memory
  name: '@clawdsh/dsh-memory'
  config:
    root: /abs/path/to/memory      # 路径必配；首次运行时目录可以尚不存在
    # chunkSizeChars: 1600          # chunk 字符预算
    # chunkOverlapChars: 160        # 相邻 chunk 句子对齐重叠
    # maxResults: 6                 # 单次召回上限
    # minScore: 0.35                # cosine 阈值
    # snippetChars: 700             # 片段字符上限
    # timeoutMs: 30000              # 协作超时（透传 embed）
    # maxReadLines: 1000            # memory_get 行数硬上限
    # flush:                        # 预压缩 flush 回合（默认启用）
    #   reserveTokensFloor: 20000   # 窗口下方保留 token 余量
    #   softThresholdTokens: 4000   # 软触发带
    #   prompt: 'Store durable memories now with memory_append (use memory/YYYY-MM-DD.md). If nothing to store, reply with NO_REPLY.'
```

Write convention (taught to the model by the guidance section): stable facts go into `MEMORY.md`, runtime notes into `memory/YYYY-MM-DD.md`, through `memory_append` only — append, never rewrite history.

## Design notes

- **Files are the sole source of truth**: `memory_append` changes the Markdown files themselves and the plugin maintains no separate write database; the derived index detects changed files by `(version, size)` and rebuilds incrementally before each search (negligible cost at personal-memory scale; chokidar watch is deferred);
- **First-run root is lazy**: `root` must be configured, but the directory itself need not exist yet. Search treats a missing root as an empty index, and the first guarded `memory_append` creates the target and parents;
- **One embed batch**: each search's embed calls = the query + all un-embedded chunks, one HTTP call on cold start, one HTTP call on incremental edits;
- **Configured search defaults are real defaults**: when a `memory_search` call omits `maxResults` or `minScore`, it uses the plugin configuration (6 / 0.35 only when that configuration is also omitted); explicit tool arguments override it;
- **Path allowlist + double safety**: `isMemoryPath` (`MEMORY.md` | `memory/<file>.md`, rejecting absolute paths and `..`) + `fs.contains(root, target)` enforced at the resolution operation; ordinary fs and shell tools receive no extra root;
- **Sandbox mode is preserved**: `workspace-write` receives the memory root only for `memory_append`, `read-only` still denies it, and a confining fs without `ctx.sandboxPolicy` fails load rather than writing unfenced;
- **Fail-loud culture**: root required, no embeddings provider, path escape, missing sandbox policy, and dimension drift (provider-side) all fail loudly;
- **Dispose rollback**: the section and all three tool registrations go through `ctx.effect`, removed on unload (test-covered).

## Implemented scope

- Semantic recall and bounded line reads: incremental index + `memory_search`/`memory_get`, with plugin-configured defaults and keyless deterministic embedding tests;
- Durable pre-compaction flush: threshold detection on `agent/turn-stopping`, with the completed compaction cycle derived from the persisted session log rather than plugin memory, so remount/restart does not duplicate a flush;
- Sandbox-aware `memory_append`: path allowlist, per-call memory root, preserved effective mode, lazy first-run creation, guarded concurrent append, and immediate re-indexing on the next search.

## Model Experience

### The recall guidance section

#### What the model sees

A fixed `## Memory Recall`-style guidance section on every request: when to use `memory_append`, `memory_search`, and `memory_get`, plus the append-only convention.

#### Token effect

Constant per mounted plugin: the section's tokens appear on every request; the section text never changes at runtime.

#### KV Cache effect

Prefix-stable: static text, registered at mount.

### Recalled memories (tool results)

#### What the model sees

Only when the model calls a memory tool: `memory_append` returns a short append receipt; `memory_search`/`memory_get` return ranked snippets with path, source lines, and cosine score, or line slices of one memory file. Every result enters the transcript as a tool result, never pre-injected.

#### Token effect

Proportional to what the model retrieves (bounded by `maxResults`/`snippetChars`/`maxReadLines`), not to the size of the memory corpus.

#### KV Cache effect

Tool results land mid-transcript, like any tool output; no system-prompt prefix changes.

### The pre-compaction flush turn

#### What the model sees

When the measured context crosses `contextWindow − reserveTokensFloor − softThresholdTokens`, one plugin-sourced message carrying `source: {kind: 'plugin', plugin: 'memory-flush'}` queues once per compaction cycle (channel reply extraction skips plugin-sourced turns), verbatim. The guard compares the newest durable flush message with the newest `compaction/end`, so it survives plugin remounts and process-style session resume:

##### Flush prompt

```markdown
Store durable memories now with memory_append (use memory/YYYY-MM-DD.md). If nothing to store, reply with NO_REPLY.
```

#### Token effect

One prompt message plus one reply per flush, only on cycles where the threshold is crossed — zero in low-context sessions.

#### KV Cache effect

Append-only: the prompt lands mid-log as an ordinary turn input; no system-prompt prefix changes.

## Known Limitations and Deferred Work

- **Flush execution is a queued turn**: its decision and `turn/start` precede any pressure compaction triggered in that flush turn, but the turn's own pre-step may compact before the model executes the flush prompt. With dsh's default compaction threshold below the flush threshold, writing from the compacted summary is therefore common; tune `compaction.thresholdRatio` above the flush threshold when pre-summary detail must be retained;
- **Flush skip-list is mount-level**: profiles that do not mount the memory row never flush (maps OpenClaw's heartbeat/CLI/sandbox-ro skips);
- **No chokidar watch**: changes rely on pre-search incremental rebuild, no proactive push;
- **Lexical fallback** (retrieval without embeddings) is deferred — evaluated in phase 3 offline scenarios;
- **Spill of oversized retrieval results** (hanging on `ctx.spillStore`) is deferred;
- **Multi-agent isolation**: each needs its own `root`; shared-memory semantics deferred to phase 3;
- **Cross-process append contention**: in-process calls serialize and external stale writes retry a bounded number of times; continuously competing processes can still exhaust the retry budget (the session persistence stack likewise assumes one daemon writer);
- **Real e2e verified**: tools/ark-e2e.ts runs the "write memory → real embedding recall" loop against a real ARK endpoint (2048 dims, top hit 0.648, unrelated-query filtering); contract tests still stay keyless with a deterministic bag-of-words stub.
