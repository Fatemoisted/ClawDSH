# Agent Note：Agent 管理的 Automation 与 owner-bound 投递

Status: implemented

[English](2026-08-17-agent-managed-automation.md) | 中文

## 问题

Automation 已挂载在产品 profile 中，却只暴露一组需要重启才生效的 Config 规则。交互式 Agent 拥有 Bash 与后台任务工具，却没有 Automation 管理工具，因此「三分钟后提醒我」这类请求可能被近似成 Batch 或休眠进程，而不是创建持久定时工作。Settings 页面也会一直显示关闭，直到用户手工编写规则并重启 Host。

从 Channel 创建的任务还有第二个缺口。专属 Automation Session 会保留结果，但从飞书创建任务的用户无法在原会话收到定时回复。让 model 提供原始 destination id 虽然能实现投递，却会引入权限升级与不可靠的路由表面。

## 决策

始终挂载的 Automation plugin 注册单一 model-visible `automation` 工具，支持 `list`、`add`、`update` 与 `remove` action。工具描述明确负责提醒、未来工作与周期任务，并禁止改用 Bash、Batch、jobs、sleep 或后台进程。`add` 接受 `after_seconds`、`at`、`every_seconds` 或 `cron` 之一；plugin 会在持久化前把相对延迟转换成绝对 `at` 时间戳。规则 id 通过 `randomUUID()` 分配，不由 model 选择。

`clawdsh-automation` Settings namespace 是持久规则 store，现在即时生效。协调器会串行处理变更与修订，完整释放当前不可变 scheduler，再校验并初始化替代 runtime。产品控制 response 读取当前持久 `enabled` 值，不再把 Loader Fiber 或重启时快照当作 Automation enablement。

变更要求当前 Agent turn 包含直接人类输入。Context provider 可以在该输入后追加 model-visible user message，但不会替换它的授权；后续的自主 turn 不能复用更早 turn 的授权。普通 user message 授权创建仅保留在 Session 的任务。Channel message 还必须具有 `trust: 'owner'`；plugin 会从持久 message provenance 派生 Gateway、channel、account、conversation 与可选 thread。工具 schema 不包含这些 route 字段，因此 model 无法伪造或改投。Web editor 在编辑可见规则字段时会保留这些私有 metadata。

每次成功的定时回合仍归属于专属持久 Session。规则携带原 route 时，Automation 会提取最终非空 assistant 文本，并执行一次 `channel.action`；SHA-256 action id 由规则、计划触发点与 target 派生。Channel Provider 不可用、最终文本为空或返回 dead-letter 时，Automation 运行会变为 `error`。UI 与 Web 创建的规则没有 route，结果只保留在 Session。

Settings 持久化是期望状态的提交点。替代 runtime 随后若初始化失败，持久修订仍会保留，同时变更会明确失败；后续有效变更可以替换它。因此 Settings 页面报告已提交的期望 enablement，而失败的工具调用会报告 runtime 未完成应用。

## 考虑过的替代方案

**教 Soul 把提醒转换成 shell 或 Batch 操作。** 否决，因为进程生命周期不是持久调度，prompt 文案也无法提供缺失的生命周期、持久化、检查与渠道投递行为。

**分别暴露 `automation_add`、`automation_list`、`automation_update` 与 `automation_remove` 工具。** 否决，因为单一 closed-action 工具提供相同权限，同时缩小 model-visible 工具目录，并只需一份明确的所有权描述。

**保持重启时生效的 Settings，让工具只编辑文件。** 否决，因为工具调用即使成功，scheduler 仍会运行旧修订，直到发生无关的重启。

**让 model 提供 destination id。** 否决，因为持久且已认证的 message provenance 已经标识允许的 destination。Model 编写路由会允许非预期跨会话投递，还会让重试依赖不透明的文本参数。

**把结果注入原 Web Session。** 否决，因为 Automation 任务已经拥有持久、可检查的 Session，而 Web 交互没有跨重启的权威投递 destination。只有 communication plane 提供 authenticated route 时才支持 Channel 投递。

## 影响

明确的提醒与周期任务请求现在可以在同一个 Agent 回合中创建持久 Automation 规则。Settings 页面会立即反映当前持久 enablement；关闭最后一项活跃规则或删除它时，会释放 timer 与 Agent handle，无需重启 Host。

从 owner 飞书会话创建的任务会把最终回复返回该会话，同时在专属 Automation Session 中保留完整运行、工具与输出。Channel id 始终是私有配置 metadata，不能由用户编辑或 model 写入。

修改规则会替换 scheduler runtime，因此进行中的触发会先被取消并完全结束，新修订随后才开始。这优先保证只有一个明确的已应用修订，不让新旧 schedule 重叠。一次性任务投递失败后仍保持终态，与既有 `at` 单次尝试语义一致。

## 验证

真组合测试通过 `ctx.tools` 执行 `automation` 工具，证明即时 add/list/update/remove 持久化与 scheduler 替换，并推进 scheduler 获得真实 scripted Agent 回复。隔离的已安装 profile 快照会把 prompt 发送到仅监听 loopback 的 DeepSeek-compatible provider，并记录实际 model-visible Automation 名称、所有权描述、action 与 schedule selector。Owner-channel 测试证明穿过 context injection 的私有 route 捕获、拒绝跨 turn 复用授权、确定性 outbound action identity、最终文本投递与终态运行状态。既有 scheduler、持久性、resume、失败及注销测试继通过。产品壳测试证明即时的 Automation 期望 enablement、经过净化的 Channel health、authenticated-Bridge 展示，以及 Web editor 会保留私有 delivery metadata。
