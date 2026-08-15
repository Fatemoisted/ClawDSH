# 上下文地图 — 该构建什么、该跳过什么

[English](context-map.md) | 中文

- **状态**：阶段 4 上下文纪律（2026-08-14）
- **目的**：单一入口，告诉 agent 哪里是 ClawDSH 自有代码（深读、可自由改）、哪里是上游 dsh（此处一次读完即可，之后跳过）。读这一页，就替代重读上游源码树。
- **配套**：[doc-inventory.md](doc-inventory.md)（按文件的归属）· [roadmap.md](roadmap.md)（ClawDSH 为何存在）

## 1. 构建面 — 深读、自由改

| 位置 | 是什么 |
|---|---|
| `packages/openclaw/` | 唯一可重写的包域——下面 10 个可发布包 |
| `docs/adr/`、`docs/specs/`、`docs/matrix/`、`docs/standards/`、`docs/journal/`、`docs/upstream-proposal/` | ClawDSH 的决策、规格、矩阵、规范、日志、上游提案 |
| `tools/` | ClawDSH 组装、插件模板、脚本与 e2e 驱动（`openclaw-preset-openclaw/`、`openclaw-plugin-template/`、`ark-e2e.ts`、`link-clawdsh.sh`、`sync-upstream.sh`） |
| `.github/workflows/clawdsh-*` | ClawDSH CI（`clawdsh-publish.yml`、`clawdsh-smoke.yml`） |

### 10 个可发布包

| 包 | 类型 | 消费 | 提供 / 做什么 |
|---|---|---|---|
| `channel-core/` | Service 类 | `agents`、`sessions`、`agentDefaultModel` | **提供 `ctx.channels`**（ADR-0002）——注册表 + 路由 + 呈现 |
| `channel-telegram/` | 适配器 | `ctx.channels` | Telegram 渠道适配器（grammY polling） |
| `channel-discord/` | 适配器 | `ctx.channels` | Discord 渠道适配器（Gateway WebSocket + REST 出站） |
| `channel-feishu/` | 适配器 | `ctx.channels` | 飞书渠道适配器（Lark 长连接） |
| `soul/` | 函数插件 | `systemPrompt` | 经 system-prompt section 提供人格（replace/append） |
| `memory/` | 函数插件 | `tools`、`systemPrompt`、`fs` | `memory_search`/`memory_get` + 召回 section + flush |
| `embeddings/` | Service 类 | — | **提供 `ctx.embeddings`**（ADR-0003）——抽象 `Embeddings` |
| `embeddings-ark/` | provider | `ctx.embeddings` | 火山方舟 provider（`doubao-embedding-vision`） |
| `skills-hub/` | provider | `skills` | ClawHub 兼容技能目录 |
| `automation/` | 函数插件 | `agents`、`sessions`、`agentDefaultModel` | croner 定时 agent 回合（`automation/run`） |

非包素材刻意不列入上表：应用组装位于 `tools/openclaw-preset-openclaw/`，复制即用的插件骨架位于 `tools/openclaw-plugin-template/`，微信系排除决策记录在 `docs/specs/feature-channel-wechat.md`。

## 2. 上游面 — 只读，已在 §3 浓缩

| 位置 | 规则 |
|---|---|
| `vendor/` | vendored Cordis；同步走 `vendor/README.md` |
| `packages/*`（除 `packages/openclaw/`） | 全部 `@deepseek-ai/dsh-*`——不改、也不重读 |
| `apps/`、`website/`、`native/`、`python/`、`examples/`、`assets/`、`patches/`、`scripts/` | 上游应用/运行时/SDK/示例/脚本 |
| `docs/` 上游页 | `architecture.md`、`development.md`、`glossary.md`、`cordis-primer.md`、…（dsh 视角） |
| 根配置 | `package.json`、`tsconfig*.json`、`tsdown.config.ts`、`vitest*.ts`、…（少数带 `@clawdsh/*` 新增条目，ADR-0001） |

只允许两类改动，绝无第三类：① 置顶品牌段（README/AGENTS）；② ADR 背书的新增式编辑（`@clawdsh/*` 注册点）。其余一律只读；rebase 冲突时取上游版本，再重放品牌段与注册条目。

## 3. dsh 一次读完 — 你需要的架构

### Cordis：一切皆插件

运行中的 `dsh` 是一棵插件树。每个插件向共享 context 贡献服务、类型化事件、可逆 effect；每次注册都经 `ctx.effect()` / `ctx.on()` 并返回 disposer。没有特权内核——模型适配器、工具注册表、session 日志、agent 循环都是插件，都能从配置替换。

### 能力 seam = Service Definition / Provider / Consumer

一种能力是一个 **seam**，含三个角色：Service Definition（接口）、一个或多个 Provider（实现）、Consumer（依赖方）。声明式依赖写在 `inject`；可选服务用 `ctx.get(name)`。新增 seam 是大事——ClawDSH 只准入过两个（`ctx.channels`、`ctx.embeddings`），各配一个 ADR。

### 组装：profile / patch / bundle

`dsh --profile <name>` 按序堆叠各层：profile 的 bundles → profile 的 `cordis.patch.yml` → home 级 patch → `--patch` 覆盖。patch 按 id 定位一行并整体替换其 config，或插入新行。`tools/link-clawdsh.sh` 将 `tools/openclaw-preset-openclaw/profile/cordis.patch.yml` 安装为 `clawdsh` profile，并把其中的 `clawdsh` preset 安装到 dsh 用户根目录。

干净安装的 profile 默认关闭飞书、Telegram、Discord 与 Automation，因此 Web Host 无需这些功能的凭据即可启动。这些默认值只在 Settings 控制面增量将可选行为迁移到已挂载插件的 `enabled` 设置前使用 Loader `disabled` 配置项。旧 `openclaw` profile 与 preset 目录仅触发警告并保持原状；托管 manifest 与 `clawdsh doctor` 修复流程由公共发行 CLI 负责。

### 不变量：模型可见 ⟺ 已记录

任何进入模型请求的内容都必须能从 session 日志重建。新增模型可见输入就要新增 session 事件。每个 ClawDSH feature 都据此校验（见 [product-chain.md](product-chain.md) 的逐 feature 台账）。

### seams

| Seam | 归属 | 使用者 | 一句话契约 |
|---|---|---|---|
| `ctx.systemPrompt` | 上游（`core`） | soul、memory | 有序 prompt section；一个 `complete` section 成为整份 prompt |
| `ctx.tools` | 上游（`core`） | memory | 工具注册表；`memory_search`/`memory_get` |
| `ctx.fs` | 上游（`fs`） | memory | 文件系统能力 + 策略 |
| `ctx.sessions` | 上游（`core`） | channel-core、automation | 内存 session 存储；flush、回合事件 |
| `ctx.agents` | 上游（`core`） | channel-core、automation | agent 注册表；恢复或新建回合 |
| `ctx.skills` | 上游（`skill`） | skills-hub | 技能 provider 注册表 |
| `ctx.llm` | 上游（`llm`） | （暂无） | LLM 能力（Service Definition + DeepSeek provider） |
| `ctx.subagents` | 上游（`subagent`） | （未来联邦） | subagent 委派（ADR-0005 transport） |
| `ctx.get(name)` | Cordis | memory（`embeddings`） | 通用可选服务访问器 |
| `ctx.channels` | **ClawDSH**（ADR-0002） | channel-*、channel-core | 渠道注册表 + 路由 |
| `ctx.embeddings` | **ClawDSH**（ADR-0003） | memory、embeddings-ark | 文本 embedding seam（抽象 `Embeddings`） |
| `ctx.schedule` | 无（无 Service seam） | — | 上游有 `dsh-schedule`（提醒*插件*）和 `ctx.jobs` seam；automation 两者都不用——直接 croner + `ctx.agents`/`ctx.sessions` |

**完整 seam 清单**：上游暴露 54 个服务，生成进 `packages/extensions/tool-cordis/src/api-catalog.ts`（`SERVICE_API`），人读摘要见 `docs/capability-seams.md`。查那个，别重读 `packages/*/src`——上表只列 ClawDSH 实际碰到的。

## 4. 阅读策略 — 开什么、跳什么

| 场景 | 打开 | 跳过 |
|---|---|---|
| 每次会话 | 本页 + `AGENTS.md` 品牌段 | — |
| 构建 ClawDSH feature | `packages/openclaw/<pkg>/src/`、`docs/adr/`、`docs/specs/feature-*.md`、`docs/matrix/parity.md` | 上游 `packages/*` 源码 |
| 新增 seam | 对应上游 Service Definition + 一个 ADR | 该上游包其余部分 |
| 查 seam 契约 | `docs/capability-seams.md` 或 `packages/extensions/tool-cordis/src/api-catalog.ts` | `packages/*/src` |
| rebase/同步 | `docs/standards/upstream-sync.md`、`vendor/README.md` | — |
| 排查上游行为 | `docs/architecture.md`、具体包的 README | 无关上游包 |
| 永不 | — | 从头重读 `vendor/` 或 `packages/*` |

**经验法则**：上游是平台，不是要读的代码库。你需要的是 seam 契约，不是实现。扩展时才读该 seam 的 Service Definition；否则信 §3。
