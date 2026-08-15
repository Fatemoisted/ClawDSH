# packages/openclaw — ClawDSH 自有插件域

[English](README.md) | 中文

本目录是 ClawDSH **唯一允许自由改写产品代码的地方**（上游纪律见根 `AGENTS.md`）。[Harness 复用地图](../../docs/matrix/harness-reuse.md)记录这些包如何使用现有服务、事件、库和平台 SDK。

## 目录布局

本目录下每个目录都是一个**可发布 npm 包**：约束门禁要求每个 `packages/openclaw/*` 都带 `publishConfig.access: public` 与 `repository` 字段的 manifest，因此非包素材一律放在本目录之外：

- `tools/openclaw-plugin-template/` — 新插件的 `.tpl` 骨架；
- `tools/openclaw-preset-openclaw/` — openclaw 组装层（agent preset + profile 模板），由 `tools/link-openclaw.sh` 安装；
- `docs/specs/feature-channel-wechat.md` — 微信系原则性排除的决策记录。

## 接入流程（实现某个插件时）

1. 复制 `tools/openclaw-plugin-template/` 到目标包目录，把 `*.tpl` 后缀去掉并填空（参照已实现的 `soul/` 包，它是完整范例）；
2. 写 `docs/specs/feature-<name>.md`（功能规格）；
3. 更新 `docs/matrix/parity.md`（对齐矩阵状态列）；
4. 在 **openclaw 聚合**里注册构建链：包自身的 tsconfig（extends `../../tsconfig.base.json`，references 每个 workspace 依赖）+ `packages/openclaw/tsconfig.json` 里的 `{ "path": ... }` 条目。openclaw 包**刻意不进**上游 `tsconfig.host.json`——cordis-catalog 门禁对 host face 是 fail-closed 双向校验（两个文件的注释有说明）。测试类型检查走 `packages/openclaw/tsconfig.check.json`（通配 `*/tests/**`，并把 vendor paths 重定向到构建产物 `lib/types`）；
5. **必须配套 `src/invariant.ts`**（vitest 的 test-invariants 强制要求，参照 soul 包），package.json 的 exports/files 带上 `./invariant`；
6. 新增 seam 必须先在 `docs/adr/` 立项（见 `docs/standards/plugin-contract.md`）。

## 包清单

| 包 | 定位 | OpenClaw 对应 | 集成边界 |
|---|---|---|---|
| [`channel-core/`](channel-core/README.md) | 持久渠道网关 | 渠道 Gateway | ClawDSH `ctx.channels`；Harness agents/presets/persistence/timer |
| [`channel-telegram/`](channel-telegram/README.md) | Telegram 渠道 | 渠道适配器 | ClawDSH `ctx.channels`；Harness timer；grammY |
| [`channel-discord/`](channel-discord/README.md) | Discord 渠道 | OpenClaw `src/discord/` | ClawDSH `ctx.channels`；Harness credentials/timer；discord.js |
| [`channel-feishu/`](channel-feishu/README.md) | 飞书渠道（**发起人第一优先**） | OpenClaw `extensions/feishu` | ClawDSH `ctx.channels`；Harness timer；官方 `LarkChannel` |
| [`soul/`](soul/README.md) | 人格 / Soul | Soul 系统 | Harness system-prompt 装配与作用域 |
| [`memory/`](memory/README.md) | 记忆（Markdown 事实源 + 语义召回） | Memory（v2026.1.15） | Harness fs/sandbox/tools/system prompt；可选 ClawDSH embeddings 与 Harness LLM 生命周期 |
| [`embeddings/`](embeddings/README.md) | 文本嵌入 Service Definition | memory 的 embeddings 后端选一 | ClawDSH `ctx.embeddings`（ADR-0003）；Harness Cordis service 基类 |
| [`embeddings-ark/`](embeddings-ark/README.md) | 火山方舟 Ark 文本嵌入 provider | openai-remote 分支位 | ClawDSH `ctx.embeddings`；可选 Harness credentials/启动环境 |
| [`skills-hub/`](skills-hub/README.md) | ClawHub 兼容技能加载 | Skills/ClawHub | Harness `ctx.skills` provider 约定 |
| [`automation/`](automation/README.md) | 定时持久 Agent 回合 | Cron/Automation | Harness agents/sessions/model selection 与可选 persistence；croner/Node timer |

渠道列表不止 Telegram 和 Discord：WhatsApp、Email、Web Chat 等按同一模板逐个新增（每个渠道一个包，互不阻塞）。

各链接包 README 负责其配置、失败行为和已知限制。[Harness 复用地图](../../docs/matrix/harness-reuse.md)负责跨包依赖视图；[功能矩阵](../../docs/matrix/parity.md)负责完成状态。

## 发布状态

10 个包已组成独立的 `clawdsh` release family：共享一条版本线和 `clawdsh-v*` tag，不与根 dsh 或 vendor 版本耦合。bump/verify/pack/publish 脚本、profile 范围同步、workspace 约束、pack 产物、主路径与 invariant 路径的全新 packed-install 验证及 `.github/workflows/clawdsh-publish.yml` 均已实现。PR 与 `clawdsh` 分支 push 无需 registry 凭证即可构建并验证 tarball；发布目标由受保护的 `npm-publish` environment 变量 `NPM_REGISTRY_URL` 配置，且只能通过 `clawdsh-v*` tag 上的受保护手动操作执行。

当前工作树尚未实际执行 ClawDSH npm 发布。因此在明确发布前，本地开发仍使用 `tools/link-openclaw.sh` 及其 profile symlink。
