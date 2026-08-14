# @clawdsh/dsh-channel-telegram

English | [中文](README.zh.md)

**Purpose**: Telegram channel adapter — a thin `ChannelAdapter` over grammY `Bot`: drain-aware long-polling text/caption inbound plus retried native topic/reply/reaction outbound with Unicode-safe 4096-unit chunking.

**OpenClaw correspondence**: the Telegram channel (one of the earliest-stable channels in OpenClaw's support matrix). Upstream `extensions/telegram` likewise wraps grammY components. This adapter uses grammY long polling plus the official `@grammyjs/auto-retry`; Harness timer owns bounded outer restart after polling itself exits.

**Seam**: `ctx.channels` (@clawdsh/dsh-channel-core).

**Specification**: stage 2 deliverable · **Status**: implemented

## Design notes

- **inbound**: `Bot.on('message')` accepts `text` and media `caption`, uses Telegram `mention`/`text_mention` UTF-16 entity ranges plus reply-to-bot identity for structured group gating, and preserves `message_thread_id` as the Harness topic key. A `bot_command` such as `/help@ClawBot` also counts as an explicit bot target: only the `@ClawBot` suffix is removed, so the model still receives `/help`;
- **awaited admission**: the grammY handler awaits `ctx.parallel('channel/inbound', inbound)`, so it remains open through channel-core's FIFO turn, `sessions.flush`, and outbound send instead of acknowledging the update before durability;
- **outbound**: long replies are split at Telegram's 4096 UTF-16-unit limit without cutting a surrogate pair. Every chunk keeps `message_thread_id`, while only the first quotes the triggering message through `reply_parameters`; `setMessageReaction` provides the configured acknowledgement reaction. The official auto-retry transformer retries API rate limits and server failures at most three times with a 30-second delay cap. Network `HttpError`s are rethrown immediately because plugin 2.0.2 otherwise retries them in an unbounded inner loop; final failures reject through channel-core;
- **credentials**: `botToken` enters via Config, no secret is stored privately; wiring into `ctx.credentials` is left for the real-e2e wrap-up.
- **polling lifecycle**: the adapter holds no offset state. Disposal cancels the Harness retry timer, awaits `bot.stop()`, and then awaits the saved `bot.start()` task, which is grammY's middleware-drain barrier. A transient exited task restarts with capped exponential backoff; a 401 marks receive capability unavailable instead of retrying a bad token forever.

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
- **cross-chat polling concurrency**: grammY's simple polling awaits middleware sequentially, so a slow model turn delays later updates even when channel-core could run another conversation concurrently. Switching to `@grammyjs/runner` is deliberately coupled to a durable ingress queue: runner advances fetch offsets ahead of concurrent middleware, which would otherwise turn a crash into silent update loss.
- **crash/delivery idempotency**: there is not yet a durable provider `messageId` inbox or outbound outbox. A crash around Telegram offset confirmation can replay a turn, and a reply whose bounded provider retries are exhausted can be lost after the session already records the assistant answer.
