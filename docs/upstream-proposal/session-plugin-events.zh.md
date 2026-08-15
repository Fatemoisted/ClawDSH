# 提案：允许 downstream plugin append 可忽略 Session event

[English](session-plugin-events.md) | 中文

- **状态**：提议中；ClawDSH 与 dsh 均未实现
- **期望 owner**：上游 `@deepseek-ai/dsh-session`
- **驱动 consumer**：ClawDSH channel admission 与 delivery diagnostics

## 动机

dsh 有意拒绝恢复包含未知 required event 的 Session。`KNOWN_SESSION_EVENT_TYPES` 从上游仓库内的 `SessionEventMap` declaration 生成，因此 out-of-tree plugin event name 按构造不在其中。Event envelope 已支持 `ignorable: true`，允许 reader 安全跳过未知 informational event，persistence codec 也会保留该 marker。

Public live writer 无法生成它。`Session.append()` 只对 surface event type 接受 required surface metadata，对 non-surface event 不接受 option。Downstream plugin 可以 declaration-merge typed event 并成功 append，但持久化后，first-party reader 会因为 name 未知且 marker 缺失而拒绝 Session。因此，编译时 extensibility 形成了 durable fail-closed trap。

ClawDSH 在提议的 `channel/turn-admitted` 与 `channel/delivery` record 上发现了这一点。这些 record 是冗余 diagnostics：模型重建已使用带 channel provenance 的已知 `user/message`，channel sidecar ledger 拥有 admission、idempotency 与 delivery。ClawDSH 已禁用 namespaced event，而不是写出无法 resume 的 Session。

## 提议契约

增加 typed append option，让 writer 把**非 surface、纯 informational** event 标记为 ignorable：

```ts ignore-check
session.append('plugin/informational-event', payload, { ignorable: true })
```

精确 TypeScript overload 可沿用既有 conditional `SurfaceIntent` design，但必须强制以下义务：

1. `ignorable` 只接受 literal `true`；缺省继续表示 required。
2. Surface event 不能标记 ignorable。未知 model-visible surface content 绝不能从 reconstruction 消失。
3. Non-surface event 可接收 `{ ignorable: true }`；caller 仍不能设置其他 envelope field。
4. `Session.append()` 以和 type、data、sequence 与 time 相同的 atomicity snapshot、validate、freeze、publish 并返回 marker。
5. JSONL、SQLite、seed validation、fork、replay、wire schema 与 persistence coordination 精确保留 marker，与今天处理 restored event 一致。
6. Generated `KNOWN_SESSION_EVENT_TYPES` 保持 repo-wide 且 composition-independent。本提案不增加 runtime known-type registry。

## Plugin author 安全规则

只有删除该类型全部 event 后，model reconstruction、tool side-effect reconciliation、security decision、Session lifecycle 与 compatibility semantics 都不变，plugin 才能设置 `ignorable: true`。Event 可以辅助 audit、metric 或 presentation，但任何 operational state 必须仍有另一个 durable source 保持权威。

对 ClawDSH channel，未来 ignorable admission event 可以复制已存于 `user/message.source` 的净化 provenance，未来 delivery event 可以复制 Provider/Agent ledger 中的 receipt。两个 event 都不能成为唯一 idempotency、admission 或 delivery record。如果无法保持该冗余，event 必须保持不存在，直到其 type 成为带 format/version decision 的 first-party required event。

## 为什么不提议 runtime registration

“已知” plugin event 的 runtime registry 会让可读性依赖碰巧 mount 的 plugin。精简 composition 可能拒绝同版本完整 composition 写出的 log，卸载 plugin 也可能让旧 Session 不可读。既有 static repository vocabulary 加 per-event ignorable marker 可提供一致 reader，并让 skip safety 成为 writer obligation。

## 兼容性

这是在当前 persistence 与 wire schema 已接受的 envelope field 之上增加 writer surface。理解 envelope rule 的旧 reader 可跳过该 event；早于该规则的 reader 不在当前 pre-release compatibility promise 内。默认仍是 required，因此 author 忘记 option 会造成显式 resume refusal，而不是静默丢失 reconstruction。

如果已接受 envelope 与 persistence backend 已携带 `ignorable`，则无需提升 Session format version。如果实现发现某个 backend 或 wire path 丢弃该 field，则必须先修复该路径，并按其 owning version policy 重新评估，再发布。

## 验收标准

1. Type test 接受 ignorable non-surface downstream event，并拒绝 surface event 上的 `ignorable`、`false` 与无关 field。
2. Unit test 表明 live event、`session/event` observer、returned value、seed、fork 与 replay 都保留 `ignorable: true`。
3. JSONL 与 SQLite round trip 能恢复包含未知 ignorable event 的 Session，并继续拒绝缺少 marker 的同一未知 type。
4. 只增加 out-of-tree declaration 时，generated persistence catalog 保持不变。
5. 文档说明 author safety rule，并链接既有 Session versioning decision。
6. ClawDSH 保持 channel event 禁用，直到能消费携带该契约的已发布 upstream version，并在自有 composition 增加 persistence/resume coverage。

## 曾考虑的替代方案

- **直接经 `ctx.sessionPersistence.append` 写入**：拒绝，因为会绕过 live Session 的 sequence、surface validation、publication 与 ownership path。
- **把完整 `SessionEvent` cast 进 private log**：拒绝，因为会破坏 append-only API，并可能损坏 live/persisted agreement。
- **在本地把 ClawDSH event name 加进 upstream generated set**：因 upstream read-only rule 而拒绝，也因为每个 downstream plugin 都会需要 fork patch。
- **只在 Session event 存储 channel authority**：拒绝，因为 ignorable record 不能拥有 operational recovery state，而 required downstream name 对 first-party build 仍不可读。
