# @clawdsh/dsh-channel-feishu

English | [中文](README.zh.md)

**Purpose**: Feishu (Lark) channel adapter — a thin `ctx.channels` bridge over the official `@larksuiteoapi/node-sdk` 1.73 high-level `LarkChannel`. **The initiator's first-priority channel** (established 2026-08-14).

**OpenClaw correspondence**: ✅ upstream's official `extensions/feishu`, shipped since v2026.2.12. ClawDSH delegates the platform machinery to the SDK's own channel component instead of copying that machinery into this package.

**Seam**: `ctx.channels` (@clawdsh/dsh-channel-core, ADR-0002). Complements Telegram's (polling) form, jointly validating the seam.

**Specification**: docs/specs/roadmap.md (stage 2 deliverable) · **Status**: implemented

## Design notes

- **SDK-owned platform layer**: `createLarkChannel` owns bot `open_id` discovery before accepting traffic, WebSocket reconnect, stale-event rejection, TTL de-duplication, in-flight locks, structured mention removal, rich-message normalization, token refresh, ordinary outbound chunking/retry, reply fallback, and reactions;
- **thin translation**: the adapter maps `NormalizedMessage` to `ChannelMessage` (`conversationId` = group `chatId` or p2p sender id, optional `threadId`, structured `mention`, and SDK-rendered text). Because the SDK policy enables `respondToMentionAll`, a broadcast mention is normalized as an accepted bot mention for channel-core's group gate too. The callback awaits `ctx.parallel('channel/inbound', inbound)` through the FIFO turn, `sessions.flush`, outbound send, and ack settlement. SDK 1.73's queue-disabled safety dispatcher launches that callback asynchronously, so the WebSocket ingress acknowledgement itself is not a durability barrier;
- **no cross-topic batching**: SDK `chatQueue` batching is disabled because its scope is the chat id while Harness sessions additionally separate Feishu topics. Mention policy is also disabled in the SDK and owned centrally by channel-core;
- **pre-WebSocket identity retry**: the SDK still owns reconnect once a WebSocket client exists. Only transient failures while discovering bot identity before the WebSocket are retried by the adapter through the Harness timer, with exponential backoff from 1 to 30 seconds; permanent SDK errors fail without a retry loop;
- **topic-safe outbound**: SDK 1.73 normally splits text at 3500 UTF-16 units, but applies `replyTo` only to its first chunk, which can move later chunks out of a topic. For a topic reply, the adapter pre-splits without cutting surrogate pairs and calls `LarkChannel.send` for every chunk with the same `replyTo`/`replyInThread`; all authentication, retry, and vanished-target fallback still remain in the SDK. Other sends use the SDK's own chunking directly. Reactions continue through SDK `addReaction`: a small explicit table maps common portable ack emoji to Feishu named reactions, while any unknown identity emoji degrades stably to `EYES` instead of failing every ack;
- **drain and failed-handshake cleanup**: disposal first unsubscribes ingress and waits every adapter-tracked message callback before disconnecting. SDK 1.73's public `disconnect()` returns early if a connection never reached `connected=true`. On that path only, disposal force-closes `rawWsClient`, drains the SDK safety timers, then calls the public disconnect; successful connections stay entirely on the public lifecycle;
- **credentials**: `appId`/`appSecret` enter via Config, no secret is stored privately; wiring into `ctx.credentials` is left for the real-e2e wrap-up.
- **long connection instead of webhook**: no `verificationToken`/`encryptKey`, no inbound HTTP port, no URL-verification challenge (these are only needed in webhook mode; the long connection performs auth via the SDK). `domain` selects Feishu (default) or international Lark.

## Model Experience

### Inbound message text

#### What the model sees

The SDK converts text, post, image/file/audio/video/sticker/card/share/location/calendar and other supported Feishu message shapes into stable normalized text; this adapter relays that text as `channel/inbound` to channel-core. The adapter registers no prompt or tool schema of its own.

#### Token effect

Only the relayed message text reaches the model, through channel-core's durable session write.

#### KV Cache effect

Append-only through channel-core's user-message write.

## Known Limitations and Deferred Work

- **binary attachments**: the SDK recognizes and textifies resource messages, but the shared `ChannelMessage` contract does not yet download their bytes into Harness `ctx.attachments`; the model sees the SDK's resource marker rather than image/file bytes.
- **interactive actions**: inbound card-action/comment/reaction events and outbound streaming cards are supported by `LarkChannel` but are not yet projected onto the text-only `ctx.channels` contract.
- **credentialed e2e**: keyless tests cover normalized mapping, awaited inbound, pre-WebSocket backoff, failed-handshake cleanup, Unicode-safe topic chunking, native replies, and reactions. Live app permissions, event subscriptions, and WebSocket behavior still require a Feishu/Lark deployment.
- **async readiness**: adapter disposal is asynchronous and drains connection cleanup, but `start` still has no ready promise; SDK identity/handshake failures are logged asynchronously rather than rejecting daemon boot.
- **SDK ingress acknowledgement**: SDK 1.73 marks an accepted event seen after its callback settles even when that callback ultimately fails. SDK outbound retry handles transient sends, but there is no durable ingress/outbox replay after a final failure.
- **SDK 1.73 compatibility shim**: failed-handshake cleanup must reach the SDK's `rawWsClient` and safety component because the public lifecycle is incomplete on that path. Revalidate or remove this narrow shim when upgrading the Lark SDK.
