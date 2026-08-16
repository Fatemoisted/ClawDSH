# Agent Note: ClawDSH 产品壳 runtime 与能力总览

Status: implemented

[English](2026-08-15-clawdsh-product-shell-runtime.md) | 中文

[本地 GUI 规格](../../../../docs/specs/feature-gui-web.md)拥有当前用户可见行为。更广泛的[产品壳决策](../../implemented/architecture/2026-08-15-clawdsh-product-shell.md)拥有完整组装；可编辑 Settings 由对应的[已实现决策](2026-08-15-clawdsh-settings-control-plane.md)所有，语义 Activity 则由其[功能规格](../../../../docs/specs/feature-activity.md)所有。

## Problem

最初的 [dsh Web bundle 组装](2026-08-15-openclaw-gui-dsh-web-app.md)证明 `clawdsh` preset 能够驱动原生 Harness GUI，但 preset label 无法表示产品边界。Agent preset 按 Session 变化，ClawDSH Host 能力却是进程级。原生导航也无法区分 ClawDSH 能力健康状态、raw Loader 诊断与渠道认证证据。

独立产品应用必须保留现有 Harness 对话实现，并遵守仓库上游只读规则。新增 Client Slot、修改 Client Catalog、导入上游私有源码或 fork Chat，都会使 ClawDSH 界面依赖未经批准的上游修改，或重复有状态行为。

## Decision

`clawdsh` profile 在原生 dsh Web runtime 旁挂载 `@clawdsh/dsh-product-runtime`。Host 在 `/clawdsh/` 下提供 ClawDSH SPA，以 HTTP 308 把 `/clawdsh` 重定向到该入口，并在 `/` 保留原生应用。产品 runtime 对产品 HTML 应用公开 index transform，并且只在 Loader settle 后打印 URL。两个浏览器应用访问相同的 Host service、Session store、Connection transport 与持久化。

产品代码是 `packages/openclaw/preset-openclaw/product-shell/` 下的嵌套非 workspace build：

- `browser/` 拥有产品导航、能力总览、可编辑 Settings、语义 Activity 呈现，以及加载公开 boot manifest 与 Client module table 的 `ClawdshWebEntry`。
- `runtime/` 拥有静态 Host route、Loader-settled ready URL、能力 projection 与 Connection RPC registration。
- `shared/` 拥有两端共同使用的严格 protocol-v1 request 与 response data-transfer type。

「对话」始终挂载完整公开 Harness root。`ClawdshWebEntry` 使用公开 Loader、`createSlotRenderer()` 与 `buildRenderApp()` 组装；ClawDSH 不抽取 Chat，不复制 Session 状态，也不通过私有 import 或 CSS 隐藏原生 Harness 区域。「Harness 高级」是跳转到 `/` 的 document navigation，不是产品壳内对原生 GUI 的近似实现。

产品控制 channel 是 `/clawdsh-rpc`，使用 Connection 的 loopback-only authority。它的基础只读 method 是 `bootstrap/get` 与 `capabilities/list`；Settings 决策在同一 protocol 上增加严格的 versioned setting 与 credential method。Response 只包含 JSON data，绝不返回 live Cordis object 或 secret value。配置的 trusted host 不能使用产品控制 channel。

能力总览把 Loader 组装与产品支持证据分开。Loader entry 映射为 `disabled`、`starting`、`active`、`failed` 或 `misconfigured`；锁定渠道独立映射为 `cataloged`、`installable`、`certified` 或 `enabled`。Channels 把 Channel Protocol、Agent Bridge 与 OpenClaw Gateway Provider 显示为组件，飞书、Telegram 与其他锁定 entry 则作为 catalog item 嵌套在 Gateway 下。Loopback response 还会投影经过净化的实时 `ctx.channels.health()` 证据：Provider lifecycle、是否存在 authenticated Bridge handshake，以及已暴露 account 的 channel 与 status；不会暴露 account id、Gateway id、路径或 diagnostic。Legacy channel plugin 只在 raw Loader inventory 中可见，不参与产品健康状态。

语义 Activity 通过独立所有的 `@clawdsh/dsh-activity` Host service 与 `activity/list` 控制 method 组合。Activity route 跟随当前 Session 并呈现其限制隐私的 page，Raw Trajectory 则留在 Harness 高级。可编辑 Settings 同样在能力总览旁组装，并由独立的 validation、revision、credential 与 lifecycle 决策所有。

产品壳是应用组装，而不是可复用 Harness Client contribution。它不注册 Client Slot，不调用 `ctx.slots.register()` 注入产品 UI，不进入根 Client aggregate 或 Client Catalog，不导入上游 `src/*` 路径，也不修改 `api-proxy`、Agent Loop、generated file 或上游自有源码。该决策只部分取代旧决策中「不拥有 ClawDSH browser UI」的选择；复用原生对话 runtime、profile 组装与 `clawdsh` preset 保持不变。

## Verification

嵌套项目独立 typecheck 和测试 browser/runtime，并以 Vite base `/clawdsh/` 生成产品 asset。Runtime test 覆盖静态 method 与路径穿越拒绝、index transform、严格 RPC request、loopback authority、能力 projection 与 Loader-settled URL 报告。Browser test 覆盖仅公开 import、module loading、稳定导航、能力总览、远程控制失败与产品 404 route。

真实 profile keyless journey 构建嵌套项目，将它安装进隔离 dsh home，在没有外部凭据或 OpenClaw artifact 时启动 `clawdsh` profile，并访问 `/clawdsh/`、Settings、Activity、产品 404 与 `/`。它验证原生应用不含 ClawDSH 产品导航，安装后的默认 preset 仍为 `clawdsh` / `ClawDSH 模式`，受管 Soul composition 能够挂载，始终挂载的 Gateway 会通过业务设置让 Channels 显示为关闭，并且 27 个 production channel 仍只是 cataloged 而不是 certified。

Activity package、控制面与 browser test 覆盖语义 projection、sidecar degradation、privacy mapping、当前 Session 选择与 pagination，同时没有把产品壳 ownership 扩展到 Raw Trajectory。

## Alternatives considered

**继续把原生 dsh 应用作为整个产品。** 这会让 ClawDSH 继续表现为 Session preset，无法表达进程级能力，也无法区分 Loader 状态与支持证据。因此原生应用改为保留作 Harness 高级。

**通过 Client Slot 增加 ClawDSH 页面。** 产品壳是顶层应用，不是 Harness frame 内的可复用 occupant。新 Slot 与 catalog entry 需要修改上游自有文件，也仍然无法建立 profile 级产品边界。

**Fork 或抽取 Chat。** 重新实现 Chat 会重复 Connection、Session、流式输出、审批与工具呈现行为。导入私有 Chat subtree 或用 CSS 隐藏相邻 UI 会把 ClawDSH 绑定到未记录的上游结构。当前实现保留完整公开 root。

**在 Settings 中暴露 Loader 启停。** Loader mutation 可能破坏依赖，也会混淆实现状态与产品配置。Loader inventory 保持只读；能力自有 schema 与经过校验的生命周期语义提供可编辑控制面。

**让静态页面与 RPC 使用同一个 route prefix。** Connection prefix matching 会让产品 asset 与控制调用重叠。`/clawdsh/` 与 `/clawdsh-rpc` 分别拥有各自命名空间。

## Consequences

ClawDSH 在不修改上游 GUI 代码的情况下获得稳定的本地产品入口与导航，用户仍可使用完整 Harness 对话与 raw 诊断。实时 handshake 证明本地 Gateway–Bridge 已认证连接时，能力总览会据实报告；它只计数明确报告 ready 的 account，并在 OpenClaw 隐藏逐账号状态时说明这一点，不会从运行中的进程推断平台已就绪。

嵌套项目有独立的 install、typecheck、test 与 build lifecycle，因为它有意处于根 Client aggregate 之外。开发安装在 runtime 与 browser artifact 构建前会失败。产品页与 Harness 高级页可能保留不同的临时 browser state，尽管两者共享持久 Host Session。

产品壳组合独立所有的 Settings 与 Activity 能力。语义记录使用自身的 projection、storage、privacy 与 degradation 规则，不能从 Loader 证据推断。
