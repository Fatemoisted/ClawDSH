# `ctx.channels` seam design record (ClawDSH's own, no upstream PR proposed)

English | [中文](ctx-channels.zh.md)

> This document is the internal design record of the `ctx.channels` messaging-channel seam (lives under `docs/upstream-proposal/`, directory name retained, content no longer a pending PR). The contract has been validated locally with `channel-core` and multiple adapters; [ADR-0002](../adr/0002-channel-seam.md) owns the base seam decision and [ADR-0009](../adr/0009-deferred-channel-images-and-address-continuity.md) owns image/address continuity. The initiator decided on 2026-08-14 to skip the upstream PR and move fast — this seam is kept long-term as ClawDSH's own capability, and this document only records the contract and assembly semantics.

## Motivation

dsh is a coding-agent form: it has `ctx.sessions`, `ctx.tools`, `ctx.llm`, `ctx.agents` and other seams, but **no "messaging channel" concept**. To land the form "a personal assistant living inside messaging channels" (WhatsApp/Telegram/Email/Feishu…) onto dsh, every channel integrator faces the same set of problems:

1. After a channel message arrives, how to locate/create a per-thread agent session?
2. How to write the message into the session log, drive an agent turn, then retrieve the reply?
3. How to deliver the reply back to the channel?

Without a seam, this "routing + session binding + turn driving + reply delivery" logic would be duplicated in every channel plugin — precisely the malady that makes OpenClaw unmaintainable due to its architecture lacking seams. This proposal adds a single seam: `ctx.channels`.

## Proposed seam

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'

export interface ChannelCapabilities { receive: boolean; send: boolean; react: boolean }

export interface ChannelImageSource {
  sourceId: string                 // ephemeral provider file id; never persisted
  mediaType: ImageMediaType
  bytes?: number
  name?: string
}

export interface ChannelMessage {
  channel: string                    // adapter id, e.g. 'telegram' | 'feishu'
  direction: 'in' | 'out'
  conversationId?: string           // current provider delivery destination
  sessionConversationId?: string    // optional stable identity after provider id migration
  threadId?: string                 // optional topic inside the conversation
  sender?: string
  messageId?: string
  replyToMessageId?: string
  chatType?: 'direct' | 'group'
  mention?: { detectable: boolean; botMentioned: boolean }
  text: string
  images?: readonly ChannelImageSource[]
}

export interface ChannelAdapter {
  id: string
  capabilities: ChannelCapabilities
  start(ctx: Context): () => void | Promise<void>
  send(msg: ChannelMessage): Promise<void>
  materializeImages?(msg: ChannelMessage): Promise<readonly ImageAttachmentRef[]>
  react?(msg: ChannelMessage, emoji: string): Promise<void>
}
```

- Events: `channel/inbound` (parallel inbound, adapter → core), `channel/outbound` (outbound, after core delivers the reply).
- A `ChannelRegistry extends Service` (`ctx.channels`) holds the adapter registry (ids unique, unregistration rolls back) and provides routing.

## Inbound routing / turn-driving semantics

adapter `start()` receives a platform message → `await ctx.parallel('channel/inbound', msg)` → `channel-core` listens → routes:

1. Normalize the current `conversationId`/optional `threadId`, apply the structured group-mention policy, and derive an opaque deterministic session id from `channel`, `sessionConversationId ?? conversationId`, and `threadId`. A rejected group message cannot trigger an image download;
2. Resume or create the exact durable session with its recorded Harness agent preset and the current Harness default model selection. A single-flight map owns live handles, while a per-session tail chain serializes admitted turns;
3. When ephemeral image sources are present, ask Harness `ctx.llm.resolveModelInfo` about that exact selection. A text-only route continues a caption with explicit omitted-image context or returns a fixed image-only transport notice. An image-capable route invokes `adapter.materializeImages` inside the FIFO and accepts only durable Harness attachment references;
4. Append one user message containing accepted text/image blocks, wait for the agent to become idle, then `ctx.sessions.flush`; and
5. Scan `assistant/message` text blocks to retrieve the reply → `adapter.send(outMsg)` + `emit('channel/outbound', outMsg)`.

The acknowledgement reaction starts after admission and settles alongside the routed turn without blocking the per-session FIFO. Every fact sent to the model is first represented in the session log. Fixed image-only/import-failure transport notices are deliberately not model input and therefore are not session events.

## Relationship to `ctx.agents` / `ctx.sessions`

- Reuse `ctx.agentDefaultModel`, `ctx.agentPresets`, and `ctx.agents.create/resume` for exact session composition, adding no new agent lifecycle;
- Reuse `ctx.sessionPersistence` plus a deterministic opaque id for restart-safe routing, and reuse `ctx.sessions.flush` without adding persistence semantics;
- Reuse `ctx.llm.resolveModelInfo` for model-owned image capability and Harness attachment references/content blocks for durable model input. A provider adapter may use `ctx.attachments` to validate and save bytes; channel-core does not implement storage;
- The in-memory map owns only live handles, FIFO tails, and idle eviction. It is not the durable channel/session mapping and does not change `agent-loop`.

## Why it is a "thin assembly layer"

The seam owns only provider-neutral routing facts plus ephemeral raster-image descriptors. It never stores provider URLs, file ids, or bytes in a session; an adapter translates its platform data and materializes accepted images only after channel-core's group admission and model-modality check. References, cards, audio/video, files, and other provider-specific payloads remain outside the normalized input. Routing, model capability lookup, attachment references, session logging, and reply delivery compose existing Harness capabilities, so adding a channel still costs one `ChannelAdapter` implementation rather than copied agent/session logic.

## Local validation status

- `channel-core` + `channel-telegram` (grammY long polling) + `channel-feishu` (official Lark SDK WebSocket) + `channel-discord` (discord.js Gateway/REST) implemented;
- Keyless contract tests cover the "inbound → real agent turn → reply out" loop, deterministic resume, mention/FIFO/lifecycle behavior, stable session identity with a changed delivery id, exact-model image-modality checks, and materialization ordering;
- Feishu text has passed real e2e. Telegram direct/group text and caption have passed a credentialed real-client run; its later image-byte path is keyless-tested but not live-tested. Discord keyless protocol/lifecycle coverage is complete; its real Gateway e2e remains pending.
