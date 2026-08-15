# @clawdsh/dsh-channel-feishu

English | [中文](README.zh.md)

**Purpose**: legacy Feishu (Lark) adapter — a thin `ctx.legacyChannels` bridge over the official `@larksuiteoapi/node-sdk` 1.73 high-level `LarkChannel`. **The initiator's first-priority channel** (established 2026-08-14).

**OpenClaw correspondence**: ✅ upstream's official `extensions/feishu`, shipped since v2026.2.12. ClawDSH delegates the platform machinery to the SDK's own channel component instead of copying that machinery into this package.

**Seams**: legacy-only `ctx.legacyChannels` (`@clawdsh/dsh-channel-core`, ADR-0002), Harness credentials / launch environment, and the Harness timer. It has no alias to the canonical production `ctx.channels` service.

**Specification**: docs/specs/roadmap.md (historical stage 2 deliverable) · **Status**: legacy compatibility, disabled by default, pending sidecar cutover; the never-settling handshake timeout below remains open

The tracked configuration carries references, not values:

```yaml
appIdEnv: FEISHU_APP_ID
appSecretEnv: FEISHU_APP_SECRET
domain: feishu
```

## Design notes

- **SDK-owned platform layer**: `createLarkChannel` owns bot `open_id` discovery before accepting traffic, WebSocket reconnect, stale-event rejection, TTL de-duplication, in-flight locks, structured mention removal, rich-message normalization, token refresh, ordinary outbound chunking/retry, reply fallback, and reactions;
- **thin translation**: the adapter maps `NormalizedMessage` to `ChannelMessage` (`conversationId` = group `chatId` or p2p sender id, optional `threadId`, structured `mention`, and SDK-rendered text). Because the SDK policy enables `respondToMentionAll`, a broadcast mention is normalized as an accepted bot mention for channel-core's group gate too. The callback awaits `ctx.parallel('channel/inbound', inbound)` through the FIFO turn, `sessions.flush`, outbound send, and ack settlement. SDK 1.73's queue-disabled safety dispatcher launches that callback asynchronously, so the WebSocket ingress acknowledgement itself is not a durability barrier;
- **no cross-topic batching**: SDK `chatQueue` batching is disabled because its scope is the chat id while Harness sessions additionally separate Feishu topics. Mention policy is also disabled in the SDK and owned centrally by channel-core;
- **pre-WebSocket identity retry**: the SDK still owns reconnect once a WebSocket client exists. Only transient failures while discovering bot identity before the WebSocket are retried by the adapter through the Harness timer, with exponential backoff from 1 to 30 seconds; permanent SDK errors fail without a retry loop;
- **Unicode-safe outbound**: the adapter pre-splits every send at 3500 UTF-16 units without cutting surrogate pairs, then delegates each chunk's authentication, retry, and vanished-target fallback to `LarkChannel.send`. Topic replies carry the same `replyTo`/`replyInThread` on every chunk so later chunks do not leave the topic. Reactions continue through SDK `addReaction`: a small explicit table maps common portable ack emoji to Feishu named reactions, while any unknown identity emoji degrades stably to `EYES` instead of failing every ack;
- **drain and settled failed-handshake cleanup**: disposal first unsubscribes ingress and waits every adapter-tracked message callback before disconnecting. After a connection attempt settles without reaching `connected=true`, disposal force-closes the SDK 1.73 `rawWsClient`, drains its safety timers, then calls the public disconnect; successful connections stay entirely on the public lifecycle. A connection attempt that never settles is the known exception below;
- **Harness-owned credentials**: `appIdEnv` and `appSecretEnv` are credential references, defaulting to `FEISHU_APP_ID` and `FEISHU_APP_SECRET`. Each field resolves independently through `ctx.credentials`; the Harness launch environment is used only when no credentials service is mounted. Existing literal `appId`/`appSecret` configuration remains a programmatic compatibility override and takes precedence, but must never be committed. If either reference is unresolved, no SDK channel is constructed, all capabilities remain unavailable, the lifecycle logs both missing reference names, and attempted sends reject. A matching `credentials/updated` event stops and drains the old SDK channel, resolves the pair again, and starts a fresh channel; literal fields do not hot-rotate;
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
- **interactive actions**: inbound card-action/comment/reaction events and outbound streaming cards are supported by `LarkChannel` but are not yet projected onto the text-only `ctx.legacyChannels` contract.
- **credentialed e2e boundary**: a real Feishu deployment passed authentication, WebSocket ingress, the durable Harness agent turn, SDK outbound delivery, and user-confirmed receipt on 2026-08-14. That run predates the current credential-reference and hot-rotation adapter. Those two paths, plus launch-environment fallback, fail-loud missing credentials, normalized mapping, awaited inbound, pre-WebSocket backoff, rejected-handshake cleanup, Unicode-safe topic chunking, native replies, and reactions have keyless coverage; the credential-reference and rotation paths still need a fresh deployed run.
- **never-settling handshake**: `LarkChannel` is currently created without an SDK handshake timeout, and disposal awaits the active `connect()` promise before closing the socket. A DNS/proxy/NAT path that never settles can therefore hang shutdown or reload; configure the SDK timeout and cover this path before claiming complete failed-handshake cleanup.
- **async readiness**: adapter disposal is asynchronous and drains connection cleanup, but `start` still has no ready promise; SDK identity/handshake failures are logged asynchronously rather than rejecting daemon boot.
- **SDK ingress acknowledgement**: SDK 1.73 marks an accepted event seen after its callback settles even when that callback ultimately fails. SDK outbound retry handles transient sends, but there is no durable ingress/outbox replay after a final failure.
- **SDK 1.73 compatibility shim**: cleanup after a settled failed handshake must reach the SDK's `rawWsClient` and safety component because the public lifecycle is incomplete on that path. Revalidate or remove this narrow shim when upgrading the Lark SDK.
