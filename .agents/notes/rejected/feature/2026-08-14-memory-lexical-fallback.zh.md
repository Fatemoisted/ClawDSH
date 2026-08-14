# Agent Note: 无 embeddings provider 时 memory_search 的词汇降级

Status: rejected — 保持 fail-loud：embedding 与词汇评分处于不同的语义空间，静默切换会误导模型

[English](2026-08-14-memory-lexical-fallback.md) | 中文

## 问题

`memory_search` 在 `ctx.get('embeddings')` 缺失时 fail-loud（错误指名 `@clawdsh/dsh-embeddings-ark`）。因此离线部署——没有 Ark 密钥——完全没有检索能力，只剩按行号的 `memory_get`。[memory-plugin note](../../implemented/feature/2026-08-14-memory-plugin.md) 将此记为「deferred，阶段 3 评估」，[ADR-0003](../../../../docs/adr/0003-embeddings-seam.md) 也把词汇降级列为「Deferred」。本 note 收口这一悬置项：降级被拒绝，而非仅延期。

## 提案

当没有 embeddings provider 时，退回到词汇评分器——token 重叠，或 `ctx.sessionQuery` FTS5——而不是报错，让无密钥部署保留部分 `memory_search` 检索能力。

## 曾考虑的替代方案

**保持 fail-loud（采纳）。** embedding 排序按语义排序；词汇排序按 token 重叠排序。同一条查询，取决于部署恰好加载了哪个后端，可能返回不同的 top-hit 集合，而模型无法从工具结果中区分二者。因此静默切换会误导模型去信任它无法判定的结果。fail-loud 保证每一次 `memory_search` 结果在语义上可比较、可信。这正是 ADR-0003 §5 与 memory-plugin note 中已落地的行为；本 note 把记录在案的「deferred」转为明确的拒绝。

**词汇降级（拒绝）。** 本 note 存在的理由：上述语义错配，外加记忆行所秉持的 fail-loud 文化（root 必配、路径逃逸、维度漂移全部响亮失败）。

**`ctx.sessionQuery` FTS5（拒绝）。** 同样的语义错配，且给记忆行新增一条 seam 依赖，却无正确性收益。

## 复活形态

若离线部署将来使「无 provider 也能检索」成为硬需求，应放在显式 opt-in 之后复活，而绝不做隐藏的 `?? default`：

- 一个 `lexicalFallback: boolean`（或 `rankBy: 'embedding' | 'lexical'`）配置字段，默认关闭，让切换成为在配置面上可见的部署决策；
- `memory_search` 里的插件层 ranker 分支按配置选择评分器，把 embedding 与词汇评分保持为两个独立 ranker，而非一条合并路径；
- 把 `StubEmbeddings` 的 token 重叠评分器提取为包内纯函数，让两个 ranker 共用一个经过测试的评分器；
- 修订 ADR-0003 §5，记录重新开启的决策及支撑它的部署证据。

在该需求出现之前，保持 fail-loud。

## 风险

- 离线部署没有语义检索；这是成文的、被接受的限制，而非隐藏的降质。
