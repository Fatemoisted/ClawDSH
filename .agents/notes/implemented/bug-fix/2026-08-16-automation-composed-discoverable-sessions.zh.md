# Agent Note: 完整组合且可发现的 Automation 会话

Status: implemented

[English](2026-08-16-automation-composed-discoverable-sessions.md) | 中文

## 问题

[初始 cron 映射](../architecture/2026-08-14-openclaw-cron-mapping.md)正确选择了调度器所有权，但每条规则的执行 agent 组合不完整，其会话也难以找到。定时回合只选择 model，没有挂载配置的 ClawDSH preset，因此可能缺少交互式 ClawDSH 对话具备的 Soul、Memory、Skills 及其他能力。新建会话还缺少 `cwd`、`agentPreset`、可读标题与 workspace 归属，所以即使运行已存在于持久化中，结果也不会出现在正常会话列表里。

运行时语义还有相邻的正确性缺口。`every` 规则会在挂载时立即触发，而不是等待一个间隔；失败的 `at` 运行可能再次启动；完成状态从 idle 推断，而不是读取自己所属的 `turn/end`；终态持久化失败可能在 append `ok` 后进入 catch 路径，并为同一次尝试再次 append `error`。Agent 取得过程没有可等待的初始化边界，注销也可能与待完成的取得过程和 timer 工作竞争。浏览器还会产生 `rule-1` 这样的位置 id；删除一项规则再新建可能重用持久 `automation:<id>` Session，使新任务获得旧任务的上下文。相对或被编辑的 `cwd` 可能导致 workspace 发布失败，而修改它还会让人误以为已创建 Session 的不可变 header 会随之迁移。

## 决策

Automation 在既有 agent、session 与 model-selection 服务之外必需 `agentPresets`。Config 新增 `preset`（默认 `clawdsh`）与绝对 `cwd`（默认 `process.cwd()`）；相对路径会在取得任何 agent 前失败。Resume 与新建的规则 agent 都先安装所选 model 并挂载该 preset，再投入使用。新会话 metadata 记录 `{cwd, agentPreset}`；旧版续接会话保留其不可变 header，但 live agent context 仍会获得配置的 preset。ClawDSH Settings manifest 因此把 `preset` 与 `cwd` 视为安装器管理字段，不作为可编辑任务设置。

会话发布使用可选 Host 服务，不让通用 headless Automation 依赖 Web 产品。安装了 `sessionTitle` 时，没有已有标题的会话会命名为 `自动任务 · <name-or-id>`。安装了 `workspaceRegistry` 时，不可变的 `session.header.cwd` 必须解析到已注册 workspace；会话 flush 后会关联至该 workspace。新 Session 使用当前 Config 值；续接 Session 保留并使用自己已记录的值发布。已安装的发布服务若不能完成工作，初始化会被拒绝；服务缺席时则省略对应增强。

浏览器用 `crypto.randomUUID()` 加固定 `rule-` 前缀生成每个新规则 id。删除规则后再新建不会重用位置 id，因此不会意外续接已删除规则的持久 Session。可见 editor 把这些对象称为「自动任务」，并解释任务由调度时间和执行指令组成，需要显式开启并重启，结果保存在带标题的独立对话中。

不同调度种类具有不同的终态语义。`every` 在挂载后等待一个完整间隔，然后在每次运行完成后，从本进程最初的锚点网格中选择下一个严格晚于当前时间的触发点。`cron` 也在完成后计算下一次触发。两者都会跳过长时间运行期间错过的边界。`at` 只尝试一次：同一规则和时间戳的持久 `ok` 或 `error` 会跨重启构成终态；当前 runtime 在任一结果后都会把规则标为完成。

每次尝试会在提交带帧 prompt 前 append 并 flush `started`。Agent 进入 idle 后，Automation 查找本回合自己的 `turn/end`；只有 `completed` 映射为 `ok`，缺失、报错、取消或其他未完成原因均映射为 `error`。随后只 append 一个终态事件并执行一次终态 flush。若该 flush 失败，runtime 会 warning 状态未持久化，但不会合成第二个终态事件。

初始化可被等待，并拥有全部已取得的 handle。任一规则取得或发布失败都会中止初始化，并释放已取得的 handle。注销具有幂等性：它中止待完成的取得过程、清除 timer、等待初始化收敛、取消活跃 agent、等待已跟踪 tick，再释放全部 handle。

## 考虑过的替代方案

**让定时 agent 保持只有 model，并按规则需要逐项授予能力。** 否决，因为这会产生第二套不断漂移的组合模型。定时 ClawDSH 回合应获得与交互式 ClawDSH 回合相同的声明式 preset 能力。

**把每次结果投递到当前交互式对话，而不发布专属会话。** 否决，因为 Automation 没有权威的当前会话所有者，跨会话注入也会掩盖由哪条规则引发回合。专属会话继续作为运行的持久且可检查的归属。

**把标题与 workspace 服务设为必需 inject。** 否决，因为 Automation 在 headless 组合中仍然有效。缺少服务时省略发布增强；服务存在时则必须完整发布，否则初始化失败。

**重试失败的 `at` 规则，或在启动时立即触发 `every` 规则。** 否决，因为任一选择都会虚构调度没有声明的触发，并可能产生重复副作用。一次性规则就是一次尝试，间隔规则在一个间隔过去后才开始。

**终态 `ok` flush 失败后 append `error`。** 否决，因为持久化失败不会改变回合结果，两个终态记录会让 run log 自相矛盾。

**删除后重用简短的位置 rule id。** 否决，因为 rule id 同时是持久 Session 身份，不是可丢弃的列表索引。随机 id 能避免意外继承上下文，同时不删除历史 Session。

## 影响

定时回合现在使用配置的完整 preset，并在 Web Host 中以有意义的标题和 workspace 关联出现在普通会话旁。同一份会话日志包含 prompt 贡献、工具使用、assistant 输出与 Automation 运行记录，因此结果既具备完整能力，也可被检查。修改安装层 `cwd` 只影响新建 Automation Session；续接 Session 保留创建时记录的 workspace。

启用 Automation 后，如果配置的 preset 不可用、会话取得失败，或已安装的发布服务无法发布会话，现在会让产品初始化失败。这是有意的：规则集只完成了部分初始化时，不会启动 timer。Web 组合中配置的 `cwd` 必须属于已注册 workspace。

调度器不提供重试、渠道投递或主会话摘要。Cron 与 interval 失败会等待下一次已声明的触发；one-shot 失败保持终态。终态持久化失败时，`at` 规则只在当前进程中保持终态，重启后仍可能再次运行，因为持久 guard 未能写入。

## 验证

聚焦的运行时测试覆盖 preset prompt 贡献、新会话 metadata、不可变 resume workspace 发布、相对路径拒绝、标题与 workspace 发布、首个间隔时序、长运行与错过边界调度、`at` 的持久成功及失败 guard、精确终态记录、初始化失败、取得/注销竞争与最终 handle 清理。浏览器测试证明删除后新建任务不会重用 Session id，且面向用户的说明存在。包 typecheck、lint、双语配对与 diff 检查均随修正后的实现通过。
