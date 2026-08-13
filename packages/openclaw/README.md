# packages/openclaw — ClawDSH 自有插件域

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
| `preset-openclaw/` | openclaw profile + bundles + patches | 整体组装 | profile/patch 机制 | planning |
| `channel-core/` | 渠道网关 seam（唯一新 seam） | 渠道网关 Gateway | **新增** `ctx.channels`（待 ADR-0002） | planning |
| `channel-telegram/` | Telegram 渠道 | 渠道适配器 | `ctx.channels` | planning |
| `soul/` | 人格 / Soul | Soul 系统 | system-prompt 装配 | **implemented**（阶段 0 ✅） |
| `memory/` | 记忆后端 | Memory | `ctx.spillStore` / session-persistence | planning |
| `skills-hub/` | ClawHub 兼容技能加载 | Skills/ClawHub | `ctx.skills` | planning |
| `automation/` | 定时任务 / 自动化 | Cron/Automation | `ctx.schedule` / `ctx.jobs` | planning |

渠道列表不止 Telegram：WhatsApp、Email、Web Chat 等按同一模板逐个新增（每个渠道一个包，互不阻塞）。
