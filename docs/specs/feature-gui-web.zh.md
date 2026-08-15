# Feature spec：ClawDSH 本地 GUI

[English](feature-gui-web.md) | 中文

- **状态**：仅 preset 的 dsh Web 基线已经实现；ClawDSH 产品壳已由 [ADR-0007](../adr/0007-clawdsh-local-gui-product.md) 接受，实现待完成
- **当前组装**：`tools/openclaw-preset-openclaw/`
- **产品角色**：与飞书、Telegram、Discord 及未来渠道前台并列的 ClawDSH 本地前台

## 当前基线

`pnpm dsh --profile clawdsh` 把原生 `dsh-web-app` bundle 与 `clawdsh` agent preset 组合起来。浏览器在 `http://127.0.0.1:3080` 启动，新 Session 默认使用显示为 `ClawDSH 模式` 的 preset，GUI 对话能够获得 Soul、Memory、Skills 与标准 agent 工具。干净安装默认关闭飞书、Telegram、Discord 与 Automation，因此 Web Host 无需这些功能的凭据即可启动。

该基线有意不包含 ClawDSH 自有浏览器代码，因此它的 Settings 与 Trajectory 呈现 Harness 信息模型，而不是完整的 ClawDSH 产品模型。

开发安装脚本为 `tools/link-clawdsh.sh`。它检测到旧 `openclaw` profile 与 preset 目录时只给出警告，不删除、不移动，也不创建别名。产品级安装状态、托管 manifest 与 `clawdsh doctor` 属于公共发行 CLI。

## 目标

目标本地 GUI 是构建在 dsh 公开 Web runtime 之上的独立 ClawDSH 产品界面。它保留成熟的 Harness 对话实现，同时让用户能够在一个位置理解、配置并检查把 Harness 变成 ClawDSH 的附加能力。由于公开 `buildRenderApp()` face 渲染完整 Harness root 而不是单独 Chat，v1 会把该完整 root 挂载在「对话」目的地内。

产品壳不会创建第二套 agent runtime。ClawDSH 与 Harness 高级共享同一个 Host 进程、Session store、Connection transport 与持久化；两者只在应用导航和呈现上不同。

## 非目标

- 不 fork 或重新实现 dsh Chat、Session 状态、流式输出、审批、工具呈现或原始 Trajectory。
- 不把产品导航插入原生 Settings 或 Trajectory Slot，也不新增 Client Slot。
- 不用 CSS、私有 Slot 或私有 import 抽取或隐藏 Chat-only subtree。
- 不把不受限制的 Cordis Loader mutation 暴露成普通产品设置。
- 不把逐 Session preset 选择描述成卸载进程级 ClawDSH 能力。
- 不改变飞书、Telegram、Discord 或其他渠道的前台路径。

## 入口与生命周期

- `http://127.0.0.1:<port>/clawdsh/` 是默认 ClawDSH 产品入口。
- `/` 保留未修改的 dsh Web 应用，并以「Harness 高级」链接。
- `dsh --profile web` 启动不含 ClawDSH Host 能力集的纯净 Harness 进程。
- ClawDSH profile 使用 `clawdsh` id，新 Session 默认使用 `clawdsh` agent preset，并显示为 `ClawDSH 模式`。
- 在运行中的 ClawDSH profile 内选择其他 agent preset，只会改变该 Session 的 Agent 组装。它不会卸载进程级 ClawDSH 插件，也不会被描述成切换到纯净 Harness。

## 导航

产品壳有四个稳定的顶层目的地：

1. **对话**挂载包含原生 frame 与诊断在内的完整 dsh Client root，从而复用 Chat、流式输出、审批、工具呈现、分页与 Session 持久化。
2. **ClawDSH 设置**呈现产品能力及其受支持配置，而不是任意 Cordis Loader entry。
3. **ClawDSH 活动**呈现与当前 Session 关联的 ClawDSH 行为语义记录。
4. **Harness 高级**打开原生 dsh Web 界面，用于原始 Settings、Loader 与 Trajectory 诊断。

## 配置面

Settings 视图把每项 ClawDSH 功能作为具有稳定 namespace 的产品能力。每项能力都显示所属包、对应 Loader entry 与 Fiber 状态、依赖、启用状态、凭据就绪状态、配置字段与变更生效时间。来源使用一套固定映射：`@clawdsh/*` 属于 ClawDSH，`@deepseek-ai/*` 与 `cordis:*` 属于 Platform，其他来源全部属于 Community。

| 能力 | Namespace | Profile base | 生效时间 |
|---|---|---:|---|
| Soul | `clawdsh-soul` | 启用 | 新 Session |
| Channel Core | `clawdsh-channel-core` | 必需 | 重启 |
| Feishu | `clawdsh-feishu` | 关闭 | 重启 |
| Telegram | `clawdsh-telegram` | 关闭 | 重启 |
| Discord | `clawdsh-discord` | 关闭 | 重启 |
| Memory | `clawdsh-memory` | 启用 | 重启 |
| Ark Embeddings | `clawdsh-embeddings-ark` | 按需 | 下次调用或重启 |
| Skills Hub | `clawdsh-skills-hub` | 启用 | 重启 |
| Automation | `clawdsh-automation` | 关闭 | 重启 |

配置字段由每项能力在服务端拥有的 Config schema 描述。用户设置覆盖 profile base，reset 移除 user layer，带 revision 的写入防止旧浏览器状态覆盖新值。视图区分 desired revision 与 runtime revision，并报告是否需要重启。

在 Settings 控制面交付前，飞书、Telegram、Discord 与 Automation 使用 Loader `disabled` 配置项建立上述干净安装默认值。Settings 控制面增量会保持其业务插件挂载，并把运行控制迁移到经过校验的 `enabled` 字段；产品 UI 不暴露任意 Loader mutation。

秘密值留在 dsh credentials provider 中。浏览器可以知道 allowlist 内的 credential reference 是否已配置，但 Host 绝不返回秘密值。秘密只在 write-only input draft 与其发出的 `credentials.set` 请求中短暂存在，请求完成后即清空，也不会保留在 Settings state，或持久化到日志、Session 文件与 Activity 记录。关闭的可选能力可以缺少凭据；启用能力时，要在最早能够判断的位置验证其必需 reference。

Channel Core 始终是必需的内部能力；Embeddings 等实现依赖显示在所属产品能力之下，而不是作为无关的顶层开关。Advanced 视图保留只读 Loader inventory；产品 UI 不暴露不受限制的插件 mutation。

托管的 `clawdsh` preset 暂时位于 dsh 用户 preset 根目录。ClawDSH Settings 不提供删除操作，但未修改的 Harness preset 管理器仍将它归类为用户资产，因而可以删除。公共发行的 `clawdsh doctor` 会校验并修复该托管资产；产品壳不宣称上游用户 preset 操作不可用。

## ClawDSH 活动

Activity 把记录分成 Soul/Prompt、Memory、Channels、Skills 与 Automation。它跟随当前 Session，并支持分页、时间排序和类别过滤。Prompt 条目只描述 ClawDSH 自有贡献，不声称能够还原最终扁平化 System Prompt。

当标准 Session history 已经包含所需事实时，视图从中推导记录；对于 Session log 不拥有的事实，再以限制隐私的 ClawDSH sidecar 补充。sidecar 缺失、损坏、轮转或不可写时，只让 Activity 降级，绝不阻断对话、渠道投递或自动化。原始 Trajectory 继续通过 Harness 高级访问，不被 Activity 替换。

## 组装接缝与集成约束

- 产品壳复用公开 dsh boot manifest、浏览器模块图、加载状态、完整 root renderer、Connection transport 与 Client 插件；不 fork Chat 或 Session 状态。
- ClawDSH 拥有 shell、路由、控制 runtime、Settings 页面、Activity 页面、能力 schema 与 sidecar 存储。
- 浏览器与 runtime 源码继续嵌套在 `tools/openclaw-preset-openclaw/` 下，不进入根 Client aggregate 或 shipped Client Catalog。
- ClawDSH 自有 shell 代码不注册新 Client Slot，不调用 `ctx.slots.register()` 注入产品 UI，不修改 `api-proxy`、Agent Loop、生成文件或任何上游自有源码，也不通过规避仓库检查的方式伪装 catalog 改动。被复用的 dsh Client 插件继续注册其既有 Slot。
- 静态产品路由拥有 `/clawdsh/`；控制 method 使用不重叠的 `/clawdsh-rpc` Connection channel，并以 `{ authority: 'loopback' }` 注册，因此配置的 trusted host 仍不能调用它。
- 该 channel 只拥有 `bootstrap/get`、`capabilities/list`、`settings/describe`、`settings/mutate`、`settings/reset`、`credentials/describe`、`credentials/set` 与 `credentials/unset`。
- 如果实现发现产品需要缺失的 dsh capability 或任何上游改动，本 GUI 工作会停止，并在批准的 local-only 边界内重新设计；它不会发起上游 PR。

## 模型可见面

产品壳本身不增加模型可见输入。对话请求继续使用所选 agent preset 与已挂载的能力插件。未来任何改变 prompt、工具、Memory、Skills、渠道或 Automation 的 Settings 变更，都必须能够从所属 dsh seam 要求的权威 Session event 中重建。

## 目标验收标准

1. 空 dsh home 且没有任何外部凭据时，可以启动 ClawDSH profile 并打开 `/clawdsh/`。
2. 新 ClawDSH Session 默认使用 `clawdsh` preset，并显示为 `ClawDSH 模式`。
3. 对话、ClawDSH 设置、ClawDSH 活动与 Harness 高级均可访问。
4. 产品壳与原生 dsh Web 应用使用同一 Host Session 与持久化，在「对话」中挂载其完整公开 root，且不重新实现或私下抽取 Chat。
5. Settings 显示能力来源、依赖、配置、凭据就绪状态、desired/runtime revision 与重启要求；过期写入以 conflict 失败。
6. 秘密值只通过 write-only credential draft 与其发出的请求跨越浏览器边界；Host 绝不返回，draft 在请求完成后清空，Settings state、日志、Session 持久化与 Activity 存储均不保留秘密值。
7. 可选渠道与 Automation 在无凭据时默认关闭，能力变更会在其记录的生效时间真实改变 runtime。
8. Activity 显示可获得的 Prompt、Memory、Channel、Skill 与 Automation 记录，同时限制隐私的 sidecar 失败不影响底层行为运行。
9. 原始 Trajectory 继续通过 Harness 高级访问，`dsh --profile web` 保持纯净 Harness 行为。
10. 在产品壳标记为 implemented 前，browser typecheck、真实 profile Playwright 旅程与 keyless 产品 snapshot 覆盖完整组装应用。
