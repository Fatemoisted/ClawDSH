# OpenClaw ↔ dsh 功能对齐矩阵

[English](parity.md) | 中文

> 本矩阵是 ClawDSH 的**单一事实源**：OpenClaw 的每个功能域在这里得到唯一分类与状态。任何 PR 涉及功能变更必须同步更新本文件（见 `docs/standards/pr-policy.md`）。
>
> 分类含义：
> - **复用**：dsh 原生能力，直接用，不写代码；
> - **插件**：挂到 dsh 既有接缝上的增量包（`packages/openclaw/*`）；
> - **新 seam**：dsh 没有对应接缝，需要新增（必须有 ADR；除非 ADR 明确记录项目另行决策，否则 upstream-first）；
> - **暂缓**：本轮不做，记录原因。

## 基线（阶段 1 定稿，2026-08-14）

**OpenClaw 基线 = tag `v2026.1.5`（commit `197b8f7c3b`）**，选定依据（完整分析见 docs/journal/2026-08-14.md 阶段 1 节）：

| 指标 | 2025-12-31 | **v2026.1.5 ✅** | v2026.1.15 | v2026.1.20 | v2026.1.30 |
|---|---|---|---|---|---|
| 文件数 | 1197 | **1537** | 3367（翻倍） | 4041 | 4543 |
| 渠道 | discord/telegram | **+imessage/signal/slack** | +whatsapp | — | — |
| channels 抽象 | ✗ | ✗ | ✓ | ✓ | ✓ |
| memory 目录 | ✗ | ✗ | ✓ | ✓ | ✓ |
| bloat 迹象（extensions/plugins/docker 部署矩阵） | ✗ | **✗** | 出现 | 加剧 | 加剧 |

- **为何 v2026.1.5**：首个发布 tag（1.5-1/2/3 小版本只修 bug），"网关 + 5 渠道 + cron + sessions + tui/wizard" 的个人助手核心体验完整且稳定；所有 tag 中代码量最瘦（1537 文件 / 1.6MB）；无 bloat 迹象；时间 = 项目爆红高峰期。
- **功能补全参考**：whatsapp / memory / channels 抽象在基线中尚未出现 → 移植时查阅 `v2026.1.15`（`9c4c9c5edd`）；更早的 gateway 雏形参考 `2025-12-31`（`f03605d8ae`）。
- 参考仓库本地缓存：`/tmp/openclaw-ref`（partial clone，blob:none；机器重启后需重拉，命令见 journal）。

## 矩阵 v2（基线定稿）

| OpenClaw 功能域 | 基线出处（v2026.1.5） | dsh 对应接缝 | 分类 | 落地包 | 状态 |
|---|---|---|---|---|---|
| 会话 / 消息历史 | `src/sessions/` | `ctx.sessions`（append-only log） | 复用 | — | 直接可用 |
| 会话追溯 / 回放 / 分叉 | —（dsh 原生） | Trajectory 视图 / replay | 复用 | — | 直接可用 |
| 工具执行（bash/文件/浏览器…） | `src/agents/*-tools.ts` | `ctx.tools` / `ctx.shell` / `ctx.fs` / `ctx.web` | 复用 | — | 直接可用 |
| 技能（Skill） | 顶层 `skills/` | `ctx.skills`（provider 合并） | 插件 | `skills-hub` | **implemented**（阶段 3 ✅） |
| 定时 / 自动化 | `src/cron/` | 自有 unref'd croner timer + `agent.followup`/`whenIdle`/`sessions.flush` 回合桥（`ctx.schedule` 否决：session-local + 300s 下限 + 仅工具面 API） | 插件 | `automation` | **implemented**（阶段 3 ✅） |
| 人格（Soul） | `src/agents/system-prompt.ts` 首行 + workspace 六文件（AGENTS/SOUL/TOOLS/IDENTITY/USER/BOOTSTRAP.md） | system-prompt 装配（persona 首行 / soul append / complete 段 / 工具指引带）+ 渠道呈现（IDENTITY ✅） | 插件 | `soul` | **implemented**（阶段 0 ✅ + 阶段 2 深读定稿 ✅） |
| 记忆（Memory） | 基线无 → 参考 v2026.1.15 `src/memory/` + `src/agents/memory-search.ts`、`memory-tool.ts` | Harness `ctx.fs`/sandbox + tools/system prompt + embeddings | 插件 | `memory` + `embeddings` + `embeddings-ark` | **implemented**（三工具、配置默认、缺失 root 启动、持久 flush 周期 ✅） |
| **渠道网关（Gateway）** | `src/gateway/` | **无** | **新 seam** | `channel-core` | **implemented**（可等待持久化、确定性恢复/preset/FIFO、legacy thread-only 兼容、策略 ✅） |
| 渠道：Telegram | `src/telegram/` | `ctx.channels` | 插件 | `channel-telegram` | **implemented**（command/mention/caption/topic/引用/reaction、Unicode-safe 4096 分片、生命周期 catch ✅） |
| 渠道：Discord | `src/discord/` | `ctx.channels` | 插件 | `channel-discord`（待建） | planning |
| 渠道：iMessage / Signal / Slack | `src/imessage/` 等 | `ctx.channels` | 插件 | 后续逐包 | 暂缓（阶段 3） |
| 渠道：WhatsApp | 参考 v2026.1.15 `src/whatsapp/` | `ctx.channels` | 插件 | 后续逐包 | 暂缓（阶段 3） |
| 审批 / 安全策略 | `src/security/`（1.15 起） | `ctx.approval` / guard | 复用（配置） | — | 直接可用 |
| 联邦节点（clawd） | 基线早期无 | `ctx.subagents`（transport） | 插件 | 待命名 | 暂缓（阶段 3 末评估） |
| 智能家居（casa） | 基线无 | 无 | 新插件域 | 待命名 | 暂缓 |
| 桌面/移动客户端 | `ui/`（+ `apps/`） | `apps/web`（dsh Web UI） | 复用 | — | 后续评估定制面 |

## 国内平台（原则：OpenClaw 上游有的才实现）

> **项目原则（发起人 2026-08-14 确立）**：只实现 OpenClaw 上游有出处的功能，摸着石头过河；不自行发明上游没有的功能域。国内平台按此原则逐一核实：

| 平台 | OpenClaw 上游现状 | 判定 |
|---|---|---|
| **飞书（Lark）** | ✅ 官方 `extensions/feishu`（2026-02-03 引入：`2483f26c23`→`0223416c61`；v2026.2.12 起发布） | **做，且为发起人第一优先**（详见下方矩阵行） |
| 企业微信 / 微信 / 公众号 / 个人微信 | ❌ 上游（最新 main）无任何微信系渠道（`tencent` 扩展是腾讯云 LLM provider，非渠道） | **不做核心包**——原则性排除；上游将来新增 wecom 时再跟进 |
| 钉钉 / QQ | ❌ 上游无 | 不做——原则性排除，同上 |

### 飞书渠道（矩阵行）

| 功能域 | 出处 | dsh 接缝 | 分类 | 落地包 | 状态 |
|---|---|---|---|---|---|
| 渠道：飞书（Lark） | OpenClaw `extensions/feishu`（v2026.2.12 起；引入提交 `0223416c61`） | `ctx.channels` + 官方 SDK 1.73 `LarkChannel` | 插件 | `channel-feishu` | **implemented**（富消息归一化、身份退避、topic-safe 3500 引用、失败握手清理、reaction ✅） |

微信系不落矩阵（不实现），决策记录见 `docs/specs/feature-channel-wechat.md`。

## 分发状态（不属于功能对齐）

9 个 `packages/openclaw/*` 成员现已组成独立、共享版本的 `clawdsh` release family，使用 `clawdsh-v*` tag。bump/verify/pack/publish、workspace 约束、packed-install 验证及受保护的 `.github/workflows/release-clawdsh.yml` 路径均已实现。当前工作树尚未执行 ClawDSH npm 发布；本地 profile 组装仍使用 `tools/link-openclaw.sh` symlink。

## 维护规则

1. 新增/删除/重新分类任何功能域 = 改本表 + 提交说明里注明；
2. "暂缓"条目必须写原因与解除条件；
3. 每次 dsh 上游同步后复查本表（OpenClaw 基线是功能清单快照，不再变动；若需深读某一功能，按"基线出处"列查 `/tmp/openclaw-ref`）；
4. 无上游出处的功能域不落矩阵（原则性排除），决策记录在对应包 README 或 journal。
