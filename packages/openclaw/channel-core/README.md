# @clawdsh/dsh-channel-core

English | [中文](README.zh.md)

**Purpose**: the legacy compatibility channel seam. It provides `ctx.legacyChannels` for the pre-sidecar Telegram, Feishu, and Discord adapters while the canonical OpenClaw sidecar owns production messaging through `ctx.channels`.

**OpenClaw correspondence**: a retained local predecessor of Gateway message ingestion. The canonical implementation now lives in `@clawdsh/dsh-channel`, `@clawdsh/dsh-channel-agent`, and `@clawdsh/dsh-channel-openclaw`.

**Seam**: legacy-only `ctx.legacyChannels` (historical design in ADR-0002). This package deliberately exports no `ctx.channels` alias and cannot displace the canonical sidecar Service Definition.

**Specifications**: [ADR-0002](../../../docs/adr/0002-channel-seam.md) · [ADR-0011](../../../docs/adr/0011-deferred-channel-images-and-address-continuity.md) · **Status**: legacy compatibility, disabled by default, pending credentialed sidecar cutover

## Usage

```yaml
- id: channel-core
  name: '@clawdsh/dsh-channel-core'
  config:
    agentPreset: clawdsh        # resolved/mounted by dsh-agent-presets
    groupMode: mention          # mention | always
    ackReactionScope: group-mentions  # all | direct | group-all | group-mentions | off | none
    idleTimeoutMs: 1800000      # Harness timer; 0 disables eviction
    # identity:                 # presentation only; never enters the prompt
    #   name: ClawDSH
    #   emoji: 🐚
    responsePrefix: auto       # 'auto' → [name]; explicit '' disables the prefix
    ackReaction: '👀'          # fallback: identity.emoji → 👀; explicit '' disables ack
```

## Design notes (see ADR-0002)

- A channel = a provider, uniformly implementing `ChannelAdapter`: `receive` (inbound), `send` (outbound), and `react` (optional ack emoji on inbound messages) as the capability kinds;
- Provider callbacks `await ctx.parallel('channel/inbound', message)`. The returned promise covers admission, the FIFO agent turn, `sessions.flush`, outbound delivery, and settlement of the concurrently started ack reaction; ack failures only warn, while a failed turn rejects to the adapter and an absorbed internal tail keeps the next message runnable. The listener still accepts legacy `ctx.emit` producers, but `emit` itself cannot provide completion backpressure;
- Inbound messages first go through dsh's session mechanism (append-only log), then enter the agent loop — the "model-visible means logged" invariant is inherited naturally;
- A provider conversation/topic maps to a deterministic opaque `channel:v1:<sha256>` session id. The router uses Harness `sessionPersistence` plus `agents.resume/create`, so the same channel history resumes after a daemon restart;
- The current address contract separates `conversationId` from optional `threadId`. For source compatibility, a legacy adapter that sends only `threadId` is treated as one conversation and receives the same value back in the outbound `threadId`; new adapters must use the structured two-field shape;
- Optional `sessionConversationId` affects only durable session and FIFO-key derivation; outbound delivery keeps the provider's actual `conversationId`. This lets an adapter preserve one durable identity across a provider-side chat-id migration without sending replies to the retired id;
- Optional `images` carry provider-owned file metadata only. They are ephemeral routing input: provider file ids, URLs, and bytes never enter the durable session log. After group-mention admission, channel-core resolves the exact selected model through Harness `ctx.llm`; only an image-capable route may invoke the adapter's `materializeImages` hook inside that chat's FIFO. The hook returns durable Harness `ImageAttachmentRef`s, so the accepted user event contains attachment references rather than provider data;
- A route that does not declare image input never materializes or downloads an image. A non-empty caption continues as a text turn with an explicit model-visible omission note; an image-only message receives a fixed transport notice and creates no model turn. Import failure likewise returns a fixed notice without appending a partial user event;
- Agent composition is delegated to Harness `agentPresets.resolve/mount`. The selected preset is recorded in the session header and reused on resume; channel-core does not reimplement Soul, tools, memory, or model setup;
- Concurrent first messages are single-flighted and every conversation/topic has one FIFO turn chain. Adapter disposal drains provider middleware, registry disposal drains admitted turns before releasing Agents, and idle live handles are released through the Harness timer while the durable session remains resumable;
- Each channel plugin (telegram/whatsapp/…) implements only the adapter and does not touch routing logic;
- Group routing reads the normalized `chatType` plus structured `mention.{detectable,botMentioned}` contract. Bundled providers use `registerLegacyChannelAdapter` for shared lifecycle wiring; adapters without structured mention metadata can consume its identity-derived patterns as a fallback. The router never strips identity-name text from direct messages;
- Identity presentation (`identity.{name,theme,emoji}`, `responsePrefix`, `ackReaction`, mention patterns) lives here, not in the prompt. The route prefixes the extracted reply and applies OpenClaw's `all`/`direct`/`group-all`/`group-mentions` ack scopes; `off`/`none` disable acks for config compatibility, as does an explicit empty `ackReaction`, while an explicit empty `responsePrefix` disables the prefix.

## Model Experience

### Inbound message text and images

#### What the model sees

The router validates group mention policy, removes the configured presentation mention when applicable, and appends the accepted text as a user message in the conversation/topic session. On an image-capable model route, successfully materialized images are appended in the same user message as durable Harness image blocks. On a text-only route, a caption remains model input with an explicit statement that the image was omitted; an image-only message never reaches the model. The agent's reply is read from that same session's `assistant/message` text blocks.

#### Token effect

Inbound text and the attachment metadata exposed to an image-capable model contribute to the per-conversation/topic history until compaction. The fixed image-only and import-failure transport notices are not model input and consume no model tokens.

#### KV Cache effect

Append-only; every accepted text/image turn appends one user message to the reusable request prefix and does not mutate prior entries.

## Known Limitations and Deferred Work

- **decommission gate**: remove this registry and its adapters only after equivalent credentialed Telegram, Feishu, and Discord traffic passes through the canonical OpenClaw sidecar. Unit coverage and the historical direct-adapter E2E do not satisfy that gate.
- **credentialed e2e**: keyless tests cover routing, persistence restart, preset mounting, concurrency, group-mention policy, ack scopes, model-modality checks, and image materialization ordering. Credentialed deployments have closed the Feishu text path and the Telegram direct/group text/caption paths, including deterministic restart recovery, interrupted-turn recovery, and same-chat FIFO. Telegram image-byte import is keyless-tested but has not yet passed a real-client/model run. Provider-specific live-coverage boundaries remain in the adapter READMEs.
- **rich channel payloads**: the normalized seam supports text plus ephemeral raster-image sources that adapters can materialize into Harness attachments. Quotes, cards, audio, video, files, and provider-specific rich text remain outside the normalized input contract.
- **legacy persisted sessions**: the thread-only message shape is supported at runtime, but pre-migration persisted sessions used random ids and contain no durable platform-address mapping. Those artifacts cannot be auto-associated with the new deterministic ids and remain separately readable.
- **one daemon writer**: FIFO/single-flight is process-local; running multiple daemons against the same bot and persistence root needs an external ownership/lease layer.
- **no durable provider outbox**: adapter/SDK retries cover transient sends and final failures reject and log, but a reply that still fails after those retries is not stored in a separately replayable outbox.
- **ack gate control-command bypass deferred**: OpenClaw's `shouldBypassMention` (control commands ack even without a mention) depends on a command concept the channel seam does not model yet; until then `group-mentions` requires a detected mention. `removeAckAfterReply` (delete the ack once the reply lands) is deferred too — it needs a list-then-delete reaction round-trip that does not warrant an asymmetric seam.
