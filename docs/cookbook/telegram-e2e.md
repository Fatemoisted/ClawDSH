# Telegram legacy-adapter credentialed end-to-end verification

English | [中文](telegram-e2e.zh.md)

> **Scope:** this cookbook exercises the retained in-process `ctx.legacyChannels` path (`channel-core` + `channel-telegram`). It does not exercise or certify the canonical OpenClaw Gateway sidecar from ADR-0008. The recorded 2026-08-15 run used the legacy implementation at commit `ca39c8ee4d`; a rerun on later code is new legacy evidence only.

This procedure verifies the legacy Telegram path one layer at a time: Bot API authentication, grammY long-poll inbound, ClawDSH routing, Harness Agent/model/tool execution, durable state, and Telegram outbound delivery. A successful `--dump-config` or `getMe` call is a prerequisite, not an end-to-end result. Current adapter behavior and deferred work remain authoritative in the [package README](../../packages/openclaw/channel-telegram/README.md); sidecar certification follows the separate [channel-plane sync standard](../standards/openclaw-channel-sync.md).

## Prerequisites

- Use a dedicated test bot. If its token has appeared in chat, logs, shell history, or a committed file, replace it through BotFather before testing.
- The user must open the bot's private chat and send a message first; Telegram bots cannot initiate a user conversation.
- Export `DEEPSEEK_API_KEY` for the Harness model route. `ARK_API_KEY` is optional for this procedure: without it, `memory_search` must fail loud, while an explicit `memory_get` can still read a known memory file.
- Build and link from the repository checkout, and use the same `DSH_HOME` for `tools/link-clawdsh.sh` and every `dsh` invocation.
- Run only one long-polling process for a bot token. A second `getUpdates` consumer produces a 409 conflict and can take updates away from the process under test.
- Stop every sidecar or older daemon using the same platform account. The profile prevents its two channel groups from running together, but cannot stop a different checkout, container, or host.

## Enable only the retained legacy group

The `clawdsh` profile contains a default-disabled `clawdsh-legacy-channel-plane` group for migration and compatibility verification. Keep OpenClaw Gateway disabled in ClawDSH Settings and enable the legacy group explicitly. Telegram resolves the named credential at runtime; no token belongs in a tracked YAML file.

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

The dump must show `clawdsh-legacy-channel-plane` and its Telegram entry enabled, its Discord and Feishu entries disabled, `clawdsh-communication-plane` present, and the non-secret Telegram credential reference `TELEGRAM_BOT_TOKEN`. It must not contain the resolved token. Gateway's persisted Settings value must remain disabled. If canonical enablement is requested while the legacy opt-in is present, startup or Settings preflight rejects the configuration; treat that failure as the expected mutual-exclusion guard rather than evidence that the legacy adapter ran.

`imageDownloadTimeoutMs` bounds Telegram file metadata lookup and the streamed byte read. It defaults to 30000 milliseconds and accepts values from 1000 through 2147483647. The deadline matters only when legacy channel-core has admitted the message and the resolved model declares image input; the shipped text-only DeepSeek route does not download the file.

## Understand credential activation and rotation

`botTokenEnv` is a Harness credential reference, not a request to copy the token into Config. The adapter resolves it through `ctx.credentials`, with the Harness launch environment as a compatibility fallback. If no value resolves, the adapter logs `no bot token resolved`, exposes receive/send/react as unavailable, and does not start a half-configured bot.

A matching managed `credentials/updated` event drains the old bot and starts a new bot with the newly resolved value without restarting the daemon. Changing only the process environment does not emit that event, so restart or remount after an environment-only change. The literal `botToken` option exists for programmatic use, takes precedence over `botTokenEnv`, and deliberately does not hot-rotate; do not use it in a checked-in profile.

## Verify Bot API authentication

Run this probe with the daemon stopped. It prints only the non-secret bot identity and never prints the token or request URL:

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

Success is HTTP 200, `ok: true`, and the expected bot id and username. Do not call `getUpdates` manually while the daemon is running.

## Configure group privacy deliberately

Telegram enables Group Privacy Mode by default. Keep it enabled for normal use: private messages are delivered, while explicitly addressed commands, mentions, and replies reach the bot; legacy channel-core then applies its own mention gate. Telegram documents the platform gate in [Privacy Mode](https://core.telegram.org/bots/features#privacy-mode) and [the bot FAQ](https://core.telegram.org/bots/faq#what-messages-will-my-bot-get).

An unmentioned-message test proves the ClawDSH gate only when Telegram delivered that ordinary group message. Make the test bot a group administrator, or temporarily disable privacy through BotFather and remove and re-add the bot so the change takes effect. Restore the least-privileged production setting after the test.

## Preserve history across a Telegram chat-id migration

When Telegram upgrades or migrates a group, delivery can move to a new chat id. Preserve the old durable Session identity with a deployment-owned alias in a repository-external patch; the values below are examples only:

```yaml
- id: channel-telegram
  config:
    chatIdAliases:
      - chatId: '-1001234567890'
        sessionChatId: '-123456789'
```

`chatId` is the current delivery destination and `sessionChatId` is the prior stable identity used only for Harness Session/FIFO routing. Replies still go to the current `chatId`. Aliases must be integer Telegram ids; conflicts and cycles fail configuration.

The adapter does not invent or persist this deployment mapping. If it observes a migration service message without an alias resolving the old and current ids to one stable identity, it adds the new chat to an in-memory pause set and logs the exact alias to add. Treat the pause as a best-effort diagnostic guard, not a migration transaction: ordinary new-id traffic can arrive before the service update, and restart/remount clears the pause. Only a preconfigured alias guarantees that routing reuses the old stable identity. This behavior belongs to the legacy ADR-0011 path and does not describe OpenClaw sidecar identity handling.

## Run the verification matrix

Use unique random markers so an old update or cached answer cannot satisfy a check. Keep the daemon log visible and record each row independently; one passing row does not imply the others passed.

| Layer | Action | Success criterion | 2026-08-15 legacy baseline |
|---|---|---|---|
| Authentication | Run `getMe` with the daemon stopped. | The API returns the expected bot identity with `ok: true`. | Passed |
| Direct inbound/outbound | Open the private chat, send `/start`, then ask for an exact unique marker. | The bot produces a model-backed reply and natively replies to the triggering message. | Passed |
| Durable memory | Store a unique fact, stop cleanly, restart with the same `DSH_HOME`, and ask for the fact. | The fact survives restart; without `ARK_API_KEY`, explicit `memory_get` can provide the fallback. | Passed |
| Unmentioned group gate | In a group where the bot receives ordinary messages, send text without addressing it. | No acknowledgement and no model reply are emitted. | Passed |
| Username mention | Send `@BotUsername` followed by a unique prompt. | The bot accepts the turn, removes its structured mention from model text, and replies to the source message. | Passed |
| Reply-to-bot | Reply to an existing bot message without another mention. | The reply relationship counts as addressing the bot and produces a response. | Passed |
| Addressed command | Send `/help@BotUsername` with a unique suffix. | The bot accepts it, removes only the username suffix, and the model still receives `/help`. | Passed |
| Other-bot command | Send a command addressed to another bot. | ClawDSH does not treat it as a mention of this bot and emits no response. | Passed |
| Harness web tool | Ask a current-information question that requires `web_search`. | The model completes the tool-backed turn and Telegram receives the answer. | Passed |
| Caption behavior | Send addressed media with a caption, then media without text or caption. | Caption reaches the model; bodyless media creates no model turn on the recorded pre-image-ingestion build. | Passed on the historical build |
| Current text-only image handling | On a text-only model, send an image with a caption, then a pure image. | Caption continues with omitted-image context; the pure image receives the fixed notice; no file download occurs. | Keyless only |
| Current image-capable import | On an image-capable model, send a photo and supported PNG/JPEG/WebP/GIF documents. | Admission precedes bounded download; Harness validates every image before saving durable references. | Keyless only |
| Offline catch-up | Stop the daemon, send a unique message, then restart the same command. | Long polling receives the pending update and delivers its reply. | Passed |
| Long reply | Request more than 4096 UTF-16 units with an emoji near a split boundary. | Ordered chunks arrive without splitting a surrogate pair; only the first quotes the source. | Passed |
| Interrupted recovery | Interrupt a turn, restart with the same `DSH_HOME`, and send a follow-up. | Harness recovers the durable conversation and the follow-up completes. | Passed |
| Same-chat FIFO | Send two distinct prompts rapidly in one chat. | Replies preserve admission order and neither turn poisons the next. | Passed |
| Chat-id migration guard | Exercise an unaliased migration and a separate pre-aliased migration. | Only the preconfigured alias guarantees one durable identity. | Keyless only |
| Forum topic | Repeat mention, reply, restart, and long-reply checks in a real topic. | Replies stay in the topic and topic histories remain isolated. | Not run |
| Acknowledgement reaction | Send an addressed group message where the configured emoji is allowed. | Ack appears without delaying the text reply. | Keyless only |

## Diagnose failures

| Signal | Meaning and action |
|---|---|
| `no bot token resolved` | The Harness credential reference has no value. Set the managed credential or launch-environment fallback, then update/remount. |
| `polling stopped permanently` with 401 | The token is invalid or revoked; replace it. Restarting the same value cannot recover. |
| `polling stopped permanently` with 409 | Another process polls the same bot. Stop the older daemon, container, or manual `getUpdates` client, then remount/restart. |
| `messages for ... are paused to avoid splitting the durable session` | Add the exact logged `{ chatId, sessionChatId }` mapping outside the repository and remount. |
| `image download failed` or the fixed safe-import notice | The deadline, Telegram transfer, or Harness validation/size limits rejected input. The failed input was not appended as a partial turn. |
| `getMe` succeeds but direct chat has no reply | Confirm the user started the chat, inspect model-route and `DEEPSEEK_API_KEY` errors, and verify the legacy group—not the sidecar—actually mounted. |
| A group mention does not arrive | Check the exact bot username, membership, privacy/admin setting, and whether Telegram delivered a supported `message` update. |
| Restart loses history | Confirm both launches used the same `DSH_HOME`, checkout, profile, and persistence root. |

## Interpret the result within current limits

- The legacy adapter requests only `message` updates; edited messages, callback queries, and channel posts are not accepted.
- Text and captions reach the model. Image bytes materialize only after mention admission and an image-capable model selection; the default text route does not download them.
- Delivery uses one awaited long-polling loop. A slow model turn can delay later chats.
- Telegram offset state and provider message ids are not a durable ClawDSH inbox. A crash can replay a turn.
- Provider retries and Session durability do not form a durable outbound outbox. An assistant answer can be persisted while Telegram delivery is ultimately lost.
- Multi-chunk sends are not transactional: earlier chunks can land before a later chunk fails.
- Credential rotation, chat-id aliases, forum topics, current image materialization, and acknowledgement reactions are not part of the recorded credentialed baseline unless a new dated row records them.
- No result from this cookbook can promote an ADR-0008 sidecar channel. Sidecar certification must use the exact locked host, bridge, account configuration, security checks, keyless assembled transcript, and live matrix required by the channel sync standard.

Record the tested commit, date, non-secret bot username/id, environment, and every passed/not-run row. Never record a token or chat id. The scoped historical evidence is in the [2026-08-15 journal](../journal/2026-08-15.md).
