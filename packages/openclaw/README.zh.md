# packages/openclaw — ClawDSH 自有插件域

[English](README.md) | 中文

本目录是 ClawDSH **唯一允许自由改写代码的地方**（上游纪律见根 `AGENTS.md`）。

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

| 包 | 定位 | OpenClaw 对应 | dsh 接缝 | 状态 |
|---|---|---|---|---|
| `channel-core/` | 持久渠道网关 | 渠道 Gateway | **新增** `ctx.channels` + Harness agents/presets/persistence/timer | **implemented**（可等待持久化、确定性恢复、FIFO、旧地址兼容、群聊/ack 策略 ✅） |
| `channel-telegram/` | Telegram 渠道 | 渠道适配器 | `ctx.channels` + grammY | **implemented**（command/mention/caption/topic/引用/reaction、Unicode-safe 4096 分片 ✅；线上 e2e 待凭证） |
| `channel-feishu/` | 飞书渠道（**发起人第一优先**） | OpenClaw `extensions/feishu` | `ctx.channels` + 官方 SDK `LarkChannel` | **implemented**（富消息归一化、身份退避、topic-safe 引用、失败握手清理 ✅；此前文本 e2e 已过） |
| `soul/` | 人格 / Soul | Soul 系统 | system-prompt 装配 | **implemented**（阶段 0 ✅ + 阶段 2 深读定稿 ✅） |
| `memory/` | 记忆（Markdown 事实源 + 语义召回） | Memory（v2026.1.15） | Harness `ctx.fs` + sandbox policy + tools/system prompt + embeddings | **implemented**（安全 append、配置化召回默认、缺失 root 启动、持久 flush 周期 ✅） |
| `embeddings/` | 文本嵌入 seam（Service Definition） | memory 的 embeddings 后端选一 | **新增** `ctx.embeddings`（ADR-0003） | **implemented**（阶段 2 补漏 ✅） |
| `embeddings-ark/` | 火山方舟 Ark 文本嵌入 provider | openai-remote 分支位 | `ctx.embeddings` | **implemented**（阶段 2 补漏 ✅，e2e 待凭证） |
| `skills-hub/` | ClawHub 兼容技能加载 | Skills/ClawHub | Harness `ctx.skills` provider | **implemented**（阶段 3 ✅） |
| `automation/` | 定时持久 Agent 回合 | Cron/Automation | Harness agents/sessions/persistence/model selection | **implemented**（阶段 3 ✅；配置声明规则） |

渠道列表不止 Telegram：WhatsApp、Email、Web Chat 等按同一模板逐个新增（每个渠道一个包，互不阻塞）。

## 发布状态

9 个包已组成独立的 `clawdsh` release family：共享一条版本线和 `clawdsh-v*` tag，不与根 dsh 或 vendor 版本耦合。bump/verify/pack/publish 脚本、workspace 约束、packed-install 验证及 `.github/workflows/release-clawdsh.yml` 均已实现。PR 与 `clawdsh` 分支 push 无需 registry 凭证即可构建并验证 tarball；npm 发布只能从 `clawdsh-v*` tag 受保护地手动触发。

当前工作树尚未实际执行 ClawDSH npm 发布。因此在明确发布前，本地开发仍使用 `tools/link-openclaw.sh` 及其 profile symlink。
