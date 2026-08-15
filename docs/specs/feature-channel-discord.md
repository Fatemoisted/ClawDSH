# Feature spec: Discord channel adapter

English | [中文](feature-channel-discord.zh.md)

- **Status**: implemented (keyless verification; credentialed live E2E pending, 2026-08-15)
- **Implementation package**: `packages/openclaw/channel-discord` (`@clawdsh/dsh-channel-discord`)
- **OpenClaw counterpart**: `src/discord/` in the selected v2026.1.5 baseline
- **Existing seams reused**: `ctx.channels`, Harness credentials / launch environment, Harness timer, Cordis lifecycle
- **Provider library**: discord.js 14.x

## Decision

Implement Discord as a provider-only adapter over the existing `ChannelAdapter` contract. Do not port OpenClaw's agent loop, session ownership, gateway facade, retry framework, or permission model. Harness already provides the corresponding components:

| Concern | Owner |
|---|---|
| Durable conversation/topic session, FIFO turn, `groupMode`, presets, model run, session flush, outbound event, acknowledgement policy | `@clawdsh/dsh-channel-core` |
| Bot-token lookup and hot rotation | Harness `ctx.credentials`, with launch-environment fallback |
| Initial-login backoff and teardown scope | Harness timer and Cordis lifecycle |
| Gateway heartbeat/reconnect and REST rate-limit handling | discord.js |
| Discord event normalization, channel/thread sends, native replies, reactions | `@clawdsh/dsh-channel-discord` |

This keeps the provider package thin and leaves no Discord branch in channel-core.

## Goals

- Receive user text from Discord DMs, guild text channels, and concrete thread channels through Gateway `MessageCreate`.
- Normalize provider addresses and structured mention state into `ChannelMessage` without parsing display text heuristically.
- Deliver assistant text to the correct channel/thread, preserve one native reply reference, and provide acknowledgement reactions.
- Use Harness credential references by default; keep secrets out of repository configuration and logs.
- Drain every admitted Harness turn before closing the provider client.

## Non-goals

- Binary attachment ingestion, embeds as model input, stickers, polls, voice, stage channels, or screen sharing;
- slash commands, autocomplete, context menus, buttons, selects, modals, or other Discord interactions;
- webhook delivery, multi-process/sharded ownership orchestration, a durable provider inbox/outbox, or exactly-once delivery;
- sending directly to a forum parent (a concrete forum thread is a valid target);
- replacing discord.js Gateway reconnect or REST rate-limit behavior with custom code.

## Configuration and credentials

```ts
interface Config {
  botToken?: string
  botTokenEnv?: string // default: DISCORD_BOT_TOKEN
  messageContentIntent?: boolean // default: false
}
```

`botTokenEnv` is a Harness credential reference, not the token itself. It defaults to `DISCORD_BOT_TOKEN` and is resolved only when a Gateway connection is opened. `ctx.credentials` is preferred; the Harness launch environment is retained as a compatibility fallback. A matching `credentials/updated` event drains and replaces the client, enabling rotation without process restart. The `botToken` secret-role field exists for programmatic composition but must not appear in tracked configuration.

No resolved token may be logged. Error rendering redacts the active token defensively. Invalid tokens and Gateway close/error codes for invalid or disallowed intents (`4013`/`4014`) are permanent for that configuration and must not enter an infinite retry loop; other initial-login failures use Harness-timer exponential backoff capped at 30 seconds.

## Intent and permission contract

The default Gateway intents are `Guilds`, `GuildMessages`, and `DirectMessages`; `Partials.Channel` is enabled for DM delivery. `MessageContent` is added only when `messageContentIntent: true`.

`messageContentIntent` defaults to `false` for least privilege. Discord supplies content for DMs and guild messages that mention the application, so DM and explicit-mention operation does not require the privileged intent. This matches channel-core's default mention-gated group mode. To use `groupMode: always` for ordinary unmentioned guild messages, the operator must both enable Message Content Intent in the Discord Developer Portal and configure `messageContentIntent: true`. Missing either side means those message bodies are intentionally unavailable.

The bot does not need Administrator. Limit it to intended channels and grant View Channel, Send Messages, and Read Message History; add Send Messages in Threads for thread output and Add Reactions for acknowledgement reactions. No member, presence, or reaction-event intent is requested by this text adapter.

## Normalization contract

1. Ignore bot-authored, webhook, system, and empty/non-text messages.
2. A DM maps to `chatType: 'direct'`, with its channel id as `conversationId`; direct messages are eligible without a mention.
3. A normal guild channel maps to `chatType: 'group'`, with its channel id as `conversationId`.
4. A thread maps its parent channel id to `conversationId` and its own channel id to `threadId`. The send/reaction target is `threadId ?? conversationId`.
5. discord.js structured mention data determines whether the current bot is addressed: either `mentions.users` contains the bot or `mentions.repliedUser` is the bot. Broad `MessageMentions.has(botId)` is intentionally not used because `@everyone` and a mentioned role containing the bot must not bypass the group mention gate. Only exact current-bot markup (`<@id>` and `<@!id>`) is removed from relayed text; every other mention remains plain model-visible text.
6. channel-core remains the only component that applies `groupMode`, chooses a durable session, serializes the turn, mounts the preset, writes logs, and invokes the adapter's outbound path.

## Outbound and safety contract

- Split text at Discord's 2,000 UTF-16-code-unit message limit with the shared channel-core splitter; never split a surrogate pair.
- Send to a fetched channel only when discord.js reports it is sendable. A forum parent fails clearly rather than silently dropping output.
- Set `allowedMentions: { parse: [], repliedUser: false }` on every chunk. Model output and preserved inbound mention markup can therefore never trigger an unsolicited user, role, `@everyone`, or reply ping.
- Attach `reply.messageReference` only to the first chunk and set `failIfNotExists: false`; later chunks are plain continuations.
- Await every send sequentially and propagate the first terminal failure through channel-core. Do not add a second retry layer over discord.js REST handling.
- Add acknowledgement emoji via the target channel's message manager so the target message need not be cached.

## Lifecycle contract

The adapter starts with `receive: false`, then marks receive capability available after client readiness. Each accepted Gateway message creates a tracked `ctx.parallel('channel/inbound', message)` promise. On replacement or disposal:

1. cancel pending Harness retry and stop `MessageCreate` admission;
2. mark receive unavailable;
3. wait until all admitted channel-core turns finish, including durable flush and outbound send;
4. destroy the discord.js client, settle the login task, and detach listeners.

This ordering prevents normal shutdown from cutting off an answer that Harness has already accepted.

## Acceptance criteria

1. Pure option construction proves the default intent set excludes Message Content and the opt-in set includes it, with DM channel partials in both cases.
2. Keyless message fixtures cover DM, guild, parent/thread addressing, bot/webhook/system filtering, explicit/reply mention state, and exact bot-mention removal.
3. Keyless client fixtures cover 2,000-unit and surrogate-boundary splitting, first-chunk-only native reply, disabled outbound pings, thread targeting, forum rejection, uncached reaction, and failure propagation.
4. Lifecycle fixtures cover readiness capability, transient login backoff, non-retryable token/intent errors, credential rotation, cancellation, and drain-before-destroy.
5. Workspace typecheck, bundle, invariant, profile-install, release-family, and bilingual-pair gates include the new package.
6. A credentialed live-server E2E is explicitly deferred: automated/keyless evidence must not be presented as proof of server membership, portal intent configuration, or real Discord delivery.

## Operational safety

A Discord bot token is equivalent to a password. Operators must store it in Harness credentials, restrict server/channel permissions, rotate it immediately after any disclosure, and keep it out of commits, terminal output, logs, issue descriptions, and screenshots. Because the provider boundary has no durable idempotency ledger or outbox, crash-window replay/loss remains possible even though Harness session state itself is durable.

Official references: [Gateway and intents](https://docs.discord.com/developers/events/gateway), [message resource](https://docs.discord.com/developers/resources/message), [threads](https://docs.discord.com/developers/topics/threads), and [rate limits](https://docs.discord.com/developers/topics/rate-limits).
