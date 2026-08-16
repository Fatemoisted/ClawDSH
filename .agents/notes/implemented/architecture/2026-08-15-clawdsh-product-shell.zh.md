# Agent Note: 构建于 dsh Web 应用之上的 ClawDSH 产品壳

Status: implemented

[English](2026-08-15-clawdsh-product-shell.md) | 中文

产品形态已由 [ADR-0007](../../../../docs/adr/0007-clawdsh-local-gui-product.md) 接受，用户可见行为由 [ClawDSH 本地 GUI](../../../../docs/specs/feature-gui-web.md)与[语义 Activity](../../../../docs/specs/feature-activity.md)规格定义。[原生 Slot 集成](2026-08-16-clawdsh-native-slot-integration.md)取代了本 Note 原有的外层导航与不贡献 Client Slot 的选择；本 Note 继续拥有 profile 边界、控制面、Settings mutation 规则、Activity 存储与隐私模型。[产品壳 runtime](../../implemented/feature/2026-08-15-clawdsh-product-shell-runtime.md)与 [Settings 控制面](../../implemented/feature/2026-08-15-clawdsh-settings-control-plane.md)拥有各自更窄的实现决策。

## Problem

[原始 GUI 组装](../../implemented/feature/2026-08-15-openclaw-gui-dsh-web-app.md)正确地复用了原生 dsh Web 应用，并且只改变默认 agent preset。已实现产品壳解决了该产品边界问题，同时保留完整 Harness 对话 runtime。

产品壳与 Settings 决策是已交付行为的当前权威。它们只部分 supersede 旧 Note 中「不拥有 ClawDSH 浏览器 UI」的选择；复用 `dsh-web-app`、通过 profile 与 preset 组装，以及由 Harness 对话 runtime 继续作为权威的决策保持不变。

该信息架构无法准确解释产品。[profile bundle](../../implemented/architecture/2026-08-05-profile-plugin-bundles.md)拥有进程级 Host 组装，[逐 Session preset](../../implemented/architecture/2026-08-03-per-session-agent-presets.md)则拥有 Agent 组装。选择 `standard` 不会卸载 ClawDSH Host 插件，因此 preset selector 不能作为 ClawDSH 与纯净 Harness 之间的产品边界。

已实现 Settings 控制面以产品自有能力分类、字段权限、credential ownership、revision 与生效时间解决配置不匹配，同时让 raw Loader entry 保持只读。

原始 [Trajectory ledger](../../implemented/feature/2026-07-27-trajectory-inspection-ledger.md)是有序 Harness 证据的权威记录，却不会把 ClawDSH 行为分成 Soul/Prompt、Memory、Channels、Skills 与 Automation。替换 Trajectory 会丢失诊断细节，只保留它一个视图又会让产品行为难以理解。

## Decision

### 产品与引擎职责

ClawDSH profile 启动一个 dsh Host 进程，并暴露两个浏览器应用。`/clawdsh/` 是默认产品路由。`/` 保留原生 dsh Web 应用，并以 Harness 高级链接。只有单独启动的 `dsh --profile web` 进程才表示纯净 Harness 模式。

产品组装拥有 ClawDSH Settings 内容、语义记录、能力呈现与产品身份。dsh 继续拥有顶层导航、Connection transport、Session 状态、Chat、流式输出、审批、工具呈现、持久化、Settings chrome 与原始 Trajectory。两个路由访问相同的 Host service 与 Session store；任何一方都不会把对话状态复制到第二个产品数据库。

产品只使用一套原生 sidebar、既有 Settings panel，以及 Session 的「对话」「轨迹」「ClawDSH 记录」三个标签。「Harness 高级」是 sidebar footer 中指向 `/` 的链接。公开 `buildRenderApp()` face 只渲染一棵完整 Harness root，而不是抽取 Chat；高级路由是诊断入口，不是竞争性的产品模式。

### 组装与身份

产品边界是 `clawdsh` profile。默认 Agent 身份是 `clawdsh` preset，显示为 `ClawDSH 模式`。Session 仍可选择其他兼容 preset，但 UI 会把该动作描述为改变 Session 的 Agent 组装，绝不描述成卸载 ClawDSH。

产品壳消费 [Web Client 架构](../../implemented/architecture/2026-07-19-gui-web-client-architecture.md)、[Client 插件加载模型](../../implemented/architecture/2026-07-23-client-plugin-loading-model.md)与 [GUI RPC 分层](../../implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md)所描述的公开 boot manifest、静态浏览器模块表、加载状态、Connection protocol 与完整 root 渲染组装。其浏览器、runtime 与发行源码嵌套在 `packages/openclaw/preset-openclaw/` 下，不进入根 Client aggregate。ClawDSH 不用 CSS、私有 Slot 或私有 import 移除原生 Harness frame。

该应用组装向既有公开 `conversation.hero.agentPreset`、`sidebar.footer.action`、`settings.section`、`conversation.view` 与 `conversation.chat.node` Slot 贡献内容。最后一项 contribution 通过标准 Chat node 呈现 Channel context，但不改变其持久事件。组装不注册新 Slot，不增加 `dsh.client` 包，不进入 shipped occupant catalog，也不修改 `api-proxy`、Agent Loop、生成文件或上游源码。它也不会使用 runtime package injection 或 scanner exception 模仿 catalog entry。proposed 的[动态 package runtime](../../proposed/architecture/2026-08-08-cordis-web-dynamic-packages.md)具有不同的信任与生命周期模型，不是本产品壳的依赖。

物理 `preset-openclaw` 目录暂时保留，因为仓库当前层级 gate 识别该组装路径。产品文案、安装后的 profile 与 preset id、默认选择、命令、安全的干净安装默认值与旧资产处理遵循 [ClawDSH 身份决策](../../implemented/feature/2026-08-15-clawdsh-identity-and-safe-defaults.md)；该目录名不作为兼容承诺暴露。

### Settings 与 Activity

主要能力总览保持只读，只包含 Soul、Memory、Skills Hub、Channels 与 Automation。它区分实现已装载、业务已启用、配置完整与执行已验证。Package、依赖、Loader、Fiber、渠道目录和必需 Activity 状态保留在默认收起的诊断详情中，不提供 Loader 开关；可编辑字段遵循独立 Settings 决策。

ClawDSH Settings 对产品能力 namespace 与 credential reference 使用静态 allowlist。每项能力贡献由服务端拥有的 Config 描述；控制面把 profile base、user override 与 schema default 解析成一份 desired configuration。mutation 携带 expected revision，reset 只移除 user layer，响应区分 desired revision、runtime revision 与 restart requirement。

能力保持 mounted，使 Settings 能够描述并验证它们。受支持的 `enabled` 字段在能力所记录的生命周期点控制可选行为；用户不切换任意 Loader entry。必需基础设施不能关闭，实现依赖归在所属能力下。只读 Loader inventory 继续用于高级诊断。

凭据保留在 dsh credentials provider 中。RPC method 只接受 allowlist 内的 reference，绝不返回秘密值，并用 metadata 暴露配置状态而不是 readiness。随 Client plugin 生命周期存在的内存 store 会在原生 Settings section 反复挂载期间保留 draft，但不使用持久化 browser storage。秘密只存在于该 store 的私有 write-only draft 与发出的 `credentials.set` 请求中；成功、失败、显式清空或 plugin dispose 都会擦除它。公开 Settings state、日志、Settings 文件、Session log 与 Activity sidecar 均不保留秘密值。关闭的可选能力可以缺少凭据；启用能力时，如果缺少必需 reference，就在最早能够判断的位置失败。

ClawDSH Activity 是补充 Trajectory 的语义 projection。始终挂载的 `@clawdsh/dsh-activity` Host service 在标准 Session history 已经拥有某项事实时从中推导记录；对于 ClawDSH 独有事实，则使用相互独立且有容量上限的 sidecar stream。记录携带 Session id、category、固定 kind、可选 status、包生成的 summary 与限制隐私的 scalar metadata；Prompt 记录存储贡献身份与 digest，不存 prompt 正文，Channel 记录排除 sender、account、conversation、thread、message、delivery identifier、消息正文与错误。

Sidecar 按子系统拥有，避免多个 appender 争用。Session id 的 SHA-256 选择目录；五个固定 producer file 使用仅 owner 可访问的权限、8 KiB 记录上限、1 MiB active-file 上限与两个轮转。Append 按 Session 与 producer 串行，dispose 会清空已接收写入，解析会跳过损坏行或尾部而不重写源数据。Sidecar 失败会把 Activity 标为降级，但不能让模型执行、渠道投递、Memory、Skills 或 Automation 失败。没有 sidecar 的旧 Session 仍显示能从标准 history 推导的记录。

Loopback-only `activity/list` request 跟随 session-scoped 记录 Slot 提供的 Session，并把 live 或 inspected history 与 sidecar 合并。它支持五类 filter，按 timestamp 与 id 排序，默认返回 50 条，最多接受 100 条，并使用绑定 Session、filter、order、timestamp 与 id 的 versioned base64url cursor。Session 变化或标签卸载时，browser 会中止旧 request 并清除 cursor；每个 kind 由固定 component 呈现且不提供 raw JSON，并在相邻原生 Trajectory 标签旁显示只读的同 Session sequence 关联。

### 安全与扩展边界

静态产品路由拥有 `/clawdsh/` 前缀，因此控制面不能注册同一个 Connection 前缀。它通过 `ctx.connection.rpc.handle(..., { authority: 'loopback' })` 注册 `/clawdsh-rpc`。该 channel 在空 trusted-host 集合下复用[浏览器信任边界](../../implemented/architecture/2026-07-28-api-browser-trust-boundary.md)、JSON media-type check、Host check、same-origin check 与 Connection 生命周期；配置的 trusted host 仍不能调用它。

能力 namespace、字段名、credential reference、Activity metadata 与 route ownership 都使用显式 allowlist。未知名称在存储或 runtime mutation 前失败。控制 runtime 返回产品 DTO，而不是 live Cordis object、Loader entry、Config provider 或 credential record。

如果后续工作需要公开组装未暴露的 dsh capability 或任何上游改动，实现会在该依赖处停止，并在批准的 local-only 边界内修改本 GUI 设计。本决策不能据此使用私有 import、DOM bridge、增加上游 Slot 或修改 catalog。

## Alternatives considered

**继续把原生 dsh Web 应用作为完整产品。** 该方案保持最小代码面，却无法表达 profile 生命周期、能力来源、安全设置、依赖或语义 Activity，因此它改为保留作高级诊断界面。

**把 `standard` 与 `clawdsh` preset 作为两种产品模式。** preset 不拥有 Host 插件；这会把 Session 级变化标成进程级卸载，并向用户给出错误的安全与行为保证。

**Fork Chat 或整个 dsh GUI。** fork 会重复 Connection、Session、流式输出、审批、工具呈现与上游 UI 维护。产品壳组合公开浏览器 runtime，只拥有产品专属应用层。

**用私有 import、私有 Slot 或 CSS 抽取或隐藏 Chat。** 公开组装渲染完整 root；依赖未记录的结构只是换一种方式制造本地 fork。因此，v1 接受「对话」内的完整 Harness frame；如果无法接受，就必须重新设计 GUI。

**把 ClawDSH 页面保留在第二层产品导航壳中。** 产品壳可以拥有任意 route，但它会重复原生导航、缩小工作区，并在权威 Session 应用外增加另一套生命周期。既有公开 Slot 已能承载产品自有内容，无需修改上游 catalog。

**把 Loader entry enable/disable 暴露成 Settings 模型。** Loader 状态是实现机制，可能破坏依赖，或者卸载用于修复配置的 schema。稳定能力 namespace 与经过验证的 `enabled` 行为才能提供可支持的产品契约。

**用 Activity 替换 Trajectory，或把每项 Activity 事实都写入 Session log。** Activity 无法保留全部原始诊断证据，ClawDSH 专属 observability 也不足以证明需要上游 Session event type。两种视图保持互补，限制隐私的 sidecar 覆盖产品专属事实。

## Verification

- `clawdsh` profile 启动 `/clawdsh/`，在 `/` 保留原生应用，并只在 Loader settle 后打印产品 URL。
- 两个浏览器路由使用同一个 Host Session service 与持久化；「对话」挂载现有完整 Client root，不重新实现或私下抽取 Chat。
- `dsh --profile web` 保持纯净 Harness 进程，ClawDSH 内的 preset 变化不会被描述成卸载 Host 能力。
- 原生信息架构只包含一套 sidebar；ClawDSH 是 Settings 首个分区，「ClawDSH 记录」位于 Trajectory 之后，「Harness 高级」位于 sidebar footer。
- 实现不修改上游自有源码、Client Catalog、生成文件、现有 Slot definition、`api-proxy` 或 Agent Loop。ClawDSH 只向五个批准的公开 Slot 注册 contribution，不使用私有 import 或 DOM 导航 bridge。
- Settings 只暴露 allowlist 内的能力、字段与 credential reference；revision conflict 拒绝过期写入，reset 保留 profile base，并显示生效时间。
- 秘密值只通过私有 write-only draft 与其发出的请求跨越浏览器边界；Host 绝不返回，所有请求完成路径与 plugin dispose 都会清空 draft，公开 Settings state、日志、Session 文件与 Activity 存储都不保留秘密值。
- Activity 呈现限制隐私的 Prompt、Memory、Channel、Skill 与 Automation 记录；sidecar 缺失、损坏或不可写只让视图降级。
- 原始 Trajectory 继续位于相邻原生标签，Prompt Activity 标为 ClawDSH 贡献，不描述成最终 System Prompt 的重建。
- Keyless clean-home 启动、browser 与 runtime typecheck、focused package 与控制面 test、真实 profile Playwright 旅程和产品 snapshot 验证完整组装应用。

## Consequences

产品壳在不 fork Chat 的情况下提供独立 ClawDSH 产品，完整原生应用则继续用于高级诊断。它同时带来独立 nested browser/runtime build；兼容测试必须固定每个被消费的 dsh 公开 export，并验证 `/clawdsh/` asset resolution。

产品应用与高级应用可能持有不同的页面本地选择或 draft 状态，尽管它们共享 Host Session；产品文案不能暗示短暂 UI 状态已同步。独立控制 channel 也需要持续的 loopback、Host、same-origin 与严格 schema test，防止 trusted remote host 获得产品控制权限。

Restart-bound capability 的持久 desired setting 可能与 mounted runtime value 不同。Desired/runtime value 与生效时间暴露该成本，Host-singleton Soul settings owner 则保证修改只影响新 Session，而不会改写运行中 prompt。

语义 Activity 提高可解释性，但有意保持不完整且不具权威性。Privacy allowlist、按子系统分文件、仅 owner 权限、有界轮转与 fail-open observability 必须协同保留；缺少任何一项都会泄露个人数据，或把业务成功与诊断耦合。

保留的 `preset-openclaw` source path 仍是内部仓库例外。Identity test 检查安装资产与渲染文案，确保旧品牌不会变成命令、id 或兼容承诺。
