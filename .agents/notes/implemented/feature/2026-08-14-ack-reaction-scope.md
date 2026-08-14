# Agent Note: Ack-reaction scope gating and per-channel mention detection

Status: implemented

English | [中文](2026-08-14-ack-reaction-scope.zh.md)

## Problem

The channel-identity-presentation note shipped `ackReaction`/`deriveMentionPatterns` but left two gaps it flagged as deferred: (1) the ack was **always-on** — every inbound with a platform `message_id` got the emoji, because OpenClaw's `ackReactionScope` gate needs group-chat mention detection that did not exist; (2) `deriveMentionPatterns` had **no consumer**. Feishu also still declared `react: false` because its `im.message.reaction.create` node-sdk surface was unverified.

## Decision

**Close all three in one pass, preserving the OpenClaw v2026.1.15 `shouldAckReaction` semantics** (`src/agents/identity.ts`/`bot-message-context.ts`) inside the integrated channel contract:

- channel-core `presentation.ts` gains `AckReactionScope = 'all' | 'direct' | 'group-all' | 'group-mentions' | 'off' | 'none'` (default `group-mentions`) and `shouldAckReaction(scope, isGroup, mentionRequired, canDetectMention, wasMentioned)`. The compatibility argument `mentionRequired` is retained for OpenClaw call-site parity, while routing policy lives in `groupMode`: `all` acks everything, `direct` only direct chats, `group-all` every group message, `group-mentions` only a group message with a detectable bot mention, and `off`/`none` disable acks. Unknown mention detection fails open (no ack, never a blocked message).
- `resolveAckReaction` is corrected: an explicit `''` now **disables** acks (was: fell through to the emoji fallback). The schema deliberately leaves the field optional, so "unset" follows `identity.emoji` and then `DEFAULT_ACK_REACTION` (`👀`) without collapsing into "disabled".
- `ChannelMessage` gains `chatType: 'direct' | 'group'` plus structured `mention.{detectable,botMentioned}` metadata. Telegram derives it from native entities, replies, and the bot identity; Feishu maps the official SDK's normalized bot/broadcast mention flags. If an adapter omits structured metadata, channel-core falls back to identity-derived mention patterns; an explicit `detectable: false` still fails open.
- Both adapters register through channel-core's `registerChannelAdapter`, keeping lifecycle wiring and identity-pattern provision in one place; channel-core uses the same presentation-derived patterns when structured metadata is absent. Provider-native mention normalization remains in each thin adapter, where the platform's structured data is available.
- Feishu implements `react` via `client.im.messageReaction.create({ path:{message_id}, data:{reaction_type:{emoji_type}} })`, throws on `code !== 0`, and sets `capabilities.react: true`.

Deferred in the note (documented in channel-core README): `shouldBypassMention` (needs a command concept) and `removeAckAfterReply` (needs a list-then-delete reaction round-trip).

## Alternatives considered

**Keep the ack always-on.** Rejected: the `group-mentions` default is OpenClaw's behavior, and spamming every direct message with an ack is the exact papercut the scope gate exists to avoid.

**Resolve the bot's Feishu open_id for mention detection.** Deferred: matching `mentions[].name` against identity patterns covers the common case with zero extra API calls; the name-agnostic open_id match needs an extra round-trip and is a documented Known Limitation.

**`removeAckAfterReply` via Feishu list-then-delete.** Deferred: a delete-after-reply seam is asymmetric (Telegram has no equivalent delete) and not worth the list round-trip for this cut.

**Drive every provider through shared identity regexes.** Rejected: platform-native mention entities are more accurate. The shared seam consumes normalized structured metadata and retains `deriveMentionPatterns` only as the fallback for generic adapters that cannot provide it.

## Consequences

- The channel-core README's "ack scope is always-on" and "`deriveMentionPatterns` has no consumer" limitations are removed; the control-command bypass and remove-after-reply remain as the sole ack-scope deferred items.
- Feishu's `react: false` Known Limitation is removed; `capabilities.react: true` is now the adapter template alongside Telegram.
- The openclaw preset's channel-core row carries `groupMode: mention` plus `ackReactionScope: group-mentions` explicitly.
- The `chatType` and `mention.{detectable,botMentioned}` contract is written into `ChannelMessage` JSDoc; future structured adapters must preserve the distinction between "not mentioned" and "not detectable".
- Tests: `presentation.spec` (table-driven `shouldAckReaction` + `''` disables), `channel-core.spec` (routing and ack gating across scopes), and adapter specs (Telegram entity/reply mapping, Feishu normalized mention mapping, and reaction payloads).
