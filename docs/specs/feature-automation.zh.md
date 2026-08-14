# 功能规格：Automation（定时 agent 回合）

[English](feature-automation.md) | 中文

- **状态**：implemented（阶段 3 ✅，2026-08-14）
- **实现包**：`packages/openclaw/automation`（`@clawdsh/dsh-automation`）
- **OpenClaw 对应**：Cron（`v2026.1.5` `src/cron/`）：job store + `cron`/`at`/`every` 调度、每 job 专属会话、prompt 帧、in-flight 去重、无重试、无追赶。
- **决策记录**：Agent Note [2026-08-14-openclaw-cron-mapping](../../.agents/notes/implemented/architecture/2026-08-14-openclaw-cron-mapping.md)

## 目标

- Config 声明的规则在每次触发时于专属持久会话（`automation:<id>`，跨重启续接）中驱动一个普通 agent 回合；
- 调度种类：`cron`（5 字段 + 可选 IANA tz，经 OpenClaw 锁定的 croner 库）、一次性 `at`（持久 once-guard）、锚定 `every`；
- OpenClaw 同构的运行语义：at-least-once（回合前先落 `started` 记录）、in-flight 去重、无自动重试、错过即跳过；
- 会话日志即 run log：`automation/run` 记录环绕每个已记录回合，无独立产物。

## 非目标

- 无渠道投递（`deliver`）与主会话摘要（`System:` 行）——openclaw profile 尚无主会话接线；
- 无运行时编辑规则（job store + `cron.add/remove/…` 工具与 CLI）——Config 声明规则不需要存储 seam；
- 无事件触发规则（文件变更 watcher 等）；
- 不复用 `ctx.schedule`：其 300 秒 `every` 下限、session-local 交付、live-root-only 挂载、工具面创建 API 无法表达本功能类别（证据见决策记录）。

## 接缝（成文）

- `ctx.agents` / `ctx.sessions` / `ctx.agentDefaultModel`（声明 inject）：每规则持久 agent、resume-or-create、`followup → whenIdle → sessions.flush` 回合驱动；
- `ctx.get('sessionPersistence')`（可选读取）：会话产物供 resume 与 `at` once-guard 使用；
- 会话事件 `automation/run`（declaration merging）：`{ruleId, scheduledAt, status: 'started'|'ok'|'error', error?}`——由 `Session.append` 结构校验、列入生成的持久化事件目录；回合本身是普通已记录回合，「model-visible means logged」成立。

## 配置面

```yaml
automation:
  rules:
    - id: morning-digest        # [a-zA-Z0-9_-]+；也是会话名后缀 automation:<id>
      name: Morning             # 可选，进入回合帧
      schedule: { kind: cron, expr: '0 9 * * *', timeZone: Asia/Shanghai }
      message: Post a morning digest of the session log.
    - id: weekly-review
      schedule: { kind: at, at: '2026-08-17T09:00:00+08:00' }
      message: Write the weekly review.
    - id: ping
      schedule: { kind: every, seconds: 3600 }
      message: Check whether anything needs attention.
```

## 验收标准

1. ✅ 非法 cron 表达式、时区、`at` 时间、id、重复 id 在挂载时响亮失败并指名规则（测试：`fails mount loudly on invalid rules`）；
2. ✅ cron 规则在分钟边界触发，回合帧为 `[automation:<id> <name>] <message>`（plugin 源）并有 `started`/`ok` 记录（测试：`fires a cron rule at the minute boundary`）；
3. ✅ 运行进行中的重叠触发被去重（测试：`skips overlapping fires`）；
4. ✅ 错过的触发点不追赶，下一次触发照常（测试：`skips missed occurrences`）；
5. ✅ 同一持久会话跨重挂载续接，保留先前运行记录（测试：`resumes the same durable session`）；
6. ✅ 已记录 `ok` 的过期一次性 `at` 规则重挂载后不再触发（测试：`suppresses a past one-shot at rule`）；
7. ✅ 失败回合记 `error` 且下一次触发照常（测试：`records an error run and re-arms`）；
8. ✅ 注销后停止触发并释放规则 agent（测试：`stops firing and disposes its agents`）。
