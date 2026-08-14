# ADR-0002: Channel gateway seam (`ctx.channels`) — ClawDSH's only newly added seam

English | [中文](0002-channel-seam.zh.md)

- **Status**: Accepted (stage 2 dual-channel validation passed, 2026-08-14)
- **Date**: 2026-08-14
- **Depends on**: ADR-0001

## Context

OpenClaw's core value is "a personal assistant living inside messaging channels" (WhatsApp/Telegram/Email/Web Chat…), whereas dsh is a coding-agent form: it has `ctx.sessions` (append-only log), `ctx.tools`, `ctx.llm` and other seams, but **no messaging-channel concept**. To port OpenClaw onto dsh, channel access is the only seam that must be newly added — every other functional domain can hang off existing seams (see `docs/matrix/parity.md`).

Adding a seam is the highest-cost change. The project's early-stage discipline originally planned upstream-first (propose an upstream PR first, transition via a local patch), but the initiator decided on 2026-08-14 to **skip the upstream PR and move fast** — `ctx.channels` lands directly as ClawDSH's own seam (decision below). Upstream `packages/`/`vendor/` and other files remain read-only; this seam lives only under `packages/openclaw/`.

## Decision

1. **Add a `ctx.channels` service**, with responsibilities:
   - Channel adapter registry: each channel plugin registers a `ChannelAdapter`;
   - Inbound routing: channel message → locate/create an agent session → write to the session log → drive the agent loop;
   - Outbound delivery: agent reply → push to the corresponding channel with normalized quote/topic metadata.
2. **Channel plugins implement only the adapter**: the capability surfaces are `receive` (inbound events), `send` (outbound delivery), and optional `react`. Routing, session binding, group/ack policy, and turn serialization belong to `channel-core`; provider transport retry remains with the adapter and its official SDK.
3. **The contract inherits dsh invariants**: every inbound message and outbound reply must be written into the session log ("model-visible means logged"), otherwise it must not reach the model.
4. **Long-lived own seam**: `ctx.channels` is kept long-term as ClawDSH's own seam and **no upstream PR is proposed** (initiator's 2026-08-14 decision — fast development first, upstream has no time to respond). `channel-core` is this seam's implementation, not treated as a temporary patch; if upstream later builds an equivalent capability, reevaluate whether to keep it, and record the difference back into this ADR.

## Contract (finalized at stage 2)

```ts
// channel-core/src/types.ts（仅类型，无运行时代码）
import type { Context } from '@deepseek-ai/cordis'

export interface ChannelCapabilities { receive: boolean; send: boolean; react: boolean }

export interface ChannelMessage {
  channel: string                    // 适配器 id，如 'telegram' | 'feishu'
  direction: 'in' | 'out'
  conversationId?: string            // 平台会话/发送目标
  threadId?: string                  // 会话内可选 topic/thread
  sender?: string                    // 发送者身份（open_id / from.id）
  messageId?: string
  replyToMessageId?: string
  chatType?: 'direct' | 'group'
  mention?: { detectable: boolean; botMentioned: boolean }
  text: string
}

export interface ChannelAdapter {
  id: string
  capabilities: ChannelCapabilities
  start(ctx: Context): () => void | Promise<void> // subscribe; return a drain-aware disposer
  send(msg: ChannelMessage): Promise<void>  // 出站投递
  react?(msg: ChannelMessage, emoji: string): Promise<void>
}
```

**Finalized event names**: `channel/inbound` (parallel inbound, adapter → core), `channel/outbound` (emit-only outbound, after core delivers the reply). New adapters must await `ctx.parallel('channel/inbound', msg)`; the listener remains compatible with legacy `ctx.emit` producers, but those producers cannot observe completion.

**Inbound path**: adapter `start()` receives and structurally normalizes a platform message → `await ctx.parallel('channel/inbound', msg)` → `channel-core` applies group/ack policy → derives an opaque deterministic session id from `(channel, conversationId, threadId)` → resumes or creates through Harness persistence/agent/preset services → `followup` + `whenIdle` + `sessions.flush` → `adapter.send(outMsg)` + `emit('channel/outbound', outMsg)`. The returned parallel promise spans the durability checkpoint and delivery and rejects on failure; an absorbed internal tail preserves later FIFO turns. Adapter teardown drains provider middleware and core teardown drains admitted turns before Agent disposal. First creation is single-flighted; the Harness timer releases idle live handles without deleting durable history.

**Address compatibility**: `conversationId` is the platform conversation/send target and `threadId` is an optional topic inside it. A legacy adapter that supplies only `threadId` is still accepted: core treats it as the conversation id and mirrors it back in outbound `threadId`. This source compatibility does not migrate old persisted sessions whose random ids never recorded a platform address.

**Current surface**: structured mentions and bot-addressed Telegram commands, acknowledgement reactions, native quoted replies/topics, captions, Unicode-safe provider-limit chunking, and provider-normalized rich text are implemented. Telegram uses grammY's official bounded auto-retry. Binary attachment bytes, interactive card/action events, and a durable provider outbox remain outside the text-first contract. Feishu SDK 1.73's queue-disabled dispatcher starts its awaited callback asynchronously and marks a failed callback seen, so its WebSocket ingress acknowledgement is not itself a durability barrier.

## Consequences

- ✅ All channels share the same routing/session/log semantics; the cost of a new channel = one adapter package;
- ⚠️ If upstream does not accept this seam, the local divergence surface +1, requiring continuous tracking of upstream session/channel-related evolution to avoid collision;
- ⚠️ Channel feature differences (such as Telegram's reply references and Feishu's interactive cards) may erode the unified contract; the Spike must validate with 2 sufficiently different channels. **The alternative channel is finalized as Feishu (Lark)** (2026-08-14): the initiator's first priority + OpenClaw upstream has provenance (`extensions/feishu`, since v2026.2.12), different enough from Telegram in identity model/event push/rich text.

## Alternatives

- **Each channel connects directly to `ctx.sessions` (rejected)**: routing/binding logic would be duplicated in each channel, repeating OpenClaw's mistakes.
- **External gateway process (sidecar) against dsh API (deferred)**: more decoupled but introduces cross-process state and deployment complexity; reevaluate as a federation/multi-machine form after stage 3.

## Conclusion (stage 2 validation, 2026-08-14)

The `ctx.channels` contract has been validated by **Telegram (grammY long polling)** and **Feishu (official SDK 1.73 `LarkChannel` WebSocket)**. The core contains no provider branch: Harness owns sessions, persistence, model selection, preset/Soul composition and timer lifecycle; adapters own protocol normalization and SDK delivery. Keyless contract tests cover failure propagation, shutdown drain, restart resume, concurrent admission, legacy thread-only input, commands/mentions, Unicode-safe replies/topics, reactions, Telegram bounded API retry, Feishu pre-WebSocket identity backoff and failed-handshake cleanup; live provider permissions remain a credentialed deployment check. The internal seam record is `docs/upstream-proposal/ctx-channels.md` (not a pending PR).
