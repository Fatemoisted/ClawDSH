# @clawdsh/dsh-automation

[English](README.md) | 中文

**定位**：定时 agent 回合——Config 声明的规则（「每天早上 9 点发摘要」）在每次触发时于专属持久会话（`automation:<id>`，跨重启续接）中驱动一个普通 agent 回合。调度器提供 at-least-once 执行、in-flight 去重、错过即跳过，以及一次性 `at` 成功后的持久守卫。失败 `at` 的已知重试缺陷记录在下文。

**OpenClaw 对应**：Cron（`v2026.1.5` `src/cron/`）：`cron`/`at`/`every` 三种调度（经 OpenClaw 锁定的 croner 库）、每 job 一个专属会话、`[cron:<jobId> <name>] <message>` 帧、单 re-arming timer 对准最早触发点。

**接缝**（全部既有，无新增）：
- `ctx.agents` / `ctx.sessions` / `ctx.agentDefaultModel`（声明 inject）：每规则一个持久 agent，跨重启 resume-or-create（`ctx.agents.resume` 失败且无产物时回退 `create`），回合驱动用已验证的 `followup → whenIdle → sessions.flush` 惯用法（channel-core / headless）；
- `ctx.get('sessionPersistence')`（可选读取）：会话产物；无持久服务时每进程重新开始；
- 会话日志即 run log：`automation/run` 记录（`started`/`ok`/`error` + `scheduledAt`）环绕每个已记录回合——无独立 run-log 产物。

**为何不用 `ctx.schedule`**：其 `every` 下限 300 秒、交付严格 session-local、runtime 只挂 plugin 加载后出现的 live root agent、记录只能经 agent 面工具创建——分钟粒度 cron、冷启动、每规则专属持久会话在它上面无法表达（`ctx.jobs` 是内存作业跟踪器，不是调度器）。见 [cron-mapping Agent Note](../../../.agents/notes/implemented/architecture/2026-08-14-openclaw-cron-mapping.md)。

**规格**：docs/specs/feature-automation.md · **状态**：implemented（阶段 3）；修复下述重试缺陷前，失败的一次性 `at` 执行仍不安全

干净安装的 `clawdsh` profile 默认禁用本 Loader 配置项，因此没有显式 opt-in 就不会启动规则。该包尚未暴露业务级 `enabled` 字段；能力 Settings 增量会保持插件挂载，并增加经过校验的开关。

## 用法

```yaml
- id: automation
  name: '@clawdsh/dsh-automation'
  config:
    rules:
      - id: morning-digest
        name: Morning            # optional label in the turn framing
        schedule: { kind: cron, expr: '0 9 * * *', timeZone: Asia/Shanghai }
        message: Post a morning digest of the session log.
      - id: weekly-review
        schedule: { kind: at, at: '2026-08-17T09:00:00+08:00' }
        message: Write the weekly review.
      - id: ping
        schedule: { kind: every, seconds: 3600 }
        message: Check whether anything needs attention.
```

规则 id 必须匹配 `[a-zA-Z0-9_-]+`（进入持久会话名）。非法 cron 表达式、时区、`at` 时间、id 或重复 id 在挂载时响亮失败并指名规则。

## 设计说明

- **Config 即持久 store**：规则写在 cordis.yml 里，无 job-store 文件、无 CRUD 工具、无新存储 seam（运行时编辑规则延后）；
- **单 re-arming unref'd timer**：对准所有规则最早的触发点；醒来顺序执行到期规则后重新对准（OpenClaw 调度器形态）；
- **每规则会话生命周期**：resume-or-create 使会话日志（即运行历史）跨重启保留；`every` 规则挂载时立即触发一次（OpenClaw「first run at/after the anchor」）；
- **失败语义**：回合前先落 `started` 记录（at-least-once）；`turn/end` reason 决定 `ok` 还是 `error`（被 loop 遏制的 adapter 失败仍呈现为 `error`）。cron 与 `every` 失败后推进到下一次计划触发；一次性 `at` 的例外列在已知限制中。

## 变更日志

- 0.1.0：首个版本（cron/at/every 规则、每规则持久会话、运行记录、once-guard；8 个契约测试，真组合 keyless）。

## Model Experience

### 定时回合

#### What the model sees

每次触发一条 plugin 源 user 消息。规则无名时缺省 `name` 段；消息携带 `source: {kind: 'plugin', plugin: 'automation'}`，渠道可区分自动化回合与人类输入。帧固定为：

##### 回合帧

```markdown
[automation:<id> <name>] <message>
```

#### Token effect

每次触发一条帧消息 + 助手回复——与规则消息和回复成正比，与未触发的规则数无关。

#### KV Cache effect

Append-only：帧消息与其他回合输入一样落在日志中段；无系统提示前缀变化，先前请求前缀保持可复用。

## Known Limitations and Deferred Work

- **无渠道投递**：OpenClaw 的 `deliver`（把回复投到渠道）未移植；回复留在规则的会话日志里；
- **无主会话摘要**：OpenClaw 的 `main` 目标（`System:` 行注入主会话）未移植——`clawdsh` profile 尚无主会话接线；
- **失败的一次性 `at` 循环**：`at` 回合记录 `error` 后，规则保持未完成且 deadline 已在过去，timer 会以 0 ms 重新挂载并可能快速重复模型调用。修复前不要启用 `at` 规则；cron 与 `every` 仍会正常推进；
- **无运行时编辑规则**：规则由 Config 声明；OpenClaw 的 job store + `cron.add/remove/…` 工具与 CLI 延后到有消费者需要运行时编辑时；
- **`at` once-guard 依赖会话产物**：持久会话日志被删除后，过期的一次性规则会再触发一次（at-least-once 语义）；
- **`every` 挂载时重新锚定**：每次启动立即触发一次，随后按 anchor 网格运行（OpenClaw 的 anchor 语义，不追赶错过的 tick）。
