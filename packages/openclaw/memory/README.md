# @clawdsh/dsh-memory

**定位**：个人助手记忆后端——把 OpenClaw 式的长期记忆（人/事/偏好，跨会话检索）落到 dsh 的持久化接缝上。

**OpenClaw 对应**：Memory 系统（长期记忆、跨会话上下文）。

**接缝**：`ctx.spillStore` / `ctx.sessionPersistence`（候选）。先在 Spike 中验证两个接缝的语义差异再定（见 docs/specs/feature-memory.md）。

**规格**：docs/specs/feature-memory.md · **状态**：planning

## 备注

- dsh 的 session log 是 append-only 事实源，记忆检索结果必须回写到 log（"model-visible means logged"）；
- 不重造存储：优先复用 `session-persistence-sqlite/jsonl` 的 provider 模式。
