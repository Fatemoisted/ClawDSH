# Feature spec：ClawDSH 语义 Activity

[English](feature-activity.md) | 中文

- **状态**：已实现
- **实现包**：`packages/openclaw/activity`（`@clawdsh/dsh-activity`）
- **产品界面**：当前 Session 的「ClawDSH 记录」对话标签，仅由 loopback `/clawdsh-rpc` 控制面提供数据

## 产品角色

「ClawDSH 记录」标签通过 Prompt、Memory、Channels、Skills 与 Automation 五类语义解释产品行为。技术 package、RPC endpoint 与 sidecar path 继续使用 Activity 名称。该标签补充相邻的 raw Trajectory；既不替代该诊断记录，也不声称能够重建最终扁平化的 System Prompt。

`clawdsh` profile 始终把 `@clawdsh/dsh-activity` 挂载为必需 Host 能力。它的 `clawdsh-activity` Settings namespace 只有安装器管理的 `enabled: true`。生产者仍把 `ctx.clawdshActivity` 视为可选的尽力而为服务：服务缺失、追加失败、权限失败、轮转失败或 sidecar 不可读可以使 Activity 视图不完整，但不能使 prompt 组装、Memory、渠道执行或投递、skill 行为或 Automation 失败。

Activity 绝不贡献模型可见内容。它的 sidecar 与浏览器 projection 不进入 Session log、`request/header`、prompt、工具 schema、工具结果或模型请求。

## 公开记录词汇

每条记录使用格式 version 1，包含 opaque id、规范时间戳、所属 Session id、category、固定 kind、包生成的 summary、kind 专属 scalar metadata 与可选 lifecycle status。封闭 kind 为：

| Category | Kinds |
|---|---|
| Prompt | `prompt.contribution` |
| Memory | `memory.search`、`memory.read`、`memory.write`、`memory.update`、`memory.flush` |
| Channels | `channel.received`、`channel.delivery` |
| Skills | `skill.catalog`、`skill.loaded`、`skill.invoked` |
| Automation | `automation.run` |

可选 status 是 `started`、`succeeded`、`failed` 或 `sent`。`started` 表示没有记录到匹配的完成结果，不表示工作仍在运行。含义不明确的渠道投递会省略 status，不会被报告为失败。生产者不能提交任意 summary 或 metadata object；每个 kind 由一个类型化 service method 拥有并构造完整公开表示。

## 来源与隐私

Activity 合并两个来源。Standard Session history 已记录某项事实时作为权威来源，有界 sidecar 则保留 ClawDSH 独有事实。语义重复项优先保留 history 派生记录；发生 id 冲突时页面会降级，而不是静默选择一方。

只有能证明实际进入最终 request header 的 ClawDSH contribution 才产生 Prompt 记录。记录保留固定 section identity、append/replace 模式、字符数、SHA-256 digest、producer 与 Session seq，但绝不保留 prompt 文本或 source path。标签明确说明它是 ClawDSH Prompt contribution，而不是最终 System Prompt。

Memory projection 用 `(turn, step, callId)` 匹配标准工具调用与结果，识别搜索、读取、写入、精确更新或删除，以及 memory-flush history。它只保留 operation kind、lifecycle status、Session seq、写入 scope、更新 action 和包内定义的隐私安全 outcome。写入 outcome 区分实际存储与长期事实完全重复；更新 outcome 区分真正更新或删除，与 already-current 或 not-found 的无修改结果。缺少 outcome 的旧记录仍然有效，使用中性呈现。Query、文件名、事实正文、snippet、任意结果与错误正文全部排除。

渠道接收 projection 使用 source kind 为 `channel` 的标准 `user/message`。只有 Agent bridge 提交新的 durable receipt 后才记录渠道投递，因此重放已有 receipt 不会产生另一条 Activity。公开字段仅限 adapter、direct/group 分类、mention 事实、lifecycle state 与 Session seq。Sender、account、conversation、thread、message 与 delivery identifier、消息正文和 transport error 全部排除。

Skill projection 识别标准 skill tool、catalog 与 invocation history。它保留有界的 skill identity 或 catalog count、lifecycle state 与 Session seq，但不保留 skill 正文、provider path、工具参数、结果或错误。Automation projection 识别 `automation/run`，只保留 rule id、scheduled time、lifecycle state 与 seq；prompt、model output 与错误全部排除。页面会在排序和分页之前折叠同一次定时执行的 `started` 与终止记录，因此一次运行只按最终已知状态和时间显示一次。

持久化格式没有 credential value、access token、filesystem path、任意 producer prose、raw tool data、message content 或错误正文的字段。RPC 与浏览器会在渲染前再次校验封闭的 kind-to-metadata 映射。

## Sidecar 存储

Sidecar 位于 `$DSH_HOME/clawdsh/activity/v1/<sha256(sessionId)>/` 下。原始 Session id 会先进行哈希，绝不成为路径片段。每个 Session 有五个固定 producer stream：`soul.jsonl`、`memory.jsonl`、`channels.jsonl`、`skills.jsonl` 与 `automation.jsonl`。

在 POSIX host 上，目录会被强制设为 `0700`，active 与 rotated file 会被强制设为 `0600`。一条完整记录连同换行上限为 8 KiB。每个 active stream 上限为 1 MiB，并保留 `.1` 与 `.2`；append 按 `(Session, producer)` 串行。Service dispose 会停止接收，并等待所有已经进入队列的 append。

旧 Session 缺少 sidecar 属于正常情况。无效行与不完整尾部会被跳过，不会重写原文件，同时结果会标记为 degraded。目录、权限、追加、轮转、读取与关闭失败会变成净化后的 availability 与 warning；物理 path 和 filesystem diagnostic 绝不跨越公开读取接口。

Retention 有界而不保证完整：每个 Session 的每个 producer 最多保留三个 1 MiB 文件。队列顺序只在进程内成立，因此两个独立 Harness 进程写入同一个 dsh home 时没有协调。

## History 合并与分页

受信 Host 提供当前 live Session events 或已校验的 `sessionPersistence.inspect()` events。Live history 优先；Session 不在运行时回退到 inspection。History 与 sidecar 可以分别不可用，`activity/list` 仍会返回另一来源，并明确提供 availability、degradation 与稳定 warning。

`activity/list` 是严格的 protocol-v1 `/clawdsh-rpc` request，包含 `sessionId`、可选 category filter、可选 `asc` 或 `desc` order、可选 limit 与可选 cursor。默认返回最新 50 条，最大 100 条。Versioned canonical base64url cursor 绑定经过哈希的 Session identity、规范 category filter、order、完整筛选结果的 snapshot digest、timestamp 与 record id。Cursor 损坏、来自其他 query，或结果集在两页之间发生变化时会失败，不会静默跳过、重复或重排记录。

Endpoint 继承产品控制面的 loopback-only authority。Remote trusted-host 页面仍可使用对话，但不能读取 Activity。Response 只暴露规范记录、continuation、availability、degraded state 与稳定 warning；不暴露 sidecar path 或 source error。

## 浏览器行为

ClawDSH 把 `clawdsh-records` 注册为 Chat 与 Trajectory 之后的第三个公开 `conversation.view` entry。Slot 会直接提供当前 Session id。Session 切换或视图卸载会中止上一请求、清除记录与 continuation，并从下一个已选 Session 的第一页开始。

用户可以选择「身份与上下文、记忆、外部消息、技能、定时任务」五类用户语言的任意组合，选择最新优先或最早优先，并在存在 continuation 时加载下一页。同一次请求的 Prompt contribution 合并为一张上下文准备卡。每项操作都使用中文标题和说明；Memory 无修改结果会明确说明，同时内容与错误正文保持私密。Package kind、事件序号、hash 与其他诊断字段收在「技术详情」中；该标签既不提供 raw JSON，也不会模拟跳转到 Trajectory。

公开对话 snapshot 报告新的完成回合后，视图会重新读取；Session 或筛选改变时会中止旧请求并重置。页面始终提供「重新读取」，用于获取稍后才写入的 sidecar-only 记录。分页 snapshot 改变时，用户需要从第一页重新读取。历史 Session 缺少 sidecar、当前 Session 尚未产生 sidecar、sidecar 不可读、Session history 不可用、部分 degraded、未选择分类和按类别筛选为空分别使用不同说明。来源缺失或 degraded 时，空结果只表示没有可显示的已选记录，绝不推断相应能力没有被使用。

## 集成约束

- ClawDSH Activity 不向上游 `SessionEventMap` 增加类型；standard history 只投影已经存在的已知事件。
- Activity 包是通过既有 ClawDSH additive build exception 注册的 Host plugin。浏览器继续位于 nested non-workspace 产品壳。
- 产品记录是面向人的 observability，不是权威 commit ledger。业务子系统继续保留已有 durable authority。
- Service 与 RPC 使用固定词汇和净化错误。扩展 kind 或 metadata 字段时，必须协同更新 package、控制 protocol、browser、privacy 与文档。

## 验证

Focused package test 覆盖类型化记录构造、privacy allowlist、权限、有界记录、轮转、队列清空、损坏尾部、不可用存储、`(turn, step, callId)` 工具配对、隐私安全 Memory outcome、Automation lifecycle 折叠、去重、排序、snapshot-bound cursor 与单来源降级。控制面与浏览器测试覆盖严格 protocol parsing、Slot 绑定的 Session 选择、完成回合刷新、切换及卸载取消、手动重新读取、filter、排序、分页重开、面向人的 card、折叠技术详情、remote denial、按来源区分的 availability 说明、degradation 与按类别细分的空结果。
