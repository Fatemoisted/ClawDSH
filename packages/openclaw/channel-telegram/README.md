# @clawdsh/dsh-channel-telegram

English | [中文](README.zh.md)

**Purpose**: legacy Telegram adapter over `ctx.legacyChannels` — a thin `ChannelAdapter` over grammY `Bot`: drain-aware long-polling text/caption and raster-image inbound plus retried native topic/reply/reaction outbound with Unicode-safe 4096-unit chunking.

**OpenClaw correspondence**: the Telegram channel (one of the earliest-stable channels in OpenClaw's support matrix). Upstream `extensions/telegram` likewise wraps grammY components. This adapter uses grammY long polling, official `@grammyjs/auto-retry`, and official `@grammyjs/files`; Harness timer owns bounded outer restart after polling itself exits.

**Seam**: legacy-only `ctx.legacyChannels` (`@clawdsh/dsh-channel-core`), with no alias to the canonical production `ctx.channels` service.

**Specification**: historical stage 2 deliverable · [ADR-0011](../../../docs/adr/0011-deferred-channel-images-and-address-continuity.md) · **Status**: legacy compatibility, disabled by default, pending sidecar cutover

## Design notes

- **inbound**: `Bot.on('message')` accepts `text`, media `caption`, Telegram `photo`, and image documents whose declared MIME type is PNG, JPEG, WebP, or GIF. For a photo it selects Telegram's largest generated size and records it as JPEG. The normalized message carries only ephemeral file metadata until channel-core admits it. Telegram `mention`/`text_mention` UTF-16 entity ranges plus reply-to-bot identity provide structured group gating, and `message_thread_id` remains the Harness topic key. A `bot_command` such as `/help@ClawBot` also counts as an explicit bot target: only the `@ClawBot` suffix is removed, so the model still receives `/help`;
- **group privacy**: Telegram's default Group Privacy Mode is compatible with the adapter's addressed-command, mention, and reply-to-bot paths and is the recommended deployment setting. `channel-core` then applies its own `groupMode` gate. To prove that gate drops unmentioned traffic, the test bot must actually receive ordinary group messages by being an administrator or by disabling privacy mode and re-adding the bot to the group;
- **awaited admission**: the grammY handler awaits `ctx.parallel('channel/inbound', inbound)`, so it remains open through channel-core's FIFO turn, `sessions.flush`, and outbound send instead of acknowledging the update before durability;
- **outbound**: long replies are split at Telegram's 4096 UTF-16-unit limit without cutting a surrogate pair. Every chunk keeps `message_thread_id`, while only the first quotes the triggering message through `reply_parameters`; `setMessageReaction` provides the configured acknowledgement reaction. The official auto-retry transformer retries API rate limits and server failures at most three times with a 30-second delay cap. Network `HttpError`s are rethrown immediately because plugin 2.0.2 otherwise retries them in an unbounded inner loop; final failures reject through channel-core;
- **credentials**: `botTokenEnv` is a Harness credential reference and defaults to `TELEGRAM_BOT_TOKEN`; resolution uses `ctx.credentials` with the Harness launch environment as a compatibility fallback. A literal `botToken` is a programmatic escape hatch and takes precedence. A matching `credentials/updated` event drains the old bot and activates the new credential without restarting the process; literal tokens do not hot-rotate;
- **image import**: channel-core first applies group-mention admission and resolves the selected model through Harness `ctx.llm`. Only a route that declares image input calls this adapter's materializer. The adapter rejects declared per-image/aggregate sizes before I/O, uses official `@grammyjs/files` only to hydrate `getUrl`, then streams bytes with native `fetch` under an abortable `imageDownloadTimeoutMs` deadline without crossing the remaining Harness byte limit. It calls `ctx.attachments.validateImage` for every input before saving any of them through `saveImage`; the session receives only durable attachment references. `imageDownloadTimeoutMs` defaults to 30000 and accepts 1000 through 2147483647. The shipped DeepSeek selection declares text-only input, so it never downloads an image: a caption continues with explicit omitted-image context, while an image-only message receives a fixed notice;
- **chat migration**: `chatIdAliases` maps a current Telegram delivery chat id to the prior stable id used only for Harness session routing. `conversationId` remains the current provider destination, while channel-core derives the durable session from `sessionConversationId`. A migration service message without a matching preconfigured alias adds the new chat to an in-memory pause set and names the required alias/remount. This is a best-effort guard, not automatic migration: Telegram may deliver ordinary new-chat messages before the service update, and a restart loses the pause set. Only a preconfigured alias guarantees that all observed new-id traffic reuses the old durable identity. Conflicting aliases, cycles, and non-integer ids fail configuration;
- **polling lifecycle**: the adapter holds no offset state. Disposal cancels the Harness retry timer, awaits `bot.stop()`, and then awaits the saved `bot.start()` task, which is grammY's middleware-drain barrier. A transient exited task restarts with capped exponential backoff. A permanent 401 disables receive, send, and react because the credential cannot authenticate any Bot API operation; a permanent 409 disables receive only because another process owns polling. Neither condition is retried until operator action.

## Credentialed verification

The 2026-08-15 deployed run verified Bot API authentication through `getMe`; private-chat `/start` and exact replies; memory write plus restart recall, including `memory_get` fallback after `memory_search` reported a missing Ark key; group rejection without a mention, username mentions, replies to the bot, addressed `/help`, and commands addressed to another bot; `web_search`; caption relay and then-current bodyless-media ignore behavior; offline catch-up; Unicode-safe 4096-unit splitting; interrupted-turn recovery; and same-chat FIFO delivery. Image-byte materialization, text-only image handling, migration pause/aliases, credential rotation, forum topics, and acknowledgement reactions were not live passes in that run; their implemented paths have keyless coverage where noted in the cookbook. The reproducible procedure and evidence boundary are in the [cookbook](../../../docs/cookbook/telegram-e2e.md) and [2026-08-15 journal](../../../docs/journal/2026-08-15.md).

## Model Experience

### Inbound text and images

#### What the model sees

The adapter maps Telegram text/caption plus supported photo or image-document metadata to `channel/inbound`; only the bot's structured mention span is removed. Channel-core admits the message, checks the selected model, and writes text plus durable Harness image references only after successful materialization. A text-only route receives the caption with explicit omitted-image context; an image-only message produces a transport notice without a model turn. The adapter registers no prompt or tool schema of its own.

#### Token effect

Relayed text and, on an image-capable route, durable image blocks reach the model through channel-core's session write. The fixed image-only transport notice does not consume model tokens; a caption and its omitted-image context do.

#### KV Cache effect

Append-only through channel-core's user-message write; ephemeral Telegram file ids and bytes never enter the session log.

## Known Limitations and Deferred Work

- **update surface**: polling requests only `message` updates; edited messages, callback queries, and channel posts are outside this adapter.
- **attachment scope**: only Telegram photos and PNG/JPEG/WebP/GIF image documents enter the raster-image path. Audio, video, stickers, arbitrary files, and albums as an atomic multi-message unit remain unsupported. The new image path is keyless-tested but has not yet passed a credentialed real-client run against an image-capable model.
- **delivery mode**: webhook mode is not wired; this package currently owns one grammY long-polling process.
- **cross-chat polling concurrency**: grammY's simple polling awaits middleware sequentially, so a slow model turn delays later updates even when channel-core could run another conversation concurrently. Switching to `@grammyjs/runner` is deliberately coupled to a durable ingress queue: runner advances fetch offsets ahead of concurrent middleware, which would otherwise turn a crash into silent update loss.
- **crash/delivery idempotency**: there is not yet a durable provider `messageId` inbox or outbound outbox. A crash around Telegram offset confirmation can replay a turn, and a reply whose bounded provider retries are exhausted can be lost after the session already records the assistant answer. Multi-chunk sends are not transactional, so a later chunk can fail after earlier chunks have landed.
- **migration ownership**: aliases are deployment state, not an automatically persisted provider ledger. The service-message pause is process-local and begins only after that update is observed; ordinary new-id traffic can arrive first, and restart/remount clears the pause. Preconfigure every known old/current pair before traffic when durable identity continuity is required.
- **live coverage boundary**: keyless tests cover topic propagation and reactions, but the credentialed run has not yet verified a forum topic from a real client or independently observed the reaction path.
