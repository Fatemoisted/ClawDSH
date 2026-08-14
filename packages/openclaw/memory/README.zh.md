# @clawdsh/dsh-memory

[English](README.md) | 中文

**定位**：个人助手长期记忆——OpenClaw 式「文件是事实源」的记忆系统落在 dsh 既有接缝上：`MEMORY.md`（稳定事实）+ `memory/YYYY-MM-DD.md`（日记式追加）是纯 Markdown 文件，跨会话、人类可编辑；`memory_append` 安全追加笔记，`memory_search` 按语义召回排序片段，`memory_get` 按行号读回。索引是内存派生数据，从文件增量重建，不落盘。

**OpenClaw 对应**：Memory 系统（v2026.1.15 `src/memory/` + `src/agents/memory-search.ts` + `src/agents/tools/memory-tool.ts`）。保留其文件布局、按需工具召回（无每请求自动注入）、`## Memory Recall` 指引段，以及 minScore 0.35 / maxResults 6 的默认配置。ClawDSH 有意增加窄能力 `memory_append`，因为 dsh 的 session workspace 沙箱未必包含共享 memory root。

**接缝**（全部既有，不新增）：
- `ctx.fs`（声明 inject）：存储、读取与原子追加。`memory_append` 保留调用 session 的有效 sandbox mode，只把这一项操作的可写 root 替换为配置的 memory root；守卫式 read→write 与逐目标串行化避免追加丢失；
- `ctx.tools`：`memory_append` / `memory_search` / `memory_get` 三工具（generic 呈现，无 presentCall）；
- `ctx.systemPrompt`：`clawdsh:memory-recall` 段（order 115，工具指引带 100–199）；
- `ctx.get('embeddings')`（可选读）：语义向量来自 `@clawdsh/dsh-embeddings` seam；**无 provider 时 `memory_search` fail-loud**（错误指名 `@clawdsh/dsh-embeddings-ark`），不做词汇降级（两个评分空间语义不同，静默切换会误导模型）；
- **无新 session event**：指引段经 `request/header.header.system` 入日志，召回内容以工具结果入转录——两条重建路径都是既有机制，「model-visible means logged」无需新事件（论证见 `src/invariant.ts`）。

**规格**：docs/specs/feature-memory.md · docs/adr/0003-embeddings-seam.md · **状态**：implemented

## 使用

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

写入规约（由指引段教给模型）：稳定事实进 `MEMORY.md`，运行笔记进 `memory/YYYY-MM-DD.md`，只经 `memory_append`——只追加、不改写历史。

## 设计要点

- **文件是唯一事实源**：`memory_append` 直接修改 Markdown 文件，插件没有另一套写数据库；派生索引以 `(version, size)` 判定变化文件，每次 search 前增量重建（个人记忆规模下成本可忽略；chokidar watch 列 Deferred）；
- **首次 root 延迟创建**：`root` 配置必填，但目录本身可以尚不存在；search 把缺失 root 视为空索引，第一次受围栏保护的 `memory_append` 会创建目标及父目录；
- **一次 embed 批**：每次 search 的 embed 调用 = 查询 + 所有未嵌入 chunk，冷启动一次 HTTP、增量编辑一次 HTTP；
- **配置默认值真正生效**：`memory_search` 未传 `maxResults` 或 `minScore` 时使用插件配置；只有插件配置也省略时才回落到 6 / 0.35，显式工具参数仍可覆盖；
- **路径白名单 + 双保险**：`isMemoryPath`（`MEMORY.md` | `memory/<file>.md`，拒绝绝对路径与 `..`）+ `fs.contains(root, target)` 在解析操作处 enforcement；普通 fs/shell 工具不会得到额外 root；
- **保留 sandbox mode**：`workspace-write` 仅为 `memory_append` 得到 memory root，`read-only` 仍然拒绝；受限 fs 缺少 `ctx.sandboxPolicy` 时加载失败，绝不无围栏写入；
- **fail-loud 文化**：root 必配、无 embeddings provider、路径逃逸、缺 sandbox policy、维度漂移（provider 侧）全部响亮失败；
- **dispose 回卷**：段与三工具注册全部走 `ctx.effect`，卸载即移除（测试覆盖）。

## 已实现范围

- 语义召回与有界行读取：增量索引 + `memory_search`/`memory_get`，插件配置默认值生效，并以无 key 的确定性 embedding 测试覆盖；
- 持久的压缩前 flush：在 `agent/turn-stopping` 判断阈值，已完成的压缩周期从持久 session log 而非插件内存推导，因此 remount/restart 不会重复 flush；
- sandbox-aware `memory_append`：路径白名单、逐调用 memory root、保留有效 mode、首次延迟创建、守卫式并发追加，并在下一次 search 立即增量重建。

## Model Experience

### The recall guidance section

#### What the model sees

每个请求都带固定的 `## Memory Recall` 风格指引段：何时使用 `memory_append`、`memory_search` 与 `memory_get`，以及 append-only 规约。

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

实测上下文越过 `contextWindow − reserveTokensFloor − softThresholdTokens` 时，一条携带 `source: {kind: 'plugin', plugin: 'memory-flush'}` 的 plugin 源消息按压缩周期入队一次（渠道回复提取跳过 plugin 源回合），原文如下。守卫会比较最新持久 flush 消息与最新 `compaction/end`，因此插件 remount 和进程式 session 恢复后仍然有效：

##### Flush prompt

```markdown
Store durable memories now with memory_append (use memory/YYYY-MM-DD.md). If nothing to store, reply with NO_REPLY.
```

#### Token effect

每次 flush 一条 prompt 消息加一条回复，且只在越过阈值的周期出现——低上下文会话为零。

#### KV Cache effect

Append-only：prompt 作为普通回合输入落在日志中段；无系统提示前缀变化。

## Known Limitations and Deferred Work

- **flush 以排队回合执行**：其判定和 `turn/start` 早于同一 flush 回合可能触发的压力压缩，但该回合的 pre-step 仍可能在模型执行 flush prompt 前先压缩。dsh 默认压缩阈值低于 flush 阈值时，从压缩摘要写入很常见；需要保留摘要前细节时，可把 `compaction.thresholdRatio` 调到 flush 阈值之上；
- **flush 跳过清单是挂载面的**：不挂 memory 行的 profile 永不 flush（映射 OpenClaw 的 heartbeat/CLI/sandbox-ro 跳过）；
- **无 chokidar watch**：变更靠 search 前增量重建，不主动推送；
- **词汇降级**（无 embeddings 时的检索）列为 Deferred——阶段 3 离线场景评估；
- **超大检索结果 spill**（挂 `ctx.spillStore`）列 Deferred；
- **多 agent 隔离**：需要各自配置 `root`；共享记忆语义留阶段 3；
- **跨进程追加竞争**：进程内调用会串行化，外部 stale 写入会做有界重试；持续竞争的多进程仍可能耗尽重试预算（session persistence 栈同样假设单 daemon writer）；
- **真实 e2e 已验**：tools/ark-e2e.ts 对真实 ARK 端点跑通「写记忆 → 真实 embedding 召回」闭环（2048 维、top 命中 0.648、无关查询过滤），契约测试仍以确定性词袋 stub 保持 keyless。
