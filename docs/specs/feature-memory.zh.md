# 功能规格：Memory（个人助手记忆）

[English](feature-memory.md) | 中文

- **状态**：implemented（阶段 2 补漏 ✅，2026-08-14）
- **实现包**：`packages/openclaw/memory`（`@clawdsh/dsh-memory`）+ `packages/openclaw/embeddings`（`@clawdsh/dsh-embeddings`）+ `packages/openclaw/embeddings-ark`（`@clawdsh/dsh-embeddings-ark`）
- **OpenClaw 对应**：Memory 系统（长期记忆：人/事/偏好，跨会话检索）。基线出处：OpenClaw `v2026.1.15`（`9c4c9c5edd`）`src/memory/` + `src/agents/memory-search.ts` + `src/agents/tools/memory-tool.ts`（基线 v2026.1.5 无 memory，功能补全参考）。
- **决策记录**：docs/adr/0003-embeddings-seam.md · Agent Note [2026-08-14-memory-plugin](../../.agents/notes/implemented/feature/2026-08-14-memory-plugin.md) · [2026-08-14-memory-flush-turn](../../.agents/notes/implemented/feature/2026-08-14-memory-flush-turn.md)

## 目标

- 提供「跨会话长期记忆」：agent 能记住用户说过的人、事、偏好（文件为事实源，跨会话可检索）；
- 语义召回：`memory_search` 按 embedding 余弦排序返回带源行号的片段；`memory_get` 按行读回；
- 检索内容注入会话时遵守日志不变式（"model-visible means logged"）；
- 存储走既有接缝，不造新后端；
- 预压缩 memory flush：上下文接近窗口时，一个带 plugin 源的静默回合要求模型按压缩周期一次写入持久记忆（OpenClaw 的 `memory-flush`）。

## 非目标

- 不自建向量数据库/检索引擎：embedding 走外部 OpenAI 兼容端点（Ark），chunk + cosine 是包内纯函数，索引是内存派生数据；
- 不做本地 embedding 模型（OpenClaw 的 local GGUF 分支留阶段 3 评估）；
- 不做每请求自动注入记忆（OpenClaw 同构：按需工具 + 静态指引段）；
- 不做无 embeddings provider 时的词汇降级：已定论拒绝而非仅延期——两个评分空间语义不同，静默切换会误导模型（见 rejected Note [2026-08-14-memory-lexical-fallback](../../.agents/notes/rejected/feature/2026-08-14-memory-lexical-fallback.md)）；
- 不做多用户记忆隔离（跟随 dsh 的 agent/session 隔离模型，多 agent = 各自 root）；
- 不做回合前置压缩**之前**的 flush：flush 回合在回合之间运行，可能自身先触发压力压缩（成文降质，见 [flush Agent Note](../../.agents/notes/implemented/feature/2026-08-14-memory-flush-turn.md)）。

## 接缝（已写死）

- `ctx.fs`（声明 inject）：`MEMORY.md` + `memory/YYYY-MM-DD.md` 的存储与读取。插件自身零写入，写由模型的 fs 工具 + 指引段规约承载；append-only 幂等由 observation policy 版本守卫兜底；
- `ctx.tools`：`memory_search` / `memory_get`（generic 呈现）；
- `ctx.systemPrompt`：`clawdsh:memory-recall` 段（order 115，工具指引带 100–199）；
- `ctx.get('embeddings')`（可选读，`@clawdsh/dsh-embeddings` seam）：无 provider 时 `memory_search` fail-loud；
- **无新 session event**：指引段经 `request/header.header.system`、召回内容经工具结果入日志。

原候选 `ctx.spillStore` / `ctx.sessionPersistence` 经 Spike 深读否决（spillStore 只存不读 + session 隔离；sessionPersistence 是回合日志不承载记忆条目），理由见 ADR-0003 备选方案。

## 配置面

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
  watch: true                    # 宿主文件变更监听（默认开，主动失效）
  watchStabilityThresholdMs: 200 # 变更稳定阈值 ms
  watchPollIntervalMs: 100       # 稳定性探测间隔 ms
  flush:
    enabled: true                # 预压缩 flush 回合开关
    reserveTokensFloor: 20000    # 窗口下方保留的 token 余量
    softThresholdTokens: 4000    # 余量之下的软触发带
    prompt: 'Store durable memories now (use memory/YYYY-MM-DD.md; create memory/ if needed). If nothing to store, reply with NO_REPLY.'
```

## 验收标准

1. ✅ 会话 A 写入一条记忆事实，会话 B 可检索到（测试：跨文件召回 `recalls related facts`，文件经 `ctx.fs` 写入后 `memory_search` 命中）；
2. ✅ 检索注入内容出现在 session log 中（工具结果经 tools seam 入日志——重建路径已论证，`src/invariant.ts` 记录）；
3. ✅ 更换 embedding 后端无需改动其他插件（embeddings seam 单实现可替换；测试用词袋 stub 替换真实 provider）；
4. ✅ 记忆写入/更新是幂等事件（append-only 规约 + observation policy 版本守卫；插件零写入故自身无幂等冲突）；
5. ✅ 预压缩 memory flush：实测上下文越过 `contextWindow − reserveTokensFloor − softThresholdTokens` 时，携带 flush prompt 的 plugin 源回合按压缩周期入队一次（测试：阈值、每周期一次、`compaction/end` 后 re-arm、NO_REPLY、失败遏制、缺 seam、注销）；flush 决策先于其自身回合的压缩（与真实压缩引擎的集成测试）。
