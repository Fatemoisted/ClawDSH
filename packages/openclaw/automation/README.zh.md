# @clawdsh/dsh-automation

[English](README.md) | 中文

**定位**：可选的定时 agent 回合——一项自动任务由「什么时候运行」和「让 ClawDSH 做什么」组成，例如「每天早上 9 点发摘要」。每次触发都在专属持久会话（`automation:<id>`，跨重启续接）中驱动一个普通回合；正常对话不依赖 Automation。其 OpenClaw-cron 语义为 at-least-once、无自动重试、in-flight 去重、错过即跳过，以及一次性 `at` 任务的持久终态守卫。

**OpenClaw 对应**：Cron（`v2026.1.5` `src/cron/`）：`cron`/`at`/`every` 三种调度（经 OpenClaw 锁定的 croner 库）、每 job 一个专属会话、`[cron:<jobId> <name>] <message>` 帧、单 re-arming timer 对准最早触发点。

**接缝**（全部既有，无新增）：
- `ctx.agents` / `ctx.agentPresets` / `ctx.sessions` / `ctx.agentDefaultModel`（声明 inject）：每项任务一个持久 agent，挂载配置的 ClawDSH preset，并跨重启续接或创建；回合使用 `followup → whenIdle → sessions.flush`；
- `ctx.get('sessionPersistence')`（可选读取）：会话产物；无持久服务时每进程重新开始；
- `ctx.get('sessionTitle')` 与 `ctx.get('workspaceRegistry')`（可选读取）：安装时给自动任务会话设置可读标题，并把它加入配置 `cwd` 所属的工作区；服务已经安装却无法完成发布时，插件初始化会失败；
- 会话日志即 run log：`automation/run` 记录（`started`/`ok`/`error` + `scheduledAt`）环绕每个已记录回合——无独立 run-log 产物。

**为何不用 `ctx.schedule`**：其 `every` 下限 300 秒、交付严格 session-local、runtime 只挂 plugin 加载后出现的 live root agent、记录只能经 agent 面工具创建——分钟粒度 cron、冷启动、每规则专属持久会话在它上面无法表达（`ctx.jobs` 是内存作业跟踪器，不是调度器）。见 [cron-mapping Agent Note](../../../.agents/notes/implemented/architecture/2026-08-14-openclaw-cron-mapping.md)。

**规格**：docs/specs/feature-automation.md · **状态**：implemented（阶段 3 ✅）

该行保持挂载并独占 `clawdsh-automation` 设置 namespace。业务层 `enabled` 默认 `false`；关闭时仍校验配置，但不会创建 runtime、timer 或 Automation Session。设置在重启时生效。

## 用法

```yaml
- id: automation
  name: '@clawdsh/dsh-automation'
  config:
    enabled: true
    preset: clawdsh
    cwd: /absolute/path/to/workspace
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

规则 id 必须匹配 `[a-zA-Z0-9_-]+`（进入持久会话名）。Web editor 使用基于 UUID 的 id，不使用位置式 `rule-1`，因此替换任务不会意外续接已删除任务的持久 Session。`cwd` 必须是绝对路径。新 Session 记录当前值，续接 Session 保留并通过其不可变 header 值发布；ClawDSH Settings UI 因此把 `preset` 和 `cwd` 显示为安装器管理字段。非法 cron 表达式、时区、`at` 时间、id、重复 id 或相对 `cwd` 在挂载时响亮失败，适用时指名规则。

## 设计说明

- **Config 即持久 store**：规则写在 cordis.yml 里，无 job-store 文件、无 CRUD 工具、无新存储 seam（运行时编辑规则延后）；
- **默认关闭**：schema 将 `enabled` 默认设为 false；关闭路径仍校验配置，但不创建 runtime、timer 或 Session；
- **单 re-arming unref'd timer**：对准所有规则最早的触发点；醒来顺序执行到期规则后重新对准（OpenClaw 调度器形态）；
- **每项任务的会话生命周期**：resume-or-create 让会话日志跨重启保留；新会话记录当前 `cwd` 与 `agentPreset`，续接会话保留已记录的 workspace，并在发布前挂载配置的 preset，因此该 preset 贡献的 Soul、Memory、Skills 等能力可用于定时回合；
- **间隔语义**：`every` 任务先等待一个完整间隔；上一轮完成后才计算下一次触发，因此耗时任务不会造成追赶式连发；
- **失败语义**：回合前先持久写入 `started`，随后依据真实 `turn/end` 只写一条终态记录。Cron 与间隔任务失败后等待下一次既定触发；`at` 尝试无论成功还是失败都会进入终态，不会成为隐式重试循环。

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
- **无主会话摘要**：OpenClaw 的 `main` 目标（`System:` 行注入主会话）未移植；不过，在 Host 安装标题与工作区服务时，自动任务会话会以 `自动任务 · <名称或 id>` 显示在所属工作区；
- **无自动重试**：失败记 `error` 运行，下一次触发照常（OpenClaw 同构）；
- **无运行时编辑规则**：规则由 Config 声明；OpenClaw 的 job store + `cron.add/remove/…` 工具与 CLI 延后到有消费者需要运行时编辑时；
- **`at` once-guard 依赖会话产物**：持久会话日志被删除后，过期的一次性规则会再触发一次（at-least-once 语义）；
- **`every` 挂载时重新锚定**：每次启动都开始新的间隔并等待它结束；进程停机期间不会累积追赶任务。
