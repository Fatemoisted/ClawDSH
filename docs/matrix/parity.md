# OpenClaw ↔ dsh 功能对齐矩阵

> 本矩阵是 ClawDSH 的**单一事实源**：OpenClaw 的每个功能域在这里得到唯一分类与状态。任何 PR 涉及功能变更必须同步更新本文件（见 `docs/standards/pr-policy.md`）。
>
> 分类含义：
> - **复用**：dsh 原生能力，直接用，不写代码；
> - **插件**：挂到 dsh 既有接缝上的增量包（`packages/openclaw/*`）；
> - **新 seam**：dsh 没有对应接缝，需要新增（必须 ADR + upstream-first）；
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
| 技能（Skill） | 顶层 `skills/` | `ctx.skills`（provider 合并） | 插件 | `skills-hub` | planning |
| 定时 / 自动化 | `src/cron/` | `ctx.schedule` / `ctx.jobs` | 插件 | `automation` | planning |
| 人格（Soul） | `src/agents/` 的 identity 机制（具体形态阶段 2 深读） | system-prompt 装配 | 插件 | `soul` | **implemented**（阶段 0 ✅） |
| 记忆（Memory） | 基线无 → 参考 v2026.1.15 `src/agents/memory-search.ts`、`memory-tool.ts` | `ctx.spillStore` / session-persistence | 插件 | `memory` | planning |
| **渠道网关（Gateway）** | `src/gateway/` | **无** | **新 seam** | `channel-core` | planning（ADR-0002） |
| 渠道：Telegram | `src/telegram/` | `ctx.channels` | 插件 | `channel-telegram` | planning |
| 渠道：Discord | `src/discord/` | `ctx.channels` | 插件 | `channel-discord`（待建） | planning |
| 渠道：iMessage / Signal / Slack | `src/imessage/` 等 | `ctx.channels` | 插件 | 后续逐包 | 暂缓（阶段 3） |
| 渠道：WhatsApp | 参考 v2026.1.15 `src/whatsapp/` | `ctx.channels` | 插件 | 后续逐包 | 暂缓（阶段 3） |
| 审批 / 安全策略 | `src/security/`（1.15 起） | `ctx.approval` / guard | 复用（配置） | — | 直接可用 |
| 联邦节点（clawd） | 基线早期无 | `ctx.subagents`（transport） | 插件 | 待命名 | 暂缓（阶段 3 末评估） |
| 智能家居（casa） | 基线无 | 无 | 新插件域 | 待命名 | 暂缓 |
| 桌面/移动客户端 | `ui/`（+ `apps/`） | `apps/web`（dsh Web UI） | 复用 | — | 后续评估定制面 |

## 维护规则

1. 新增/删除/重新分类任何功能域 = 改本表 + 提交说明里注明；
2. "暂缓"条目必须写原因与解除条件；
3. 每次 dsh 上游同步后复查本表（OpenClaw 基线是功能清单快照，不再变动；若需深读某一功能，按"基线出处"列查 `/tmp/openclaw-ref`）。
