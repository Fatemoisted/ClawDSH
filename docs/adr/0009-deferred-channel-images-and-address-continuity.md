# ADR-0009: Deferred channel image import and address continuity

English | [中文](0009-deferred-channel-images-and-address-continuity.zh.md)

- **Status**: Accepted (2026-08-15)
- **Date**: 2026-08-15
- **Depends on**: ADR-0002 (channel gateway seam), ADR-0008 (contract-first Harness reuse)

## Context

Channel ingress carries provider-owned data with different lifetimes. A provider image id is a temporary locator, while a Harness attachment reference is durable, validated session input. Downloading an image before group mention admission can spend network and storage on a message that channel policy rejects. Sending image content to a model that does not declare image input can also corrupt a durable session with input that its selected model cannot consume.

Provider conversation addresses can change independently of durable conversation identity. Telegram group-to-supergroup migration replaces the delivery chat id, and migration service messages can race with ordinary messages. Automatically moving or copying a session in response cannot establish which address received every concurrent message.

Telegram polling presents a related durability constraint. Concurrent update handling improves cross-chat throughput only when admitted provider updates are durably recorded before the polling offset can advance past them; the channel seam does not have a durable ingress queue or provider outbox.

## Decision

1. **Provider image descriptors remain ephemeral.** `ChannelMessage.images` contains provider-owned `ChannelImageSource` descriptors, including an opaque file id and declared media metadata. The descriptors, provider file URLs, and downloaded bytes are not appended to the Harness session log. Only a validated `ImageAttachmentRef` may become model-visible durable input.
2. **Channel core owns image admission order.** It first applies the group mention policy, then admits the turn to the stable conversation FIFO, and inside that FIFO resolves `inputModalities` for the thread's exact provider/model selection. It calls `ChannelAdapter.materializeImages` only when that model explicitly declares `image` input.
3. **Adapters import; Harness validates and stores.** The Telegram adapter uses the maintained `@grammyjs/files` integration to retrieve accepted provider files. It enforces the Harness attachment count and byte limits, passes bytes through `ctx.attachments.validateImage` and `ctx.attachments.saveImage`, and returns attachment references to channel core. Channel core appends the user event only after every selected image has materialized successfully.
4. **Text-only routes remain usable without pretending to inspect media.** A caption continues as a text turn with a fixed model-visible image-omission context. A pure-image message receives a fixed transport notice and appends no user turn. Import failure likewise produces a fixed notice rather than partially appending images.
5. **Delivery address and durable identity are separate.** `conversationId` remains the current provider send target, while optional `sessionConversationId` selects the durable session and FIFO identity. Telegram deployments record validated current-to-stable mappings in `chatIdAliases`; conflicting and cyclic mappings are invalid. An observed migration without an alias pauses the current chat in that process and reports the required mapping, but this pause is best-effort and does not replace persisted deployment configuration.
6. **Polling remains awaited until ingress is durable.** Telegram keeps the official long-polling path whose middleware awaits the channel turn. A concurrent runner requires a durable ingress queue and recovery semantics before it can safely advance provider offsets independently of session persistence.

## Consequences

- Mention-rejected or text-only image messages do not cause provider downloads, attachment writes, or unsupported image blocks in the session log.
- Image-capable routes reuse Harness attachment validation, storage, and durable references instead of creating channel-specific binary persistence.
- The adapter may retain provider descriptors only for the lifetime of the inbound turn; retries after process loss begin from provider delivery rather than a session-stored file locator.
- Operators must maintain `chatIdAliases` when Telegram changes a chat id. The in-process migration pause limits accidental session splits after an observed migration but cannot protect a restart or a message that arrived before the migration service update.
- A slow Telegram turn can delay polling work for other chats until a durable ingress queue makes cross-chat concurrency recoverable.

## Alternatives

- **Download in the adapter before channel admission (rejected)**: unmentioned group media and text-only routes would consume provider bandwidth, memory, validation work, and possibly storage before core policy accepts them.
- **Persist provider file ids or URLs in the session (rejected)**: provider locators can expire, require channel credentials, and are not validated model input; persisting them would couple replay to a live transport account.
- **Automatically write migration aliases or copy sessions (rejected)**: migration updates and ordinary messages can arrive in either order, and the adapter has no atomic evidence that makes a session copy or address rewrite complete and race-free.
- **Use a concurrent polling runner without durable ingress (rejected)**: advancing a provider offset before the admitted turn reaches the session durability checkpoint can lose the update on process failure.
