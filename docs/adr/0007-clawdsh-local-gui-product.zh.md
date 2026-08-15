# ADR-0007：基于 dsh Web runtime 的 ClawDSH 本地 GUI 产品壳

[English](0007-clawdsh-local-gui-product.md) | 中文

- **状态**：已接受（产品壳与 Settings 控制面已实现；语义 Activity 待完成）
- **日期**：2026-08-15
- **依赖**：ADR-0001（自有代码隔离）、[当前 dsh Web GUI 组装](../../.agents/notes/implemented/feature/2026-08-15-openclaw-gui-dsh-web-app.md)

## Context

本地 GUI 把原生 `dsh-web-app` bundle、显示为 `ClawDSH 模式` 的 `clawdsh` agent preset 与自有产品 runtime 组合起来。`/clawdsh/` 提供 ClawDSH 导航、能力总览与 allowlist Settings 控制面，`/` 保留完整 DeepSeek Harness 应用。语义 Activity 记录仍属于独立实现增量。

profile 与 agent preset 的生命周期不同。profile 为进程挂载 Host 插件，preset 则组合某个 Session 的 Agent plane。因此，在 ClawDSH profile 内选择 `standard` preset 不会卸载 ClawDSH 的渠道、Memory、Skills 或 Automation，也不能诚实地表示「纯净 DeepSeek Harness」。

dsh 公开 Web 组装已经提供 Session runtime、浏览器模块图、RPC carrier、Settings 基础设施、原始 Trajectory，以及一个渲染完整 Harness root 的 renderer。它没有把 Chat 暴露成独立应用组装。因此，ClawDSH 接受在 v1「对话」目的地内放入完整 Harness root，并在外层增加应用级产品组装。该组装只落在 ClawDSH 自有文件中，也不需要上游 PR；如果实现需要上游改动或私有 Chat 抽取，本 GUI 工作会停止，并在 local-only 边界内重新设计。

## Decision

1. **产品与引擎使用不同入口。** `/clawdsh/` 是默认 ClawDSH 界面。`/` 保留未修改的 DeepSeek Harness GUI，并命名为「Harness 高级」。`dsh --profile web` 继续表示纯净 Harness 进程；在 ClawDSH profile 内更换 agent preset 不会被描述成产品模式切换。
2. **ClawDSH 拥有顶层导航。** 产品壳提供「对话」「ClawDSH 设置」「ClawDSH 活动」与「Harness 高级」。Harness 继续拥有对话实现及其内部诊断导航。
3. **复用完整 dsh 浏览器 root，不分叉 Chat。** 产品壳消费公开 boot manifest、模块图、加载状态与 `buildRenderApp()` root renderer。v1 的「对话」挂载包含原生 frame 与诊断在内的完整 Harness root；ClawDSH 不通过 CSS、私有 Slot 或私有 import 抽取 Chat-only subtree。ClawDSH 只拥有外层壳、路由、控制 runtime、Settings 视图与 Activity 视图；Session 状态、agent loop、RPC transport、Chat、审批、流式输出、持久化与原始 Trajectory 继续归 dsh 所有。
4. **产品壳是应用组装，不是 Client Slot contribution。** 源码位于 `packages/openclaw/preset-openclaw/`，不进入根 Client aggregate。ClawDSH 自有 shell 代码不注册 `dsh.client` 包或新 Slot，不进入 shipped occupant catalog，也不修改 `api-proxy`、Agent Loop、Client Catalog、生成文件或上游源码。被复用的 dsh graph 继续注册其既有 Slot。
5. **Settings 控制 ClawDSH 能力，不控制任意 Loader row。** 主视图呈现能力来源、依赖、启用状态、凭据就绪状态与生效时机。原始 Loader inventory 只保留为高级只读诊断。Host 绝不返回秘密值。秘密只在 write-only input draft 与其发出的 `credentials.set` 请求中短暂存在，请求完成后即清空，也不会保留在 Settings state、日志、Session 文件或 Activity 存储中。Business plugin 保持 mounted，让 Config schema 持续可用，经过校验的 `enabled` 字段则控制可选 runtime effect。OpenClaw 独占 platform credential；ClawDSH credential allowlist 只包含 dsh 自有 reference。
6. **控制面使用独立的 loopback RPC 前缀。** 静态产品路由拥有 `/clawdsh/`，因此控制 method 使用不重叠的 `/clawdsh-rpc` Connection channel。它以 `{ authority: 'loopback' }` 注册，在空 trusted-host 集合下复用 JSON、Host 与 same-origin fence；配置的 trusted host 不能调用它。
7. **Activity 补充而不替换 Trajectory。** ClawDSH Activity 用产品语言解释 Soul/Prompt、Memory、Channels、Skills 与 Automation。原始 Trajectory 继续作为权威 Harness 诊断视图。Prompt 记录描述 ClawDSH 贡献，不声称能够还原最终扁平化 prompt 的全部分段。
8. **产品身份是 ClawDSH。** 用户可见模式为 `ClawDSH 模式`，profile 与 preset id 均为 `clawdsh`。物理 `preset-openclaw` 源码目录只因仓库既有层级检查把它视为组装目录而保留；它不是用户术语。
9. **旧身份只触发警告。** `tools/link-clawdsh.sh` 检测到旧 `openclaw` profile 或 preset 目录时给出警告并保持原状，既不删除，也不创建兼容别名。托管安装 manifest、完整性检查与 `clawdsh doctor` 修复操作属于公共发行 CLI。

详细的所有权与验证依据见 [ClawDSH 产品壳 Agent Note](../../.agents/notes/proposed/architecture/2026-08-15-clawdsh-product-shell.md)与已实现的 [Settings 控制面决策](../../.agents/notes/implemented/feature/2026-08-15-clawdsh-settings-control-plane.md)。

## Consequences

- ClawDSH 获得稳定产品身份，以及可独立演进的 Settings 与 Activity 体验，同时保留完整 dsh 对话 runtime。
- v1 的 Conversation 目的地中仍会显示 Harness 原生 frame 及其内置诊断入口。Harness Advanced 在 `/` 直接全页打开同一个原生应用；未来若要提供无内层 frame 的 Chat-only 体验，需要重新作出架构决策。
- 仓库需要拥有并测试一个新增 Web 应用壳与控制 runtime；它们与所消费的 dsh 公开浏览器 API 之间必须固定兼容关系。
- 产品路由与高级路由共享同一个 Host 进程和持久化，但可以拥有相互独立的页面本地 UI 状态。
- 能力开关描述 ClawDSH 行为，不暴露不受限制的 Cordis Loader mutation。
- 托管的 `clawdsh` preset 暂时位于 dsh 用户 preset 根目录。ClawDSH Settings 不提供删除操作，但未修改的 Harness preset 管理器仍可把它作为用户 preset 删除；公共发行的 `clawdsh doctor` 会显式修复该状态。
- 产品壳拥有路由、导航、能力 Settings 与明确的 deferred Activity 状态；它不宣称语义 Activity 存储已经交付。

## Alternatives

- **继续使用原生 dsh GUI，只增加 ClawDSH preset（否决）**：它能运行能力，却无法拥有产品导航、完整 ClawDSH 设置、来源、依赖状态或语义活动，并会继续混淆 profile 与 preset 生命周期。
- **Fork 或直接修改 dsh GUI（否决）**：这会重复承担上游 UI 所有权，扩大每次上游同步的冲突，并违反仓库的上游只读规则。
- **把全部 ClawDSH 页面做成新的 Client Slot contribution（v1 否决）**：顶层产品导航属于应用组装，不是可复用 Harness feature；静态 shipped roster 归 dsh 所有。ClawDSH 不会伪造该 catalog，也不会在本地修改它。
- **重新实现 Chat 与 Session 状态（否决）**：streaming、reconnect、审批、分页、持久化与工具呈现已经在 dsh 中各有唯一 owner，否则这些行为会产生分叉。
- **用私有 import、私有 Slot 或 CSS 抽取或隐藏 Chat-only subtree（否决）**：公开 renderer 拥有完整 Harness root。v1 接受把该 root 放入「对话」；如果该产品权衡无法接受，本 GUI 工作必须停止，并在不修改上游的前提下重新设计。
- **用 `standard` preset 表示纯净 Harness（否决）**：Host-plane ClawDSH 插件仍处于挂载状态，因此该标签会承诺一个并未发生的生命周期变化。
- **用 Activity 替换原始 Trajectory（否决）**：语义解释无法替代诊断所需的有序 Session 与 request 证据。
