# Telegram credentialed end-to-end verification

English | [中文](telegram-e2e.zh.md)

This cookbook verifies the deployed Telegram path one layer at a time: Bot API authentication, grammY long-poll inbound, ClawDSH routing, Harness agent/model/tool execution, durable state, and Telegram outbound delivery. A successful `--dump-config` or `getMe` call is a prerequisite, not an end-to-end result. The adapter's current behavior and deferred work remain authoritative in the [package README](../../packages/openclaw/channel-telegram/README.md).

## Prerequisites

- Use a dedicated test bot. If its token has appeared in chat, logs, shell history, or a committed file, replace it through BotFather before testing.
- The user must open the bot's private chat and send a message first; Telegram bots cannot initiate a user conversation.
- Export `DEEPSEEK_API_KEY` for the Harness model route. `ARK_API_KEY` is optional for this procedure: without it, `memory_search` must fail loud, while an explicit `memory_get` can still read a known memory file.
- Build and link from the repository checkout, and use the same `DSH_HOME` for `tools/link-openclaw.sh` and every `dsh` invocation.
- Run only one long-polling process for a bot token. A second `getUpdates` consumer produces a 409 conflict and can take updates away from the process under test.

## Enable Telegram without storing its token

The shipped `openclaw` profile keeps Telegram disabled and Feishu enabled. Put the following overlay at `$DSH_HOME/telegram-e2e.patch.yml`, outside the repository. `tools/link-openclaw.sh` can then refresh the installed profile without overwriting this opt-in.

```yaml
- id: channel-feishu
  disabled: true

- id: channel-discord
  disabled: true

- id: channel-telegram
  disabled: false
  config:
    botTokenEnv: TELEGRAM_BOT_TOKEN
    polling: true
    timeout: 30
    imageDownloadTimeoutMs: 30000
```

Export credentials only in the launch environment, build and install the local profile, inspect the composed tree, and then start the resident daemon:

```bash
export DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
export TELEGRAM_BOT_TOKEN='<new token>'
export DEEPSEEK_API_KEY='<model key>'

pnpm run build
tools/link-openclaw.sh
pnpm dsh --profile openclaw --patch "$DSH_HOME/telegram-e2e.patch.yml" --dump-config
pnpm dsh --profile openclaw --patch "$DSH_HOME/telegram-e2e.patch.yml"
```

The dump must show `channel-telegram` enabled, Feishu/Discord disabled, and the non-secret credential reference `botTokenEnv: TELEGRAM_BOT_TOKEN`. A config dump does not resolve or authenticate the token.

`imageDownloadTimeoutMs` bounds Telegram file metadata lookup and the streamed byte read. It defaults to 30000 milliseconds and accepts values from 1000 through 2147483647. The deadline matters only when channel-core has admitted the message and the resolved model declares image input; the shipped text-only DeepSeek route does not download the file.

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

Telegram enables Group Privacy Mode by default. Keep it enabled for normal ClawDSH use: private messages are delivered, while explicitly addressed commands, mentions, and replies reach the bot; `channel-core` then applies its own `groupMode: mention` rule. Telegram documents the platform gate in [Privacy Mode](https://core.telegram.org/bots/features#privacy-mode) and [the bot FAQ](https://core.telegram.org/bots/faq#what-messages-will-my-bot-get).

An unmentioned-message test proves the ClawDSH gate only when Telegram delivered that ordinary group message. Make the test bot a group administrator, or temporarily disable privacy through BotFather and remove and re-add the bot so the change takes effect. Restore the least-privileged production setting after the test.

## Preserve history across a Telegram chat-id migration

When Telegram upgrades or migrates a group, delivery can move to a new chat id. Preserve the old durable session identity with a deployment-owned alias in the same external overlay; the values below are examples only:

```yaml
- id: channel-telegram
  config:
    chatIdAliases:
      - chatId: '-1001234567890'
        sessionChatId: '-123456789'
```

`chatId` is the current delivery destination and `sessionChatId` is the prior stable identity used only for Harness session/FIFO routing. Replies still go to the current `chatId`. Aliases must be integer Telegram ids; conflicts and cycles fail configuration.

The adapter does not invent or persist this deployment mapping. If it observes a migration service message without an alias resolving the old and current ids to one stable identity, it adds the new chat to an in-memory pause set and logs the exact alias to add. Add that mapping outside the repository and remount the plugin.

Treat the pause as a best-effort diagnostic guard, not a migration transaction. Telegram can deliver an ordinary message under the new id before the migration service update, in which case that turn can already open a separate durable session; the adapter does not merge it afterward. Restarting or remounting also clears the in-memory pause. Only an alias configured before new-id traffic is observed guarantees that routing reuses the old stable identity. Chat migration was not exercised in the 2026-08-15 real-client baseline; preconfigured-alias routing, service-update pause, and config rejection have keyless contract coverage.

## Run the verification matrix

Use unique random markers so an old update or cached answer cannot satisfy a check. Keep the daemon log visible and record each row independently; one passing row does not imply the others passed.

| Layer | Action | Success criterion |
|---|---|---|
| Authentication | Run `getMe` with the daemon stopped. | The API returns the expected bot identity with `ok: true`. |
| Direct inbound/outbound | Open the private chat, send `/start`, then ask for an exact unique marker. | The bot produces a model-backed reply and natively replies to the triggering message. |
| Durable memory | Ask the agent to store a unique fact, wait for completion, stop cleanly, restart with the same `DSH_HOME`, and ask for the fact. | The fact survives restart. Without `ARK_API_KEY`, `memory_search` reports its missing credential and `memory_get` can provide the recorded fallback. |
| Unmentioned group gate | In a group where the bot receives ordinary messages, send text without addressing it. | No acknowledgement and no model reply are emitted. |
| Username mention | Send `@BotUsername` followed by a unique prompt. | The bot accepts the turn, removes its structured mention from model text, and replies to the source message. |
| Reply-to-bot | Reply to an existing bot message without another mention. | The reply relationship counts as addressing the bot and produces a response. |
| Addressed command | Send `/help@BotUsername` with a unique suffix. | The bot accepts it, removes only the username suffix, and the model still receives `/help`. |
| Other-bot command | Send a command addressed to another bot. | ClawDSH does not treat it as a mention of this bot and emits no response. |
| Harness web tool | Ask a current-information question that requires `web_search`. | The model completes the tool-backed turn and Telegram receives the answer. |
| 2026-08-15 caption baseline | On the recorded pre-image-ingestion build, send media once with a caption addressed to the bot and once without text or caption. | The credentialed run observed caption relay and bodyless-media ignore behavior; media bytes were not model input. This is historical evidence, not the current image-path expectation. |
| Current text-only image handling | On the current shipped DeepSeek text-only selection, send a supported photo/image document first with a caption, then without one. | The caption continues with explicit omitted-image context; the image-only message receives the fixed text-only notice. No Telegram file download or Harness attachment save occurs. This path is keyless-tested, not part of the recorded live baseline. |
| Current image-capable import | Select a model whose resolved Harness metadata includes image input; send a photo, then PNG/JPEG/WebP/GIF image documents within configured limits. | After mention admission, official `@grammyjs/files` hydrates `getUrl`; native `fetch` then streams under the abortable deadline and declared/actual byte limits before Harness `ctx.attachments` validates every image and saves any reference. The durable user message contains only Harness image references. This path is keyless-tested but has not completed a credentialed real-client/model run. |
| Offline catch-up | Stop the daemon, send a unique message, then restart the same command. | Long polling receives the pending update and delivers its reply after startup. |
| Long reply | Request output exceeding 4096 UTF-16 units and include an emoji near a split boundary. | Telegram receives ordered chunks, no surrogate pair is cut, and only the first chunk quotes the source message. |
| Interrupted recovery | Interrupt a turn, restart with the same `DSH_HOME`, and send a follow-up. | Harness repairs or resumes the durable conversation and the follow-up completes without corrupt history. |
| Same-chat FIFO | Send two distinct prompts rapidly in one chat. | Replies preserve admission order and neither turn poisons the next one. |
| Chat-id migration guard | Before converting a disposable test group to a supergroup, record the old id. Exercise both an unaliased conversion and a fresh conversion with the alias preconfigured. | Once an unaliased service update is observed, later new-chat messages are paused only for that process; earlier ordinary messages may already have routed separately, and restart clears the pause. Only the preconfigured-alias case guarantees one durable identity while replies target the current chat id. This row is not part of the current credentialed baseline. |
| Forum topic | Repeat mention, reply, restart, and long-reply checks inside a real forum topic. | The reply stays in the same topic and topic histories remain isolated. This row is not part of the current credentialed baseline. |
| Acknowledgement reaction | Send an addressed group message in a chat that permits the configured emoji. | The acknowledgement appears without delaying the text reply. This path has keyless coverage but was not independently observed in the current credentialed run. |

## Diagnose failures

| Signal | Meaning and action |
|---|---|
| `no bot token resolved` | The configured Harness credential reference has no value. Set the managed credential or launch-environment fallback, then emit/update that matching credential or remount. |
| `polling stopped permanently` with 401 | The token is invalid or revoked, so receive/send/react are all unavailable. Replace it; restarting the same value cannot recover. |
| `polling stopped permanently` with 409 | Another process is polling the same bot, so receive becomes unavailable while send/react remain available for the current credential. The adapter intentionally does not retry. Stop the old daemon, container, or manual `getUpdates` client, then remount/restart this adapter. |
| `messages for ... are paused to avoid splitting the durable session` | A Telegram chat migration arrived without a matching deployment alias. Add the exact logged `{ chatId, sessionChatId }` mapping to `chatIdAliases` and remount. |
| `image download failed` or the fixed safe-import notice | The selected model accepts images, but the 1000–2147483647 ms download deadline, Telegram transfer, or Harness validation/size limits rejected the input. Increase `imageDownloadTimeoutMs` only within that range or resend a supported PNG/JPEG/WebP/GIF within the configured limits; the failed input was not appended as a partial user turn. |
| `getMe` succeeds but direct chat has no reply | Confirm the user started the chat, inspect model-route and `DEEPSEEK_API_KEY` errors, and verify the overlay is present on the daemon command. |
| A group mention does not arrive | Check the exact bot username, group membership, privacy/admin setting, and whether the message was a supported `message` update. |
| A direct reply works without an acknowledgement | This is expected under the shipped `ackReactionScope: group-mentions`; direct chats are not acknowledged. |
| A group reply works without an acknowledgement | Check allowed reactions and bot permissions. Reaction failure logs a warning and does not block the text reply. |
| An acknowledgement appears but no text follows | Telegram inbound succeeded; inspect the Harness model/tool error or final `sendMessage` failure. |
| Restart loses history | Confirm both launches used the same `DSH_HOME`, checkout working directory, profile overlay, and persistence root. |
| Network access requires an environment proxy | On supported Node versions, export `NODE_USE_ENV_PROXY=1` together with the deployment's `HTTP_PROXY` or `HTTPS_PROXY`. |

## Interpret the result within current limits

- The adapter requests only `message` updates; edited messages, callback queries, and channel posts are not accepted.
- Text and captions reach the model. Supported Telegram photos and PNG/JPEG/WebP/GIF image documents are represented as ephemeral sources; only after mention admission and an image-capable `ctx.llm` result does official `@grammyjs/files` hydrate `getUrl`. Native `fetch` then streams bytes under the abortable `imageDownloadTimeoutMs` deadline before the adapter validates all inputs and saves them through Harness `ctx.attachments`. The shipped DeepSeek route is text-only and therefore performs no image download.
- Delivery uses one simple long-polling loop, not a webhook. A slow model turn delays later chats because grammY waits for middleware sequentially.
- Telegram offset state and provider message ids are not a durable ClawDSH inbox. A crash can replay a turn.
- Provider retries and session durability do not form a durable outbound outbox. An assistant answer can be persisted while its Telegram send is ultimately lost.
- Multi-chunk sends are not transactional: earlier chunks can land before a later chunk fails.
- `botTokenEnv` resolves through Harness credentials with launch-environment fallback. Managed updates hot-rotate; environment-only changes and the literal `botToken` escape hatch require remount/restart.
- Chat-id aliases are deployment-owned configuration, not an automatically persisted migration ledger. The unknown-migration pause is process-local, starts only after the service update is observed, and can miss earlier new-id traffic; only a preconfigured alias guarantees durable identity continuity.
- Forum-topic propagation and reactions have keyless contract coverage, but remain separate live checks until their rows above pass on a real client.
- The current image path and text-only no-download behavior have keyless coverage, but remain separate live checks until exercised from a real client against the intended model route.

Record the tested commit, date, non-secret bot username/id, environment, and every passed/not-run row. Never record the token or chat id. The repository's latest scoped evidence is in the [2026-08-15 journal](../journal/2026-08-15.md).
