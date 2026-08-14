# @clawdsh/dsh-memory

**定位**：个人助手长期记忆——OpenClaw 式「文件是事实源」的记忆系统落在 dsh 既有接缝上：`MEMORY.md`（稳定事实）+ `memory/YYYY-MM-DD.md`（日记式追加）是纯 Markdown 文件，跨会话、人类可编辑；`memory_search` 按语义召回排序片段，`memory_get` 按行号读回。索引是内存派生数据，从文件增量重建，不落盘。

**OpenClaw 对应**：Memory 系统（v2026.1.15 `src/memory/` + `src/agents/memory-search.ts` + `src/agents/tools/memory-tool.ts`）。对齐其形态：无专用写工具（模型经文件工具写入，见下）、按需工具召回（无每请求自动注入）、`## Memory Recall` 指引段、minScore 0.35 / maxResults 6 默认值。

**接缝**（全部既有，不新增）：
- `ctx.fs`（声明 inject）：存储与读取——**插件自身零写入**，写由模型的 fs 工具 + 指引段规约承载（OpenClaw 同构）；append-only 幂等由 fs observation policy 的版本守卫兜底；
- `ctx.tools`：`memory_search` / `memory_get` 两工具（generic 呈现，无 presentCall）；
- `ctx.systemPrompt`：`clawdsh:memory-recall` 段（order 115，工具指引带 100–199）；
- `ctx.get('embeddings')`（可选读）：语义向量来自 `@clawdsh/dsh-embeddings` seam；**无 provider 时 `memory_search` fail-loud**（错误指名 `@clawdsh/dsh-embeddings-ark`），不做词汇降级（两个评分空间语义不同，静默切换会误导模型）；
- **无新 session event**：指引段经 `request/header.header.system` 入日志，召回内容以工具结果入转录——两条重建路径都是既有机制，「model-visible means logged」无需新事件（论证见 `src/invariant.ts`）。

**规格**：docs/specs/feature-memory.md · docs/adr/0003-embeddings-seam.md · **状态**：implemented

## 使用

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

写入规约（由指引段教给模型）：稳定事实进 `MEMORY.md`，运行笔记追加到 `memory/YYYY-MM-DD.md`，只经文件工具、只追加不改写历史。

## 设计要点

- **文件是唯一事实源**：插件只读文件、只维护派生索引；索引以 `(version, size)` 判定变化文件，每次 search 前增量重建（个人记忆规模下成本可忽略；chokidar watch 列 Deferred）；
- **一次 embed 批**：每次 search 的 embed 调用 = 查询 + 所有未嵌入 chunk，冷启动一次 HTTP、增量编辑一次 HTTP；
- **路径白名单 + 双保险**：`isMemoryPath`（`MEMORY.md` | `memory/<file>.md`，拒绝绝对路径与 `..`）+ `fs.contains(root, target)` 在解析操作处 enforcement；
- **fail-loud 文化**：root 必配、无 embeddings provider、路径逃逸、维度漂移（provider 侧）全部响亮失败；
- **dispose 回卷**：段与两工具注册全部走 `ctx.effect`，卸载即移除（测试覆盖）。

## 变更说明

- 0.1.0：首版（chunk+增量索引+双工具+指引段；契约测试 13 例，keyless 词袋 stub）。

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

- **无专用写工具**：写入靠模型遵守规约（OpenClaw 同构）；预压缩 memory flush 回合（OpenClaw 的存量写入驱动）留阶段 3，挂 dsh compaction 钩子；
- **无 chokidar watch**：变更靠 search 前增量重建，不主动推送；
- **词汇降级**（无 embeddings 时的检索）列为 Deferred——阶段 3 离线场景评估；
- **超大检索结果 spill**（挂 `ctx.spillStore`）列 Deferred；
- **多 agent 隔离**：需要各自配置 `root`；共享记忆语义留阶段 3；
- **sandbox 后端**：`root` 在 workspace 外时模型的 fs 工具可能写不进去，阶段 3 评估记忆专用写工具或沙箱豁免；
- **真实 e2e**：契约测试以确定性词袋 stub 替代真实 embedding；真实 ARK e2e 留凭证后验证。
