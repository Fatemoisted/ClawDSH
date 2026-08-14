# Agent Note: 文本嵌入 seam（ctx.embeddings）——记忆语义检索

Status: implemented

[English](2026-08-14-embeddings-seam.md) | 中文

## 问题

Memory 插件需要语义召回——OpenClaw `v2026.1.15` 的 `memory_search` 用 embedding 余弦相似度给 chunk 排序。dsh 全库没有任何嵌入/向量/语义检索设施：`ctx.llm` 只有 chat/completion 流，`ctx.sessionQuery` 是 FTS5 词法检索，`ctx.spillStore` 无读 API 且按 session 隔离，`tool-fs-search` 是 ripgrep。语义召回是 memory 需要而 dsh 真正缺失的唯一能力，移植必须补上——要么新增 seam，要么插件内自研。

## 决策

新增单实现服务 seam `ctx.embeddings` 加首个 provider，三件套拆包，镜像 spill/spill-local 的分层：

| 包 | 角色 |
|---|---|
| `@clawdsh/dsh-embeddings` | Service Definition：抽象 `Embeddings`（`super(ctx, 'embeddings')`）、`embed(texts, signal?) → number[][]`、词汇类型。 |
| `@clawdsh/dsh-embeddings-ark` | Provider：火山方舟文本嵌入（多模态端点、仅 `type: "text"` 输入）、凭证每操作分层解析、响应校验含跨调用维度漂移检测。实测 wire（2026-08-14 验证）：每请求一个 `data.embedding` 单对象、2048 维、每文本一个请求——该端点把整个 input 数组嵌成一条多模态条目，无法批量。 |
| `@clawdsh/dsh-memory` | Consumer：经 `ctx.fs` 的 Markdown 记忆文件、内存派生索引、`memory_search`/`memory_get` 两工具。 |

关键设计点（完整决策记录见 [ADR-0003](../../../../docs/adr/0003-embeddings-seam.md)）：

- **单实现，不做 provider 注册表。** 一个 context 混合 provider 产生不可比的嵌入空间、破坏 cosine 排序；OpenClaw 自己的 embeddings 层就是配置选一。将来多 provider 需求在消费侧升级（配置选 provider），本 seam 不动。
- **凭证每操作解析、绝不缓存**，遵循 credentials seam 契约与 `web-search-deepseek` 的分层：字面量 `apiKey` → `ctx.get('credentials')` → launch environment。缺 key fail-loud，不静默降级。
- **响应校验落在做出决定的那个操作**：条目数 == 输入数、向量非空全有限、批内维度一致；跨调用维度漂移整次调用失败（服务端静默换模型不得污染消费端 cosine 排序）。
- **消费端无 provider 即 fail-loud。** `ctx.get('embeddings')` 缺席时 `memory_search` 报错并指名 `@clawdsh/dsh-embeddings-ark`；词汇降级列 Deferred——两个语义不同的评分空间静默切换会误导模型。
- **上游提案缓行。** 沿 ADR-0002 先例，seam 先在 ClawDSH 自有域落地；形态稳定后再评估向上游提案。对「ADR → 上游 PR → patch 过渡」默认流程的偏离记录在 ADR-0003。

## 考虑过的替代方案

**用 `ctx.sessionQuery` FTS5 做召回。** 本次否决：词法检索不是语义召回——措辞不同的查询会漏检——而验收标准是 OpenClaw 的 embedding 排序 `memory_search`。保留为无 key 部署的已评估降级路径，延后到阶段 3。

**用 `ctx.spillStore` 作记忆存储。** 否决：`SpillStore` 只存不读、按 owner session 隔离、locator 不透明——`memory_get` 无法读回、跨会话检索失败、索引须自存全文使 spill 沦为只写影子。

**每请求自动注入召回记忆。** 否决：OpenClaw 刻意做按需工具召回 + 静态 `## Memory Recall` 指引段；自动注入放大每请求 token 成本且偏离移植的功能类别。

**先向上游提 PR 再落地。** 缓行：上游 PR 周期太长且现在就需要 seam（ADR-0002 先例）；记录在 ADR-0003 供日后重估。

**本地 GGUF 嵌入（OpenClaw 的 local 分支）。** 暂缓：引入模型文件与原生依赖；离线部署场景留阶段 3 评估。

## 影响

- memory 获得真正的语义召回，而其存储、工具、指引段、日志全部挂在既有接缝上（`ctx.fs`、`ctx.tools`、`ctx.systemPrompt`、session log）。
- ClawDSH 自有 seam 增至两个（`ctx.channels`、`ctx.embeddings`），同政策长期保留；上游同步时复查 dsh 是否自建等价能力。
- 召回依赖外部 key（Ark）；离线部署在词汇降级落地前无检索。
- embedding 维度以服务端为准；provider 的漂移守卫在模型静默升级时以可用性换排序完整性。
