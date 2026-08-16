# @clawdsh/dsh-channel-agent

[English](README.md) | 中文

`@clawdsh/dsh-channel-agent` 是 [channel Service Definition](../channel/README.md) 的 agent（智能体）平面消费方。它只接受本地 OpenClaw 网关已经准入的轮次，把每个 OpenClaw 会话 generation 映射到一个持久化 DSH 会话，运行配置的 agent preset，并返回可回放的终态结果。网关仍然是平台凭据、pairing、allowlist、mention 策略、协议连接和最终平台投递的权威。

## 配置

```yaml
- id: channel-agent
  name: '@clawdsh/dsh-channel-agent'
  config:
    ownerPreset: clawdsh
    safePreset: clawdsh-messaging-safe
    cwd: /srv/clawdsh/workspace
    stagingRoot: /srv/clawdsh/channel-media
    maxMediaBytes: 10485760
    shutdownGraceMs: 30000
- id: channel-agent-invariant
  name: '@clawdsh/dsh-channel-agent/invariant'
```

| 配置键 | 约定 |
|---|---|
| `ownerPreset` | OpenClaw 把直接消息分类为 `owner` 时使用、由安装器管理的 `clawdsh` preset。 |
| `safePreset` | admitted、paired、allowlisted 或群组发送者使用、由安装器管理的 `clawdsh-messaging-safe` preset。agent 上下文会先执行 `tools.restrict({ allow: [] })` 再挂载该 preset，因此继承／全局工具不可见，而作用域本地的 preset 工具与 `message` 仍然可用。 |
| `cwd` | 每个新建渠道会话都会记录、可由用户配置的绝对工作区。 |
| `stagingRoot` / `maxMediaBytes` | 由安装器管理并与 Gateway 部署保持一致的绝对共享媒体根目录和单对象正整数体积上限；附件存储的数量、类型、总字节数与解码器策略也同时生效。 |
| `shutdownGraceMs` | 面向高级用户的正整数关闭期限。teardown 会停止准入、取消活跃工作，并在该期限内等待已接受轮次、待完成的 agent acquisition 和路由控制达到静止，再释放 agent 并关闭存储。超时会明确失败；只要迟到操作仍可能写入，就会有意保持存储开启。 |

DSH Settings 服务存在时，该插件会把现有 schema 注册到 `clawdsh-channel-agent`。schema 默认值、profile base 和 user layer 会在启动时以 `applies: restart` 解析一次，后续写入不会改变正在运行的 driver。user layer 只要改变 `ownerPreset`、`safePreset`、`stagingRoot` 或 `maxMediaBytes`，系统就会在持久化或创建 driver 前拒绝，因此手工编辑 Settings 也无法替换安装器管理的身份。无论 OpenClaw Gateway Provider 是否启用，该插件都会保持挂载并注册 driver。它依赖 `ctx.channels`、`ctx.agents`、会话持久化、模型选择、agent presets、附件服务、storage-domain facility 和工具注册表。任一路径为相对路径时，配置会在 driver 注册前失败。部署可单独注册不变式配套插件，让仓库的不变式注册表校验实时日志和恢复日志。

## 轮次与会话语义

持久化绑定键是 `(gatewayInstanceId, openclawSessionKey, generation)`。它对应的 SessionId 是确定性的；存储的绑定还包含 channel、account、conversation、可选 thread、会话类型、选定 preset 和生命周期状态。同一键若携带不同平台坐标，或在 owner 与安全准入类别之间变化，系统会快速失败，不会让会话混用或扩大权限。

首个接受的 generation 会成为该网关／会话谱系的当前值。`session.reset` 会退役精确匹配的当前 generation，并且只接受严格更大的 generation；`session.close` 会退役精确指定的 generation。两个操作都会先取消匹配的实时工作，再释放本包持有的 agent 句柄。generation 的提交会原子记录精确控制请求和 reset acknowledgement，因此 bridge 在 acknowledgement 丢失后重试时会回放已经完成的控制，不会再次使 successor 失效。陈旧或已关闭的 generation 不能进入模型，包括此前处于 `accepted` 的轮次重试。

owner 直接消息使用 `ownerPreset`。其他所有已准入轮次使用 `safePreset`；owner 发起的群组仍属于群组，不能继承 owner 权限。未知或与 route 不一致的 admission class 会在 Agent 执行前失败，并再次被 live/restored Session invariant 拒绝。空的继承工具 allowlist 会移除 shell、文件系统和其他部署级全局工具，不受 owner preset 暴露内容影响。作用域本地工具有意不受该限制，因此经过审计的安全 preset 可以贡献自己的工具，本包也始终可以加入绑定到当前路由的 `message` 工具。

当 Host 安装了可选的标题和工作区展示服务时，每个新建或恢复的渠道 Session 都会在 agent 进入空闲后出现在普通 Web 工作区中。没有标题的 Session 会获得 `外部消息 · <channel> · 私聊` 或 `外部消息 · <channel> · 群聊`；标题只使用渠道名和会话类型，绝不包含消息文本、account 或 conversation id，也不包含发送者名称。已有标题绝不会被覆盖。新 Session 会记录当前运行时的 `cwd`；恢复的 Session 即使遇到不同的重启配置，也会保留不可变 header 中的 `cwd`。工作区展示会解析该已记录路径，并在匹配工作区存在时关联该 Session。旧 header 若没有 `cwd`，标题处理仍然生效，但工作区关联会跳过并记录固定的脱敏警告。这些尽力而为的展示写入不会改变渠道轮次的结果。

## 持久化幂等与投递

`clawdsh_channel_agent` storage domain 管理绑定、当前 generation 和以网关为作用域的入站 ledger。每个持久化记录都经过严格 schema；格式错误的 id、时间戳、envelope digest、result 身份、receipt 或 phase／receipt 组合会在加载时失败，而不会被强制转换。

| 阶段 | 含义 |
|---|---|
| `accepted` | 精确 envelope 已持久化，但尚未排队 agent follow-up。此阶段失败返回 `retryable: true`，保持 accepted 且不保存 result，只能用相同 envelope 和 generation 重试。 |
| `running` | Session 身份和 running 标记会在 `agent.followup()` 之前持久化；此后模型或工具工作可能开始。 |
| `completed` | 终态结果已持久化；内容相同的重试会回放结果，不再调用 agent。平台返回 accepted 或 retrying receipt 时仍保持此阶段。 |
| `delivered` | 提供方报告最终轮次投递已确认。 |
| `ambiguous` | 对账无法证明平台是否接受投递，禁止自动重发。 |
| `dead-letter` | 投递遇到终态平台失败。 |
| `needs-recovery` | agent 工作可能开始后发生了进程或运行时失败。内容相同的重试会返回需要人工对账的错误，绝不自动再次运行 agent。 |

Wire 上的终态失败只暴露本包拥有且长度受限的诊断。模型、preset、附件或其他依赖的任意错误会在持久化或进入 IPC 前替换为通用消息，因为其文本可能包含凭据或本地路径。

同一路由 generation 的不同轮次会分别持久化 `accepted`，但只能依次进入一条执行队列。该队列覆盖 agent 启动前检查、媒体导入、agent acquisition、进度观察、`followup`、完全停稳、flush 与终态 ledger 提交，因此一个 Session 不会出现重叠的渠道轮次或进度 observer。取消排队轮次只会持久化该轮次的取消，不调用共享 agent 的 `cancel()`；只有取消当前占用队列的活跃轮次才会中断该 agent。排队轮次随后会在进入模型前提交可回放的 cancelled 结果。

并发且内容相同的 envelope 会挂接到同一个 Promise。复用正在运行或已持久化的幂等键但改变内容会失败。精确匹配的 `turn.cancel` 即使发生在 agent acquisition 或活跃轮次注册之前，也会记录到 accepted ledger；每个 agent 启动前检查点都会观察它，持久化终态 cancelled 结果，并让内容相同的重试直接回放而不启动 agent。错误的 run id 不能取消同一 turn id 下的其他 run。最终轮次投递报告必须唯一指向一组 turn/run，保持同一个 delivery id 和任何已经获知的平台 message id，并单调增加 attempt；retrying 状态不能退回 accepted，也不能重复同一次 attempt，confirmed、ambiguous 和 dead-letter 等终态 receipt 不能回退。通信平面提供方保存权威的平台投递 ledger，本 ledger 保存 agent 平面的投影。

## 来源与媒体

每条已准入输入都作为核心 `user/message` 事件追加，并使用 `source.kind: channel`。source 记录清理后的网关／会话／generation、渠道路由、发送者和准入类别、群组和 mention 信息、消息／回复身份、幂等／run／turn 身份以及可选 trace 字段。凭据、原始鉴权材料和 staging 路径绝不进入消息文本或 source 元数据。不变式配套插件保证每个会话只有一条精确路由，并保证 turn、run、幂等和平台消息身份各自唯一。

入站图片保持网关给出的顺序，并且只以持久化附件引用进入模型历史。在保存任何附件之前，本包会检查连续 ordinal、已启用的图片媒体类型、全部体积限制、使用斜杠归一化的相对路径、每个路径组件是否为符号链接、规范根目录包含关系、精确大小、SHA-256 与附件解码器策略。读取前后都会把路径组件和文件身份与打开的句柄对照；即使替换目录硬链接到同一文件，竞态也会被拒绝。批次校验失败时不会保存任何对象。在 DSH 提供持久化的对应附件类型之前，音频、视频和普通文件都会明确失败。

## `message` 工具

每个渠道创建的 agent 都会获得一个绑定到当前路由、使用 generic 渲染意图的 `message` 工具。channel/account/conversation/thread/message 坐标位于 `rawInput`，不会伪装成文件 `locations`。该工具从完整路由和持久化 tool-call id 派生 action id，因此回放同一条已记录调用时仍保留提供方侧幂等性。它通过 `ctx.channels.action` 分发；若选定账号不支持某项操作，则透传提供方的能力错误。

| 类别 | 动作与结果 |
|---|---|
| 变更 | `send`、`edit`、`delete`、`react`、`poll` 和 `typing` 返回投递 receipt。send 可以回复一条平台消息；不接受模型生成的出站媒体。 |
| 目录 | `directory.self`、`directory.list-peers`、`directory.list-groups` 和 `directory.list-group-members` 返回清理后的条目；缓存查询与实时查询必须显式选择。 |
| 解析 | `resolve` 按原始顺序为每个用户或群组目标返回一个清理后的结果。 |

工具向模型暴露 JSON 前，会严格校验结果 variant 和精确 action id。resolve 结果还必须保持输入数量与顺序。查询结果不能伪装成变更成功，delivery receipt 也不能伪装成目录或解析结果。

## Model Experience

### 已准入渠道输入

#### What the model sees

模型把已准入的纯文本和完成鉴权的图片附件引用视为普通用户消息。清理后的渠道来源保留在持久化 message source 中，供恢复和策略审计使用；提供方适配器接收消息内容，不会接收本地 staging 路径或凭据。

#### Token effect

文本产生普通用户消息 token。图片成本由提供方决定。已完成结果的回放、delivery receipt、健康状态和 ledger 元数据不会增加模型请求 token。

#### KV Cache effect

渠道轮次仅追加到同一个路由 generation 会话，保留其可复用的历史前缀。重置 generation 会启动不同会话；改变任一选定 preset，可能在下次创建或恢复该会话时改变前缀和工具集。

### 绑定到路由的 `message` 工具

#### What the model sees

模型会看到 `message` 名称、能力检查说明、包含十一种动作的参数 schema 和 JSON 结果。owner 会话还可能看到 `ownerPreset` 选择的继承工具；安全会话看不到任何继承／全局工具，只保留 `message` 等作用域本地贡献与经过审计的安全 preset 工具。

#### Token effect

该 schema 会在渠道创建的 agent 的每次请求中产生固定工具定义成本。单次工具结果通过普通工具结果历史贡献其清理后的 JSON。

#### KV Cache effect

一个 agent 组合内的工具 schema 保持稳定。包升级或 preset 变化若改变可见的作用域工具集，可能使未变化会话前缀之后的缓存无法复用。

## Known Limitations and Deferred Work

- **命名空间 Session 事件等待上游 append API** — 当前 DSH 持久化会拒绝未知的必需事件名，下游代码也无法把信息性 append 标为 `ignorable`。因此本包把完整且清理后的准入来源保存在已知的 `user/message.source` 字段中，并由 storage-domain ledger 持有准入／投递权威。在[下游事件提案](../../../docs/upstream-proposal/session-plugin-events.md)落地前，本包不得追加无法恢复的 `channel/*` 事件。
- **入站附件只支持图片** — 音频、视频和文件仍会被拒绝；agent 最终结果和模型发起的 `message` 动作目前都不携带媒体。
- **进度只用于展示** — 文本、reasoning、工具和状态通知都是尽力而为，不拥有持久化结果。通信平面 bridge 必须抑制握手中未协商的通知类型。
- **渠道坐标不是文件位置** — 当前 generic 工具展示类型只允许 `locations` 表示文件系统路径，因此本包改用结构化 `rawInput`，不会发出误导性的文件导航元数据。
