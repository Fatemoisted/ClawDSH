# OpenClaw ↔ dsh 功能对齐矩阵

> 本矩阵是 ClawDSH 的**单一事实源**：OpenClaw 的每个功能域在这里得到唯一分类与状态。任何 PR 涉及功能变更必须同步更新本文件（见 `docs/standards/pr-policy.md`）。
>
> 分类含义：
> - **复用**：dsh 原生能力，直接用，不写代码；
> - **插件**：挂到 dsh 既有接缝上的增量包（`packages/openclaw/*`）；
> - **新 seam**：dsh 没有对应接缝，需要新增（必须 ADR + upstream-first）；
> - **暂缓**：本轮不做，记录原因。

**OpenClaw 基线**：待定（阶段 1 首个任务；目标窗口 2025-12 ~ 2026-01，按功能集合边界选 commit）。

## 矩阵 v1（2026-08-14 初稿）

| OpenClaw 功能域 | dsh 对应接缝 | 分类 | 落地包 | 状态 |
|---|---|---|---|---|
| 会话 / 消息历史 | `ctx.sessions`（append-only log） | 复用 | — | 直接可用 |
| 会话追溯 / 回放 / 分叉 | Trajectory 视图 / replay | 复用 | — | 直接可用 |
| 工具执行（bash/文件/浏览器…） | `ctx.tools` / `ctx.shell` / `ctx.fs` / `ctx.web` | 复用 | — | 直接可用 |
| 技能（Skill） | `ctx.skills`（provider 合并） | 插件 | `skills-hub` | planning |
| 定时 / 自动化 | `ctx.schedule` / `ctx.jobs` | 插件 | `automation` | planning |
| 人格（Soul） | system-prompt 装配 | 插件 | `soul` | planning（Spike 候选 #1） |
| 记忆（Memory） | `ctx.spillStore` / session-persistence | 插件 | `memory` | planning |
| **渠道网关（Gateway）** | **无** | **新 seam** | `channel-core` | planning（ADR-0002） |
| 渠道：Telegram | `ctx.channels` | 插件 | `channel-telegram` | planning（Spike 候选 #2） |
| 渠道：WhatsApp / Email / Web Chat | `ctx.channels` | 插件 | 后续逐包 | 暂缓（阶段 3） |
| 审批 / 安全策略 | `ctx.approval` / guard | 复用（配置） | — | 直接可用 |
| 联邦节点（clawd） | `ctx.subagents`（transport） | 插件 | 待命名 | 暂缓（阶段 3 末评估） |
| 智能家居（casa） | 无 | 新插件域 | 待命名 | 暂缓 |
| 桌面/移动客户端 | `apps/web`（dsh Web UI） | 复用 | — | 后续评估定制面 |

## 维护规则

1. 新增/删除/重新分类任何功能域 = 改本表 + 提交说明里注明；
2. "暂缓"条目必须写原因与解除条件；
3. 每次 OpenClaw 基线变更（阶段 1 定稿后）或 dsh 上游同步后，复查一次本表。
