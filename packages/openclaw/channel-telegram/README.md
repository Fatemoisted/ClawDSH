# @clawdsh/dsh-channel-telegram

English | [中文](README.zh.md)

**Purpose**: Telegram channel adapter — implements `ChannelAdapter`, wrapped with grammY: `Bot` long-polling inbound (`message:text`) + `bot.api.sendMessage` outbound; the first channel plugin, doubling as the spike carrier for the `ctx.channels` seam.

**OpenClaw correspondence**: the Telegram channel (one of the earliest-stable channels in OpenClaw's support matrix). Upstream `extensions/telegram` likewise wraps `grammy` + `@grammyjs/runner` + `@grammyjs/transformer-throttler`; this adapter starts with the minimal surface (grammY `Bot` long polling), leaving runner/throttler to be introduced on demand in stage 3.

**Seam**: `ctx.channels` (@clawdsh/dsh-channel-core).

**Specification**: stage 2 deliverable · **Status**: implemented

## Design notes

- **inbound**: `Bot.on('message:text')` maps each text message to `channel/inbound` (`threadId` = `chat.id`, `sender` = `from.id`); `bot.start({ allowed_updates:['message'], timeout })` long-polls, with grammY advancing `offset` internally (at-least-once delivery idempotence); `bot.catch` as the fallback log.
- **outbound**: `bot.api.sendMessage(chat_id, text)`; grammY throws `GrammyError` on API errors, fail-loud.
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

- **real e2e**: a real `botToken` + key is needed to run the real closed loop; currently covered by contract tests (protocol mapping + `send` payload + start/stop polling).
- **quoted replies / attachments**: `reply_parameters` quoting, images/rich text all deferred (stage 3 channel extensions).
- **runner/throttler**: `@grammyjs/runner` (high-load concurrency) and `@grammyjs/transformer-throttler` (rate limiting) are adopted upstream; this adapter starts with the minimal `bot.start()` long-polling surface, to be introduced when needed.
