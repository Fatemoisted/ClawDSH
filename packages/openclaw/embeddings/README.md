# @clawdsh/dsh-embeddings

**定位**：文本嵌入能力 seam（Service Definition）——`ctx.embeddings` 抽象服务：把文本映射到同一个可比嵌入空间里的稠密向量，供语义检索消费。定义「做什么」不定义「怎么做」；实现包（provider）子类化 `Embeddings` 挂载注册。

**OpenClaw 对应**：OpenClaw memory 的 embeddings 后端选一（v2026.1.15 `src/memory/embeddings.ts` 的 openai-remote / local-gguf 二选一）。本 seam 保持同样的「每 context 单实现」语义；第一个 provider 是 `@clawdsh/dsh-embeddings-ark`（火山方舟）。

**接缝**：新增 `ctx.embeddings` 单实现服务（ADR-0003）。可选服务访问用 `ctx.get('embeddings')`（缺席返回 `undefined`），不声明 inject。

**规格**：docs/adr/0003-embeddings-seam.md · **状态**：implemented

## 使用

provider 侧：子类化 `Embeddings`，实现 `embed`，作为插件加载即可（构造器 `super(ctx, 'embeddings')` 完成注册，重复加载第二个实现会 throw）：

```ts
import { Embeddings } from '@clawdsh/dsh-embeddings'
import type { EmbeddingVector } from '@clawdsh/dsh-embeddings'

export class MyEmbeddings extends Embeddings {
  async embed(texts: readonly string[], signal?: AbortSignal): Promise<EmbeddingVector[]> {
    throw new Error('not implemented')
  }
}
```

消费侧（如 `@clawdsh/dsh-memory`）：`ctx.get('embeddings')` 读取；无后端时按各自契约降级或 fail-loud。

## 设计要点

- **单实现**：一个 context 只有一个 embedding 后端——混合 provider 会破坏 cosine 可比性（向量来自不同嵌入空间时排序无意义），这正是 OpenClaw 配置二选一的理由；
- **批内契约**：输出向量数 == 输入文本数、按输入序；同一次调用内所有向量维度一致；任何失败整体 reject、无部分结果；
- **signal 透传**：协作取消经 `AbortSignal` 传入 provider（工具超时、会话取消走同一条链）；
- **不拥有**：chunk、索引、相似度排序归 `@clawdsh/dsh-memory`；凭证归 `@deepseek-ai/dsh-credentials`。

## 变更说明

- 0.1.0：Seam 初始形态（单实现 `ctx.embeddings` + `embed` 批内契约 + seam 契约测试 4 例）。

## Model Experience

### The embedding service

#### What the model sees

The model never sees vectors directly — they surface only through consumers such as `@clawdsh/dsh-memory`, whose `memory_search` tool result carries matched snippets, paths, and scores into the session transcript.

#### Token effect

The seam itself performs no model request and contributes no prompt section, so it adds no model-facing tokens of its own.

#### KV Cache effect

No prompt text is produced by the seam; per-call embedding payloads are provider-side HTTP bodies and never touch the prompt prefix.

## Known Limitations and Deferred Work

- **单 provider**：`ctx.embeddings` 单实现；多 provider 需求出现时在消费侧做注册表升级（本 seam 保持不动）；
- **无维度协商**：维度以 provider 返回为准，seam 不声明期望维度；跨调用维度漂移由 provider 自行 fail-loud（ark 已实现，实测 2048）；
- **无本地模型**：本期只有远端 HTTP provider；本地 GGUF（OpenClaw 的 local 路径）留待阶段 3；
- **真实 e2e 已验**：Ark wire 经 tools/ark-e2e.ts 真实闭环（2026-08-14），见 embeddings-ark README。
