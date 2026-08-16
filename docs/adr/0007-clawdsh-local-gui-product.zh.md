# ADR-0007：基于 dsh Web runtime 的 ClawDSH 本地 GUI 产品壳

[English](0007-clawdsh-local-gui-product.md) | 中文

- **状态**：已接受（产品壳、Settings 控制面与语义 Activity 已实现）
- **日期**：2026-08-15
- **依赖**：ADR-0001（自有代码隔离）、[当前 dsh Web GUI 组装](../../.agents/notes/implemented/feature/2026-08-15-openclaw-gui-dsh-web-app.md)

## Context

本地 GUI 把原生 `dsh-web-app` bundle、显示为 `ClawDSH 模式` 的 `clawdsh` agent preset 与自有产品 runtime 组合起来。`/clawdsh/` 提供带 ClawDSH 能力分区与语义记录的原生 Session 界面，`/` 保留完整 DeepSeek Harness 应用。

profile 与 agent preset 的生命周期不同。profile 为进程挂载 Host 插件，preset 则组合某个 Session 的 Agent plane。因此，在 ClawDSH profile 内选择 `standard` preset 不会卸载 ClawDSH 的渠道、Memory、Skills 或 Automation，也不能诚实地表示「纯净 DeepSeek Harness」。

dsh 公开 Web 组装已经提供 Session runtime、浏览器模块图、RPC carrier、Settings 基础设施、raw Trajectory、完整 Harness root 的唯一 renderer，以及供功能自有导航与内容使用的公开 Slot。因此 ClawDSH 会把该完整 root 保持为产品 UI，并通过这些既有 Slot 贡献内容。该组装只落在 ClawDSH 自有文件中，也不需要上游 PR；如果实现需要上游改动、私下抽取或使用 DOM 导航桥接，本 GUI 工作会停止，并在 local-only 边界内重新设计。

## Decision

1. **产品与引擎使用不同入口。** `/clawdsh/` 是默认 ClawDSH 界面。`/` 保留未修改的 DeepSeek Harness GUI，并命名为「Harness 高级」。`dsh --profile web` 继续表示纯净 Harness 进程；在 ClawDSH profile 内更换 agent preset 不会被描述成产品模式切换。
2. **Harness 拥有顶层信息架构。** 产品只保留一个原生 sidebar。Session history 与新建 Session 操作承载「对话」，既有「设置」按钮会打开默认首先显示 ClawDSH 的原生 section，Harness 高级是新增的 sidebar footer link，每个已选 Session 则显示相邻的「对话」「轨迹」与「ClawDSH 记录」标签。
3. **复用完整 dsh 浏览器 root，不分叉 Chat。** 产品壳消费公开 boot manifest、模块图、加载状态与 `buildRenderApp()` root renderer，并把该完整 Harness root 只挂载一次到最小容器内。ClawDSH 不通过私有 Slot、私有 import 或布局 selector 抽取 Chat-only subtree。产品样式可以隐藏稳定语义标记 `[data-variant='think']` 的 reasoning row，因为推理内容属于 raw Trajectory，而不是产品 transcript。Session 状态、agent loop、RPC transport、Chat、审批、流式输出、持久化、Settings chrome 与 raw Trajectory 继续归 dsh 所有。
4. **ClawDSH 只向既有公开 Slot 贡献内容。** 源码位于 `packages/openclaw/preset-openclaw/`，不进入根 Client aggregate。`conversation.hero.agentPreset` 显示固定的 `ClawDSH 模式` identity，`sidebar.footer.action` 链接 Harness 高级，`settings.section` 拥有第一个 Settings section，`conversation.view` 拥有第三个 Session 标签。该组装不注册新 Slot 或 `dsh.client` package，不 import 上游 `src/*` path，不进入 shipped occupant catalog，也不修改 `api-proxy`、Agent Loop、generated file 或上游源码。它绝不按文本定位 tab，也不调用 DOM `.click()` 导航原生应用。
5. **Settings 控制 ClawDSH 能力，不控制任意 Loader row。** 主视图区分 mounted、enabled、configured 与 verified 四种含义，用户计数只包括 Soul、Memory、Skills Hub、Channels 与 Automation。Activity、package 来源、组件状态、channel catalog 与 Loader inventory 保留为收起的诊断。随 plugin 生命周期存在的内存 store 会在原生 section 卸载后保留 namespace 与 credential draft，并在不使用 browser 持久化的前提下继续提供 dirty unload protection。Host 绝不返回 secret；credential 写入成功、失败、显式清空或 plugin dispose 都会擦除私有 draft。Business plugin 保持 mounted，让 Config schema 持续可用，经过校验的 `enabled` 字段则控制可选 runtime effect。OpenClaw 独占 platform credential；ClawDSH credential allowlist 只包含 dsh 自有 reference。
6. **控制面使用独立的 loopback RPC 前缀。** 静态产品路由拥有 `/clawdsh/`，因此控制 method 使用不重叠的 `/clawdsh-rpc` Connection channel。它以 `{ authority: 'loopback' }` 注册，在空 trusted-host 集合下复用 JSON、Host 与 same-origin fence；配置的 trusted host 不能调用它。
7. **ClawDSH 记录补充而不替换 Trajectory。** 「ClawDSH 记录」标签用产品语言解释 Soul/Prompt、Memory、Channels、Skills 与 Automation，技术 Activity package 与 sidecar format 则保留原名。Raw Trajectory 继续作为权威 Harness 诊断视图。同一 Session 的事件序号只保留在收起的技术详情中；Prompt 记录描述 ClawDSH 贡献，不声称能够还原最终扁平化 prompt 的全部分段。
8. **产品身份是 ClawDSH。** 用户可见模式为 `ClawDSH 模式`，profile 与 preset id 均为 `clawdsh`。物理 `preset-openclaw` 源码目录只因仓库既有层级检查把它视为组装目录而保留；它不是用户术语。
9. **旧身份只触发警告。** `tools/link-clawdsh.sh` 检测到旧 `openclaw` profile 或 preset 目录时给出警告并保持原状，既不删除，也不创建兼容别名。托管安装 manifest、完整性检查与 `clawdsh doctor` 修复操作属于公共发行 CLI。

详细的所有权与验证依据见已实现的 [ClawDSH 产品壳 Agent Note](../../.agents/notes/implemented/architecture/2026-08-15-clawdsh-product-shell.md)、[原生 Slot 集成决策](../../.agents/notes/implemented/architecture/2026-08-16-clawdsh-native-slot-integration.md)与 [Settings 控制面决策](../../.agents/notes/implemented/feature/2026-08-15-clawdsh-settings-control-plane.md)。

## Consequences

- ClawDSH 获得稳定产品身份，以及可独立演进的 Settings 与 Activity 体验，同时保留完整 dsh 对话 runtime。
- Harness 原生 frame 就是产品 frame。Harness 高级在 `/` 直接全页打开原生应用；产品 route 只添加四项公开 Slot contribution 与语义 reasoning-row 策略。
- 仓库需要拥有并测试一个新增 Web 应用壳与控制 runtime；它们与所消费的 dsh 公开浏览器 API 之间必须固定兼容关系。
- 产品路由与高级路由共享同一个 Host 进程和持久化，但可以拥有相互独立的页面本地 UI 状态。
- ClawDSH「对话」界面固定可见 preset identity 并省略 reasoning row；Harness 高级保留完整 preset manager，推理证据仍可在 raw Trajectory 中查看。
- 能力开关描述 ClawDSH 行为，不暴露不受限制的 Cordis Loader mutation。
- 托管的 `clawdsh` preset 暂时位于 dsh 用户 preset 根目录。ClawDSH Settings 不提供删除操作，但未修改的 Harness preset 管理器仍可把它作为用户 preset 删除；公共发行的 `clawdsh doctor` 会显式修复该状态。
- Host 拥有正式产品 route 与 legacy redirect，原生 Harness component 拥有导航 chrome。ClawDSH 拥有能力 Settings 内容与语义记录。Activity 数据保持有界、限制隐私并 fail-open，不是 Session history 或 raw Trajectory 的权威替代。

## Alternatives

- **继续使用原生 dsh GUI，只增加 ClawDSH preset（否决）**：它能运行能力，却无法拥有产品导航、完整 ClawDSH 设置、来源、依赖状态或语义活动，并会继续混淆 profile 与 preset 生命周期。
- **Fork 或直接修改 dsh GUI（否决）**：这会重复承担上游 UI 所有权，扩大每次上游同步的冲突，并违反仓库的上游只读规则。
- **保留第二层 ClawDSH 导航壳（否决）**：它会重复原生应用已经拥有的「对话」、Settings 与 Activity 导航，占用横向空间，并可能卸载或让 Session UI state 失去同步。
- **重新实现 Chat 与 Session 状态（否决）**：streaming、reconnect、审批、分页、持久化与工具呈现已经在 dsh 中各有唯一 owner，否则这些行为会产生分叉。
- **用私有 import、私有 Slot 或布局 CSS 抽取或隐藏 Chat-only subtree（否决）**：公开 renderer 拥有完整 Harness root。窄化的语义 reasoning-row 策略与公开 preset-identity override 不会抽取或替换该 tree；更广泛的 Chat-only 体验仍需新的架构决策。
- **通过 selector、tab 文本或模拟 click 切换原生视图（否决）**：DOM 结构与本地化 label 都不是公开 API。ClawDSH 注册自身 section 与 view，并把跨 view 选择留给原生控制项。
- **用 `standard` preset 表示纯净 Harness（否决）**：Host-plane ClawDSH 插件仍处于挂载状态，因此该标签会承诺一个并未发生的生命周期变化。
- **用 Activity 替换原始 Trajectory（否决）**：语义解释无法替代诊断所需的有序 Session 与 request 证据。
