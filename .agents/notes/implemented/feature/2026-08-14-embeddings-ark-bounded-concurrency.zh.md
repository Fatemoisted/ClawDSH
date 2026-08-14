# Agent Note: embeddings-ark 每文本请求有界并发

Status: implemented

[English](2026-08-14-embeddings-ark-bounded-concurrency.md) | 中文

## 问题

Ark 多模态嵌入端点把整个 input 数组当作**一条**多模态条目嵌入，批量不可能：`embed(N)` 发 N 个请求，每文本一个。阶段 2 收尾以严格串行交付，并发显式留到阶段 3（「One request per text … concurrency deferred」）。大语料召回（memory 的增量重嵌入）付 N 次串行往返。

## 决策

**`embed()` 内做有界 worker 池：最多 `maxConcurrentTexts`（Config，默认 4，`z.number().step(1).min(1)` 校验）个在途请求；每个 worker 从共享计数器认领下一个索引，结果天然按输入序落位；`Promise.all` 任一失败即整体 reject（embeddings seam 契约本就要求整体拒绝与保序，`embeddings/src/index.ts:34-45`）。兄弟请求失败时不强制取消在途请求。** `maxConcurrentTexts: 1` 精确复现原串行行为。

- 保序由索引分配自然成立——无排序、无结果重排环节；
- 不接每请求 controller：失败时强制取消兄弟请求要改动 `embedOne` 的 signal 管线，而正确性零收益（seam 反正整体拒绝，已发出的工作是浪费而非错误）；
- 并发上限是部署调优（小消费者 vs 服务端限流），故为带校验的 Config 字段（tool-jobs `maxConsecutiveWakes` 式理由），而非硬编码常量。

## 考虑过的替代方案

**无界 `Promise.all(texts.map(embedOne))`。** 否决：大批次（memory 语料 chunk）会一次开 N 个 socket 且无泄压阀；端点与消费者都需要一个上限。

**保持纯串行。** 否决：这正是延期的阶段 3 工作；memory 的增量重嵌入是当前付 N 次往返的消费者。

**首个失败即强制取消在途兄弟请求。** 否决：为无可见收益加 abort-controller 管线——seam 契约无论如何整体拒绝，provider 从不交付部分结果。

## 影响

- `embed(N)` 延迟从 N 次往返降到 ⌈N / maxConcurrentTexts⌉ 次往返，代价是最多 `maxConcurrentTexts` 个并发 socket；
- 5 个契约测试钉住行为：并发上限（延迟门 fetch mock 计在途数）、乱序完成下的输入保序、单失败整体拒绝、`maxConcurrentTexts: 1` 串行等价、schema 拒绝小于 1 的值；
- config-catalog 再生成含新键；预存的 `config-catalog.zh.md` 欠账（缺失的 `@clawdsh/*` 段）在同一次变更中补齐。
