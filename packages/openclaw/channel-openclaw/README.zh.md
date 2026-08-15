# @clawdsh/dsh-channel-openclaw

[English](README.md) | 中文

`@clawdsh/dsh-channel-openclaw` 是 [Channel Service Definition](../channel/README.md) 的 OpenClaw 通信平面 Service Provider。它校验并监管一个锁定版本的 OpenClaw Gateway，认证其本地 bridge，把已准入的 turn 转发给 Agent 平面 driver，并把原生 Channel action 返回给 OpenClaw。OpenClaw 继续负责平台凭据、登录状态、准入策略、协议客户端、媒体获取和最终平台投递；[Agent consumer](../channel-agent/README.md)继续负责模型选择、提示词、工具、记忆、Session 和模型可见历史。

## 配置

该插件始终保持挂载；DSH Settings 服务存在时，它会把现有 schema 注册到 `clawdsh-channel-openclaw`。schema 默认值、profile base 和 user layer 会在启动时以 `applies: restart` 解析一次。user layer 可以修改 `enabled` 以及有界的端口、帧限制、并发和超时；只要修改 `track`、Gateway 身份、artifact/runtime/host/Node/config/state/staging/socket 路径、extension lock 或媒体上限，系统就会在持久化或启动前拒绝，手工编辑 Settings 文档也不例外。`enabled` 默认为 `false`；此时插件不会检查 artifact、打开存储、绑定 socket、启动进程或注册 Provider。ClawDSH 控制面会在持久化启用变更之前完成锁定 runtime、Node、OpenClaw 配置和插件检查的完整预检。

启用部署时，每个路径、身份、端口、超时和资源限制都必须显式配置。托管安装器必须预先把 `stateDir` 和 `stagingRoot` 配置为已经存在的私有 `0700` 目录；只读预检成功后，启动流程才创建私有 workspace。`configPath`、`endpoint` 和 `stagingRoot` 必须位于 `stateDir` 内，且父路径不得经过符号链接。

```yaml
- id: channel-openclaw
  name: '@clawdsh/dsh-channel-openclaw'
  config:
    enabled: false
    track: production
    gatewayInstanceId: personal-gateway
    artifactPath: /srv/clawdsh/openclaw/openclaw-2026.7.1-2.tgz
    runtimeRoot: /srv/clawdsh/openclaw/runtime
    hostRoot: /srv/clawdsh/openclaw/runtime/node_modules/openclaw
    extensions: []
    nodePath: /srv/clawdsh/node/bin/node
    configPath: /srv/clawdsh/openclaw/state/openclaw.json
    stateDir: /srv/clawdsh/openclaw/state
    stagingRoot: /srv/clawdsh/openclaw/state/staging
    maxMediaBytes: 5242880
    endpoint: /srv/clawdsh/openclaw/state/clawdsh.sock
    gatewayPort: 18789
    maxFrameBytes: 1048576
    maxInFlight: 16
    requestTimeoutMs: 30000
    handshakeTimeoutMs: 10000
    startupTimeoutMs: 30000
    shutdownGraceMs: 10000
    diagnosticBytes: 262144
- id: channel-openclaw-invariant
  name: '@clawdsh/dsh-channel-openclaw/invariant'
```

| 配置键 | 约定 |
|---|---|
| `enabled` | 用户控制的 Gateway 启用状态。`false` 时仅挂载 Settings 和经过清理的生命周期状态；变更在重启后生效。 |
| `track` | 选择已检入的 `production` 或隔离 `canary` 宿主身份。它不会解析浮动 tag。 |
| `gatewayInstanceId` | 稳定且非空的身份，写入 route、握手和存储，并用于跨 Gateway 隔离检查。 |
| `artifactPath` | 已下载归档的绝对路径；其 SHA-512 必须等于所选宿主 lock。 |
| `runtimeRoot` / `hostRoot` | 绝对路径形式的已检查 NPM 项目及其精确 `node_modules/openclaw` 子目录。在 Node 启动前，插件会校验 package 输入、可见 lock、隐藏安装 lock、实际 package 集合、package 元数据、解压后的宿主文件树和当前平台完整安装项目的摘要。 |
| `extensions` | 由安装器管理、在产品 UI 中只读显示的精确 opt-in 插件 lock。每个条目包含 `pluginId`、非空且不重复的 `channelIds`、精确的 NPM `packageName` 与语义化 `version`、64 字节 `sha512` SRI，以及隔离 NPM 项目的 `projectTree.fileCount` 和小写 `projectTree.sha512`。空数组会禁用全部外部扩展。 |
| `nodePath` | 专用绝对可执行文件或不含路径的可执行文件名。其报告版本必须满足锁定宿主的 engine 范围。 |
| `configPath` / `stateDir` / `stagingRoot` | 严格 JSON 格式的 OpenClaw 配置、私有隔离 state，以及共享入站媒体 staging root。Supervisor 会读取并解析完整配置以强制执行准入策略，但不会选取 credential field 用于返回、日志或 DSH 持久化；凭据仍由 OpenClaw 的配置与 state 持有。 |
| `maxMediaBytes` | 注入 bridge 的正安全整数入站媒体单项字节上限。 |
| `endpoint` | `stateDir` 内的绝对 Unix socket 路径；绑定后权限改为 `0600`。不接受 TCP。 |
| `gatewayPort` | 1 到 65535 的整数 loopback Gateway 端口。OpenClaw 配置也必须选择 local 模式和 loopback 绑定。 |
| `maxFrameBytes` / `maxInFlight` | UTF-8 NDJSON 帧大小、双向并发 request 数量和待处理出站进度写入数的正安全整数上限。 |
| `requestTimeoutMs` | 每个 DSH 到 Gateway RPC 等待的正安全整数 deadline。超时会释放本地容量，但不会取消远端工作，也不会使 mutation 变得可安全重试。 |
| `handshakeTimeoutMs` / `startupTimeoutMs` | 每个 socket 的首个认证帧，以及宿主预检加首个已接受 bridge 身份的正安全整数超时上限。 |
| `shutdownGraceMs` / `diagnosticBytes` | 进程树关闭超时和每个诊断流保留字节数的正安全整数上限。预检输出发生丢失时启动失败。 |

OpenClaw JSON 必须用唯一的 `clawdsh/local` 替换模型注册表，让每个默认和具名 Agent route 选择 `clawdsh` AgentHarness，使用空 fallback 列表，并把 Agent workspace 设为 `stateDir/workspace`。`plugins.load.paths` 只能包含已校验的 bridge root；`plugins.allow` 和已启用的 `plugins.entries` 必须精确包含 `clawdsh-bridge` 加锁定 extension id；`plugins.installs` 必须为空。Bash、config、MCP、plugin、debug、restart 和 native-skill command 必须显式关闭；已准入 text command 必须使用 access group，禁止 wildcard sender，全局及每个具名 Agent 必须显式设置 `tools.elevated.enabled: false`，Agent defaults 必须设置 `elevatedDefault: off`。即使没有配置 Channel，也必须存在 `channels` 对象，每个 entry 和 account 都必须显式设置 `enabled`。首批锁定的准入校验器允许启用 Telegram 和 Feishu：两者都要求 `configWrites: false`、安全的 DM 与群组策略，并分别通过 Feishu `requireMention` 或 Telegram `groups["*"].requireMention` 显式要求 mention。其他已编目的 Channel 在具备版本专用的准入字段校验器前必须保持关闭，避免把目录存在误报成已认证运行支持。所有 Channel 的不安全嵌套策略和 public wildcard sender 都会被拒绝。任何不匹配都会在 Gateway 启动前失败。

## 锁定宿主与扩展

[`PRODUCTION_OPENCLAW_LOCK`](src/locks.ts) 标识 OpenClaw `v2026.7.1-2`、其解引用后的 commit、发布归档、package 版本、Node engine、已检查的运行时依赖 lock、解压后的宿主文件树，以及按 Node platform 与 architecture 区分的完整安装运行时摘要。包内的 [`runtime/package-lock.json`](runtime/package-lock.json) 是部署 assembly 输入：已安装依赖必须精确匹配其中适用于当前平台的必需集合，项目中的每个普通文件也必须匹配获批的平台摘要。内部文件符号链接按其逻辑路径、项目内规范目标和目标字节锁定；逃逸链接、非文件目标和未跟踪 package 都会导致校验失败。没有唯一精确 aggregate lock 的平台无法启动 production。

系统不会在运行时安装或更新外部 Channel 插件。运维人员需要在 `stateDir/npm/projects/<project>` 下为每个配置 lock 预置一个私有 NPM 项目。该项目必须为 private，只请求一个锁定 package 的精确版本，并且已检查、隐藏和实际依赖集合彼此一致。系统会校验每个已安装 package 的名称与版本；`projectTree` 会锁定项目 manifest、两份 NPM lock、主插件和每个传递依赖的字节。内部文件符号链接会连同目标一起锁定。唯一允许的外部 package 符号链接，是嵌套的可选 `openclaw` peer，且它必须解析到单独校验过的宿主；`projectTree` 包含该链接的存在性，其目标字节则继续由宿主运行时 lock 负责。随后，OpenClaw 运行时检查必须报告精确的 package、版本、integrity、规范路径、启用状态、可信官方安装和锁定 Channel id，且不能出现 error 诊断。第三方所有权与许可证义务仍归单独安装的 package；参见[第三方声明](THIRD_PARTY_NOTICES.md)。

## 本地 IPC 与生命周期

Provider 在私有 Unix socket 上接受一个 bridge。每次启动都会创建随机 bearer token 与 nonce，只通过受监管进程的环境变量注入，并要求首帧同时提供二者以及精确的 Gateway 实例、OpenClaw lock、Node engine 和 AgentHarness 代际。Token 使用恒定时间比较。第二条连接、错误身份、超时或不受支持的宿主 lineage 都会被拒绝，且不会回退到其他模型。

认证后，双方通过有界 UTF-8 NDJSON 交换严格 JSON-RPC 2.0 对象。额外 envelope 字段、同时包含 `result` 与 `error` 的 response、格式错误的 error，以及未知 notification 都会 fail closed。Router 实现 `turn.run`、`turn.cancel`、`session.reset`、`session.close`、`channel.action` 和 `health.get`；协商后的 `turn.progress` 仅用于展示，待处理进度写入受 `maxInFlight` 限制，因此背压时可以丢弃多余更新。每个 DSH 到 Gateway request 都有本地 deadline。超时或 IPC 断开不会取消远端工作或 Agent run。重连会恢复传输，而持久化 Agent 和 Provider ledger 决定能否回放工作或投递。

启动流程使用 restart-scoped Settings snapshot，依次校验运行时、产物、扩展、Node engine、fail-closed 配置、OpenClaw 配置校验器和运行时插件检查，然后才绑定 Provider 并 spawn `gateway run`。本地控制面也可以运行同一套完整预检；该过程不会创建目录、打开存储、绑定 IPC 或启动 Gateway，只会执行经过校验和锁定的检查子进程。每个 Node 预检和 Gateway 都会收到显式 tombstone，用于删除继承的 `NODE_*`、`LD_*`、`DYLD_*`、OpenSSL 模块与配置、TLS 信任路径和 TLS 密钥日志变量，防止 ambient loader 或 Node option 改变已校验运行时。进程保持存活并完成已认证 bridge 握手后才进入 ready。dispose 会停止接受新 peer、终止并等待 Gateway 进程树、关闭 Provider、只移除精确 socket 条目，并释放 storage domain。相互独立的清理错误会被聚合返回，而不会被隐藏。

[`bridge`](bridge/README.md) 目录负责 OpenClaw 加载的 V1/V2 适配器及其更窄的宿主侧能力细节。

## Action 与投递持久性

`clawdsh_channel_openclaw` storage domain 会在派发前记录有副作用的 `send`、`edit`、`delete`、`react`、`poll` 和 `typing` action。用不同输入复用 action id 会失败。已完成结果可以回放而不再发起平台请求；重启后发现的 running 记录会变为 `needs-recovery`。随后以相同 action 重试时，只会调用只读的 `channel.reconcile` 方法：bridge 可以回放其持久化完成结果，但缺失或非终态的 bridge 记录会直接失败，不会触发平台派发。目录与解析查询不会创建副作用恢复状态。

系统在向 Agent consumer 投影前持久化 delivery receipt。delivery id 不得更换 subject，attempt 不得减少，retrying 不得退回 accepted，也不得在同一 attempt 下用不同数据重复；一旦获知 platform message id，后续就不得更改或删除；confirmed、ambiguous 和 dead-letter 均为终态。这些规则会暴露不确定投递以供对账；如果平台已接受请求却丢失确认，它们不承诺 exactly-once 行为。

## 扩展点

`OpenClawChannelProvider` 实现 `ChannelProviderV1`，并注册为唯一的 `ctx.channels` Provider。`OpenClawSupervisor` 负责已校验的进程生命周期。导出的 lock 和校验函数供获取工具与部署预检使用；它们不授权调用方削弱已检查身份。平台专用代码应放在 OpenClaw Channel 插件中，不属于本包。

## Model Experience

### OpenClaw 通信平面 Provider

#### What the model sees

模型不会直接看到任何内容。[Agent consumer](../channel-agent/README.md)负责已准入 user message、attachment 引用、route-bound `message` 工具和每项模型可见的失败或结果；本包只贡献传输、健康状态和持久化投递状态。

#### Token effect

直接 token 增量为零。IPC 帧、宿主检查、action ledger、delivery receipt 和健康诊断不会增加 system prompt、user message、tool schema 或 model request。

#### KV Cache effect

不会直接使缓存失效。Gateway 重连、receipt 更新、宿主健康状态和 Provider 生命周期不会改变已经可复用的 model request prefix；Session generation 和 Agent composition 仍归 consumer 所有。

## Known Limitations and Deferred Work

- **Production 当前只准入 Darwin arm64 运行时字节**：其安装项目 aggregate 由已检查的 `darwin/arm64` assembly 生成。Linux、Windows 和其他 CPU 组合会 fail closed，直到获取流程为各自平台生成并评审独立 lock。Canary lock 记录了审计后的 source snapshot 和 AgentHarness V2 代际，但没有获批的解压文件树或运行时依赖 lock，因此 managed Canary 同样会 fail closed。
- **仅支持 POSIX**：在原生实现能够强制 peer ACL 前，Windows named pipe 保持禁用；本包绝不会改用 localhost TCP。
- **锁定 bridge 只声明 `send` 和 `poll`**：其他 V1 action variant 在协议层仍然有效，但在 OpenClaw bridge 具备等效公共宿主 API 前会因能力检查失败。
- **媒体支持不对称**：在 DSH 拥有已校验 staging writer 前，出站 Provider action 会拒绝媒体；stable V1 因 AgentHarness 缺少安全的已 materialize 文件 fact 而拒绝入站媒体，V2 只接受已校验的本地 staging 文件。
- **锁定 bridge 不协商最终投递报告**：两个宿主代际都缺少公开且可关联的 final-delivery hook，因此 Agent 侧 ledger 无法从这些适配器收到 `delivery.report`。最终投递声明以及依赖此能力的任何 Channel 认证仍处于阻塞状态。
- **崩溃歧义需要对账**：确认丢失的副作用会保留为 recovery-required 或 ambiguous，绝不会被盲目重发。
- **仅限聊天**：语音通话、实时音频和会议生命周期需要单独协议。
- **认证状态依赖外部证据**：keyless 测试校验本 Provider 和 bridge 协议，不校验真实账号凭据、平台条款、硬件依赖或各 Channel 的认证状态。
