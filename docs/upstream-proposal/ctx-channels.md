# `ctx.channels` seam design record (ClawDSH's own, no upstream PR proposed)

English | [中文](ctx-channels.zh.md)

> This document is the internal design record of the `ctx.channels` messaging-channel seam (lives under `docs/upstream-proposal/`, directory name retained, content no longer a pending PR). The contract has been validated locally with `channel-core` + dual-channel adapters (stage 2, see docs/adr/0002-channel-seam.md). The initiator decided on 2026-08-14 to skip the upstream PR and move fast — this seam is kept long-term as ClawDSH's own capability, and this document only records the contract and assembly semantics.

## Motivation

dsh is a coding-agent form: it has `ctx.sessions`, `ctx.tools`, `ctx.llm`, `ctx.agents` and other seams, but **no "messaging channel" concept**. To land the form "a personal assistant living inside messaging channels" (WhatsApp/Telegram/Email/Feishu…) onto dsh, every channel integrator faces the same set of problems:

1. After a channel message arrives, how to locate/create a per-thread agent session?
2. How to write the message into the session log, drive an agent turn, then retrieve the reply?
3. How to deliver the reply back to the channel?

Without a seam, this "routing + session binding + turn driving + reply delivery" logic would be duplicated in every channel plugin — precisely the malady that makes OpenClaw unmaintainable due to its architecture lacking seams. This proposal adds a single seam: `ctx.channels`.

## Proposed seam

```ts
import type { Context } from '@deepseek-ai/cordis'

export interface ChannelCapabilities { receive: boolean; send: boolean }

export interface ChannelMessage {
  channel: string                    // 适配器 id，如 'telegram' | 'feishu'
  direction: 'in' | 'out'
  threadId?: string                  // 渠道侧会话线索（群 chat_id / p2p open_chat_id / TG chat.id）
  sender?: string                    // 发送者身份（open_id / from.id）
  text: string
}

export interface ChannelAdapter {
  id: string
  capabilities: ChannelCapabilities
  start(ctx: Context): () => void           // 订阅平台事件，emit 'channel/inbound'；返回 disposer
  send(msg: ChannelMessage): Promise<void>  // 出站投递
}
```

- Events: `channel/inbound` (inbound, adapter → core), `channel/outbound` (outbound, after core delivers the reply).
- A `ChannelRegistry extends Service` (`ctx.channels`) holds the adapter registry (ids unique, unregistration rolls back) and provides routing.

## Inbound routing / turn-driving semantics

adapter `start()` receives a platform message → `ctx.emit('channel/inbound', msg)` → `channel-core` listens → routes:

1. Locate/create the per-thread agent session by `${channel}\0${threadId ?? ''}` (`ctx.agents.create` for the first message, reused afterward);
2. `followup(createUserMessage({ text }))` → `await agent.whenIdle()` → `await ctx.sessions.flush(session)`;
3. Scan `assistant/message` text blocks to retrieve the reply → `adapter.send(outMsg)` + `emit('channel/outbound', outMsg)`.

Per-thread inbound turns are serialized via a tail-chain to avoid concurrent interleaving. **Every inbound message and outbound reply goes through the session log** ("model-visible means logged"), covered by `dsh-agent`'s existing invariants.

## Relationship to `ctx.agents` / `ctx.sessions`

- Reuse `ctx.agents.create` to create the session (`agentOptions` taken from `ctx.agentDefaultModel.currentSelection()`), adding no new session lifecycle;
- Reuse `ctx.sessions.flush` to persist, adding no new persistence semantics;
- Routing only keeps the "channel thread ↔ dsh session" binding in an in-memory map, a thin assembly layer that does not change `agent-loop`.

## Why it is a "thin assembly layer"

This seam introduces no channel-feature semantics (attachments/references/rich text/cards all stay out of this layer): `ChannelMessage` carries only `text`, and the remaining channel features are mapped by the adapter itself inside `send`. Routing/session/log/reply-delivery are compositions of dsh's existing capabilities, and `channel-core` only does "assembly + serialization", so the intrusion surface into upstream is minimal, and the cost of adding a channel = one `ChannelAdapter` implementation.

## Local validation status

- `channel-core` + `channel-telegram` (grammY long polling) + `channel-feishu` (official Lark SDK WebSocket) + `channel-discord` (discord.js Gateway/REST) implemented;
- Contract tests (MockAdapter validating the "inbound → real agent turn → reply out" closed loop) + full typecheck + `--dump-config` smoke are all green;
- Feishu has passed real e2e. Discord keyless protocol/lifecycle coverage is complete; its real Gateway e2e remains pending a rotated token installed through the Harness credential seam.
