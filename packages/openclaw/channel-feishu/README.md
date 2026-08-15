# @clawdsh/dsh-channel-feishu

English | [中文](README.zh.md)

**Purpose**: legacy Feishu (Lark) adapter over `ctx.legacyChannels`, using the official `@larksuiteoapi/node-sdk` for WebSocket inbound and `im.message.create` outbound. It remains only until credentialed OpenClaw sidecar live cutover.

**OpenClaw correspondence**: ✅ upstream's official `extensions/feishu` — introduced 2026-02-03 (commit `2483f26c23` "Channels: add Feishu/Lark support" → `0223416c61` "finish Feishu/Lark integration"), shipped since v2026.2.12. Use that extension as the functional reference for the port: it likewise uses `@larksuiteoapi/node-sdk`'s long-connection mode (`Lark.Client` + `Lark.WSClient` + `Lark.EventDispatcher` registering `im.message.receive_v1`).

**Seam**: legacy-only `ctx.legacyChannels` (@clawdsh/dsh-channel-core, historical ADR-0002). It has no compatibility alias to the production `ctx.channels` service.

**Specification**: docs/specs/roadmap.md (historical stage 2 deliverable) · **Status**: legacy, disabled by default, pending decommission; sidecar live cutover is not yet claimed

## Design notes

- **inbound**: `Lark.EventDispatcher` registers `im.message.receive_v1`, `Lark.WSClient` starts the long connection (the SDK performs auth and ACK internally, at-least-once delivery); idempotent dedup by `message_id`; text message → `channel/inbound` (group `threadId` = chat_id, p2p/private = sender open_id, `sender` = open_id, text decoded from the `content` JSON string `{"text":"…"}`). `isGroup` comes from `chat_type === 'group'`; `wasMentioned` is derived by matching `mentions[].name` against the identity-derived patterns (absent patterns omit the field → fail-open).
- **outbound**: `Lark.Client.im.message.create` (`params.receive_id_type` group = `chat_id`, p2p = `open_id`, `data.receive_id` + `msg_type:'text'` + `content` JSON); `tenant_access_token` is cached and refreshed by the SDK's `tokenManager`, the adapter does not manage it itself.
- **ack reaction**: `Lark.Client.im.messageReaction.create` (`path.message_id` + `data.reaction_type.emoji_type`); a non-zero `code` throws, mirroring `sendMessage`.
- **credentials**: `appId`/`appSecret` enter via Config, no secret is stored privately; wiring into `ctx.credentials` is left for the real-e2e wrap-up.
- **long connection instead of webhook**: no `verificationToken`/`encryptKey`, no inbound HTTP port, no URL-verification challenge (these are only needed in webhook mode; the long connection performs auth via the SDK). `domain` selects Feishu (default) or international Lark.

## Model Experience

### Inbound message text

#### What the model sees

The adapter parses a Feishu `im.message.receive_v1` event (delivered over the SDK's WebSocket long-connection) and emits a `channel/inbound` message; the channel-core router writes that message's `text` into the session log as a user message. The adapter registers no prompt or tool schema of its own.

#### Token effect

Only the relayed message text reaches the model, through channel-core's session write.

#### KV Cache effect

Append-only through channel-core's user-message write.

## Known Limitations and Deferred Work

- **decommission gate**: remove this adapter only after a credentialed Feishu account passes the OpenClaw sidecar live-cutover matrix; unit and contract tests do not satisfy that gate.

- **rich text / interactive cards / attachments**: text messages only; rich-text, interactive cards, images, and `reply_in_thread` quoted replies all belong to stage 3 channel extensions.
- **p2p session thread**: p2p/private uses the sender's `open_id` as the thread id, with `chat_id` as the fallback only when the sender is missing.
- **real e2e**: the assembly test running a real agent turn inside the Loader needs a real key (see the stage 2 summary for the credential list); currently covered by contract tests (protocol mapping + `send` payload + idempotent dedup) + dump-config smoke.
- **dedup set**: `seen` evicts the oldest entry past 10000, so a long-running bot does not grow without bound.
- **send failure throws**: an error is thrown when `im.message.create` returns a non-zero `code`; retry/rate-limit policy deferred to stage 3.
- **mention mapping by display name**: `wasMentioned` matches `mentions[].name` against the identity patterns; resolving the bot's own `open_id` from the mention `id` (and thus a name-agnostic match) needs an extra API round-trip, deferred. A mention whose name does not match any identity pattern reports `wasMentioned: false`.
