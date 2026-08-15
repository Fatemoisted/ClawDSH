# Telegram 旧适配器带凭证端到端验证

[English](telegram-e2e.md) | 中文

> **范围：**本手册只测试保留的进程内 `ctx.legacyChannels` 路径（`channel-core` + `channel-telegram`），不测试或认证 ADR-0008 的 canonical OpenClaw Gateway sidecar。2026-08-15 的记录运行使用 commit `ca39c8ee4d` 上的 legacy 实现；后续代码的复测也只产生新的 legacy 证据。

本流程逐层验证旧 Telegram 路径：Bot API 身份验证、grammY 长轮询入站、ClawDSH 路由、Harness Agent/模型/工具执行、持久状态与 Telegram 出站投递。`--dump-config` 或 `getMe` 成功只是前置条件，不是端到端结果。当前 adapter behavior 与 deferred work 仍以[包 README](../../packages/openclaw/channel-telegram/README.md)为准；sidecar 认证遵循单独的[渠道平面同步规范](../standards/openclaw-channel-sync.md)。

## 前置条件

- 使用专用测试 bot。如果 token 曾出现在聊天、日志、shell history 或已提交文件中，测试前通过 BotFather 更换。
- 用户必须先打开 bot 私聊并发送消息；Telegram bot 不能主动发起用户会话。
- 为 Harness 模型路由导出 `DEEPSEEK_API_KEY`。本流程不强制要求 `ARK_API_KEY`：缺失时 `memory_search` 必须明确报错，而显式 `memory_get` 仍可读取已知 Memory 文件。
- 从仓库 checkout 构建并链接，且 `tools/link-clawdsh.sh` 与所有 `dsh` 调用使用同一个 `DSH_HOME`。
- 一个 bot token 只运行一个长轮询进程。第二个 `getUpdates` consumer 会产生 409 冲突，也可能从受测进程抢走 update。
- 停止使用同一平台账号的所有 sidecar 或旧 daemon。Profile 会阻止自身两组渠道同时运行，但不能停止其他 checkout、container 或 host。

## 只启用保留的 legacy group

`clawdsh` profile 含一个默认关闭的 `clawdsh-legacy-channel-plane` group，只供迁移与 compatibility 验证使用。在 ClawDSH Settings 中保持 OpenClaw Gateway 关闭，并显式启用 legacy group 与其中的 Telegram entry。Telegram 在 runtime 解析命名凭据；任何受跟踪 YAML 都不得包含 token。

```bash
export DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
export CLAWDSH_LEGACY_CHANNELS_ENABLED=1
export CLAWDSH_LEGACY_TELEGRAM_ENABLED=1
unset CLAWDSH_LEGACY_DISCORD_ENABLED
unset CLAWDSH_LEGACY_FEISHU_ENABLED
export TELEGRAM_BOT_TOKEN='<new token>'
export DEEPSEEK_API_KEY='<model key>'

pnpm run build
tools/link-clawdsh.sh
pnpm dsh --profile clawdsh --dump-config
pnpm dsh --profile clawdsh
```

dump 必须显示 `clawdsh-legacy-channel-plane` 及其 Telegram entry 已启用、Discord 与飞书 entry 已禁用、`clawdsh-communication-plane` 已存在，并显示非机密 Telegram 凭据引用 `TELEGRAM_BOT_TOKEN`；不得包含解析后的 token。Gateway 的持久化 Settings 值必须保持关闭。若存在 legacy opt-in 时请求 canonical enablement，启动或 Settings preflight 会拒绝该配置；本流程应把该失败视为预期互斥防护，不能当作旧 adapter 已运行的证据。

`imageDownloadTimeoutMs` 限制 Telegram 文件 metadata 查询与流式字节读取的总时间。其默认值为 30000 毫秒，可配置范围为 1000 至 2147483647。只有旧 channel-core 已准入消息且解析到的模型声明支持图片输入时，该 deadline 才会生效；随附的纯文本 DeepSeek 路由不会下载文件。

## 理解凭据激活与热切换

`botTokenEnv` 是 Harness 凭据引用，不是把 token 复制进 Config 的指令。Adapter 通过 `ctx.credentials` 解析它，并以 Harness 启动环境作为兼容回退。若没有解析到值，adapter 会记录 `no bot token resolved`，把 receive/send/react 均标为 unavailable，且不会启动一个半配置的 bot。

匹配的托管 `credentials/updated` event 会先排空旧 bot，再用新解析值启动新 bot，无需重启 daemon。只修改进程环境不会发出该 event，因此仅修改环境后需 restart 或 remount。字面量 `botToken` 只供编程使用，优先于 `botTokenEnv`，且刻意不参与热切换；不要在受版本控制的 profile 中使用它。

## 验证 Bot API 身份

在 daemon 停止时运行此探针。它只输出非机密 bot identity，不输出 token 或请求 URL：

```bash
node --input-type=module <<'NODE'
const token = process.env.TELEGRAM_BOT_TOKEN
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required')
const response = await fetch(`https://api.telegram.org/bot${token}/getMe`)
const body = await response.json()
console.log({ status: response.status, ok: body.ok, id: body.result?.id, username: body.result?.username })
if (!response.ok || body.ok !== true) process.exitCode = 1
NODE
```

成功标准是 HTTP 200、`ok: true` 以及预期 bot id 和 username。Daemon 运行时不要手工调用 `getUpdates`。

## 明确配置群聊隐私

Telegram 默认启用 Group Privacy Mode。正常使用应保持开启：私聊消息会投递，明确定向的 command、mention 与 reply 会到达 bot；旧 channel-core 随后应用自身的 mention gate。Telegram 在 [Privacy Mode](https://core.telegram.org/bots/features#privacy-mode)与 [bot FAQ](https://core.telegram.org/bots/faq#what-messages-will-my-bot-get) 中记录了平台门控。

只有 Telegram 已投递普通群消息时，未 mention 消息测试才能证明 ClawDSH 门控。可把测试 bot 设为群管理员，或通过 BotFather 临时关闭 privacy，并移除后重新添加 bot 使变更生效。测试后恢复最小权限的 production setting。

## 在 Telegram chat-id 迁移后保留历史

Telegram 升级或迁移群组时，投递可能转到新的 chat id。请在仓库外 patch 中用部署自有 alias 保留旧的持久 Session identity；以下值仅为示例：

```yaml
- id: channel-telegram
  config:
    chatIdAliases:
      - chatId: '-1001234567890'
        sessionChatId: '-123456789'
```

`chatId` 是当前投递目标，`sessionChatId` 是仅用于 Harness Session/FIFO 路由的旧稳定身份。回复仍会发到当前 `chatId`。Alias 必须是 Telegram 整数 id；冲突与环会使配置失败。

Adapter 不会自行推断或持久化这份部署映射。如果它看到 migration service message，但 alias 没有把新旧 id 解析到同一个稳定身份，就会把新 chat 加入内存暂停集合，并记录需要添加的准确 alias。该暂停只是 best-effort 诊断防护，不是迁移事务：普通新 id 流量可能早于 service update 到达，restart/remount 也会清空暂停。只有预配置 alias 才能保证路由复用旧稳定身份。该行为属于 legacy ADR-0011 路径，不描述 OpenClaw sidecar 的 identity handling。

## 运行验证矩阵

使用唯一随机 marker，避免旧 update 或缓存答案误通过检查。保持 daemon 日志可见，并独立记录每一行；一行通过不代表其他行已通过。

| 层 | 操作 | 成功标准 | 2026-08-15 legacy 基线 |
|---|---|---|---|
| 身份验证 | daemon 停止时运行 `getMe`。 | API 以 `ok: true` 返回预期 bot identity。 | 通过 |
| 私聊入站/出站 | 打开私聊，发送 `/start`，再要求精确回复唯一 marker。 | bot 生成模型驱动的回复，并原生引用触发消息。 | 通过 |
| 持久 Memory | 存储唯一事实，干净停止，再以同一 `DSH_HOME` 重启并询问该事实。 | 事实在重启后保留；缺少 `ARK_API_KEY` 时可用显式 `memory_get` 回退。 | 通过 |
| 群聊未 mention 门控 | 在 bot 可收到普通消息的群里发送未定向文本。 | 不发送 ack，也不生成模型回复。 | 通过 |
| 用户名 mention | 发送 `@BotUsername` 加唯一提示。 | bot 准入回合，从模型文本移除结构化 mention，并回复源消息。 | 通过 |
| Reply-to-bot | 不再 mention，直接回复一条现有 bot 消息。 | 回复关系被视为定向 bot，并生成响应。 | 通过 |
| 定向 command | 发送带唯一后缀的 `/help@BotUsername`。 | bot 准入命令，只移除 username 后缀，模型仍收到 `/help`。 | 通过 |
| 其他 bot command | 发送指向其他 bot 的 command。 | ClawDSH 不把它视为对当前 bot 的 mention，也不回复。 | 通过 |
| Harness web tool | 询问必须使用 `web_search` 的时效问题。 | 模型完成 tool-driven 回合，Telegram 收到答案。 | 通过 |
| Caption behavior | 发送一次带定向 caption 的媒体，再发送一次无文本/caption 媒体。 | 在记录的 pre-image-ingestion build 上，caption 到达模型，无正文媒体不创建模型回合。 | 历史构建通过 |
| 当前纯文本模型图片处理 | 向纯文本模型发送带 caption 图片，再发送纯图片。 | caption 携带 omitted-image context 继续；纯图片收到固定提示；不下载文件。 | 仅无密钥 |
| 当前图片模型导入 | 向图片模型发送 photo 与受支持 PNG/JPEG/WebP/GIF document。 | 先准入再有界下载；Harness 在保存持久引用前校验全部图片。 | 仅无密钥 |
| 离线补收 | 停止 daemon，发送唯一消息，再以同一命令重启。 | polling 在启动后收到待处理 update 并投递回复。 | 通过 |
| 长回复 | 要求超过 4096 个 UTF-16 unit，并在分割边界附近放 emoji。 | 分片按序到达，不切断 surrogate pair，且只有首片引用源消息。 | 通过 |
| 中断恢复 | 中断一个回合，以同一 `DSH_HOME` 重启后发送 follow-up。 | Harness 恢复持久会话，follow-up 完成。 | 通过 |
| 同一聊天 FIFO | 在一个 chat 中快速发送两条不同提示。 | 回复保持准入顺序，且任一回合不影响下一回合。 | 通过 |
| Chat-id 迁移防护 | 分别测试无 alias 迁移与预配置 alias 的另一次迁移。 | 只有预配置 alias 保证一个持久 identity。 | 仅无密钥 |
| Forum topic | 在真实 topic 中重复 mention、reply、restart 与长回复。 | 回复留在同一 topic，不同 topic 历史相互隔离。 | 未运行 |
| Ack reaction | 在允许配置 emoji 的群里发送定向消息。 | ack 出现且不延迟文本回复。 | 仅无密钥 |

## 诊断失败

| 信号 | 含义与处理 |
|---|---|
| `no bot token resolved` | Harness 凭据引用没有值。设置托管凭据或启动环境回退值，再更新/remount。 |
| `polling stopped permanently` 且带 401 | token 无效或已撤销，请更换；重启同一值无法恢复。 |
| `polling stopped permanently` 且带 409 | 另一进程正在轮询同一 bot。停止旧 daemon、container 或手工 `getUpdates` client，再 remount/restart。 |
| `messages for ... are paused to avoid splitting the durable session` | 在仓库外加入日志给出的准确 `{ chatId, sessionChatId }` 映射，然后 remount。 |
| `image download failed` 或固定 safe-import notice | deadline、Telegram 传输或 Harness 校验/大小限制拒绝输入；失败输入不会作为不完整回合追加。 |
| `getMe` 成功但私聊无回复 | 确认用户已启动私聊，检查模型路由与 `DEEPSEEK_API_KEY`，并确认实际挂载的是 legacy group 而非 sidecar。 |
| 群聊 mention 未到达 | 检查精确 bot username、成员身份、privacy/admin setting，以及 Telegram 是否投递受支持的 `message` update。 |
| 重启后历史丢失 | 确认两次启动使用相同 `DSH_HOME`、checkout、profile 与 persistence root。 |

## 在当前限制内解读结果

- 旧 adapter 只请求 `message` update；edited message、callback query 与 channel post 不会被接受。
- 文本与 caption 会达到模型。只有通过 mention 准入且选择图片模型后才 materialize 图片字节；默认纯文本路由不会下载图片。
- 投递使用一个等待式 long-polling loop；缓慢模型回合会延迟后续 chat。
- Telegram offset 状态与 provider message id 不是持久 ClawDSH inbox；崩溃可能重放回合。
- Provider retry 与 Session 持久性不会构成持久出站 outbox。Assistant answer 可能已持久化，但 Telegram 投递最终丢失。
- 多分片发送不是事务：后续分片失败前，早先分片可能已落地。
- 凭据轮换、chat-id alias、forum topic、当前图片 materialization 与 ack reaction 不属于已记录的带凭证基线，除非新的 dated row 明确记录。
- 本手册任何结果都不能提升 ADR-0008 sidecar Channel。Sidecar 认证必须使用渠道同步规范要求的精确锁定 host、bridge、账号配置、安全检查、无密钥装配 transcript 与 live matrix。

记录受测 commit、日期、非机密 bot username/id、环境，以及每个 passed/not-run row。绝不记录 token 或 chat id。范围化历史证据见 [2026-08-15 日志](../journal/2026-08-15.md)。
