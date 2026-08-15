# Feature specification: retained legacy Discord adapter

English | [中文](feature-channel-discord.zh.md)

- **Status**: implemented compatibility package; keyless verification only; credentialed live-server E2E not completed
- **Implementation package**: `packages/openclaw/channel-discord` (`@clawdsh/dsh-channel-discord`)
- **OpenClaw reference used by the historical implementation**: `src/discord/` in v2026.1.5
- **Compatibility seam**: `ctx.legacyChannels`, Harness credentials / launch environment, Harness timer, Cordis lifecycle
- **Provider library**: discord.js 14.x
- **Current replacement**: the locked OpenClaw Gateway sidecar in [ADR-0008](../adr/0008-openclaw-channel-plane.md)

## Scope and decision

Discord was implemented as a provider-only adapter over the earlier `ChannelAdapter` contract. It did not port OpenClaw's Agent loop, Session ownership, gateway facade, retry framework, or permission model. Harness and the retained legacy core own those responsibilities:

| Concern | Owner |
|---|---|
| Conversation/topic Session, FIFO turn, `groupMode`, presets, model run, Session flush, outbound event, acknowledgement policy | `@clawdsh/dsh-channel-core` |
| Bot-token lookup and hot rotation | Harness `ctx.credentials`, with launch-environment fallback |
| Initial-login backoff and teardown scope | Harness timer and Cordis lifecycle |
| Gateway heartbeat/reconnect and REST rate-limit handling | discord.js |
| Discord normalization, channel/thread sends, native replies, reactions | `@clawdsh/dsh-channel-discord` |

ADR-0008 now makes the locked OpenClaw Gateway the canonical communication-plane owner. This package remains only for migration and compatibility verification under `ctx.legacyChannels`. New Discord functionality belongs to the sidecar; keyless or future live results from this package cannot certify the sidecar.

## Goals

- Receive user text from Discord DMs, guild text channels, and concrete thread channels through Gateway `MessageCreate`.
- Normalize provider addresses and structured mention state into the legacy `ChannelMessage` without display-text heuristics.
- Deliver assistant text to the correct channel/thread, preserve one native reply reference, and provide acknowledgement reactions.
- Use Harness credential references by default; keep secrets out of repository configuration and logs.
- Drain every admitted Harness turn before closing the provider client.

## Non-goals

- Binary attachment ingestion, embeds as model input, stickers, polls, voice, stage channels, or screen sharing;
- slash commands, autocomplete, context menus, buttons, selects, modals, or other Discord interactions;
- webhook delivery, multi-process/sharded ownership, a durable provider inbox/outbox, or exactly-once delivery;
- sending directly to a forum parent; a concrete forum thread is a valid target;
- replacing discord.js Gateway reconnect or REST rate-limit behavior with custom code;
- expanding the legacy surface or establishing current sidecar support.

## Profile activation and credentials

The package is nested under the default-disabled `clawdsh-legacy-channel-plane` group and has its own default-disabled entry. Compatibility testing requires both legacy switches and must leave OpenClaw Gateway disabled in ClawDSH Settings:

```bash
export CLAWDSH_LEGACY_CHANNELS_ENABLED=1
export CLAWDSH_LEGACY_DISCORD_ENABLED=1
export DISCORD_BOT_TOKEN='<new token>'
```

If canonical enablement is requested while legacy opt-in is present, Gateway startup or Settings preflight rejects the configuration. Never run this adapter and any other Discord consumer with the same bot token.

```ts
interface Config {
  botToken?: string
  botTokenEnv?: string // default: DISCORD_BOT_TOKEN
  messageContentIntent?: boolean // default: false
}
```

`botTokenEnv` is a Harness credential reference, not the token itself. It is resolved only when a Gateway connection opens. `ctx.credentials` is preferred; the Harness launch environment is a compatibility fallback. A matching `credentials/updated` event drains and replaces the client without a process restart. The literal `botToken` field exists only for programmatic composition and must not appear in tracked configuration.

No resolved token may be logged. Error rendering redacts the active token defensively. Invalid tokens and Gateway close/error codes for invalid or disallowed intents (`4013`/`4014`) are permanent for that configuration and must not enter an infinite retry loop; other initial-login failures use Harness-timer exponential backoff capped at 30 seconds.

## Intent and permission behavior

The default Gateway intents are `Guilds`, `GuildMessages`, and `DirectMessages`; `Partials.Channel` is enabled for DM delivery. `MessageContent` is added only when `messageContentIntent: true`.

The option defaults to `false` for least privilege. Discord supplies content for DMs and guild messages that mention the application, so DM and explicit-mention operation does not require the privileged intent. To use legacy `groupMode: always` for ordinary unmentioned guild messages, the operator must enable Message Content Intent in the Discord Developer Portal and configure `messageContentIntent: true`. Missing either side means those message bodies are intentionally unavailable.

The bot does not need Administrator. Limit it to intended channels and grant View Channel, Send Messages, and Read Message History; add Send Messages in Threads for thread output and Add Reactions for acknowledgements. This text adapter requests no member, presence, or reaction-event intent.

## Normalization behavior

1. Ignore bot-authored, webhook, system, and empty/non-text messages.
2. A DM maps to `chatType: 'direct'`, with its channel id as `conversationId`; direct messages are eligible without a mention.
3. A normal guild channel maps to `chatType: 'group'`, with its channel id as `conversationId`.
4. A thread maps its parent channel id to `conversationId` and its own channel id to `threadId`. The send/reaction target is `threadId ?? conversationId`.
5. discord.js structured mention data determines whether the current bot is addressed: either `mentions.users` contains the bot or `mentions.repliedUser` is the bot. Broad `MessageMentions.has(botId)` is intentionally avoided because `@everyone` and role mentions must not bypass the group gate. Only exact current-bot markup (`<@id>` and `<@!id>`) is removed from relayed text.
6. Legacy channel-core remains the only component that applies `groupMode`, chooses a Session, serializes the turn, mounts the preset, writes logs, and invokes outbound delivery.

## Outbound and safety behavior

- Split text at Discord's 2,000 UTF-16-code-unit limit with the shared legacy splitter; never split a surrogate pair.
- Send to a fetched channel only when discord.js reports it is sendable. A forum parent fails clearly rather than silently dropping output.
- Set `allowedMentions: { parse: [], repliedUser: false }` on every chunk, preventing model output or preserved markup from triggering unsolicited pings.
- Attach `reply.messageReference` only to the first chunk with `failIfNotExists: false`; later chunks are plain continuations.
- Await sends sequentially and propagate the first terminal failure. Do not add a retry layer over discord.js REST handling.
- Add acknowledgement emoji through the target channel's message manager so the target message need not be cached.

## Lifecycle behavior

The adapter starts with receive unavailable, then marks it available after client readiness. Each accepted Gateway message creates a tracked legacy inbound promise. On credential replacement or disposal it stops admission, marks receive unavailable, waits for admitted legacy turns through Session flush and outbound send, destroys the client, settles the login task, and detaches listeners. Normal shutdown therefore does not cut off an answer Harness already accepted.

## Verification and evidence boundary

Keyless fixtures cover intent construction, DM/guild/thread normalization, bot/webhook/system filtering, structured mentions, 2,000-unit and surrogate-safe splitting, first-chunk-only replies, disabled outbound pings, thread targeting, forum rejection, uncached reactions, failure propagation, readiness, transient backoff, permanent token/intent errors, credential rotation, cancellation, and drain-before-destroy.

A credentialed live-server E2E was never completed. Keyless evidence must not be presented as proof of bot installation, guild/channel membership, Developer Portal intent configuration, real Gateway ingress, or REST delivery. Under ADR-0008's support vocabulary this compatibility package is at most `installable`; it is default-disabled, not `certified`, and not `enabled`. It provides no evidence for the locked sidecar.

## Operational safety

A Discord bot token is a password. Store it in Harness credentials, restrict server/channel permissions, rotate it after any disclosure, and keep it out of commits, terminal output, logs, issues, and screenshots. Without a durable legacy ingress/idempotency ledger or outbox, crash-window replay or loss remains possible even though the Harness Session is durable.

Official references: [Gateway and intents](https://docs.discord.com/developers/events/gateway), [message resource](https://docs.discord.com/developers/resources/message), [threads](https://docs.discord.com/developers/topics/threads), and [rate limits](https://docs.discord.com/developers/topics/rate-limits).
