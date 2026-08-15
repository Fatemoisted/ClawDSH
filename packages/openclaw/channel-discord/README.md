# @clawdsh/dsh-channel-discord

English | [中文](README.zh.md)

**Purpose**: Discord channel adapter — a thin `ChannelAdapter` over discord.js Gateway and REST primitives, with direct-message, guild-channel, thread, native-reply, and acknowledgement-reaction support.

**OpenClaw correspondence**: `src/discord/` in the selected OpenClaw v2026.1.5 baseline. The implementation keeps only the provider boundary here instead of importing OpenClaw's gateway/agent stack.

**Seams**: `ctx.channels` (`@clawdsh/dsh-channel-core`), Harness credentials / launch environment, and the Harness timer.

**Specification**: [English](../../../docs/specs/feature-channel-discord.md) / [中文](../../../docs/specs/feature-channel-discord.zh.md) · **Status**: implemented; keyless verification is automated, while a credentialed live Discord E2E is not claimed by this change.

## Harness-first design

- **Channel core owns the assistant**: durable session binding, per-conversation FIFO turns, `groupMode`, preset mounting, model execution, log flush, native-reply metadata, and acknowledgement policy remain in `@clawdsh/dsh-channel-core`. This package only normalizes Discord events and performs provider sends/reactions.
- **Harness owns credentials**: `botTokenEnv` is a credential reference and defaults to `DISCORD_BOT_TOKEN`. It is resolved at connection time through `ctx.credentials`, with the Harness launch environment as the compatibility fallback. `botToken` is only a programmatic escape hatch; never commit a literal token to configuration. A matching `credentials/updated` event replaces the client so rotation does not require a process restart.
- **Harness owns outer retry timing**: a failed initial login uses the Harness timer with capped exponential backoff. Invalid tokens and invalid/disallowed intent sets stop instead of retrying forever. Once connected, discord.js owns Gateway heartbeat/reconnect behavior and Discord REST rate limits.
- **Harness owns lifecycle admission**: each admitted `MessageCreate` awaits `ctx.parallel('channel/inbound', message)`. Disposal stops new admission, drains those turns (including session flush and final send), then destroys the Discord client.

## Configuration

```yaml
botTokenEnv: DISCORD_BOT_TOKEN
messageContentIntent: false
```

Store the bot token in the referenced Harness credential or launch environment. Discord API-style `Bot ` prefixes and surrounding whitespace are normalized before login, but the unprefixed token is preferred.

`messageContentIntent` defaults to `false` for least privilege. Discord still supplies message content for direct messages and guild messages that mention the bot, which is enough for channel-core's default mention-gated group policy. To use `channel-core` with `groupMode: always` for ordinary, unmentioned guild traffic, both of the following are required:

1. enable **Message Content Intent** for the application in the Discord Developer Portal;
2. set `messageContentIntent: true` in this adapter.

Without both settings, Discord intentionally omits ordinary guild message content; the adapter does not attempt to bypass that boundary.

## Discord setup and permissions

Invite the application as a bot to the target server. It does not need Administrator. Grant only the channels it should serve, with these practical permissions:

- View Channel, Send Messages, and Read Message History;
- Send Messages in Threads for thread replies;
- Add Reactions for acknowledgement reactions.

The Gateway intent set is `Guilds`, `GuildMessages`, and `DirectMessages`, plus `MessageContent` only when explicitly enabled. `Partials.Channel` is enabled so direct-message events can be received. This text adapter does not request member, presence, or reaction-event intents.

## Message contract

- **Inbound filtering**: user-authored text is accepted; bot-authored, webhook, system, and empty messages are ignored. Only exact `<@bot-id>` / `<@!bot-id>` markup for the current bot is removed. Other mentions remain text, but cannot be emitted as pings by outbound replies.
- **Mention policy**: DMs are direct conversations. In guilds, only a direct user mention or a reply to the bot sets `mention.botMentioned`; `@everyone` and role-derived matches do not bypass the gate. channel-core makes the final `groupMode` decision.
- **Addressing**: a DM or normal guild channel uses its channel id as `conversationId`. A thread uses its parent channel as `conversationId` and the thread channel id as `threadId`; outbound replies and reactions target `threadId` when present.
- **Outbound safety**: replies are split at Discord's 2,000 UTF-16-code-unit limit without cutting a surrogate pair. Every chunk disables parsed mentions and reply pings; only the first chunk carries the native message reference. Provider failures reject back through channel-core rather than being reported as success.
- **Reactions**: acknowledgement uses Discord's message REST path and does not require the message to be cached.

## Model Experience

### Inbound message text

#### What the model sees

The adapter contributes no prompt or tool schema. It forwards normalized user text to `channel/inbound`; channel-core applies group policy and writes every accepted turn to the durable session log before model execution.

#### Token effect

Only accepted message text reaches the model; this adapter adds no hidden prompt tokens.

#### KV Cache effect

Session history remains append-only through channel-core.

## Known Limitations and Deferred Work

- Treat a bot token as a password. Keep it in Harness credentials, restrict Discord channel permissions, rotate it immediately after any disclosure, and never paste it into tracked files, logs, issue text, or screenshots.
- Automated tests are keyless and use deterministic client seams. This change does not claim a credentialed live-server E2E; server membership, portal intent settings, and channel permissions still require deployment verification.
- Text is supported; binary attachments, embeds as model input, stickers, polls, voice, slash-command interactions, buttons/modals, and provider-side moderation are not implemented.
- A forum parent is not itself a sendable text target; address a concrete forum thread. Cross-process Gateway ownership, a durable provider inbox/outbox, and webhook delivery are also out of scope.
- discord.js handles transient reconnects and REST rate limits in memory. A process crash can replay an inbound event or lose a reply after the assistant turn is already durable because there is not yet a provider-level idempotency ledger/outbox.

Official references: [Gateway intents and Message Content](https://docs.discord.com/developers/events/gateway), [message resource and limits](https://docs.discord.com/developers/resources/message), [threads](https://docs.discord.com/developers/topics/threads), and [rate limits](https://docs.discord.com/developers/topics/rate-limits).
