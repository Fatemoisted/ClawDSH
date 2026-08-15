# Agent Note: 构建于 dsh Web 应用之上的 ClawDSH 产品壳

Status: proposed

[English](2026-08-15-clawdsh-product-shell.md) | 中文

产品形态已由 [ADR-0007](../../../../docs/adr/0007-clawdsh-local-gui-product.md) 接受，用户可见目标由 [ClawDSH 本地 GUI 功能规格](../../../../docs/specs/feature-gui-web.md)定义。

## Problem

[当前 GUI 组装](../../implemented/feature/2026-08-15-openclaw-gui-dsh-web-app.md)正确地复用了原生 dsh Web 应用，并且只改变默认 agent preset。它已经证明一个本地浏览器对话能够运行 Soul、Memory、Skills、渠道与标准工具，但 ClawDSH 只表现为 Harness 自有信息架构中的一个 preset 名称。

在本 Note 仍为 proposed 期间，该 implemented Note 继续作为当前权威。如果本提案实现，它只部分 supersede 旧 Note 中「不拥有 ClawDSH 浏览器 UI」的决策；复用 `dsh-web-app`、通过 profile 与 preset 组装，以及由 Harness 对话 runtime 继续作为权威的决策保持不变。

该信息架构无法准确解释产品。[profile bundle](../../implemented/architecture/2026-08-05-profile-plugin-bundles.md)拥有进程级 Host 组装，[逐 Session preset](../../implemented/architecture/2026-08-03-per-session-agent-presets.md)则拥有 Agent 组装。选择 `standard` 不会卸载 ClawDSH Host 插件，因此 preset selector 不能作为 ClawDSH 与纯净 Harness 之间的产品边界。

Settings 也存在相同的不匹配。原始 Loader entry 适合诊断，但用户需要的是能力级所有权、依赖、启用状态、凭据就绪状态、经过验证的字段与生效时间。现有[user-settings seam](../../implemented/architecture/2026-07-28-user-settings-seam.md)、[Web 配置面](../../implemented/architecture/2026-07-30-web-config-plane.md)与[插件配置 UI](../../implemented/feature/2026-08-10-web-plugin-configuration.md)提供了可复用机制；它们并不定义 ClawDSH 产品分类，也不决定哪些 mutation 可以安全暴露。

原始 [Trajectory ledger](../../implemented/feature/2026-07-27-trajectory-inspection-ledger.md)是有序 Harness 证据的权威记录，却不会把 ClawDSH 行为分成 Soul/Prompt、Memory、Channels、Skills 与 Automation。替换 Trajectory 会丢失诊断细节，只保留它一个视图又会让产品行为难以理解。

## Proposal

### 产品与引擎职责

ClawDSH profile 启动一个 dsh Host 进程，并暴露两个浏览器应用。`/clawdsh/` 是默认产品路由。`/` 保留原生 dsh Web 应用，并以 Harness 高级链接。只有单独启动的 `dsh --profile web` 进程才表示纯净 Harness 模式。

产品壳拥有顶层导航、ClawDSH Settings、ClawDSH Activity、能力呈现与产品品牌。dsh 继续拥有 Connection transport、Session 状态、Chat、流式输出、审批、工具呈现、持久化、原始 Settings 诊断与原始 Trajectory。两个路由访问相同的 Host service 与 Session store；任何一方都不会把对话状态复制到第二个产品数据库。

固定产品导航为「对话」「ClawDSH 设置」「ClawDSH 活动」与「Harness 高级」。公开 `buildRenderApp()` face 渲染完整 Harness root，因此 v1「对话」会挂载包含原生 frame 与诊断视图在内的完整 root，而不是抽取 Chat。「Harness 高级」在 `/` 直接打开同一个原生应用；它是诊断路由，不是竞争性的产品模式。

### 组装与身份

产品边界是 `clawdsh` profile。默认 Agent 身份是 `clawdsh` preset，显示为 `ClawDSH 模式`。Session 仍可选择其他兼容 preset，但 UI 会把该动作描述为改变 Session 的 Agent 组装，绝不描述成卸载 ClawDSH。

产品壳消费 [Web Client 架构](../../implemented/architecture/2026-07-19-gui-web-client-architecture.md)、[Client 插件加载模型](../../implemented/architecture/2026-07-23-client-plugin-loading-model.md)与 [GUI RPC 分层](../../implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md)所描述的公开 boot manifest、静态浏览器模块表、加载状态、Connection protocol 与完整 root 渲染组装。其浏览器、runtime 与发行源码嵌套在 `tools/openclaw-preset-openclaw/` 下，不进入根 Client aggregate。ClawDSH 不用 CSS、私有 Slot 或私有 import 移除原生 Harness frame。

这是应用组装，不是可复用 Client contribution。它不注册新 Slot，不增加 `dsh.client` 包，不进入 shipped occupant catalog，也不修改 `api-proxy`、Agent Loop、生成文件或上游源码。它也不会使用 runtime package injection 或 scanner exception 模仿 catalog entry。proposed 的[动态 package runtime](2026-08-08-cordis-web-dynamic-packages.md)具有不同的信任与生命周期模型，不是本产品壳的依赖。

物理 `tools/openclaw-preset-openclaw/` 目录暂时保留，因为仓库当前层级 gate 识别该组装路径。产品文案、安装后的 profile 与 preset id、默认选择、命令、安全的干净安装默认值与旧资产处理遵循 [ClawDSH 身份决策](../../implemented/feature/2026-08-15-clawdsh-identity-and-safe-defaults.md)；该目录名不作为兼容承诺暴露。

### Settings 与 Activity

初版产品壳保持只读。概览把产品能力映射到所属包、依赖、Loader entry 与 Fiber 状态，并把 `@clawdsh/*` 分类为 ClawDSH、`@deepseek-ai/*` 与 `cordis:*` 分类为 Platform、其他来源全部分类为 Community。该 inventory 提供 runtime 证据，但不提供开关。

ClawDSH Settings 对产品能力 namespace 与 credential reference 使用静态 allowlist。每项能力贡献由服务端拥有的 Config 描述；控制面把 profile base、user override 与 schema default 解析成一份 desired configuration。mutation 携带 expected revision，reset 只移除 user layer，响应区分 desired revision、runtime revision 与 restart requirement。

能力保持 mounted，使 Settings 能够描述并验证它们。受支持的 `enabled` 字段在能力所记录的生命周期点控制可选行为；用户不切换任意 Loader entry。必需基础设施不能关闭，实现依赖归在所属能力下。只读 Loader inventory 继续用于高级诊断。

凭据保留在 dsh credentials provider 中。RPC method 只接受 allowlist 内的 reference，绝不返回秘密值，并用 metadata 暴露就绪状态。秘密只在 write-only input draft 与其发出的 `credentials.set` 请求中短暂存在；draft 在请求完成后清空，秘密也不会保留在 Settings state，或持久化到日志、Settings 文件、Session log 与 Activity sidecar。关闭的可选能力可以缺少凭据；启用能力时，如果缺少必需 reference，就在最早能够判断的位置失败。

ClawDSH Activity 是补充 Trajectory 的语义 projection。当标准 Session history 已经拥有某项事实时，它从中推导记录；对于 ClawDSH 独有事实，则使用相互独立且有容量上限的 sidecar stream。记录携带 Session id、category、kind、status、summary 与限制隐私的 scalar metadata；Prompt 记录存储贡献身份与 digest，不存 prompt 正文，Channel 记录排除用户、群、thread、message id 与消息正文。

sidecar 按子系统拥有，避免多个 appender 争用。目录和文件使用仅 owner 可访问的权限，append 串行化，存储按可配置上限轮转，解析失败容忍损坏尾部。sidecar 失败会把 Activity 标为降级，但不能让模型执行、渠道投递、Memory、Skills 或 Automation 失败。没有 sidecar 的旧 Session 仍显示能从标准 history 推导的记录。

### 安全与扩展边界

静态产品路由拥有 `/clawdsh/` 前缀，因此控制面不能注册同一个 Connection 前缀。它通过 `ctx.connection.rpc.handle(..., { authority: 'loopback' })` 注册 `/clawdsh-rpc`。该 channel 在空 trusted-host 集合下复用[浏览器信任边界](../../implemented/architecture/2026-07-28-api-browser-trust-boundary.md)、JSON media-type check、Host check、same-origin check 与 Connection 生命周期；配置的 trusted host 仍不能调用它。

能力 namespace、字段名、credential reference、Activity metadata 与 route ownership 都使用显式 allowlist。未知名称在存储或 runtime mutation 前失败。控制 runtime 返回产品 DTO，而不是 live Cordis object、Loader entry、Config provider 或 credential record。

如果实现需要一项公开组装未暴露的 dsh capability 或任何上游改动，ClawDSH PR 会在该依赖处停止，并在批准的 local-only 边界内修改本 GUI 设计。本工作流不会发起上游 PR，也不能据此增加上游 Slot 或修改 catalog。

## Alternatives considered

**继续把原生 dsh Web 应用作为完整产品。** 该方案保持最小代码面，却无法表达 profile 生命周期、能力来源、安全设置、依赖或语义 Activity，因此它改为保留作高级诊断界面。

**把 `standard` 与 `clawdsh` preset 作为两种产品模式。** preset 不拥有 Host 插件；这会把 Session 级变化标成进程级卸载，并向用户给出错误的安全与行为保证。

**Fork Chat 或整个 dsh GUI。** fork 会重复 Connection、Session、流式输出、审批、工具呈现与上游 UI 维护。产品壳组合公开浏览器 runtime，只拥有产品专属应用层。

**用私有 import、私有 Slot 或 CSS 抽取或隐藏 Chat。** 公开组装渲染完整 root；依赖未记录的结构只是换一种方式制造本地 fork。因此，v1 接受「对话」内的完整 Harness frame；如果无法接受，就必须重新设计 GUI。

**通过新 Client Slot 插入 ClawDSH 页面。** 顶层产品框架属于应用，而不是 Harness 应用内可复用 occupant。增加或伪装 Slot/catalog entry 会在没有提供通用 dsh seam 的情况下跨越仓库上游只读边界。

**把 Loader entry enable/disable 暴露成 Settings 模型。** Loader 状态是实现机制，可能破坏依赖，或者卸载用于修复配置的 schema。稳定能力 namespace 与经过验证的 `enabled` 行为才能提供可支持的产品契约。

**用 Activity 替换 Trajectory，或把每项 Activity 事实都写入 Session log。** Activity 无法保留全部原始诊断证据，ClawDSH 专属 observability 也不足以证明需要上游 Session event type。两种视图保持互补，限制隐私的 sidecar 覆盖产品专属事实。

## Acceptance criteria

- `clawdsh` profile 启动 `/clawdsh/`，在 `/` 保留原生应用，并只在 Loader settle 后打印产品 URL。
- 两个浏览器路由使用同一个 Host Session service 与持久化；「对话」挂载现有完整 Client root，不重新实现或私下抽取 Chat。
- `dsh --profile web` 保持纯净 Harness 进程，ClawDSH 内的 preset 变化不会被描述成卸载 Host 能力。
- 产品导航包含「对话」「ClawDSH 设置」「ClawDSH 活动」与「Harness 高级」。
- 实现不修改上游自有源码、Client Catalog、生成文件、现有 Slot definition、`api-proxy` 或 Agent Loop。ClawDSH 自有 shell 代码绝不调用 `ctx.slots.register()` 注入产品 UI；被复用的 dsh 插件继续注册其既有 Slot。
- Settings 只暴露 allowlist 内的能力、字段与 credential reference；revision conflict 拒绝过期写入，reset 保留 profile base，并显示生效时间。
- 秘密值只通过 write-only input draft 与其发出的请求跨越浏览器边界；Host 绝不返回，draft 在请求完成后清空，Settings state、日志、Session 文件与 Activity 存储都不保留秘密值。
- Activity 呈现限制隐私的 Prompt、Memory、Channel、Skill 与 Automation 记录；sidecar 缺失、损坏或不可写只让视图降级。
- 原始 Trajectory 继续通过 Harness 高级访问，Prompt Activity 标为 ClawDSH 贡献，不描述成最终 System Prompt 的重建。
- 在本 Note 移入 implemented 前，keyless clean-home 启动、browser typecheck、真实 profile Playwright 旅程与产品 snapshot 验证完整组装应用。

## Risks

- dsh 公开浏览器 API 可能变化。导入私有模块会把上游同步变成隐式 fork，因此兼容测试必须固定每个被消费的公开 export。
- 嵌套浏览器 build 可能漏过仓库 gate，或产出 base path 错误的 asset。发行 build 与真实 profile 浏览器旅程必须从 clean tree 运行，并验证 `/clawdsh/` asset resolution。
- 产品应用与高级应用可能持有不同的页面本地选择或 draft 状态，尽管它们共享 Host Session。产品文案不得暗示短暂 UI 状态已经同步。
- 独立 RPC channel 可能误用 `trusted-host` authority 或绕过共享 request check。安全测试必须验证 `/clawdsh-rpc` 接受成功的 loopback same-origin 路径，并拒绝已配置的 trusted host、非 loopback Host 与 cross-origin marker。
- setting 可能已经成功持久化，而 mounted capability 仍使用旧 runtime 配置。desired/runtime revision 与显式生效时间用于防止 UI 错报 applied state。
- 现有插件可能只在 mount 时读取 config。Soul 挂载在每个 Agent scope 内，因此不能再由每个 Session 注册同一个全局 Settings namespace；控制面需要一个 Host-singleton settings owner，而 Soul 变更按记录的生命周期在新 Session 或 remount 后生效。
- Activity 可能泄露个人 identifier，或与业务成功耦合。metadata allowlist、按子系统分文件、仅 owner 权限、有界轮转与 fail-open observability 必须同时成立。
- 保留的 `tools/openclaw-preset-openclaw/` 路径可能把旧品牌泄露到命令或 UI 中。identity test 必须检查安装资产与渲染文案，同时只把目录名视为内部实现。
