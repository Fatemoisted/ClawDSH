# @clawdsh/dsh-channel-telegram

English | [中文](README.zh.md)

**Purpose**: legacy Telegram adapter over `ctx.legacyChannels`, using grammY `Bot` long-polling inbound (`message:text`) and `bot.api.sendMessage` outbound. It remains only until credentialed OpenClaw sidecar live cutover.

**OpenClaw correspondence**: the Telegram channel (one of the earliest-stable channels in OpenClaw's support matrix). Upstream `extensions/telegram` likewise wraps `grammy` + `@grammyjs/runner` + `@grammyjs/transformer-throttler`; this adapter starts with the minimal surface (grammY `Bot` long polling), leaving runner/throttler to be introduced on demand in stage 3.

**Seam**: legacy-only `ctx.legacyChannels` (@clawdsh/dsh-channel-core). It has no compatibility alias to the production `ctx.channels` service.

**Specification**: historical stage 2 deliverable · **Status**: legacy, disabled by default, pending decommission; sidecar live cutover is not yet claimed

## Design notes

- **inbound**: `Bot.on('message:text')` maps each text message to `channel/inbound` (`threadId` = `chat.id`, `sender` = `from.id`); `bot.start({ allowed_updates:['message'], timeout })` long-polls, with grammY advancing `offset` internally (at-least-once delivery idempotence); `bot.catch` as the fallback log. `isGroup` comes from `chat.type` (`group`/`supergroup`); `wasMentioned` comes from `detectBotMention` (the bot's real username against `mention` entities and the `@username` text, plus any identity pattern).
- **outbound**: `bot.api.sendMessage(chat_id, text)`; grammY throws `GrammyError` on API errors, fail-loud.
- **ack reaction**: `bot.api.setMessageReaction(chat_id, message_id, [{ type:'emoji', emoji }])`; an unsupported emoji is rejected by the API at runtime and surfaces as the caller's logged warning.
- **credentials**: `botToken` enters via Config, no secret is stored privately; wiring into `ctx.credentials` is left for the real-e2e wrap-up.
- **polling offset owned by grammY**: the adapter itself holds no mutable state; the offset is managed by grammY's long-polling loop.

## Model Experience

### Inbound message text

#### What the model sees

The adapter maps a Telegram text update to a `channel/inbound` message; the channel-core router writes that message's `text` into the session log as a user message. The adapter registers no prompt or tool schema of its own.

#### Token effect

Only the relayed message text reaches the model, through channel-core's session write.

#### KV Cache effect

Append-only through channel-core's user-message write.

## Known Limitations and Deferred Work

- **decommission gate**: remove this adapter only after a credentialed Telegram account passes the OpenClaw sidecar live-cutover matrix; unit and contract tests do not satisfy that gate.

- **real e2e**: a real `botToken` + key is needed to run the real closed loop; currently covered by contract tests (protocol mapping + `send` payload + start/stop polling).
- **quoted replies / attachments**: `reply_parameters` quoting, images/rich text all deferred (stage 3 channel extensions).
- **runner/throttler**: `@grammyjs/runner` (high-load concurrency) and `@grammyjs/transformer-throttler` (rate limiting) are adopted upstream; this adapter starts with the minimal `bot.start()` long-polling surface, to be introduced when needed.
- **mention detection depends on getMe**: the bot's real username is read from `bot.botInfo?.username` after grammY's `init()`; before that (or without a username) only the identity patterns can detect a mention, and with neither the adapter omits `wasMentioned` (fail-open, no ack).
