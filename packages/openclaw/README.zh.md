# packages/openclaw — ClawDSH 自有插件域

[English](README.md) | 中文

本目录是 ClawDSH **唯一允许自由改写代码的地方**（上游纪律见根 `AGENTS.md`）。

## 为什么骨架目录里没有 package.json

上游的 pnpm workspace 与 tsdown 构建都以 `packages/*/*` 为通配符，且 tsdown 的扫描**以目录为粒度**（目录下没有 package.json 会向上游找到根包并报 `Cannot find entry`）。因此骨架阶段采用双保险：

1. **不放置 `package.json`** → pnpm 完全不可见；
2. **tsdown 显式排除** → 根 `tsdown.config.ts` 的 workspace `exclude` 名单包含 `packages/openclaw/**`（见 ADR-0001 决策 4 的构建编排豁免）。

实现某个插件时，把该包从排除名单中移出并按模板接入。

> 唯一例外是 `_template/`：它存放的是 `.tpl` 模板文件（无 `package.json` 实体文件），且整个目录被排除名单覆盖。

## 接入流程（实现某个插件时）

1. 复制 `_template/` 到目标包目录，把 `*.tpl` 后缀去掉并填空（参照已实现的 `soul/` 包，它是完整范例）；
2. 写 `docs/specs/feature-<name>.md`（功能规格）；
3. 更新 `docs/matrix/parity.md`（对齐矩阵状态列）；
4. 注册构建链：`tsconfig.base.json` paths 条目 + `tsconfig.host.json` references（或 client 聚合，见 `docs/development.md`），并从根 `tsdown.config.ts` 的排除名单移出；
5. **必须配套 `src/invariant.ts`**（vitest 的 test-invariants 强制要求，参照 soul 包），package.json 的 exports/files 带上 `./invariant`；
6. 新增 seam 必须先在 `docs/adr/` 立项（见 `docs/standards/plugin-contract.md`）。

## 包清单

| 包 | 定位 | OpenClaw 对应 | dsh 接缝 | 状态 |
|---|---|---|---|---|
| `preset-openclaw/` | openclaw profile + bundles + patches | 整体组装 | profile/patch 机制 | **implemented**（阶段 2 ✅） |
| `channel-core/` | 渠道网关 seam | 渠道网关 Gateway | **新增** `ctx.channels`（ADR-0002） | **implemented**（阶段 2 ✅） |
| `channel-telegram/` | Telegram 渠道 | 渠道适配器 | `ctx.channels` | **implemented**（阶段 2 ✅，e2e 待凭证） |
| `channel-feishu/` | 飞书渠道（**发起人第一优先**） | OpenClaw `extensions/feishu`（v2026.2.12 起） | `ctx.channels` | **implemented**（阶段 2 ✅，真实 e2e 已过） |
| `channel-wechat/` | 微信系——**决策记录：不实现**（上游无对应） | — | — | 原则性排除 |
| `soul/` | 人格 / Soul | Soul 系统 | system-prompt 装配 | **implemented**（阶段 0 ✅ + 阶段 2 深读定稿 ✅） |
| `memory/` | 记忆（Markdown 事实源 + 语义召回） | Memory（v2026.1.15） | `ctx.fs` + `ctx.tools` + system-prompt 段 + `ctx.get('embeddings')` | **implemented**（阶段 2 补漏 ✅） |
| `embeddings/` | 文本嵌入 seam（Service Definition） | memory 的 embeddings 后端选一 | **新增** `ctx.embeddings`（ADR-0003） | **implemented**（阶段 2 补漏 ✅） |
| `embeddings-ark/` | 火山方舟 Ark 文本嵌入 provider | openai-remote 分支位 | `ctx.embeddings` | **implemented**（阶段 2 补漏 ✅，e2e 待凭证） |
| `skills-hub/` | ClawHub 兼容技能加载 | Skills/ClawHub | `ctx.skills` | planning |
| `automation/` | 定时任务 / 自动化 | Cron/Automation | `ctx.schedule` / `ctx.jobs` | planning |

渠道列表不止 Telegram：WhatsApp、Email、Web Chat 等按同一模板逐个新增（每个渠道一个包，互不阻塞）。
