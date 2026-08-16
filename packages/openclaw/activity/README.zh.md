# @clawdsh/dsh-activity

[English](README.md) | 中文

`@clawdsh/dsh-activity` 提供可选的 `ctx.clawdshActivity` 语义活动写入服务和安全的 sidecar 读取接口。Prompt、Memory、Channels、Skills 与 Automation 生产者只能调用类型化领域方法；公开摘要与 metadata 字段由本服务选择，因此调用方不能提交任意文本或任意 metadata 对象。

## 配置

`clawdsh-activity` Settings namespace 只有一个由安装器管理的字段：

```yaml
enabled: true
```

schema 只接受 `true`。Activity 是 ClawDSH 产品的必需能力，但生产者插件保持独立：它们通过 `ctx.get('clawdshActivity')` 发现服务，并在服务缺失或追加返回 degraded 时继续完成自己的权威业务操作。

## 生产者 API

服务为每个固定 sidecar kind 提供一个类型化方法：`promptContribution`、`memorySearch`、`memoryRead`、`memoryWrite`、`memoryUpdate`、`memoryFlush`、`channelReceived`、`channelDelivery`、`skillCatalog`、`skillLoaded`、`skillInvoked` 和 `automationRun`。每个方法返回 `{ written, degraded }` 并在内部消化文件系统失败；生产者不得把 Activity 成功当成自身操作的提交点。

Prompt 记录只保留固定 section 身份、append/replace 模式、字符数、SHA-256、生产者和 Session seq。Memory 记录只保留 kind、生命周期状态、seq、写入 scope、更新 action 和可选的封闭 outcome。Channel 记录只保留 adapter、direct/group 分类、mention 事实、生命周期状态和 seq。Skill 记录只保留 skill 身份或目录数量、生命周期状态和 seq。Automation 记录只保留 rule 身份、计划时间、生命周期状态和 seq。

`list({ sessionId, producers? })` 会等待当前服务实例已经接收的写入，按选定 Session 和生产者文件校验每一行 JSONL，并且只返回规范记录以及 `availability`、`degraded` 和稳定的 `activity-data-incomplete` warning。它绝不返回物理路径或文件系统错误。

`page(request, { live?, inspect? })` 会投影标准 Session history，优先使用传入的 live log，并在其缺失时回退到已经校验的 `sessionPersistence.inspect()` events，然后把投影与 sidecar 合并。Projector 用 `(turn, step, callId)` 匹配支持的工具调用与结果。它识别 Memory 搜索、读取、写入、更新和 flush；channel 来源的用户消息；skill 工具、目录和调用记录；以及 `automation/run`。它只读取 Memory 包自有的精确成功文案，派生 `stored`、`already-stored`、`updated`、`forgotten`、`already-current` 或 `not-found`；无法识别的旧结果会省略 outcome，不会猜测。它绝不保留消息正文、任意工具参数或结果、平台身份、provider 路径或错误正文。语义重复项优先保留标准 history 记录，冲突的重复 id 会把页面标记为 degraded，每次 Automation 执行在排序前折叠为一条最终已知 lifecycle 记录。

页面默认返回最新 50 条，最多接受 100 条。Version-1 base64url cursor 绑定 Session hash、规范化 category filter、order、完整筛选结果的 snapshot digest、timestamp 和 id。来自其他查询或结果 snapshot 已变化的 cursor 会失败，不会静默跳过、重复或重排记录。History 或 sidecar 任一不可用时，页面仍会返回另一来源，并提供明确的 availability 和稳定 warning。

## Sidecar 存储

每个 Session 使用 `$DSH_HOME/clawdsh/activity/v1` 下的 SHA-256 路径；原始 Session id 绝不会成为路径片段。五个固定 active 文件是 `soul.jsonl`、`memory.jsonl`、`channels.jsonl`、`skills.jsonl` 和 `automation.jsonl`。

在 POSIX host 上，目录会被强制设为 `0700`，active 与轮转文件会被强制设为 `0600`。一条完整 JSONL 记录（包括换行）上限为 8 KiB。每个 active 文件上限为 1 MiB，并保留 `.1`、`.2` 两个轮转文件。追加操作按 `(Session, producer)` 串行；服务 dispose 会先停止接收，再等待所有已经进入队列的追加完成。

旧 Session 缺少文件属于正常状态。无效行和不完整尾部会被跳过，原文件不会被改写，读取结果会标记 degraded。目录、权限、追加、轮转、读取与关闭失败都会使 Activity 降级，但不会从类型化生产者方法向外抛出。

## 隐私

持久化格式使用封闭的 kind-to-metadata 映射和包内生成的摘要。格式中没有 prompt 文本、消息正文、sender、account、conversation id、thread id、message id、delivery id、工具参数、工具结果、凭据值、路径或错误正文的字段。渠道投递回执含义不明确时会省略 `status`，不会伪造失败状态。

## Model Experience

### 语义 Activity 记录

#### What the model sees

模型看不到任何内容。Activity sidecar 是面向人的投影视图，不进入 Session log、`request/header`、prompt、工具 schema、工具结果或模型请求。

#### Token effect

直接 token 影响为零。Activity 的记录与读取不会改变模型输入或输出。

#### KV Cache effect

没有影响。此包不修改 system-prompt 前缀或后续任何请求内容。

## Known Limitations and Deferred Work

- **尽力而为的完整性** — 记录缺失、损坏、不可写或被轮转淘汰时，权威业务系统保持不变；Activity 历史可能不完整，并通过状态报告，而不会修复源数据。
- **单 Host 写入者** — 队列顺序只在进程内成立；两个独立 Harness 进程写入同一个 DSH home 时没有协调机制。
- **有界保留** — 每个 Session 的每个生产者最多保留三个 1 MiB 文件；更早的语义记录会被轮转丢弃。
