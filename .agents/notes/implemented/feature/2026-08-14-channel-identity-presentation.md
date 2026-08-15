# Agent Note: Channel identity presentation in channel-core

Status: implemented

English | [中文](2026-08-14-channel-identity-presentation.zh.md)

## Problem

The parity matrix's soul row carried "channel presentation (IDENTITY, Deferred)": OpenClaw's `identity.{name,theme,emoji}` config is presentation-only (never in the prompt) and drives the ack emoji, the `[Name]` response prefix, and group-chat mention patterns — none of which existed anywhere in dsh's channel stack. channel-core's `driveTurn` sent raw extracted text with no prefix, no ack, no mention handling.

## Decision

**Identity presentation lives in legacy channel-core** (`src/presentation.ts` pure functions + `LegacyChannelRegistry` Config), ported verbatim from OpenClaw v2026.1.15 (`src/agents/identity.ts` + `src/auto-reply/reply/mentions.ts`):

- `resolveAckReaction`: `ackReaction` → `identity.emoji` → `👀`;
- `resolveResponsePrefix`: `'auto'` (default) renders `[name]`, empty without a name; literals pass through;
- `resolveMessagePrefix`: `[name]` or empty;
- `deriveMentionPatterns`: `\b@?<name parts joined by \s+>\b` case-insensitive + the raw emoji as a literal pattern, with OpenClaw's `→\b` normalization; `stripMentions` removes matches.

Wiring: `LegacyChannelRegistry` carries Config (`identity` / `responsePrefix` / `ackReaction`); `driveTurn` prefixes the extracted reply and fires a fire-and-forget ack before the turn; `ChannelMessage.messageId` + `ChannelCapabilities.react` + optional `ChannelAdapter.react(message, emoji)` carry the ack to adapters. Telegram implements `react` via grammY's `setMessageReaction` and captures `message_id` inbound; Feishu captures `message_id` and uses the official SDK's `im.messageReaction.create`. The default-disabled legacy profile row carries `responsePrefix: auto` + `ackReaction: '👀'`. `agent.cordis.yml` is untouched: identity presentation is not prompt content. The later [ack-reaction scope note](2026-08-14-ack-reaction-scope.md) owns group-mention gating and its current adapter consumers.

## Alternatives considered

**Agent-plane identity config (a row per preset).** Rejected: presentation belongs to the channel registry — one deployment identity for every channel, and prompt/identity separation stays exactly where OpenClaw keeps it.

**Adapter-local presentation (each adapter prefixes its own sends).** Rejected: duplicates the prefix logic per channel and bypasses the seam's single render point (`driveTurn`), where reply extraction already lives.

**Full `ackReactionScope` port (group-mentions gating).** Deferred in this increment because it needed group-chat mention detection; the later [ack-reaction scope decision](2026-08-14-ack-reaction-scope.md) delivers it.

**A new identity service seam.** Rejected: a pure-function module over a Config surface covers the whole feature; a `ctx.identity` service would carry no capability beyond it.

## Consequences

- The matrix soul row's `(IDENTITY, Deferred)` is removed; `feature-soul.md`'s mapping line points at this note;
- `deriveMentionPatterns` is consumed by adapter mention detection under the later ack-scope decision;
- Adapter capability `react` is part of the `ChannelAdapter` contract; a new adapter must declare it, and Telegram and Feishu currently implement it;
- The default-disabled legacy group carries identity presentation; deployments override name/emoji without touching the prompt;
- This policy belongs only to legacy `ctx.legacyChannels`; the [test1 rebuild note](../architecture/2026-08-15-test1-channel-plane-rebuild.md) owns its isolation from canonical `ctx.channels`.
