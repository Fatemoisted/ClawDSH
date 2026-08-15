# Agent Note: ClawDSH 产品壳 runtime 与只读控制面

Status: implemented

[English](2026-08-15-clawdsh-product-shell-runtime.md) | 中文

[本地 GUI 规格](../../../../docs/specs/feature-gui-web.md)拥有当前用户可见行为。更广泛的[产品壳提案](../../proposed/architecture/2026-08-15-clawdsh-product-shell.md)仍处于 proposed，用于可编辑 Settings 与语义 Activity。

## Problem

最初的 [dsh Web bundle 组装](2026-08-15-openclaw-gui-dsh-web-app.md)证明 `clawdsh` preset 能够驱动原生 Harness GUI，但 preset label 无法表示产品边界。Agent preset 按 Session 变化，ClawDSH Host 能力却是进程级。原生导航也无法区分 ClawDSH 能力健康状态、raw Loader 诊断与渠道认证证据。

独立产品应用必须保留现有 Harness 对话实现，并遵守仓库上游只读规则。新增 Client Slot、修改 Client Catalog、导入上游私有源码或 fork Chat，都会使 ClawDSH 界面依赖未经批准的上游修改，或重复有状态行为。

## Decision

`clawdsh` profile 在原生 dsh Web runtime 旁挂载 `@clawdsh/dsh-product-runtime`。Host 在 `/clawdsh/` 下提供 ClawDSH SPA，以 HTTP 308 把 `/clawdsh` 重定向到该入口，并在 `/` 保留原生应用。产品 runtime 对产品 HTML 应用公开 index transform，并且只在 Loader settle 后打印 URL。两个浏览器应用访问相同的 Host service、Session store、Connection transport 与持久化。

产品代码是 `packages/openclaw/preset-openclaw/product-shell/` 下的嵌套非 workspace build：

- `browser/` 拥有产品导航、只读总览、Activity 空状态，以及加载公开 boot manifest 与 Client module table 的 `ClawdshWebEntry`。
- `runtime/` 拥有静态 Host route、Loader-settled ready URL、能力 projection 与 Connection RPC registration。
- `shared/` 拥有两端共同使用的严格 protocol-v1 request 与 response data-transfer type。

「对话」始终挂载完整公开 Harness root。`ClawdshWebEntry` 使用公开 Loader、`createSlotRenderer()` 与 `buildRenderApp()` 组装；ClawDSH 不抽取 Chat，不复制 Session 状态，也不通过私有 import 或 CSS 隐藏原生 Harness 区域。「Harness 高级」是跳转到 `/` 的 document navigation，不是产品壳内对原生 GUI 的近似实现。

产品控制 channel 是 `/clawdsh-rpc`，使用 Connection 的 loopback-only authority。Protocol v1 接受严格的 `{ version: 1 }` request，并且只暴露 `bootstrap/get` 与 `capabilities/list`。Response 只包含 JSON 产品 identity、稳定 route、能力 component、净化后的 Loader 证据与锁定的 OpenClaw channel catalog；绝不返回 live Cordis object。配置的 trusted host 不能使用产品控制 channel。

只读 Settings 页面把 Loader 组装与产品支持证据分开。Loader entry 映射为 `disabled`、`starting`、`active`、`failed` 或 `misconfigured`；锁定渠道独立映射为 `cataloged`、`installable`、`certified` 或 `enabled`。Channels 把 Channel Protocol、Agent Bridge 与 OpenClaw Gateway Provider 显示为组件，飞书、Telegram 与其他锁定 entry 则作为 catalog item 嵌套在 Gateway 下。Legacy channel plugin 只在 raw Loader inventory 中可见，不参与产品健康状态。

本增量有意不包含可编辑 Settings 与语义 Activity。RPC channel 没有 setting、credential 或 activity method；browser 没有 mutation 或 secret flow；Activity route 渲染明确空状态。Raw Trajectory 留在 Harness 高级。

产品壳是应用组装，而不是可复用 Harness Client contribution。它不注册 Client Slot，不调用 `ctx.slots.register()` 注入产品 UI，不进入根 Client aggregate 或 Client Catalog，不导入上游 `src/*` 路径，也不修改 `api-proxy`、Agent Loop、generated file 或上游自有源码。该决策只部分取代旧决策中「不拥有 ClawDSH browser UI」的选择；复用原生对话 runtime、profile 组装与 `clawdsh` preset 保持不变。

## Verification

嵌套项目独立 typecheck 和测试 browser/runtime，并以 Vite base `/clawdsh/` 生成产品 asset。Runtime test 覆盖静态 method 与路径穿越拒绝、index transform、严格 RPC request、loopback authority、能力 projection 与 Loader-settled URL 报告。Browser test 覆盖仅公开 import、module loading、稳定导航、只读总览、远程控制失败与产品 404 route。

真实 profile keyless journey 构建嵌套项目，将它安装进隔离 dsh home，在没有外部凭据或 OpenClaw artifact 时启动 `clawdsh` profile，并访问 `/clawdsh/`、Settings、Activity、产品 404 与 `/`。它验证原生应用不含 ClawDSH 产品导航，安装后的默认 preset 仍为 `clawdsh` / `ClawDSH 模式`，受管 Soul composition 能够挂载，关闭的 communication-plane 父组会让 Channels 显示为关闭，并且 27 个 production channel 仍只是 cataloged 而不是 certified。

明确的 coverage gap 是尚未实现的 Settings 与 Activity 范围：带 revision 的 mutation、credential handling、enabled semantics、语义 projection、sidecar storage、隐私 mapping 与 Activity pagination 在本决策中没有已交付 runtime behavior。

## Alternatives considered

**继续把原生 dsh 应用作为整个产品。** 这会让 ClawDSH 继续表现为 Session preset，无法表达进程级能力，也无法区分 Loader 状态与支持证据。因此原生应用改为保留作 Harness 高级。

**通过 Client Slot 增加 ClawDSH 页面。** 产品壳是顶层应用，不是 Harness frame 内的可复用 occupant。新 Slot 与 catalog entry 需要修改上游自有文件，也仍然无法建立 profile 级产品边界。

**Fork 或抽取 Chat。** 重新实现 Chat 会重复 Connection、Session、流式输出、审批与工具呈现行为。导入私有 Chat subtree 或用 CSS 隐藏相邻 UI 会把 ClawDSH 绑定到未记录的上游结构。当前实现保留完整公开 root。

**在首版 Settings 页面暴露 Loader 启停。** Loader mutation 可能破坏依赖，也会混淆实现状态与产品配置。首版控制面保持只读；能力自有 setting schema 与经过校验的生命周期语义仍属于独立 proposal 工作。

**让静态页面与 RPC 使用同一个 route prefix。** Connection prefix matching 会让产品 asset 与控制调用重叠。`/clawdsh/` 与 `/clawdsh-rpc` 分别拥有各自命名空间。

## Consequences

ClawDSH 在不修改上游 GUI 代码的情况下获得稳定的本地产品入口与导航，用户仍可使用完整 Harness 对话与 raw 诊断。只读总览准确呈现能力所有权与 runtime 证据，不会把运行中的 Gateway 宣称成任何平台账号已经 certified。

嵌套项目有独立的 install、typecheck、test 与 build lifecycle，因为它有意处于根 Client aggregate 之外。开发安装在 runtime 与 browser artifact 构建前会失败。产品页与 Harness 高级页可能保留不同的临时 browser state，尽管两者共享持久 Host Session。

当前产品壳不是完整控制面。用户不能通过它编辑 ClawDSH setting 或 credential，Activity 也尚不能解释 Session 行为。这些能力需要独立的 server validation、持久化、隐私与 lifecycle 决策，不能从当前只读实现推断。
