# Telegram 带凭证端到端验证

[English](telegram-e2e.md) | 中文

本实操手册逐层验证已部署的 Telegram 路径：Bot API 身份验证、grammY 长轮询入站、ClawDSH 路由、Harness agent/模型/工具执行、持久状态与 Telegram 出站投递。`--dump-config` 或 `getMe` 成功只是前置条件，不是端到端结果。适配器的当前行为与推迟项仍以[包 README](../../packages/openclaw/channel-telegram/README.md)为准。

## 前置条件

- 使用专用测试 bot。如果 token 曾出现在聊天、日志、shell history 或已提交文件中，测试前通过 BotFather 更换。
- 用户必须先打开 bot 私聊并发送消息；Telegram bot 不能主动发起用户会话。
- 为 Harness 模型路由导出 `DEEPSEEK_API_KEY`。本流程不强制要求 `ARK_API_KEY`：缺失时 `memory_search` 必须明确报错，而显式 `memory_get` 仍可读取已知 Memory 文件。
- 从仓库 checkout 构建并链接，且 `tools/link-clawdsh.sh` 与所有 `dsh` 调用使用同一个 `DSH_HOME`。
- 一个 bot token 只运行一个长轮询进程。第二个 `getUpdates` 消费方会产生 409 冲突，也可能从受测进程抢走 update。

## 在不存储 token 的前提下启用 Telegram

随附的 `clawdsh` profile 在干净安装中默认禁用飞书、Telegram、Discord 与 Automation。请把以下 overlay 放到仓库外的 `$DSH_HOME/telegram-e2e.patch.yml`；它只启用 Telegram，并保留其余安全默认值。此后 `tools/link-clawdsh.sh` 可刷新已安装 profile，而不会覆盖该启用选择。

```yaml
- id: channel-feishu
  disabled: true

- id: channel-discord
  disabled: true

- id: automation
  disabled: true

- id: channel-telegram
  disabled: false
  config:
    botTokenEnv: TELEGRAM_BOT_TOKEN
    polling: true
    timeout: 30
    imageDownloadTimeoutMs: 30000
```

凭证只通过启动环境导出；然后构建、安装本地 profile、检查组合树，并启动常驻 daemon：

```bash
export DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
export TELEGRAM_BOT_TOKEN='<new token>'
export DEEPSEEK_API_KEY='<model key>'

pnpm run build
tools/link-clawdsh.sh
pnpm dsh --profile clawdsh --patch "$DSH_HOME/telegram-e2e.patch.yml" --dump-config
pnpm dsh --profile clawdsh --patch "$DSH_HOME/telegram-e2e.patch.yml"
```

dump 必须显示 `channel-telegram` 已启用、飞书/Discord/Automation 已禁用，以及非机密凭证引用 `botTokenEnv: TELEGRAM_BOT_TOKEN`。配置 dump 不会解析或验证 token 身份。

`imageDownloadTimeoutMs` 限制 Telegram 文件元数据查询与流式字节读取的总时间。其默认值为 30000 毫秒，可配置范围为 1000 至 2147483647。只有 channel-core 已准入消息，且解析到的模型声明支持图片输入时，该 deadline 才会生效；随附的 DeepSeek 文本路由不会下载文件。

## 理解凭证激活与热切换

`botTokenEnv` 是 Harness 凭证引用，不是把 token 复制进 Config 的指令。adapter 通过 `ctx.credentials` 解析它，并以 Harness 启动环境作为兼容回退。若没有解析到值，adapter 会记录 `no bot token resolved`，把 receive/send/react 均标为不可用，且不会启动一个半配置的 bot。

匹配的托管 `credentials/updated` 事件会先排空旧 bot，再用新解析值启动新 bot，无需重启 daemon。只修改进程环境不会发出该事件，因此仅修改环境后需重启或 remount。字面量 `botToken` 仅供编程使用，优先于 `botTokenEnv`，且刻意不参与热切换；不要在受版本控制的 profile 中使用它。

## 验证 Bot API 身份

在 daemon 停止时运行此探针。它只输出非机密 bot 身份，不输出 token 或请求 URL：

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

成功标准是 HTTP 200、`ok: true` 以及预期的 bot id 和 username。daemon 运行时不要手工调用 `getUpdates`。

## 明确配置群聊隐私

Telegram 默认启用 Group Privacy Mode。正常 ClawDSH 使用应保持开启：私聊消息会投递，明确定向的命令、mention 与回复会达到 bot；随后由 `channel-core` 应用自身的 `groupMode: mention` 规则。Telegram 在 [Privacy Mode](https://core.telegram.org/bots/features#privacy-mode)与 [bot FAQ](https://core.telegram.org/bots/faq#what-messages-will-my-bot-get) 中记录了平台门控。

只有 Telegram 已投递该普通群消息时，未 mention 消息测试才能证明 ClawDSH 门控。可把测试 bot 设为群管理员，或通过 BotFather 临时关闭 privacy，并移除后重新添加 bot 使变更生效。测试后恢复最小权限的生产设置。

## 在 Telegram chat-id 迁移后保留历史

Telegram 升级或迁移群组时，投递可能转到新的 chat id。请在同一个仓库外 overlay 中用部署自有 alias 保留旧的持久 session 身份；以下值仅为示例：

```yaml
- id: channel-telegram
  config:
    chatIdAliases:
      - chatId: '-1001234567890'
        sessionChatId: '-123456789'
```

`chatId` 是当前投递目标，`sessionChatId` 是仅用于 Harness session/FIFO 路由的旧稳定身份。回复仍会发到当前 `chatId`。alias 必须是 Telegram 整数 id；冲突与环会使配置失败。

adapter 不会自行推断或持久化这份部署映射。如果它看到迁移 service message，但 alias 没有把新旧 id 解析到同一个稳定身份，就会把新 chat 加入内存暂停集合，并记录需要添加的准确 alias。请在仓库外添加该映射并 remount 插件。

应把该暂停理解为 best-effort 诊断防护，而不是迁移事务。Telegram 可能先以新 id 投递普通消息、再投递迁移 service update，此时该轮次可能已打开一条独立的持久 session；adapter 之后不会自动合并它。restart 或 remount 也会清空内存暂停。只有在观察到新 id 流量前就配置 alias，才能保证路由复用旧稳定身份。2026-08-15 的真实客户端基线未测试 chat 迁移；预配置 alias 路由、service-update 暂停与配置拒绝具有无密钥契约覆盖。

## 运行验证矩阵

使用唯一随机 marker，避免旧 update 或缓存答案误通过检查。保持 daemon 日志可见，并独立记录每一行；一行通过不代表其他行已通过。

| 层 | 操作 | 成功标准 |
|---|---|---|
| 身份验证 | daemon 停止时运行 `getMe`。 | API 以 `ok: true` 返回预期 bot 身份。 |
| 私聊入站/出站 | 打开私聊，发送 `/start`，再要求精确回复唯一 marker。 | bot 生成模型驱动的回复，并原生引用触发消息。 |
| 持久 Memory | 让 agent 存储唯一事实，等待完成，干净停止后以同一 `DSH_HOME` 重启，再询问该事实。 | 事实在重启后保留。缺少 `ARK_API_KEY` 时，`memory_search` 报告凭证缺失，`memory_get` 可提供已记录的回退结果。 |
| 群聊未 mention 门控 | 在 bot 可收到普通消息的群里发送未定向文本。 | 不发送 ack，也不生成模型回复。 |
| 用户名 mention | 发送 `@BotUsername` 加唯一提示。 | bot 接受轮次，从模型文本移除结构化 mention，并回复源消息。 |
| Reply-to-bot | 不再 mention，直接回复一条现有 bot 消息。 | 回复关系被视为定向 bot，并生成响应。 |
| 定向命令 | 发送带唯一后缀的 `/help@BotUsername`。 | bot 接受命令，只移除 username 后缀，模型仍收到 `/help`。 |
| 其他 bot 命令 | 发送指向其他 bot 的命令。 | ClawDSH 不把它视为对当前 bot 的 mention，也不发送回复。 |
| Harness web 工具 | 询问必须使用 `web_search` 的时效问题。 | 模型完成工具驱动轮次，Telegram 收到答案。 |
| 2026-08-15 caption 基线 | 在当时尚未接图片导入的受测构建上，分别发送一次带定向 caption 的媒体，以及一次无文本/caption 媒体。 | 带凭证测试观察到 caption 转发与无正文媒体忽略；媒体字节不是模型输入。这是历史证据，不是当前图片路径的预期。 |
| 当前文本模型图片处理 | 在随附的默认 DeepSeek 文本 selection 上，先发送带 caption 的受支持 photo/图片 document，再发送一条纯图片。 | caption 携带明确的图片省略上下文继续；纯图片消息收到固定的文本模型提示。不会下载 Telegram 文件，也不会保存 Harness attachment。该路径已通过无密钥测试，但不属于已记录线上基线。 |
| 当前图片模型导入 | 选择 Harness 解析元数据包含图片输入的模型；发送 photo，再发送限制内的 PNG/JPEG/WebP/GIF 图片 document。 | 通过 mention 准入后，官方 `@grammyjs/files` hydrate `getUrl`；随后原生 `fetch` 在可取消 deadline 及声明/实际字节限制下流式读取，Harness `ctx.attachments` 先校验全部图片，再保存任何引用。持久 user message 只含 Harness 图片引用。该路径已通过无密钥测试，但尚未完成带凭证真实客户端/模型验证。 |
| 离线补收 | 停止 daemon，发送唯一消息，再以同一命令重启。 | 长轮询在启动后收到待处理 update 并投递回复。 |
| 长回复 | 要求输出超过 4096 个 UTF-16 unit，并在分割边界附近包含 emoji。 | Telegram 按序收到多个分片，不切断 surrogate pair，且只有首片引用源消息。 |
| 中断恢复 | 中断一个轮次，以同一 `DSH_HOME` 重启后发送 follow-up。 | Harness 修复或恢复持久会话，follow-up 完成且历史不损坏。 |
| 同一聊天 FIFO | 在一个聊天中快速发送两条不同提示。 | 回复保持准入顺序，且任一轮次都不会毒化下一轮次。 |
| Chat-id 迁移防护 | 把一次性测试群转换为 supergroup 前记录旧 id；分别测试一次无 alias 转换，以及另一次提前配置 alias 的新转换。 | 无 alias 的 service update 一旦被观察，后续新 chat 消息只在当前进程中暂停；更早的普通消息可能已单独路由，restart 也会清空暂停。只有预配置 alias 的场景保证一个持久身份，同时回复仍发往当前 chat id。此行不属于当前带凭证基线。 |
| Forum topic | 在真实 forum topic 中重复 mention、回复、重启与长回复检查。 | 回复留在同一 topic，且不同 topic 的历史相互隔离。此行不属于当前带凭证基线。 |
| Ack reaction | 在允许已配置 emoji 的群里发送定向消息。 | ack 出现且不延迟文本回复。该路径有无密钥覆盖，但本轮带凭证验证未单独观察。 |

## 诊断失败

| 信号 | 含义与处理 |
|---|---|
| `no bot token resolved` | 配置的 Harness 凭证引用没有解析到值。设置托管凭证或启动环境回退值，再更新/发出匹配的凭证事件，或 remount。 |
| `polling stopped permanently` 且带 401 | token 无效或已撤销，因此 receive/send/react 均不可用。请更换；重启同一值无法恢复。 |
| `polling stopped permanently` 且带 409 | 另一个进程正在轮询同一 bot，因此 receive 不可用，而当前凭证的 send/react 仍可用。adapter 刻意不重试。停止旧 daemon、container 或手工 `getUpdates` 客户端，再 remount/重启当前 adapter。 |
| `messages for ... are paused to avoid splitting the durable session` | Telegram chat 迁移时缺少匹配的部署 alias。把日志给出的准确 `{ chatId, sessionChatId }` 映射加入 `chatIdAliases`，然后 remount。 |
| `image download failed` 或固定的安全导入提示 | 所选模型支持图片，但 1000–2147483647 毫秒下载 deadline、Telegram 传输或 Harness 校验/大小限制拒绝输入。仅在该范围内增加 `imageDownloadTimeoutMs`，或在配置限制内重发受支持的 PNG/JPEG/WebP/GIF；失败输入不会作为不完整 user turn 追加。 |
| `getMe` 成功但私聊无回复 | 确认用户已启动私聊，检查模型路由与 `DEEPSEEK_API_KEY` 错误，并确认 daemon 命令携带 overlay。 |
| 群聊 mention 未到达 | 检查精确 bot username、群成员身份、privacy/管理员设置，以及消息是否属于受支持的 `message` update。 |
| 私聊回复正常但无 ack | 在随附的 `ackReactionScope: group-mentions` 下这是预期行为；私聊不 ack。 |
| 群聊回复正常但无 ack | 检查允许的 reaction 与 bot 权限。reaction 失败只记 warning，不阻塞文本回复。 |
| ack 出现但没有文本 | Telegram 入站已成功；请检查 Harness 模型/工具错误或最终 `sendMessage` 失败。 |
| 重启后历史丢失 | 确认两次启动使用同一 `DSH_HOME`、checkout 工作目录、profile overlay 与持久化根目录。 |
| 网络访问需要环境代理 | 在受支持的 Node 版本上，与部署的 `HTTP_PROXY` 或 `HTTPS_PROXY` 一起导出 `NODE_USE_ENV_PROXY=1`。 |

## 在当前限制内解读结果

- 适配器只请求 `message` update；编辑后的消息、callback query 与 channel post 不会被接受。
- 文本与 caption 会达到模型。受支持的 Telegram photo 与 PNG/JPEG/WebP/GIF 图片 document 先表示为短暂 source；只有通过 mention 准入且 `ctx.llm` 解析为图片模型后，官方 `@grammyjs/files` 才会 hydrate `getUrl`。随后原生 `fetch` 在可取消的 `imageDownloadTimeoutMs` deadline 下流式读取字节，adapter 再校验全部输入并通过 Harness `ctx.attachments` 保存。随附的默认 DeepSeek 路由仅支持文本，因此不会下载图片。
- 投递使用一个 simple long-polling loop，而非 webhook。grammY 串行等待 middleware，因此慢模型回合会延迟后续聊天。
- Telegram offset 状态与 provider message id 不是持久 ClawDSH inbox。崩溃可能重放轮次。
- Provider 重试与会话持久性不会构成持久出站 outbox。assistant answer 可能已持久化，但 Telegram 发送最终丢失。
- 多分片发送不是事务：后续分片失败前，早先分片可能已落地。
- `botTokenEnv` 经 Harness credentials 解析，并以启动环境为回退。托管更新会热切换；仅修改环境或使用字面量 `botToken` escape hatch 时需要 remount/重启。
- Chat-id alias 是部署自有配置，不是自动持久化的迁移 ledger。未知迁移暂停只存在于进程内，只在观察到 service update 后开始，也可能漏掉更早的新 id 流量；只有预配置 alias 才能保证持久身份连续。
- Forum topic 传递与 reaction 有无密钥约定测试，但在上述各行通过真实客户端验证前，仍是独立的线上检查。
- 当前图片路径与文本模型不下载行为具有无密钥覆盖，但在通过真实客户端与目标模型路由验证前，仍是独立的线上检查。

记录受测 commit、日期、非机密 bot username/id、环境，以及每个 passed/not-run 行。绝不记录 token 或 chat id。仓库最新的范围化证据见 [2026-08-15 日志](../journal/2026-08-15.md)。
