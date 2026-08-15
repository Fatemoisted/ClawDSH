# ClawDSH → Harness 复用地图

[English](harness-reuse.md) | 中文

本参考把 ClawDSH 自有包映射到其使用的 DeepSeek Harness 公开能力。它只记录集成视图，不重复 Harness 包目录；完整约定以链接的子系统和包文档为准。强制规则与理由分别见[插件约定](../standards/plugin-contract.md)和 [ADR-0010](../adr/0010-harness-contract-first.md)。

<a id="harness-module-entry"></a>

## Harness 模块入口

使用以下持续维护的参考，不另外手写一份目录，也无需遍历实现源码：

| 问题 | 持续维护的来源 |
|---|---|
| 有哪些包组，各包组负责什么？ | [包组地图](../../packages/README.md) |
| 有哪些包，它们的运行时依赖如何连接？ | [生成式模块依赖图](../module-graph.md) |
| 子系统公开哪些服务、事件与类型？ | [子系统参考](../subsystems/README.md) |
| ClawDSH 增加了哪些 Cordis service 与 channel event？ | [生成式 ClawDSH Service 投影](../subsystems/clawdsh.md) |
| 能力、事件、工具、配置、组合与生命周期如何连接？ | [生成式与编写式关系图索引](../graph-atlas.md) |

生成式模块图是根 Harness workspace 的完整包目录。在上游自有的顶层包组中，手工维护的包组地图目前只遗漏 [`mcp/`](../../packages/mcp/README.md) 与 [`runtime-diagnostics/`](../../packages/runtime-diagnostics/invariants/README.md)：前者把外部 MCP server 接入 Harness 工具，后者负责运行时 invariant 注册表与各包 companion。有意嵌套的 `preset-openclaw/product-shell` 应用使用独立 lockfile，不属于根 workspace 或该生成式图；其 Harness 复用关系记录在下文。上游包组地图补入前述两行后，应删除上游补遗。

## 开发路径

1. 在 [OpenClaw 对齐矩阵](parity.md)中定位功能。
2. 从 [Harness 架构](../architecture.md)选择现有扩展点。
3. 通过上方模块入口选择所属子系统、包和生成式关系视图。
4. 通过 ClawDSH 插件复用服务、事件、provider 约定、工具库或维护中的平台 SDK。
5. 没有合适 seam 时，先停下并编写 ADR，再新增 `ctx.*` 能力。

渠道工作还受 [ADR-0008](../adr/0008-openclaw-channel-plane.md) 的所有权边界约束：锁定的 OpenClaw Gateway 拥有平台传输，Harness 拥有 Agent、Session、工具、存储与模型执行。不得通过扩宽旧进程内 adapter 绕过 sidecar 方案。

## 本地产品壳映射

产品壳是私有 nested build，而不是另一个可发布 feature package。它保持 Harness browser 与 Host runtime 不变，只组装其公开 seam：

| 自有组件 | ClawDSH 职责 | 必需 `inject` 及来源 | 其他复用组件及来源 | 构建组件 |
|---|---|---|---|---|
| [`product-shell/runtime`](../../packages/openclaw/preset-openclaw/product-shell/runtime/src/index.ts) | `/clawdsh/` 静态路由、仅 loopback 的控制 RPC、净化后的 capability manifest、经过校验的 Settings/credential 写入、语义 Activity 页面与产品 readiness | Harness：`webServer`、`connection`、`loader`、`agentPresets`、`settings`、`credentials` | Harness：frontend-static `serveStatic`、WebServer index transform、Connection RPC、Loader entry/fiber、preset inspection、分层 Settings、write-only credential 与 Session persistence inspection；ClawDSH：可选 `clawdshOpenClawControl` 与 `clawdshActivity` | tsdown |
| [`product-shell/browser`](../../packages/openclaw/preset-openclaw/product-shell/browser/src/ClawdshWebEntry.tsx) | 产品导航、可编辑 capability Settings、限制隐私的语义 Activity，以及完整原生 Harness 应用的挂载 | Harness：browser `slots`、`sessions`、`layout`、`connection` | Harness：Client module boot manifest/static table、公开 Loader、`createSlotRenderer()`、`buildRenderApp()` 与 Connection `isLoopback`；ClawDSH：typed control client 与共享 RPC protocol | React、Vite |

Browser 不 fork Chat 或 Session 状态，Host 也不暴露不受限 Loader mutation 或秘密值。`/` 保持未修改的 Harness 应用；两个 browser 入口共享同一个 Host、Session、持久化与 Connection transport。已实现 Settings 与 Activity 的产品边界以 [ADR-0007](../adr/0007-clawdsh-local-gui-product.md)与 [GUI feature spec](../specs/feature-gui-web.md)为准。

## 当前渠道平面映射

[生成式 ClawDSH Service 投影](../subsystems/clawdsh.md)是 `ctx.channels` 的 method-level 权威；本表记录 package ownership 与 Harness 复用，不复制该 Cordis surface。

| 自有包 | ClawDSH 职责 | 必需 `inject` 及来源 | 其他复用组件及来源 | 外部组件 |
|---|---|---|---|---|
| [`channel`](../../packages/openclaw/channel/README.md) | provider-neutral V1 Service Definition 与严格 bridge value | — | Harness：Cordis `Service` 基类；zod 校验 | — |
| [`channel-agent`](../../packages/openclaw/channel-agent/README.md) | 持久 route generation、Session 绑定、Agent 执行、已校验图片导入、恢复 ledger、route-bound `message` tool 与渠道 Activity | Harness：`agents`、`sessions`、`sessionPersistence`、`agentDefaultModel`、`agentPresets`、`attachments`、`storageDomain`、`tools`、`settings`；ClawDSH：`channels` | Harness：Agent follow-up、Session event/flush、attachment 校验/存储、scoped tool restriction；ClawDSH：可选 `clawdshActivity` | 锁定的 OpenClaw AgentHarness 协议 |
| [`channel-openclaw`](../../packages/openclaw/channel-openclaw/README.md) | 校验并监督锁定 Gateway、认证 IPC、提供 Provider、持久化 action/delivery 状态并校验受管 enablement | Harness：`storageDomain`、`subprocess`、`settings`；ClawDSH：`channels` | Harness：可选 `credentials`、launch-environment snapshot、process lifecycle、executable resolution 与持久存储原语；ClawDSH：`clawdshOpenClawControl` | 锁定的 OpenClaw Gateway 与 channel plugin |
| [`preset-clawdsh-messaging-safe`](../../packages/openclaw/preset-clawdsh-messaging-safe/README.md) | non-owner 与群聊 Channel Session 的受限组合 | — | Harness：preset discovery 与 system-prompt composition；channel-agent 负责 inherited-tool restriction | — |

这些行是 canonical 通信平面。其 package 与 protocol test 只建立实现基础；profile 保持整个 group 关闭，目前没有任何 sidecar Channel 达到 certified 或 enabled。

## 保留的旧渠道映射

| 自有包 | 兼容职责 | 必需 `inject` 及来源 | 其他复用组件及来源 | 平台组件 |
|---|---|---|---|---|
| [`channel-core`](../../packages/openclaw/channel-core/README.md) | 定义 `ctx.legacyChannels`；把旧 provider conversation 与已接受图片引用路由到 Agent Session | Harness：`agents`、`sessions`、`llm`、`agentDefaultModel`、`agentPresets`、`sessionPersistence`、`timer` | Harness：Agent 创建/恢复、preset 解析/挂载、准确模型 `resolveModelInfo`、文本/图片 block、attachment 引用类型、Session flush、timeout 工具 | — |
| [`channel-telegram`](../../packages/openclaw/channel-telegram/README.md) | 旧 Telegram event、图片 materialization 与 send/reaction adapter | ClawDSH：`legacyChannels`；Harness：`timer` | Harness：可选 `credentials`、启动环境、`credentials/updated` 与 `ctx.attachments` 限制/校验/保存 | grammY、`@grammyjs/auto-retry`、`@grammyjs/files` |
| [`channel-discord`](../../packages/openclaw/channel-discord/README.md) | 旧 Discord Gateway/REST adapter | ClawDSH：`legacyChannels`；Harness：`timer` | Harness：可选 `credentials`、启动环境、`credentials/updated` | discord.js |
| [`channel-feishu`](../../packages/openclaw/channel-feishu/README.md) | 旧飞书/Lark 归一化消息 adapter | ClawDSH：`legacyChannels`；Harness：`timer` | Harness：可选 `credentials`、启动环境、`credentials/updated` | 官方 `@larksuiteoapi/node-sdk` `LarkChannel` |

本表只记录 compatibility code 如何复用 Harness，不建议新渠道工作继续采用这条路径。2026-08-15 Telegram 真实客户端测试与更早的飞书文本 smoke 运行在该 legacy path；Discord 只有无密钥覆盖。由于 host、provider namespace、准入路径、ledger、媒体边界与投递路径均不同，这些事实都不能认证锁定的 sidecar。

## 其他自有包映射

| 自有包 | ClawDSH 职责 | 必需 `inject` 及来源 | 其他复用组件及来源 | 平台组件 |
|---|---|---|---|---|
| [`activity`](../../packages/openclaw/activity/README.md) | 限制隐私的语义 Activity service、有界 sidecar、history projection 与 pagination | Harness：`settings` | Harness：`resolveDshHome` 与标准 Session event type；ClawDSH producer 通过 Cordis 发现可选 `clawdshActivity` | Node 文件系统 |
| [`soul`](../../packages/openclaw/soul/README.md) | Settings-backed、Agent-scoped persona section 与 prompt Activity | Harness：Settings host 使用 `settings`；session row 使用 `systemPrompt`；ClawDSH：`clawdshSoulSettings` | Harness：scope ownership 与 system-prompt assembly；ClawDSH：可选 `clawdshActivity` | Node 文件系统 |
| [`memory`](../../packages/openclaw/memory/README.md) | Settings-backed Memory 工具、prompt guidance、索引、flush lifecycle 与语义 Activity | Harness：`tools`、`systemPrompt`、`fs`、`settings` | ClawDSH：可选 `embeddings` 与 `clawdshActivity`；Harness：可选 `sandboxPolicy`、`tokenMeter`、`llm` 及 Agent/Session/compaction event | chokidar |
| [`embeddings`](../../packages/openclaw/embeddings/README.md) | 定义 `ctx.embeddings` | — | Harness：Cordis `Service` 基类 | — |
| [`embeddings-ark`](../../packages/openclaw/embeddings-ark/README.md) | Settings-backed `ctx.embeddings` 火山方舟实现 | Harness：`settings` | ClawDSH：`embeddings`；Harness：可选 `credentials`、启动环境与 timeout 上限 | 方舟 HTTP API |
| [`skills-hub`](../../packages/openclaw/skills-hub/README.md) | Settings-backed ClawHub 风格目录 provider | Harness：`skills`、`settings`、`subprocess` | Harness：`SkillProvider` 约定与 `resolveExecutable()` | Node 文件系统、YAML |
| [`automation`](../../packages/openclaw/automation/README.md) | Settings-backed 定时 Agent 回合 | Harness：`agents`、`sessions`、`agentDefaultModel`、`settings` | Harness：可选 `sessionPersistence` 与 Agent/model/Session 库 | croner、Node timer |

适用的每个 runtime package 还导出一个 `./invariant` companion。注入 Harness invariant 注册表的是该 companion，不是每个主插件。

## 组合、状态与限制

[ClawDSH 组装 README](../../packages/openclaw/preset-openclaw/README.md)负责默认组合与安装行为，[功能矩阵](parity.md)负责完成状态与渠道支持状态，各链接 package README 负责配置、失败行为与已知限制。[Telegram legacy E2E 手册](../cookbook/telegram-e2e.md)负责可重复的历史真实测试流程及其证据边界。

## 维护

自有包增加或删除注入服务、可选服务、导入约定或平台组件时，同步更新本地图，并始终保留 Harness/ClawDSH/OpenClaw 来源标记。生成式模块图继续作为根 Harness workspace 的完整目录；本页记录其导航入口、包组地图的明确漏项、独立构建的嵌套产品壳与 ClawDSH 集成视图。
