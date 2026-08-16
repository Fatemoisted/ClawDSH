# @clawdsh/dsh-memory

[English](README.md) | 中文

**定位**：个人助手长期记忆。`MEMORY.md`（稳定事实）与 `memory/YYYY-MM-DD.md`（日常记录）是跨会话、人类可编辑的纯 Markdown；`memory_write` 负责安全创建和写入，`memory_update` 精确更正或遗忘长期事实，`memory_search` 按语义召回排序，`memory_get` 按行读回。索引仅是不落盘的内存派生数据。

**OpenClaw 对应**：Memory 系统（v2026.1.15 `src/memory/` + `src/agents/memory-search.ts` + `src/agents/tools/memory-tool.ts`）。召回仍是按需工具流程，指引与评分默认值保持对齐。ClawDSH 特意增加记忆根目录自有的变更工具，因为 dsh 的普通 workspace 写入策略不能写入全局 Harness-home 记忆目录。

**接缝**（全部既有，不新增）：
- `ctx.fs`（声明 inject）：受记忆根约束的读取与守卫写入；同一目标在进程内串行化，fs 版本 CAS 防止覆盖外部写入；
- `ctx.tools`：`memory_search`、`memory_get`、`memory_write` 与 `memory_update`；变更参数不接受路径；
- `ctx.systemPrompt`：`clawdsh:memory-recall` 段（order 115，工具指引带 100–199）；
- `ctx.get('embeddings')`（可选读）：语义向量来自 `@clawdsh/dsh-embeddings` seam；**无 provider 时 `memory_search` fail-loud**（错误指名 `@clawdsh/dsh-embeddings-ark`），不做词汇降级（两个评分空间语义不同，静默切换会误导模型）；
- **无新 session event**：指引段经 `request/header.header.system` 入日志，召回内容以工具结果入转录——两条重建路径都是既有机制，「model-visible means logged」无需新事件（论证见 `src/invariant.ts`）。

**规格**：docs/specs/feature-memory.md · docs/adr/0003-embeddings-seam.md · **状态**：implemented

## 使用

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

`clawdsh-memory` 设置 namespace 在重启时生效：启动时依次合并 schema 默认值、profile base 与用户分节。提交修改只改变 desired value；运行中的 Memory 注册保持不变，直到进程重启。`enabled: false` 会在创建 prompt、tools、watcher、index 或 flush hooks 之前返回。

干净安装时配置的记忆根可以不存在。此时搜索直接返回空结果且不调用 Embeddings；第一次成功的 `memory_write` 创建根目录与固定目标。语义搜索未配置时，模型会改用 `memory_get` 直接读取 `MEMORY.md`。稳定事实用 `scope: durable`，日常记录用 `scope: daily`，更正或遗忘则在精确读取后使用 `memory_update`。

## 设计要点

- **文件是唯一事实源**：插件只对两类固定 Markdown 目标执行守卫操作，并维护派生索引；索引按 `(version, size)` 增量重建，可恢复 watcher 主动失效宿主编辑；
- **一次 embed 批**：每次 search 的 embed 调用 = 查询 + 所有未嵌入 chunk，冷启动一次 HTTP、增量编辑一次 HTTP；
- **路径白名单 + 符号链接安全**：`isMemoryPath`、`fs.contains` 与宿主 `lstat` 拒绝绝对路径、遍历以及根目录、日记目录或记忆文件的符号链接；
- **长期事实幂等**：精确相同的 durable 行在重试时去重，更新会移除矛盾或精确遗忘；daily 记录保持追加语义；
- **fail-loud 文化**：配置根缺失是正常空库；无 embeddings provider、路径逃逸、符号链接、非法变更或维度漂移会响亮失败，但不暴露物理路径；
- **dispose 回卷**：指引段、四个工具、watcher 恢复和正在运行的 watcher 生命周期均以 quiescent 方式卸载。
- **关闭即无副作用**：`enabled: false` 会在创建 prompt、tools、watcher、index 或 flush hooks 之前返回。

## 变更说明

- 0.1.0：首版，后续完成干净安装根创建、四个根目录自有工具、精确更正/遗忘、durable 去重、并发宿主写入、符号链接拒绝与 quiescent watcher 恢复。

## Model Experience

### The recall guidance section

#### What the model sees

每次请求都有固定指引：回答过往事实前先召回，主动保存稳定身份/偏好/决策/长期项目，精确更正或遗忘事实，且永不保存凭据或用户拒绝保留的信息。

#### Token effect

Constant per mounted plugin: the section's tokens appear on every request; the section text never changes at runtime.

#### KV Cache effect

Prefix-stable: static text, registered at mount.

### Recalled memories (tool results)

#### What the model sees

只在模型调用 Memory 工具时出现。搜索/读取结果进入转录；写入/更新仅返回固定状态，不回显内容或物理路径。不做自动预注入。

#### Token effect

Proportional to what the model retrieves (bounded by `maxResults`/`snippetChars`/`maxReadLines`), not to the size of the memory corpus.

#### KV Cache effect

Tool results land mid-transcript, like any tool output; no system-prompt prefix changes.

### The pre-compaction flush turn

#### What the model sees

实测上下文越过 `contextWindow − reserveTokensFloor − softThresholdTokens` 时，一条携带 `source: {kind: 'plugin', plugin: 'memory-flush'}` 的 plugin 源消息按压缩周期入队一次。渠道投递始终绑定到已准入消息所属的精确回合，因此后续 flush 回合不能替换其结果。入队 prompt 原文如下：

##### Flush prompt

```markdown
Store durable memories now with memory_write. If nothing to store, reply with NO_REPLY.
```

#### Token effect

每次 flush 一条 prompt 消息加一条回复，且只在越过阈值的周期出现——低上下文会话为零。

#### KV Cache effect

Append-only：prompt 作为普通回合输入落在日志中段；无系统提示前缀变化。

## Known Limitations and Deferred Work

- **flush 在回合之间运行，而非严格早于主回合**：flush 完成前入队的入站先跑；且 flush 回合自身的 pre-step 可能先触发压力压缩，flush 从压缩后的摘要写记忆（dsh 默认压缩阈值低于 flush 阈值时，压缩 → 从摘要 flush 是常见流程；把 `compaction.thresholdRatio` 调到 flush 阈值之上即得 OpenClaw 顺序）；
- **flush 跳过清单是挂载面的**：不挂 memory 行的 profile 永不 flush（映射 OpenClaw 的 heartbeat/CLI/sandbox-ro 跳过）；
- **词汇降级**（无 embeddings 时的检索）已定论拒绝：两个评分空间语义不同，静默切换会误导模型（见 rejected Note `2026-08-14-memory-lexical-fallback`）；
- **超大检索结果 spill**（挂 `ctx.spillStore`）列 Deferred；
- **多 agent 隔离**：需要各自配置 `root`；共享记忆语义留阶段 3；
- **真实 e2e**：`tools/ark-e2e.ts` 覆盖真实 embedding 召回；包测试以确定性 keyless provider 覆盖缺根写入 → 召回，产品 profile 验收覆盖跨会话 Agent 使用。
