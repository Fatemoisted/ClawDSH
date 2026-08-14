# Agent Note: Ack-reaction scope gating and per-channel mention detection

Status: implemented

English | [中文](2026-08-14-ack-reaction-scope.zh.md)

## Problem

The channel-identity-presentation note shipped `ackReaction`/`deriveMentionPatterns` but left two gaps it flagged as deferred: (1) the ack was **always-on** — every inbound with a platform `message_id` got the emoji, because OpenClaw's `ackReactionScope` gate needs group-chat mention detection that did not exist; (2) `deriveMentionPatterns` had **no consumer**. Feishu also still declared `react: false` because its `im.message.reaction.create` node-sdk surface was unverified.

## Decision

**Close all three in one pass, porting OpenClaw v2026.1.15 `shouldAckReaction` verbatim** (`src/agents/identity.ts`/`bot-message-context.ts`):

- channel-core `presentation.ts` gains `AckReactionScope = 'all' | 'direct' | 'group-all' | 'group-mentions'` (default `group-mentions`) and `shouldAckReaction(scope, isGroup, requireMention, canDetectMention, wasMentioned)`: `all`/`direct`/`group-all` are unconditional; `group-mentions` acks groups only when `requireMention` is on, detection is possible, and the bot was mentioned — `canDetectMention: false` fails open (no ack, never a blocked message).
- `resolveAckReaction` is corrected: an explicit `''` now **disables** acks (was: fell through to the emoji fallback); the z default moves from `''` to `DEFAULT_ACK_REACTION` (`👀`) so "unset" no longer collapses into "disabled".
- `ChannelMessage` gains `isGroup?` / `wasMentioned?`. Field **presence** is the detection-capability signal: an adapter that cannot evaluate mentions omits `wasMentioned`, and the gate fails open.
- Telegram `detectBotMention` (the bot's real username against `mention` entities and the `@username` text, plus identity patterns) and Feishu's mention mapping (match `mentions[].name` against identity patterns) become the consumers; both adapters register through channel-core's `registerChannelAdapter` (the single place that reads `getPresentation()` → `deriveMentionPatterns`, replacing the per-adapter copy-paste). Telegram reads the username from `bot.botInfo?.username` (grammY populates it after `init()`).
- Feishu implements `react` via `client.im.messageReaction.create({ path:{message_id}, data:{reaction_type:{emoji_type}} })`, throws on `code !== 0`, and sets `capabilities.react: true`.

Deferred in the note (documented in channel-core README): `shouldBypassMention` (needs a command concept) and `removeAckAfterReply` (needs a list-then-delete reaction round-trip).

## Alternatives considered

**Keep the ack always-on.** Rejected: the `group-mentions` default is OpenClaw's behavior, and spamming every direct message with an ack is the exact papercut the scope gate exists to avoid.

**Resolve the bot's Feishu open_id for mention detection.** Deferred: matching `mentions[].name` against identity patterns covers the common case with zero extra API calls; the name-agnostic open_id match needs an extra round-trip and is a documented Known Limitation.

**`removeAckAfterReply` via Feishu list-then-delete.** Deferred: a delete-after-reply seam is asymmetric (Telegram has no equivalent delete) and not worth the list round-trip for this cut.

**Drive mention detection from a shared service.** Rejected: `deriveMentionPatterns` is a pure function over the presentation config; each adapter consumes it locally through `getPresentation()`, which is the single entry point.

## Consequences

- The channel-core README's "ack scope is always-on" and "`deriveMentionPatterns` has no consumer" limitations are removed; the control-command bypass and remove-after-reply remain as the sole ack-scope deferred items.
- Feishu's `react: false` Known Limitation is removed; `capabilities.react: true` is now the adapter template alongside Telegram.
- The openclaw preset's channel-core row carries `ackReactionScope: group-mentions` + `requireMention: true` explicitly.
- The `wasMentioned` field-presence contract is written into `ChannelMessage` JSDoc; any future adapter must honor it (omit → fail open).
- Tests: `presentation.spec` (table-driven `shouldAckReaction` + `''` disables), `channel-core.spec` (ack gating across scopes), and adapter specs (`detectBotMention`, Feishu mention mapping and `react` payload).
