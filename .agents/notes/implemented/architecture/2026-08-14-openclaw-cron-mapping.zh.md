# Agent Note: OpenClaw cron 功能域 → dsh automation 映射

Status: implemented

[English](2026-08-14-openclaw-cron-mapping.md) | 中文

## 问题

对齐矩阵的 Scheduling/automation 行（出处：OpenClaw `src/cron/`，接缝：`ctx.schedule` / `ctx.jobs`）处于 planning。最自然的 dsh 落点——挂在既有 schedule 接缝上——经证实无法表达：schedule 包是面向存活 agent 的会话内任务调度，而 OpenClaw cron 是全局、冷启动、分钟粒度的调度器，每个 job 一个专属持久会话。要回答的问题：cron 功能类别到底落在哪个 dsh 接缝上，诚实的增量是什么？

## 决策

深读 OpenClaw `v2026.1.5`（`197b8f7c3b`）`src/cron/` 后定论：**automation 自持单个 re-arming unref'd timer + `croner` 库，并复用 dsh 已验证的回合驱动机制。`ctx.schedule` 与 `ctx.jobs` 以证据否决。**

OpenClaw 侧：

- **声明**：持久 JSON5 store `~/.clawdbot/cron/jobs.json`（`{version:1, jobs:[]}`），经 gateway `cron.add/update/remove/run/list` + CLI + hooks 创建。Job 形态：`{id, name, description?, enabled, schedule, sessionTarget: 'main'|'isolated', wakeMode, payload, state:{nextRunAtMs, runningAtMs?, lastRunAtMs?, lastStatus, lastError?, lastDurationMs?}}`。
- **调度**：`at`（一次性 epoch，成功后自动 disable，宕机后仍 due）、`every`（间隔 + anchor，无追赶）、`cron`（经 `croner`，5 字段，可选 IANA tz）。
- **执行**：`isolated` job 在专属会话 `cron:<jobId>` 开真实 agent 回合，prompt 帧为 `[cron:<jobId> <name>] <message>`；结束后向主会话投递摘要。`main` job 把 `System:` 行注入下一次主会话回合。
- **失败语义**：无自动重试；内存 `runningAtMs` in-flight 去重（2 小时卡死清理）；at-least-once（先持久化再跑）；store 原子写；per-job JSONL run log。单个 unref'd `setTimeout` 对准最早 `nextRunAtMs`；错过的 tick 跳过（无追赶）。

dsh 侧映射：

| OpenClaw cron 组成部分 | dsh 对应落地 |
|---|---|
| Job store `cron/jobs.json` | Config 声明的 `rules` 数组（z schema）——cordis.yml 即持久 store；无新存储 seam、本批次无 CRUD 工具 |
| `cron` 调度 | `croner` ^9.1.0（OpenClaw 验证过的同款库），挂载时校验 |
| `every` / `at` 调度 | 同语义：anchor 间隔无追赶；一次性带持久 once-guard |
| 单 re-arming timer | 一个 unref'd `setTimeout` 对准最早 `nextRunAt`（OpenClaw 调度器形态） |
| 每 job 的 `isolated` 会话 | 每规则一个专属 agent，`SessionId('automation:' + rule.id)`，跨重启 resume-or-create（`ctx.agents.resume` catch → `persistence.list()` 缺席 → `create`） |
| prompt 帧 `[cron:<jobId> <name>] <message>` | `[automation:<id> <name>] <message>` 经 `agent.followup`，`source: {kind:'plugin', plugin:'automation'}` |
| Run log `cron/runs/<jobId>.jsonl` | 会话日志本身：回合前后 append `automation/run` 事件（`started`/`ok`/`error` + `scheduledAt`）——无独立产物 |
| In-flight 去重 / 无重试 / 无追赶 | 同：每规则 WeakMap 去重、失败记日志并 re-arm、错过 tick 跳过 |
| `main` 会话 `System:` 注入 | 本批次不移植——openclaw profile 尚无主会话概念接线（Known Limitation） |
| 渠道 `deliver` | 本批次不移植（Known Limitation） |

为何不用 dsh 接缝：

- **`ctx.schedule`**（packages/schedule/schedule/）：`every` 有 300 秒下限（`domain.ts:24`）、交付严格 session-local（`types.ts:111-115`）、runtime 只挂 plugin 加载后出现的 live root agent（`index.ts:45-46`）、记录只能经 agent 面工具创建（`registerScheduleTools`，`index.ts:49`）——无编程 API。分钟粒度 cron、冷启动、每规则专属持久会话在它上面无法表达。
- **`ctx.jobs` / jobs-local**：纯内存注册表（`store = new Map`，`jobs-local/src/index.ts:102`）、无持久化、工具导向（`job_output/list/kill`）——它跟踪已派生的作业，不调度周期性回合。

## 考虑过的替代方案

**挂在 `ctx.schedule` 上、限定 `at`/`every ≥300s` 的桥。** 否决：无法表达 cron、无法保证专属会话模型，attach 条件与 one-session-per-rule 冲突。

**移植 OpenClaw 的 job store + CRUD 工具 + CLI。** 本批次否决：Config 声明的规则不需要新存储 seam 也不需要可变 store；带 agent 面 CRUD 工具的运行时可变 store 是后续表面，待有消费者需要运行时编辑规则时再评估。

**用 schedule 包的 `runMaintenance` + `followup` 模式触发。** 部分复用：触发路径用同样的 `followup → whenIdle → sessions.flush` 惯用法（channel-core 与 headless 已验证），但 `runMaintenance` 是 schedule 内部机制（agent 所有）；automation 直接驱动自己的 agent。

## 影响

- 矩阵行接缝格修正为：`own unref'd croner timer + agent.followup/whenIdle/sessions.flush turn bridge（ctx.schedule rejected: session-local + 300s floor + tools-only API）`。
- preset 以 disabled 挂载 automation（opt-in；配置错误的规则挂载时响亮失败并指名规则）。
- `automation/run` 是 declaration merging 进 `SessionEventMap` 的会话事件；回合本身是普通已记录回合，「model-visible means logged」无需新机制即成立。
- 渠道投递、主会话摘要、重试回到本 Note 重新论证，而非默认补结构。
