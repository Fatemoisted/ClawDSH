# Agent Note: OpenClaw 式记忆落地 dsh 接缝（memory_search / memory_get）

Status: implemented

[English](2026-08-14-memory-plugin.md) | 中文

下述存储与召回决策仍然有效；其中“插件自身零写入且只提供两个工具”的结论已被[自有变更与干净安装空库](../bug-fix/2026-08-16-memory-owned-mutation-and-empty-store.md)部分取代。

## 问题

ClawDSH 阶段 2 需要 Memory 行：OpenClaw 的长期记忆（人/偏好/决策/既往工作，跨会话检索）作为 dsh 插件。handoff 原指针是 `ctx.spillStore` 持久化，但 OpenClaw `v2026.1.15` 深读与 dsh 接缝盘点证伪了它：OpenClaw 的记忆是纯 Markdown 文件作事实源（人类可编辑、跨会话、`memory_get` 可读回），而 `SpillStore` 只存不读、按 owner session 隔离、locator 不透明无读 API——承载不了被移植的功能类别。语义召回是唯一真实缺口：dsh 全库无 embedding 设施。

## 决策

Memory 行以函数插件形态只挂既有接缝，语义召回缺口由新 embeddings seam 补上（[2026-08-14-embeddings-seam](../architecture/2026-08-14-embeddings-seam.md)、[ADR-0003](../../../../docs/adr/0003-embeddings-seam.md)）：

- **存储 = 经 `ctx.fs` 的 Markdown 文件**——`MEMORY.md` 存稳定事实、`memory/YYYY-MM-DD.md` 日记式追加。插件自身零写入；模型经 fs 工具按指引段规约写入（OpenClaw 同构——无专用写工具）。append-only 幂等由 fs observation policy 的版本守卫兜底。
- **召回 = 按需工具，无每请求注入**——`memory_search`（embedding cosine 排序，默认 `minScore` 0.35 / `maxResults` 6，片段带源行号）与 `memory_get`（行切片读取，`isMemoryPath` 白名单 + `FileSystem.contains` enforcement）。不做任何自动注入；召回内容以工具结果入转录，「model-visible means logged」无需新 session event 即成立。
- **索引 = 派生数据，纯内存不落盘**——每次 search 前按文件 `(version, size)` 戳增量重建；chunk（`chunkMarkdown`，句子对齐重叠）与 cosine 是包内纯函数。每次 search 一次 embed 批 = 查询 + 所有未嵌入 chunk。
- **无 embeddings provider 时 fail-loud**——`memory_search` 报错并指名 `@clawdsh/dsh-embeddings-ark`；词汇降级被拒绝——两个语义不同的评分空间静默切换会误导模型（见 [rejected note](../../rejected/feature/2026-08-14-memory-lexical-fallback.md)）。
- **静态指引段**——`clawdsh:memory-recall`（order 115，工具指引带），固定文本教召回工作流与 append-only 写入规约，镜像 OpenClaw 的 `## Memory Recall` 段。

## 考虑过的替代方案

**用 `ctx.spillStore` 作存储。** 否决：只存不读、session 隔离、locator 不透明——`memory_get` 读不回、跨会话验收标准失败、索引须自存全文使 spill 沦为只写影子。记录于 ADR-0003。

**用 `ctx.sessionPersistence` 建专用 memory session。** 否决：session log 是带 header 不变式的 append-only 回合记录；记忆条目不是回合，把日志当数据库会撞 session 加载不变式。

**索引落盘（sqlite，如 OpenClaw）。** 否决：持久化索引是第二份会漂移的事实；OpenClaw 用 sqlite 是因为它的文件之外没有别的副本且要 watch。此处文件单独权威且量小，内存增量重建更简单且零漂移，重建成本只随变化文件增长。

**无 provider 时词汇打分降级。** 拒绝而非交付：两个评分空间会让结果语义随部署静默改变，违背 fail-loud（见 [rejected note](../../rejected/feature/2026-08-14-memory-lexical-fallback.md)）。

**每请求自动注入召回记忆。** 否决：OpenClaw 刻意按需召回；自动注入放大 token 成本且偏离移植的功能类别。

## 影响

- 记忆完全可从 session log 重建：指引段走 `request/header.header.system`，召回内容走工具结果。无需新增 session event 类型。
- 记忆根目录由部署拥有（`root` 必配 fail-loud）——跨会话检索因文件集中一处而成立；多 agent 隔离即各自 root。
- 召回依赖外部 embedding provider（Ark）；离线部署无检索——词汇降级被拒绝而非延期（见 [rejected note](../../rejected/feature/2026-08-14-memory-lexical-fallback.md)）。
- OpenClaw 的预压缩 memory flush 回合（「存量记忆写入」驱动器）延后到阶段 3、挂 dsh compaction 钩子；此前写入依赖模型遵守规约。
