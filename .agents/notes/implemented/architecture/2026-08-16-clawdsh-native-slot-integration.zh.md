# Agent Note: ClawDSH 原生 Slot 集成

Status: implemented

[English](2026-08-16-clawdsh-native-slot-integration.md) | 中文

本决策细化 [ADR-0007](../../../../docs/adr/0007-clawdsh-local-gui-product.md)，并部分取代[产品壳决策](2026-08-15-clawdsh-product-shell.md)中由 ClawDSH 拥有第二层顶级导航且避免 Client contribution 的选择。原 Agent Note 仍是 profile 边界、控制面、Settings mutation 规则、Activity 存储与隐私模型的权威依据。

## Problem

在完整 Harness 应用外再包一层 ClawDSH sidebar，会重复「对话」、Settings 与诊断导航。两列 sidebar 会占用空间，把 Loader 状态呈现成产品 readiness，并迫使 ClawDSH 页面从 owner 外部取得已选 Session 或切换原生视图。基于本地化 tab 文本的 DOM bridge 看似能够连接 Activity 与 Trajectory，却不是受支持 API，并可能在上游或 locale 变化后选择错误视图。

用户关闭原生 Settings panel 或选择其他 section 时，原生 Settings section 会卸载。因此，component-local draft 无法保留未保存的能力修改，而 credential value 又不能进入持久化 browser storage。UI 还需要在不修改冻结 protocol-v1 response 的前提下，区分 package 装载、业务启用、配置完整性与已验证使用。

## Decision

`/clawdsh/` 会在最小 root 容器内渲染一棵完整 `buildRenderApp()` tree。ClawDSH 删除外层导航，只向四个既有公开 Slot 贡献内容：`conversation.hero.agentPreset`、`sidebar.footer.action`、`settings.section` 与 `conversation.view`。这些 contribution 会固定产品 identity、添加全页 Harness 高级链接、把 ClawDSH 放在原生 Settings 首位，并在 Trajectory 后添加「ClawDSH 记录」。任何 contribution 都不 import 上游 `src/*` path、不注册新 Slot、不搜索本地化 DOM 文本，也不模拟 click。

产品 root 保留稳定的 `[data-variant='think']` 呈现规则，Harness 则拥有 AppFrame、sidebar、Session history、Chat、Settings chrome、Trajectory、composer 与所有关联 React state。打开或关闭 Settings 不会 remount 该原生应用。`/clawdsh/settings` 与 `/clawdsh/activity` 在一个兼容周期内通过 HTTP 308 跳转到 `/clawdsh/`；protocol-v1 route field 保持不变，直到后续单独进行版本化移除。

### Settings 生命周期与证据

由 ClawDSH Client plugin 创建的 store 拥有 Settings snapshot、namespace 与 credential draft、保存与冲突状态、展开状态和 dirty key。该 store 比每次 `settings.section` mount 存活更久，自行拥有 `beforeunload` listener，并随 plugin dispose。它不写入 browser 或 Session 持久化。Credential text 只存在于私有内存与发出的 request 中，并在成功、失败、显式清空或 plugin dispose 后擦除。

Browser 会从既有 `capabilities/list`、`settings/describe` 与 `credentials/describe` response 推导呈现。Mounted 表示存在实现证据，enabled 表示业务 effect 正在运行，configured 表示所需本地 setting 或 credential 已具备，verified 表示存在直接执行证据。UI 不推断 verified 状态。未知或畸形证据会显示「状态未知」，不会让整个 section 失败。

Soul、Memory、Skills Hub、Channels 与 Automation 是五项用户功能。Activity 以及 component、package 与 Loader 证据属于实现详情。Memory 把 Ark Embeddings 归入语义搜索配置，而不是第二项功能。Channels 把 Agent Bridge 与 OpenClaw Gateway 归入同一组。安全默认值会显示为中性产品状态：Gateway 未启动表示尚未连接平台，Automation 关闭且没有规则时不会创建定时工作。

### Session 记录

记录 contribution 从 session-scoped `conversation.view` Slot 接收 Session id。Session 变化与视图卸载会中止旧 Activity request 并清除 continuation。Prompt、Memory、Channels、Skills 与 Automation filter 保留按来源区分的 availability 与空状态说明。对应的事件顺序保留在收起的技术详情中，但不提供导航行为，因为公开 view API 没有暴露按 Session sequence focus 的操作。

## Alternatives considered

**保留第二层产品 sidebar。** 它可以拥有任意 route，却会重复原生控制项、减少可用宽度，并在权威 Session 应用外引入另一套生命周期。

**打开独立 ClawDSH Settings overlay。** 它容易保留 draft，却会留下两个 Settings 入口，并重复 Harness 已经拥有的 modal、focus 与 accessibility 行为。

**把 draft 持久化到 local 或 Session storage。** 持久化可以跨 remount 恢复，但 credential text 不能进入 durable storage，namespace draft 也会需要新的 invalidation 与 migration policy。随 plugin 生命周期存在的内存 store 已覆盖所需 UI 生命周期。

**通过 DOM selector 导航到 Trajectory 或增加本地上游 patch。** Selector 不是 API，而 patch 会违反上游所有权。在公开 focus API 存在前，相邻的原生 tab 是唯一导航；收起的 sequence metadata 不作更强承诺。

**向 protocol v1 添加 readiness field。** 既有 response 已经携带当前可用证据。由纯 browser presenter 解释它们，可以避免修改 wire，并防止把猜测的远端 readiness 变成 protocol claim。

## Verification

Focused browser test 固定四项 Slot registration、单一原生 root、wide 与 rail footer action、Settings 首位顺序、store 生命周期、unload protection、credential cleanup 与 dispose、状态矩阵、保守 fallback、第三个 tab 的 Session binding、cancellation、pagination、按来源区分的 availability 与按类别细分的空状态文案。Runtime test 固定 legacy redirect、query preservation、method rejection 与未知产品 path。Static assertion 会拒绝 private import 与 DOM navigation bridge。

Browser 会在 desktop、rail 与 narrow 宽度下操作正常 `clawdsh` profile。验证覆盖单一 sidebar、原生 ClawDSH Settings section、五项 clean-install 状态、相邻的「对话」「轨迹」「ClawDSH 记录」tab、真实 Session 产生的记录、legacy redirect、产品 404 与 browser console output。

## Consequences

ClawDSH 获得更小的信息架构，并让 Session 与 modal state 保持单一 owner。产品功能依赖四个 published Slot contract 与完整 root renderer 的稳定性，而不依赖原生 DOM 结构。

未保存 draft 只在当前 browser process 与 plugin 生命周期内保留。该选择有意放弃 reload 后恢复，以换取 credential text 不进入 durable storage。Sequence label 可以把记录与 Session 顺序关联起来，但不提供进入 Trajectory 的 deep link。
