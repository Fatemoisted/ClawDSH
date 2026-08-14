# @clawdsh/dsh-channel-telegram

English | [中文](README.zh.md)

**Purpose**: Telegram channel adapter — a thin `ChannelAdapter` over grammY `Bot`: drain-aware long-polling text/caption inbound plus retried native topic/reply/reaction outbound with Unicode-safe 4096-unit chunking.

**OpenClaw correspondence**: the Telegram channel (one of the earliest-stable channels in OpenClaw's support matrix). Upstream `extensions/telegram` likewise wraps grammY components. This adapter uses `grammy` long polling plus the official `@grammyjs/auto-retry`, leaving runner/throttler to be introduced only for higher load.

**Seam**: `ctx.channels` (@clawdsh/dsh-channel-core).

**Specification**: stage 2 deliverable · **Status**: implemented

## Design notes

- **inbound**: `Bot.on('message')` accepts `text` and media `caption`, uses Telegram `mention`/`text_mention` UTF-16 entity ranges plus reply-to-bot identity for structured group gating, and preserves `message_thread_id` as the Harness topic key. A `bot_command` such as `/help@ClawBot` also counts as an explicit bot target: only the `@ClawBot` suffix is removed, so the model still receives `/help`;
- **awaited admission**: the grammY handler awaits `ctx.parallel('channel/inbound', inbound)`, so it remains open through channel-core's FIFO turn, `sessions.flush`, and outbound send instead of acknowledging the update before durability;
- **outbound**: long replies are split at Telegram's 4096 UTF-16-unit limit without cutting a surrogate pair. Every chunk keeps `message_thread_id`, while only the first quotes the triggering message through `reply_parameters`; `setMessageReaction` provides the configured acknowledgement reaction. The official auto-retry transformer retries API rate limits and server failures at most three times with a 30-second delay cap. Network `HttpError`s are rethrown immediately because plugin 2.0.2 otherwise retries them in an unbounded inner loop; final failures reject through channel-core;
- **credentials**: `botToken` enters via Config, no secret is stored privately; wiring into `ctx.credentials` is left for the real-e2e wrap-up.
- **polling lifecycle owned by grammY**: the adapter itself holds no offset state. Disposal awaits `bot.stop()` and then the saved `bot.start()` task, which is grammY's middleware-drain barrier; rejected start/stop promises are caught and logged.

## Model Experience

### Inbound message text

#### What the model sees

The adapter maps Telegram text or a media caption to `channel/inbound`; only the bot's structured mention span is removed. Channel-core writes the accepted text into the durable session log. The adapter registers no prompt or tool schema of its own.

#### Token effect

Only the relayed message text reaches the model, through channel-core's session write.

#### KV Cache effect

Append-only through channel-core's user-message write.

## Known Limitations and Deferred Work

- **credentialed e2e**: keyless tests cover entity/caption/`bot_command` mapping, awaited inbound, Unicode-safe 4096-unit splitting, topics, native replies, reactions, and polling start/stop rejection; a real `botToken` and model key are still needed for the deployed closed loop.
- **binary attachments**: media captions are handled, but photo/document/audio bytes are not downloaded into Harness `ctx.attachments` yet.
- **delivery mode**: webhook mode is not wired; this package currently owns one grammY long-polling process.
- **runner/throttler**: `@grammyjs/runner` (high-load concurrency) and `@grammyjs/transformer-throttler` (rate limiting) are adopted upstream; this adapter starts with the minimal `bot.start()` long-polling surface, to be introduced when needed.
- **final delivery failures**: grammY consumes an update after its error handler handles a middleware failure. Official bounded API retries make transient send loss unlikely, but there is no persistent outbox for a reply that still fails afterward.
