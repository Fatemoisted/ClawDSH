# Agent Note: Channel identity presentation in channel-core

Status: implemented
Archived: 2026-08-16

English | [中文](2026-08-14-channel-identity-presentation.zh.md)

## Problem

The parity matrix's soul row carried "channel presentation (IDENTITY, Deferred)": OpenClaw's `identity.{name,theme,emoji}` config is presentation-only (never in the prompt) and drives the ack emoji, the `[Name]` response prefix, and group-chat mention patterns — none of which existed anywhere in dsh's channel stack. channel-core's `driveTurn` sent raw extracted text with no prefix, no ack, no mention handling.

## Decision

**Identity presentation lives in channel-core** (`src/presentation.ts` pure functions + `ChannelRegistry` Config), ported verbatim from OpenClaw v2026.1.15 (`src/agents/identity.ts` + `src/auto-reply/reply/mentions.ts`):

- `resolveAckReaction`: `ackReaction` → `identity.emoji` → `👀`;
- `resolveResponsePrefix`: `'auto'` (default) renders `[name]`, empty without a name; literals pass through;
- `resolveMessagePrefix`: `[name]` or empty;
- `deriveMentionPatterns`: `\b@?<name parts joined by \s+>\b` case-insensitive + the raw emoji as a literal pattern, with OpenClaw's `→\b` normalization; `stripMentions` removes matches.

Wiring: `ChannelRegistry` gains `static Config` (`identity` / `responsePrefix` / `ackReaction`); `driveTurn` prefixes the extracted reply and fires a fire-and-forget ack before the turn; `ChannelMessage.messageId` + `ChannelCapabilities.react` + optional `ChannelAdapter.react(message, emoji)` carry the ack to adapters. Telegram implements `react` via grammY's `setMessageReaction` and captures `message_id` inbound; Feishu captures `message_id` but declares `react: false` (its `im.message.reaction.create` node-sdk surface is unverified in this workspace — Known Limitation naming the REST path). The `clawdsh` preset's channel-core row carries `responsePrefix: auto` + `ackReaction: '👀'` with a commented identity example. `agent.cordis.yml` is untouched: identity presentation is not prompt content.

## Alternatives considered

**Agent-plane identity config (a row per preset).** Rejected: presentation belongs to the channel registry — one deployment identity for every channel, and prompt/identity separation stays exactly where OpenClaw keeps it.

**Adapter-local presentation (each adapter prefixes its own sends).** Rejected: duplicates the prefix logic per channel and bypasses the seam's single render point (`driveTurn`), where reply extraction already lives.

**Full `ackReactionScope` port (group-mentions gating).** Deferred: needs group-chat mention detection that batch 1 does not have; the always-on ack is the documented interim.

**A new identity service seam.** Rejected: a pure-function module over a Config surface covers the whole feature; a `ctx.identity` service would carry no capability beyond it.

## Consequences

- The matrix soul row's `(IDENTITY, Deferred)` is removed; `feature-soul.md`'s mapping line points at this note;
- `deriveMentionPatterns` ships without an in-request consumer (future owner: ack scope gating and adapter mention detection) — flagged in the PR description per the current-owner rule;
- Adapter capability `react` is part of the `ChannelAdapter` contract; a new adapter must declare it (feishu's `false` is the template);
- The `clawdsh` preset carries an identity presentation block; deployments override name/emoji without touching the prompt.
