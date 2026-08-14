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
   - Outbound delivery: agent reply → push to the corresponding channel (including channel-feature mapping such as message grouping/references).
2. **Channel plugins implement only the adapter**: the two capability surfaces `receive` (inbound events) and `send` (outbound delivery); routing, session binding, and retry policy all belong to `channel-core`.
3. **The contract inherits dsh invariants**: every inbound message and outbound reply must be written into the session log ("model-visible means logged"), otherwise it must not reach the model.
4. **Long-lived own seam**: `ctx.channels` is kept long-term as ClawDSH's own seam and **no upstream PR is proposed** (initiator's 2026-08-14 decision — fast development first, upstream has no time to respond). `channel-core` is this seam's implementation, not treated as a temporary patch; if upstream later builds an equivalent capability, reevaluate whether to keep it, and record the difference back into this ADR.

## Contract (finalized at stage 2)

```ts
// channel-core/src/types.ts（仅类型，无运行时代码）
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

**Finalized event names**: `channel/inbound` (inbound, adapter → core), `channel/outbound` (outbound, after core delivers the reply).

**Inbound path**: adapter `start()` receives a platform message → `ctx.emit('channel/inbound', msg)` → `channel-core` listens → routes to a per-thread agent session (`ctx.agents.create` + `followup` + `whenIdle` + `sessions.flush`) → scans `assistant/message` to read the reply → `adapter.send(outMsg)` + `emit('channel/outbound', outMsg)`. Per-thread sessions are reused by the `${channel}\0${threadId ?? ''}` key; inbound turns are serialized via a per-thread tail-chain to avoid concurrent interleaving.

**Minimal surface**: attachments/references/rich text/interactive cards are all deferred (stage 3 channel expansion).

## Consequences

- ✅ All channels share the same routing/session/log semantics; the cost of a new channel = one adapter package;
- ⚠️ If upstream does not accept this seam, the local divergence surface +1, requiring continuous tracking of upstream session/channel-related evolution to avoid collision;
- ⚠️ Channel feature differences (such as Telegram's reply references and Feishu's interactive cards) may erode the unified contract; the Spike must validate with 2 sufficiently different channels. **The alternative channel is finalized as Feishu (Lark)** (2026-08-14): the initiator's first priority + OpenClaw upstream has provenance (`extensions/feishu`, since v2026.2.12), different enough from Telegram in identity model/event push/rich text.

## Alternatives

- **Each channel connects directly to `ctx.sessions` (rejected)**: routing/binding logic would be duplicated in each channel, repeating OpenClaw's mistakes.
- **External gateway process (sidecar) against dsh API (deferred)**: more decoupled but introduces cross-process state and deployment complexity; reevaluate as a federation/multi-machine form after stage 3.

## Conclusion (stage 2 validation, 2026-08-14)

The `ctx.channels` contract has been validated by two adapters with sufficiently different forms — **Telegram (grammY `Bot` long polling)** and **Feishu (`@larksuiteoapi/node-sdk` long connection + `im.message.create`)**: both implement only the `ChannelAdapter` contract (each wraps its protocol with the official SDK, see §8 porting principles), while routing/session binding/reply delivery is uniformly carried by `channel-core`, with no channel-specific special-casing in the core. Contract tests (MockAdapter validating the "inbound → real agent turn → reply out" closed loop) + full typecheck + `--dump-config` smoke are all green. Real e2e (real key + real bot) is left as a finishing item once credentials are in place. The internal design record of the seam contract and assembly semantics is `docs/upstream-proposal/ctx-channels.md` (no longer a pending PR).
