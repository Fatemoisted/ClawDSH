# 功能规格：Automation（定时 agent 回合）

[English](feature-automation.md) | 中文

- **状态**：implemented（阶段 3 ✅，2026-08-17 增加 Agent 即时管理与渠道返回）
- **实现包**：`packages/openclaw/automation`（`@clawdsh/dsh-automation`）
- **OpenClaw 对应**：Cron（`v2026.1.5` `src/cron/`）：Config 声明的 `cron`/`at`/`every` 调度、每规则一个专属会话、prompt 帧、in-flight 去重、无重试、无追赶。
- **决策记录**：初始调度器映射 [2026-08-14-openclaw-cron-mapping](../../.agents/notes/implemented/architecture/2026-08-14-openclaw-cron-mapping.md)；完整组合且可发现的会话修正 [2026-08-16-automation-composed-discoverable-sessions](../../.agents/notes/implemented/bug-fix/2026-08-16-automation-composed-discoverable-sessions.md)；Agent 即时管理与 owner-bound 投递 [2026-08-17-agent-managed-automation](../../.agents/notes/implemented/feature/2026-08-17-agent-managed-automation.md)。

## 目标

- 每条已启用的 Config 规则在每次触发时于专属会话（`automation:<id>`）中驱动一个普通 agent 回合；安装了会话持久化时，该会话可跨重启续接。
- 每个定时 agent 都挂载配置的完整 preset（默认 `clawdsh`），因此 Soul、Memory、Skills、工具及其他 preset 贡献与交互式 ClawDSH 会话一致。
- 新会话记录配置的 `cwd` 与 `agentPreset`；Host 提供标题与 workspace 服务时，会话还会获得标题 `自动任务 · <name-or-id>`，并出现在拥有该 `cwd` 的 workspace 中。
- 调度器支持 `cron`、一次性 `at` 与锚定的 `every` 规则，具备 in-flight 去重、无自动重试和无追赶突发的语义。
- 会话日志即 run log：已 flush 的 `started` 事件先于回合；观察到 `turn/end` 或执行失败后，恰好跟随一个 `ok` 或 `error` 终态事件。
- Model 会获得单一 `automation` CRUD 工具。提醒与定时工作请求使用它，不能改用 Batch、Bash、jobs、sleep 或后台进程；提交变更无需重启即可生效。
- 从 owner-authenticated Channel 消息创建的任务会把成功的最终文本返回准确的原会话。Model 不会得到可写的 channel route 字段。

干净安装的 `clawdsh` profile 会让 Automation plugin 保持 mounted，同时配置 `enabled=false` 且不包含规则。因此 Config schema 与管理工具仍然可用，而关闭的业务 effect 不会创建 timer、runtime 或 Automation 会话。明确的提醒或定时工作请求会授权 Agent 创建规则；plugin 不会在没有该请求时自行推断 schedule。

## 非目标

- 无任意渠道改投与主会话摘要（`System:` 行）；只支持 owner-authenticated 原渠道投递。
- 无独立 job-store 文件或 Automation CLI。用户设置分区是持久规则 store，CRUD 通过 Agent 工具与 Settings UI 提供。
- 无文件变更 watcher 等事件触发规则。
- 不复用 `ctx.schedule`：其 300 秒 `every` 下限、session-local 交付、live-root-only 挂载与工具面创建 API 无法表达本功能类别。

## 运行时依赖

- `ctx.agents`、`ctx.agentPresets`、`ctx.sessions` 与 `ctx.agentDefaultModel` 为必需项：每条规则 resume 或 create 一个 agent、挂载配置的 preset，并以 `followup → whenIdle → sessions.flush` 驱动回合。
- `ctx.tools` 与 `ctx.settings` 为必需项：`automation` 工具持久化规则变更，即时协调器会完整释放旧的不可变 scheduler，再应用下一份已解析设置修订。
- `ctx.get('channels')` 对普通任务是可选项，只在规则携带 owner-derived 原 route 时才是必需项。成功的最终 assistant 文本使用确定性 action id 发送；投递失败会让该次运行记为 `error`。
- `ctx.get('sessionPersistence')` 是可选项：存在时，其产物提供跨进程 resume 与持久的 `at` 终态 guard；缺少时，规则在每个进程中重新开始。
- `ctx.get('sessionTitle')` 与 `ctx.get('workspaceRegistry')` 是可选的发布服务。安装后，发布失败会让 Automation 初始化失败，不会留下仅发布一部分的会话。
- 会话事件 `automation/run` 以 declaration merging 并入 `SessionEventMap`，字段为 `{ruleId, scheduledAt, status: 'started'|'ok'|'error', error?}`。定时回合是普通已记录回合，因此 model-visible 输入仍可重建。

## 配置面

```yaml
automation:
  enabled: true
  preset: clawdsh
  cwd: /absolute/path/to/workspace
  rules:
    - id: morning-digest
      name: Morning
      schedule: { kind: cron, expr: '0 9 * * *', timeZone: Asia/Shanghai }
      message: Post a morning digest of the session log.
    - id: weekly-review
      schedule: { kind: at, at: '2026-08-17T09:00:00+08:00' }
      message: Write the weekly review.
    - id: ping
      schedule: { kind: every, seconds: 3600 }
      message: Check whether anything needs attention.
```

规则 id 必须匹配 `[a-zA-Z0-9_-]+`，并构成持久会话的后缀。Web editor 为每个新增任务生成基于 UUID 的新 id，因此删除后新建不会因重用列表位置而续接已删除任务的 Session。非法 id、重复 id、相对 `cwd`、cron 表达式、时区及 `at` 时间戳会让初始化失败，适用时指明受影响的规则。在 ClawDSH Settings 分区中，`preset` 与 `cwd` 由安装器管理；用户只编辑业务开关和自动任务。

Agent-facing `automation` 工具支持 `list`、`add`、`update` 与 `remove`。`add` 必须且只能提供 `after_seconds`、`at`、`every_seconds` 或 `cron` 之一；`time_zone` 只可配合 `cron`。变更要求 owning Agent 的最新 model-visible 输入是直接用户消息。Channel 输入必须具有 `trust: 'owner'`；plugin 自行派生并保存 route，工具 schema 不包含 route 参数。

## 运行时保证

1. `every` 规则只在一个完整间隔过去后首次运行。一次运行完成后，在本进程最初的锚点网格上选择下一个严格晚于当前时间的触发点；长时间运行期间错过的间隔直接跳过。
2. `cron` 规则在上一次运行完成后计算下一次触发，因此已过去的 cron 边界不会产生追赶突发。
3. `at` 规则只尝试一次。`ok` 或 `error` 都是终态，匹配的持久终态事件会阻止过期触发点在重启后再次运行。
4. 到期规则串行运行，已在运行的规则不能与自身重叠。
5. 提交 prompt 前先 append 并 flush `started`。成功必须存在 reason 为 `completed` 的真实 `turn/end`；缺失、报错、取消或其他未完成的回合终止均产生 `error`。
6. 每次尝试恰好 append 一个终态事件。终态 flush 失败会记录为未持久化，但不会再次 append 第二个终态。
7. 初始化会先取得全部规则会话，再启动 timer。Preset 挂载、resume/create、标题发布、flush 或 workspace 关联失败时，已取得的 handle 会被释放，plugin 初始化会被拒绝。
8. 注销会中止待完成的取得过程、清除 timer、取消活跃 agent、等待进行中的 tick，并释放每个已取得的 handle。
9. 设置变更与工具变更串行执行。旧 runtime 完全释放前，新修订不能开始工作；本地产品控制读取当前持久 `enabled` 值，而不是重启时快照。
10. 原渠道运行只有在定时回合完成且 Provider 接受最终文本后才记为 `ok`。UI 与 Web 创建的规则不含 delivery metadata，结果保留在专属会话中。

## 失败与兼容边界

- 安装了 `workspaceRegistry` 时，新 Session 会记录当前绝对 `cwd`，该路径必须能解析到已注册 workspace，否则 Automation 会响亮地初始化失败。续接 Session 使用其不可变 header `cwd` 发布，因此修改安装配置只影响新 Session。没有 registry 时，定时会话仍会运行，但不关联 workspace。
- 没有 `sessionTitle` 时，会话仍会运行，只是没有友好标题。已有标题会被保留。
- 终态 flush 失败时，当前进程仍把一次 `at` 尝试视为已完成，但持久化无法保证重启后的 once-guard；warning 会明确指出这次持久性丢失。
- 旧版本创建的会话可能缺少不可变的 `cwd` 或 `agentPreset` header 字段。Resume 仍会在运行时挂载配置的 preset，但不会重写旧 header metadata。
- 设置持久化先于即时 runtime 初始化完成。新提交的规则集若无法初始化，会继续作为期望的持久配置保留，同时变更会明确失败；后续有效编辑可以恢复运行。
