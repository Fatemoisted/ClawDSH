# @clawdsh/dsh-channel-core

English | [中文](README.zh.md)

**Purpose**: ClawDSH's channel-domain capability seam. It provides the `ctx.channels` service, registers channel adapters (inbound message → agent session, outbound reply → channel push), and owns session-channel binding and routing.

**OpenClaw correspondence**: the message-ingestion layer of the Gateway (the shared skeleton for all channels — WhatsApp/Telegram/Email/Web Chat and so on).

**Seam**: **new** `ctx.channels` (design in docs/adr/0002-channel-seam.md). Upstream dsh has no message-channel concept; this is the project's core increment. Per ADR-0002 it is a long-lived ClawDSH seam, not a temporary upstream patch.

**Specification**: docs/adr/0002-channel-seam.md · **Status**: implemented

## Usage

```yaml
- id: channel-core
  name: '@clawdsh/dsh-channel-core'
  config:
    agentPreset: openclaw       # resolved/mounted by dsh-agent-presets
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
- Agent composition is delegated to Harness `agentPresets.resolve/mount`. The selected preset is recorded in the session header and reused on resume; channel-core does not reimplement Soul, tools, memory, or model setup;
- Concurrent first messages are single-flighted and every conversation/topic has one FIFO turn chain. Adapter disposal drains provider middleware, registry disposal drains admitted turns before releasing Agents, and idle live handles are released through the Harness timer while the durable session remains resumable;
- Each channel plugin (telegram/whatsapp/…) implements only the adapter and does not touch routing logic;
- Group routing reads the normalized `chatType` plus structured `mention.{detectable,botMentioned}` contract. Bundled providers use `registerChannelAdapter` for shared lifecycle wiring; adapters without structured mention metadata can consume its identity-derived patterns as a fallback. The router never strips identity-name text from direct messages;
- Identity presentation (`identity.{name,theme,emoji}`, `responsePrefix`, `ackReaction`, mention patterns) lives here, not in the prompt. The route prefixes the extracted reply and applies OpenClaw's `all`/`direct`/`group-all`/`group-mentions` ack scopes; `off`/`none` disable acks for config compatibility, as does an explicit empty `ackReaction`, while an explicit empty `responsePrefix` disables the prefix.

## Model Experience

### Inbound message text

#### What the model sees

The router validates group mention policy, removes the configured presentation mention when applicable, and turns the accepted `channel/inbound` text into a user message (`followup(createUserMessage({ text }))`) in the conversation/topic session. The agent's reply is read from that same session's `assistant/message` text blocks.

#### Token effect

Inbound text contributes prompt tokens to the per-conversation/topic session and stays in that session's history until compaction.

#### KV Cache effect

Append-only; each inbound turn appends a user message to the reusable request prefix and does not invalidate prior cache entries.

## Known Limitations and Deferred Work

- **credentialed e2e**: keyless tests cover routing, persistence restart, preset mounting, concurrency, mention gating, and ack scopes; live Feishu/Telegram permissions still require deployment credentials.
- **rich channel payloads**: the normalized seam remains text-first. Providers can flatten rich text, but binary attachments, quotes, cards, and Harness `ctx.attachments` ingestion are not yet part of `ChannelMessage`.
- **legacy persisted sessions**: the thread-only message shape is supported at runtime, but pre-migration persisted sessions used random ids and contain no durable platform-address mapping. Those artifacts cannot be auto-associated with the new deterministic ids and remain separately readable.
- **one daemon writer**: FIFO/single-flight is process-local; running multiple daemons against the same bot and persistence root needs an external ownership/lease layer.
- **no durable provider outbox**: adapter/SDK retries cover transient sends and final failures reject and log, but a reply that still fails after those retries is not stored in a separately replayable outbox.
- **ack gate control-command bypass deferred**: OpenClaw's `shouldBypassMention` (control commands ack even without a mention) depends on a command concept the channel seam does not model yet; until then `group-mentions` requires a detected mention. `removeAckAfterReply` (delete the ack once the reply lands) is deferred too — it needs a list-then-delete reaction round-trip that does not warrant an asymmetric seam.
