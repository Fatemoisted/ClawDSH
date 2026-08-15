# 产品链路图 + 正确性核对（阶段 0–3 已落地 feature）

[English](product-chain.md) | 中文

- **状态**：阶段 4 入口交付物（2026-08-14）
- **目的**：一页跑通每个已落地 feature 的接入链——OpenClaw 源 → dsh seam → 落地包 → 触发/呈现——并做三重正确性核对（对齐矩阵 / 代码 / 契约测试），显式标出每一处文档-代码不一致。
- **方法**：每个 feature 一张接入链表 + 一份 ✅/⚠️/❌ 清单。❌ 表示该文档今天就是错的、发布前必须改；⚠️ 表示核对缺口或存疑表述、需要对齐。

| 标记 | 含义 |
|---|---|
| ✅ | 已对照矩阵 + 代码（+ 适用时的契约测试）核实 |
| ⚠️ | 核对缺口或存疑表述——需对齐，但不是硬错误 |
| ❌ | 文档-代码不一致——所引文档今天就是错的 |

## 总览索引

| Feature | 落地包 | dsh seam | 正确性 |
|---|---|---|---|
| channel-core | `channel-core/` | **新** `ctx.channels`（ADR-0002） | ✅ |
| channel-telegram | `channel-telegram/` | `ctx.channels` | ✅（e2e ⚠️ 凭证） |
| channel-feishu | `channel-feishu/` | `ctx.channels` | ✅（真实 e2e 通过） |
| soul | `soul/` | `ctx.systemPrompt` | ✅ |
| memory（+embeddings +embeddings-ark） | `memory/`、`embeddings/`、`embeddings-ark/` | `ctx.fs` + `ctx.tools` + `ctx.get('embeddings')`（ADR-0003） | ✅（一处 ⚠️） |
| skills-hub | `skills-hub/` | `ctx.skills` | ✅（roster ❌） |
| automation | `automation/` | `ctx.agents` + `ctx.sessions` | ✅（roster ❌ ×2） |
| ClawDSH 组装接线 | `preset-openclaw/` | `clawdsh` profile/patch + `clawdsh` agent preset | ✅ |

## channel-core

| 环节 | 内容 |
|---|---|
| OpenClaw 源 | channel gateway `Gateway`——消息路由、线程管理、适配器注册表 |
| dsh seam | **新** `ctx.channels`（ADR-0002）；`ChannelRegistry extends Service`，`static inject = ['agents','sessions','agentDefaultModel']` |
| 落地包 | `packages/openclaw/channel-core/src/index.ts` |
| 触发 | 适配器发 `channel/inbound` → `route()` → `getOrCreateThread()`（`SessionId('channel-${randomUUID()}')`）→ `driveTurn()`（followup → whenIdle → `sessions.flush` → `extractReply` → `adapter.send` → 发 `channel/outbound`） |
| 呈现 | `presentation.ts` 纯函数：`resolveAckReaction`（缺省 `👀`）、`resolveResponsePrefix`（`auto` = `[name]`）、`deriveMentionPatterns`、`stripMentions`、`stripZeroWidth` |

- ✅ 矩阵 `parity.md`：「implemented」。
- ✅ 代码：`ChannelRegistry`、`registerAdapter`、`getPresentation`、`route`、`driveTurn`、`extractReply` 齐备；`extractReply` 过滤插件来源的回合。
- ✅ 契约测试：`invariant.ts` 交付空 installer 并给出「No runtime invariant」理由——有据可依（注册表除已暴露的适配器集合外无可断言关系）。
- ✅ 模型可见 ⟺ 已记录：入站 → `user/message`，出站 → `assistant/message`（经 `driveTurn` → `sessions.flush`）；ack 表情属渠道侧、正确地*不*模型可见。

## channel-telegram

| 环节 | 内容 |
|---|---|
| OpenClaw 源 | `extensions/telegram`（grammY 实现） |
| dsh seam | `ctx.channels`——实现 `ChannelAdapter` |
| 落地包 | `packages/openclaw/channel-telegram/src/index.ts` |
| 触发 | grammY `Bot` polling → `toInbound` → `detectBotMention` → channel-core `route` |
| 呈现 | `setMessageReaction`；capabilities `{receive: polling, send: true, react: true}` |

- ✅ 矩阵：「implemented」。
- ✅ 代码齐备。
- ⚠️ 传输层 e2e 因凭证阻塞（无 Telegram bot token）。这是已知且*已记录*的缺口（`openclaw/README.md`「e2e pending credentials」、journal「Telegram blocked on credentials」）——一致，非不一致。

## channel-feishu

| 环节 | 内容 |
|---|---|
| OpenClaw 源 | `extensions/feishu`（自 OpenClaw v2026.2.12） |
| dsh seam | `ctx.channels`——实现 `ChannelAdapter` |
| 落地包 | `packages/openclaw/channel-feishu/src/index.ts` |
| 触发 | `Lark.WSClient` 长连接 → `im.message.receive_v1` → 按 `message_id` 去重（`SEEN_CAP = 10000`）→ route → `im.message.create` 出站 |
| 呈现 | `im.messageReaction.create`；capabilities `{receive: true, send: true, react: true}`；config `{appId, appSecret, domain}` |

- ✅ 矩阵：「implemented」。
- ✅ 代码齐备。
- ✅ 真实 e2e 端到端通过（journal + `openclaw/README.md`「real e2e passed」）。凭证走 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 环境变量，不落盘。

## soul

| 环节 | 内容 |
|---|---|
| OpenClaw 源 | Soul / identity 系统（`src/agents/`——人格、语气、行为准则） |
| dsh seam | `ctx.systemPrompt`——`section({name, order, text, complete?})` |
| 落地包 | `packages/openclaw/soul/src/index.ts`；`inject = ['systemPrompt']`，`SOUL_SECTION = 'clawdsh:soul'`，`SOUL_ORDER = 10` |
| 触发 | boot 时挂载 → 贡献一段 system-prompt section |
| 呈现 | `mode: replace` → `PERSONA_SECTION` 且 `complete: true`（soul 成为完整 prompt）；`mode: append` → 追加段落；相对 `source` 经 `ctx.baseUrl` 解析 |

- ✅ 矩阵：「implemented」。
- ✅ 代码 + 12 个测试用例（baseUrl 相对解析、cwd 回退）；replace/append 是最终形态。
- ✅ preset 接线：`preset-openclaw/agent.cordis.yml` 携带 `source: ./souls/assistant.md`、`mode: append`。
- ✅ 模型可见 ⟺ 已记录：soul 是 prompt section，装配即进入 `request/header`（上游 session 机制保证「模型可见即已记录」）。

## memory（+ embeddings + embeddings-ark）

| 环节 | 内容 |
|---|---|
| OpenClaw 源 | Memory（v2026.1.15）——Markdown 事实源 + 语义召回 |
| dsh seam | `ctx.fs` + `ctx.tools` + system-prompt section + `ctx.get('embeddings')`（ADR-0003） |
| 落地包 | `memory/`（`search.ts` `MemoryIndex`、`watch.ts` chokidar、`flush.ts`、`chunk.ts`、`memory-files.ts`）+ `embeddings/`（抽象 `Embeddings extends Service`）+ `embeddings-ark/`（`ArkEmbeddings`，`doubao-embedding-vision-251215`） |
| 触发 | `memory_search` / `memory_get` 工具（search 依赖 `ctx.embeddings`，缺失即 fail-loud）；`agent/turn-stopping` flush 钩子；宿主 fs watcher（`invalidateFile`） |
| 呈现 | `MEMORY_RECALL_SECTION = 'clawdsh:memory-recall'`（order 115）；搜索命中作为工具结果 |

- ✅ 矩阵：「implemented」（memory、embeddings、embeddings-ark）。
- ✅ 代码：增量 `(version, size)` 同步、`cosineSimilarity`、每次搜索单批 embed、watcher 补上同尺寸编辑盲区。
- ✅ 模型可见 ⟺ 已记录：`memory_search` 结果是工具结果事件；flush 用 `NO_REPLY` 约定、`memory-flush` 源（已记录、不模型可见）；召回 section 是 prompt section。
- ⚠️ `openclaw/README.md` 第 39 行称 embeddings-ark「e2e pending credentials」，而 `roadmap.md` 阶段 2 状态称「a real ARK e2e (tools/ark-e2e.ts)」。需对齐哪方为准。

## skills-hub

| 环节 | 内容 |
|---|---|
| OpenClaw 源 | Skills / ClawHub（兼容技能目录加载） |
| dsh seam | `ctx.skills` |
| 落地包 | `packages/openclaw/skills-hub/src/index.ts`；`ClawHubProvider` 名 `'clawhub'`，rank `WORKSPACE=300 / EXTRA=350 / MANAGED=450`，`DEFAULT_MANAGED_DIR = ~/.clawdbot/skills`，`metadata.clawdbot.requires.{bins,anyBins,env}` 门控 |
| 触发 | skills 注册表 provider 挂载 |
| 呈现 | skill 目录 → 模型可见的工具/指令（经 skill 工具事件记录） |

- ✅ 矩阵：「implemented」。
- ✅ 代码：纯增量目录合并、无安装执行、无凭证。
- ❌ `openclaw/README.md` 第 40 行 roster 状态仍为「planning」——应改为「implemented (phase 3 ✅)」。

## automation

| 环节 | 内容 |
|---|---|
| OpenClaw 源 | Cron / Automation（定时 agent 回合） |
| dsh seam | 经 croner 的 `ctx.agents` + `ctx.sessions`——**非** `ctx.schedule`（无此 seam；`ctx.schedule` 已被否决） |
| 落地包 | `packages/openclaw/automation/src/index.ts`；规则类型 `cron/at/every`，`SessionId('automation:${id}')`，`agent.session.append('automation/run', {ruleId, scheduledAt, status})`，经 `ctx.agents.resume` 恢复或新建 |
| 触发 | cron/at/every 规则 → agent 回合 |
| 呈现 | `automation/run` session 事件（`AutomationRunEvent` declaration-merge 进 `SessionEventMap`） |

- ✅ 矩阵：「implemented」。
- ✅ 代码：croner `Cron`、`MAX_TIMER_DELAY_MS`、session 事件 append、恢复或新建。
- ✅ 模型可见 ⟺ 已记录：`automation/run` 已记录 + 插件来源回合。
- ❌ `openclaw/README.md` 第 41 行：状态仍为「planning」**且** seam 误标 `ctx.schedule / ctx.jobs`——应改为「implemented (phase 3 ✅, disabled opt-in)」与「`ctx.agents` + `ctx.sessions`」。

## preset-openclaw wiring

| 环节 | 内容 |
|---|---|
| 形态 | `clawdsh` agent preset（`preset.yml` 显示名 `ClawDSH 模式` + `agent.cordis.yml`）、示例 soul（`souls/assistant.md`）与 `clawdsh` profile 模板（`profile/cordis.patch.yml`） |
| 层叠 | `profile/package.json` 先组合 `@deepseek-ai/dsh-base`，再组合 `@deepseek-ai/dsh-web-app`；soul 通过 agent preset 而非 profile 挂载 |
| profile patch | `system-prompt` persona → `channel-core` → `channel-telegram`（`disabled: true`）→ `channel-feishu`（`disabled: true`，env 凭据引用）→ `memory` → `embeddings-ark` → `skills-hub` → `automation`（`disabled: true`）→ `agent-presets.default: clawdsh` |
| 凭证 | 关闭的渠道可以缺少凭据；飞书启用后使用 env 引用，Ark 按需解析 `ARK_API_KEY`——profile 中不提交任何值 |

- ✅ 接线完整：profile patch 覆盖全部六个运行时 feature，soul 由 agent preset 覆盖。
- ✅ 层次分离正确：soul 是 agent-preset 关注点，channels/memory/skills/automation 是 profile-patch 关注点。
- ✅ 飞书、Telegram 与 Automation 均以 `disabled: true` 交付，因此干净安装的 Web Host 无需这些功能的凭据即可启动。
- ✅ 这些可选功能暂时使用 Loader `disabled`；能力 Settings 增量会保持其业务插件挂载，并将控制迁移到经过校验的 `enabled` 设置。
- ✅ `tools/link-clawdsh.sh` 只安装 `clawdsh` id，检测到旧 `openclaw` 资产时警告并保留，不创建兼容别名。
- ✅ 托管 manifest、完整性修复与 `clawdsh doctor` 属于公共发行 CLI，而不是本 profile 源码。

## 文档-代码不一致台账

| # | 位置 | 现状 | 应为 | 严重度 |
|---|---|---|---|---|
| 1 | `openclaw/README.md:40` | skills-hub「planning」 | 「implemented (phase 3 ✅)」 | ❌ |
| 2 | `openclaw/README.md:41` | automation「planning」、seam「`ctx.schedule` / `ctx.jobs`」 | 「implemented (phase 3 ✅, disabled opt-in)」、seam「`ctx.agents` + `ctx.sessions`」 | ❌ |
| 3 | `openclaw/README.md:39` | embeddings-ark「e2e pending credentials」 | 与 `roadmap.md`「real ARK e2e」对齐 | ⚠️ |
| 4 | `docs/matrix/parity.md:46` | Federation「to be named / Deferred (evaluated at end of Phase 3)」 | ADR-0005 `'clawd-federation'` transport provider；阶段 3 已收尾 | ❌ |
| 5 | `AGENTS.md:18`（CLAUDE.md 符号链接） | 「当前阶段：阶段 2」 | 「阶段 4」 | ❌ |
| 6 | `docs/specs/roadmap.md:36,42` | 阶段 2 标题缺 ✅；阶段 3 无完成标记 | 两处均带 ✅（completed 2026-08-14） | ⚠️ |
| 7 | `docs/adr/0001-project-foundation.md` 决策 3 | 物理隔离清单漏掉 `docs/upstream-proposal/` | 补上（CLAUDE.md 品牌段已列） | ⚠️ |

条目 1–2、4–5 为发布阻断项（读者会被积极误导）；条目 3、6–7 为发布前清理项、无正确性风险。

## 模型可见 ⟺ 已记录，按 feature

| Feature | 模型可见输入 | 记录为 | 判定 |
|---|---|---|---|
| soul | system-prompt section | `request/header` | ✅ |
| memory recall | system-prompt section | `request/header` | ✅ |
| memory search | 工具结果 | 工具结果事件 | ✅ |
| memory flush | （不模型可见） | `memory-flush` 源、`NO_REPLY` | ✅ |
| channel inbound | 用户消息 | `user/message` | ✅ |
| channel outbound | 助手消息 | `assistant/message` | ✅ |
| ack reaction | （不模型可见） | — | ✅ |
| automation run | 插件来源回合 | `automation/run` 事件 | ✅ |
| skills | skill 工具/指令 | skill 工具事件 | ✅ |
