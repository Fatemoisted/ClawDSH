# ADR-0003：文本嵌入 seam（`ctx.embeddings`）——记忆语义检索的依赖接缝

- **状态**：Accepted（2026-08-14）
- **日期**：2026-08-14
- **依赖**：ADR-0001（构建链豁免）、ADR-0002（自有 seam 先例）

## 上下文

Memory 插件（交付 B）需要「按语义召回记忆」：OpenClaw v2026.1.15 的 `memory_search` 用 embedding + cosine 排序（`src/memory/embeddings.ts`、`src/agents/tools/memory-tool.ts`）。深读与摸底确认 dsh 侧**没有任何嵌入/向量/语义检索设施**：

- `ctx.llm` 只有 chat/completion 流，无 embedding 端点；
- `ctx.sessionQuery`（FTS5）是词法检索，非语义；
- `ctx.spillStore` 只有 `saveText`、按 owner session 隔离、locator 不透明无读 API——与「跨会话、可读回、人类可编辑的记忆事实源」语义互斥（handoff 原预设被深读证伪，记录在备选方案）；
- `tool-fs-search` 是 ripgrep 文件/内容搜索，同域不同义。

语义召回是 memory 的必要条件，而它是 dsh 的真实缺口——要么新增 seam，要么不做语义检索。

## 决策

1. **新增 `ctx.embeddings` 单实现服务**（Service Definition，spill 式）：`abstract embed(texts): Promise<number[][]>`，每 context 一个实现，load 第二个 throw。**否决多 provider 注册表**（web 式）：混合 provider 产生不可比的嵌入空间，cosine 排序无意义；OpenClaw 原实现同样是配置二选一（openai-remote / local-gguf）。将来若需多 provider，升级路径在消费侧（配置选 provider），seam 保持不动。
2. **三件套拆包**：`@clawdsh/dsh-embeddings`（Service Definition）+ `@clawdsh/dsh-embeddings-ark`（Provider）+ `@clawdsh/dsh-memory`（Consumer），镜像 dsh 的 spill/spill-local 分层。
3. **第一个 provider = 火山方舟 Ark 文本嵌入**（发起人指定）：POST `https://ark.cn-beijing.volces.com/api/v3/embeddings/multimodal`（OpenAI 兼容响应），model `doubao-embedding-vision-251215`，只发 `type: "text"` 输入；API Key 经 credentials seam 每操作解析（根 `.env` 的 `ARK_API_KEY`，永不入仓库），解析不到 fail-loud。
4. **memory 存储 = 纯 Markdown 文件经 `ctx.fs`**（`MEMORY.md` + `memory/*.md`，对齐 OpenClaw「文件是事实源」），索引是派生数据、纯内存不落盘（文件变更增量重建）。
5. **无 embeddings provider 时 `memory_search` fail-loud**（错误信息指名需要 `@clawdsh/dsh-embeddings-ark`）；词汇打分降级列 Deferred（两个评分空间语义不同，静默切换会误导模型）。
6. **上游提案缓行**：本次偏离「ADR → 上游 PR → profile patch 过渡」纪律默认流程——上游 PR 周期太长、上游无暇回应（ADR-0002 已确立先例）。`ctx.embeddings` 作为 ClawDSH 自有 seam 长期保留，`docs/upstream-proposal/` 暂不建档；未来若上游自建等价能力再评估去留，差异记录回本 ADR。

## 契约

```ts
// @clawdsh/dsh-embeddings（仅类型 + 抽象服务）
export type EmbeddingVector = number[]

export abstract class Embeddings extends Service {
  // super(ctx, 'embeddings') 注册；单实现，重复 load throw
  abstract embed(texts: readonly string[], signal?: AbortSignal): Promise<EmbeddingVector[]>
}
```

语义：输出向量数 == 输入数、按输入序；同一次调用内维度一致（provider 可额外承诺跨调用稳定，ark 实现并 fail-loud on 漂移）；任何失败整体 reject、无部分结果；`signal` 透传协作取消。访问方式：可选服务用 `ctx.get('embeddings')`（缺席返回 `undefined`），不声明 inject。

## 后果

- ✅ memory 获得真正的语义召回，且存储（fs）、工具（tools）、提示段（systemPrompt）、日志（session log）全部挂在既有接缝上；
- ⚠️ 自有 seam +1（与 `ctx.channels` 同政策长期保留），上游同步时需关注其是否自建 embedding 能力；
- ⚠️ 记忆检索依赖外部 key（Ark），离线部署无检索；离线词汇降级为 Deferred 而非静默行为；
- ⚠️ embedding 维度以服务端为准，跨版本漂移由 provider fail-loud 拦截（宁可报错，不可污染 cosine 排序）。

## 备选方案

- **`ctx.sessionQuery` FTS5 词法检索（保留为 Deferred）**：零新 seam，但「语义召回」名不副实——记忆条目措辞与查询措辞不同时漏检；作为无 key 环境的降级路径留阶段 3 评估。
- **`ctx.spillStore` 作存储（被否决）**：handoff 原预设；深读确认 SpillStore 只有 `saveText`、session 隔离、locator 不透明——`memory_get` 无法读回、跨会话验收标准无法满足、索引须自存全文使 spill 沦为只写影子。
- **每请求自动注入记忆（被否决）**：OpenClaw 原实现刻意不做自动注入（按需工具 + `## Memory Recall` 规约段），自动注入放大了 token 成本且偏离上游功能类别。
- **先向上游提 PR 再落地（缓行）**：周期风险（ADR-0002 同款理由）；自有域先行，形态稳定后再评估上游提案。
- **本地 GGUF embedding（暂缓）**：OpenClaw 的 local 分支；引入模型文件与原生依赖，阶段 3 按需评估。
