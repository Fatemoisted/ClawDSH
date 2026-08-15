# ClawDSH → Harness 复用地图

[English](harness-reuse.md) | 中文

本参考把 ClawDSH 自有包映射到其使用的 DeepSeek Harness 公开能力。它只记录集成视图，不重复 Harness 包目录；完整约定以链接的子系统和包文档为准。强制规则与理由分别见[插件契约](../standards/plugin-contract.md)和 [ADR-0006](../adr/0006-harness-contract-first.md)。

## Harness 模块入口

使用以下持续维护的参考，不另外手写一份目录，也无需遍历实现源码：

| 问题 | 持续维护的来源 |
|---|---|
| 有哪些包组，各包组负责什么？ | [包组地图](../../packages/README.md) |
| 有哪些包，它们的运行时依赖如何连接？ | [生成式模块依赖图](../module-graph.md) |
| 子系统公开哪些服务、事件与类型？ | [子系统参考](../subsystems/README.md) |
| 能力、事件、工具、配置、组合与生命周期如何连接？ | [生成式与编写式关系图索引](../graph-atlas.md) |

生成式模块图是完整的包目录。在上游自有的顶层包组中，手工维护的包组地图目前只遗漏 [`mcp/`](../../packages/mcp/README.md) 与 [`runtime-diagnostics/`](../../packages/runtime-diagnostics/invariants/README.md)：前者把外部 MCP server 接入 Harness 工具，后者负责运行时 invariant 注册表与各包 companion。上游包组地图补入这两行后，应删除本补遗。

## 开发路径

1. 在 [OpenClaw 对齐矩阵](parity.md)中定位功能。
2. 从 [Harness 架构](../architecture.md)选择现有扩展点。
3. 通过上方 Harness 模块入口选择所属子系统、包和生成式关系视图。
4. 通过 ClawDSH 插件复用服务、事件、provider 约定、工具库或维护中的平台 SDK。
5. 没有合适 seam 时，先停下并编写 ADR，再新增 `ctx.*` 能力。

## 自有包映射

`inject` 列表示必需的运行时服务。每项都标明来源，避免把 ClawDSH 自建 seam 误认成上游 Harness 能力；可选服务和导入库继续与必需注入分开。

| 自有包 | ClawDSH 职责 | 必需 `inject` 及来源 | 其他复用组件及来源 | 平台组件 |
|---|---|---|---|---|
| [`channel-core`](../../packages/openclaw/channel-core/README.md) | 定义 `ctx.channels`；把 provider conversation 与已接受图片引用路由到持久 agent 会话 | Harness：`agents`、`sessions`、`llm`、`agentDefaultModel`、`agentPresets`、`sessionPersistence`、`timer` | Harness：Agent 创建/恢复、preset 解析/挂载、准确模型 `resolveModelInfo`、LLM 文本/图片 content block、attachment 引用类型、会话 flush、timeout 工具 | — |
| [`channel-telegram`](../../packages/openclaw/channel-telegram/README.md) | Telegram 事件、图片 materialize 与发送/reaction 适配器 | ClawDSH：`channels`；Harness：`timer` | Harness：可选 `credentials`、启动环境、`credentials/updated` 与 `ctx.attachments` 限制/校验/保存 | grammY、`@grammyjs/auto-retry`、`@grammyjs/files` |
| [`channel-discord`](../../packages/openclaw/channel-discord/README.md) | Discord Gateway/REST 适配器 | ClawDSH：`channels`；Harness：`timer` | Harness：可选 `credentials`、启动环境、`credentials/updated` | discord.js |
| [`channel-feishu`](../../packages/openclaw/channel-feishu/README.md) | 飞书/Lark 归一化消息适配器 | ClawDSH：`channels`；Harness：`timer` | — | 官方 `LarkChannel` |
| [`soul`](../../packages/openclaw/soul/README.md) | agent 作用域人格段落 | Harness：`systemPrompt` | Harness：作用域归属原语 | Node 文件系统 |
| [`memory`](../../packages/openclaw/memory/README.md) | 记忆工具、提示词指导、索引与 flush 生命周期 | Harness：`tools`、`systemPrompt`、`fs` | ClawDSH：可选 `embeddings`；Harness：可选 `sandboxPolicy`、`tokenMeter`、`llm` 及 agent/session/compaction 事件 | chokidar |
| [`embeddings`](../../packages/openclaw/embeddings/README.md) | 定义 `ctx.embeddings` | — | Harness：Cordis `Service` 基类 | — |
| [`embeddings-ark`](../../packages/openclaw/embeddings-ark/README.md) | `ctx.embeddings` 的火山方舟实现 | — | ClawDSH：`embeddings` 基类；Harness：可选 `credentials`、启动环境、timeout 上限 | 方舟 HTTP API |
| [`skills-hub`](../../packages/openclaw/skills-hub/README.md) | ClawHub 风格目录 provider | Harness：`skills` | Harness：`SkillProvider` 约定 | Node 文件系统、YAML |
| [`automation`](../../packages/openclaw/automation/README.md) | Config 声明的定时 agent 回合 | Harness：`agents`、`sessions`、`agentDefaultModel` | Harness：可选 `sessionPersistence` 与 agent/model/session 库 | croner、Node timer |

每个自有包还导出一个 `./invariant` 配套包。注入 Harness invariant 注册表的是该配套包，不是每个主插件。

## 组合、状态与限制

[OpenClaw profile README](../../tools/openclaw-preset-openclaw/README.md)负责默认组合与安装行为，[功能矩阵](parity.md)负责完成状态，各链接包 README 负责配置、失败行为与已知限制。

## Maintenance

自有包增加或删除注入服务、可选服务、导入约定或平台组件时，同步更新本地图，并始终保留 Harness/ClawDSH 来源标记。生成式模块图继续作为完整 Harness 目录；本页只记录其导航入口、包组地图的明确漏项与 ClawDSH 集成视图。
