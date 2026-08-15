# @clawdsh/dsh-channel-agent

English | [中文](README.zh.md)

`@clawdsh/dsh-channel-agent` is the Agent-plane Consumer for the [channel Service Definition](../channel/README.md). It accepts only turns already admitted by the local OpenClaw Gateway, maps each OpenClaw session generation to one durable DSH Session, runs the configured Agent preset, and returns a replayable terminal result. The Gateway remains authoritative for platform credentials, pairing, allowlists, mention policy, protocol connections, and final platform delivery.

## Configuration

```yaml
- id: channel-agent
  name: '@clawdsh/dsh-channel-agent'
  config:
    ownerPreset: clawdsh
    safePreset: clawdsh-messaging-safe
    cwd: /srv/clawdsh/workspace
    stagingRoot: /srv/clawdsh/channel-media
    maxMediaBytes: 10485760
    shutdownGraceMs: 30000
- id: channel-agent-invariant
  name: '@clawdsh/dsh-channel-agent/invariant'
```

| Key | Contract |
|---|---|
| `ownerPreset` | Installer-managed `clawdsh` preset for direct messages classified as `owner` by OpenClaw. |
| `safePreset` | Installer-managed `clawdsh-messaging-safe` preset for admitted, paired, allowlisted, or group senders. The Agent scope applies `tools.restrict({ allow: [] })` before mounting this preset, so inherited/global tools are absent while scope-local preset tools and `message` remain available. |
| `cwd` | User-configurable absolute workspace recorded in every newly created channel Session. |
| `stagingRoot` / `maxMediaBytes` | Installer-managed absolute shared-media root and positive per-object byte cap, kept equal to the Gateway deployment. Attachment-store count, type, aggregate-byte, and decoder policies also apply. |
| `shutdownGraceMs` | Advanced positive teardown deadline. Teardown stops admission, cancels active work, and waits this long for accepted turns, pending Agent acquisition, and route controls to quiesce before disposing Agents and closing storage. A timeout fails loud and deliberately leaves storage open while a late operation could still write. |

The plugin registers its existing schema under `clawdsh-channel-agent` when the DSH Settings service is present. Schema defaults, the profile base, and the user layer are resolved once at startup with `applies: restart`; later writes cannot mutate the running driver. A user layer that changes `ownerPreset`, `safePreset`, `stagingRoot`, or `maxMediaBytes` is rejected before persistence or driver creation, so hand-edited Settings cannot replace installer-managed identities. The plugin remains mounted and registers its driver regardless of whether the OpenClaw Gateway Provider is enabled. It requires `ctx.channels`, `ctx.agents`, Session persistence, model selection, Agent presets, attachments, a storage-domain facility, and the tool registry. Configuration fails before driver registration when either path is relative. The invariant companion is registered separately so deployments that run the repository invariant registry can validate live and restored logs.

## Turn and Session Semantics

The durable binding key is `(gatewayInstanceId, openclawSessionKey, generation)`. Its SessionId is deterministic, while the stored binding also contains channel, account, conversation, optional thread, conversation kind, selected preset, and lifecycle state. Reusing one key with different platform coordinates or changing between owner and safe admission classes fails closed instead of aliasing Sessions or expanding permissions.

The first accepted generation becomes current for its Gateway/session lineage. `session.reset` retires the exact current generation and admits only a strictly larger generation; `session.close` retires the exact named generation. Both operations cancel matching live work before disposing an owned Agent handle. Their generation commit atomically records the exact control request and reset acknowledgement, so a bridge retry after a lost acknowledgement replays the completed control without invalidating the successor. A stale or closed generation cannot enter the model, including a retry of a previously accepted turn.

An owner direct message uses `ownerPreset`. Every other admitted turn uses `safePreset`; an owner-originated group is still a group and cannot inherit owner permissions. Unknown or route-inconsistent admission classes fail before Agent execution and are rejected again by the live/restored Session invariant. The empty inherited-tool allowlist removes shell, filesystem, and other deployment-global tools regardless of what the owner preset exposes. Scope-local tools deliberately survive that restriction, so the audited safe preset may contribute its own tools and this package can always add the route-bound `message` tool.

## Durable Idempotency and Delivery

The `clawdsh_channel_agent` storage domain owns bindings, current generations, and a Gateway-scoped inbound ledger. Every stored row passes strict schemas; malformed ids, timestamps, envelope digests, result identities, receipts, or phase/receipt combinations fail while loading rather than being coerced.

| Phase | Meaning |
|---|---|
| `accepted` | The exact envelope is durable, but no Agent follow-up has been queued. A failure in this phase returns `retryable: true`, remains accepted without a result, and may retry only the same envelope and generation. |
| `running` | The Session identity and running marker are durable before `agent.followup()`. Model or tool work may begin after this point. |
| `completed` | A terminal result is durable and equal retries replay it without invoking the Agent. Accepted and retrying platform receipts retain this phase. |
| `delivered` | The provider reported confirmed final-turn delivery. |
| `ambiguous` | Reconciliation cannot prove whether the platform accepted delivery; automatic resend is forbidden. |
| `dead-letter` | Delivery reached a terminal platform failure. |
| `needs-recovery` | A process or runtime failure occurred after Agent work might have begun. Equal retries return an operator-reconciliation failure and never rerun the Agent automatically. |

Terminal wire failures expose only package-owned, bounded diagnostics. Arbitrary errors from model, preset, attachment, or other dependencies are replaced with a generic message before persistence or IPC because their text may contain credentials or local paths.

Distinct turns for one durable route generation are accepted independently but enter a single execution lane. The lane covers pre-Agent checks, media import, Agent acquisition, progress observation, `followup`, quiescence, flush, and the terminal ledger commit, so one Session never has overlapping channel turns or progress observers. Cancelling a queued turn only records its cancellation; it does not call the shared Agent's `cancel()`. Only cancellation of the lane's active turn interrupts that Agent, and the queued turn later commits a replayable pre-Agent cancelled result without entering the model.

Concurrent equal envelopes attach to one promise. Reusing an in-flight or persisted idempotency key with different content fails. An exact `turn.cancel` is recorded against the accepted ledger row even before Agent acquisition or active-run registration; every pre-Agent checkpoint observes it, persists a terminal cancelled result, and equal retries replay that result without starting the Agent. A wrong run id cannot cancel another run with the same turn id. Final-turn delivery reports must name one unambiguous turn/run pair, retain one delivery id and any learned platform message id, and advance attempts monotonically; a retrying state cannot return to accepted or repeat the same attempt, and terminal confirmed, ambiguous, and dead-letter receipts cannot regress. The communication-plane provider keeps the authoritative platform delivery ledger, while this ledger records the Agent-side projection.

## Provenance and Media

Each admitted input is appended as the core `user/message` event with `source.kind: channel`. The source records sanitized Gateway/session/generation, channel route, sender and admission class, group and mention facts, message/reply identities, idempotency/run/turn identities, and optional trace fields. Credentials, raw authentication material, and staging paths are never placed in message text or source metadata. The invariant companion enforces one exact route per Session and uniqueness of turn, run, idempotency, and platform-message identities.

Inbound images preserve Gateway order and enter model history only as durable attachment references. Before any attachment is saved, the package checks contiguous ordinals, enabled image media types, all byte limits, a relative slash-normalized path, every path component for symlinks, canonical-root containment, exact size, SHA-256, and attachment decoder policy. It compares path-component and file identities with the open handle before and after reading, rejecting replacement races even when a replacement hard-links the same file. A failed batch saves nothing. Audio, video, and generic files fail explicitly until DSH has a durable attachment type for them.

## `message` Tool

Every channel-created Agent receives one route-bound `message` tool with generic render intent. Channel/account/conversation/thread/message coordinates appear in `rawInput`; they are not reported as file `locations`. The tool derives its action id from the complete route and durable tool-call id, so replaying the same logged call preserves provider-side idempotency. It dispatches through `ctx.channels.action` and propagates the provider's capability error when the selected account does not support an operation.

| Family | Actions and result |
|---|---|
| Mutation | `send`, `edit`, `delete`, `react`, `poll`, and `typing` return a delivery receipt. Send optionally replies to a platform message; model-originated outbound media is not accepted. |
| Directory | `directory.self`, `directory.list-peers`, `directory.list-groups`, and `directory.list-group-members` return sanitized entries. Cached versus live lookup is explicit. |
| Resolution | `resolve` returns one sanitized result for each requested user or group destination in the original order. |

The tool strictly validates the result variant and exact action id before exposing JSON to the model. Resolve results must also preserve input count and order. A query result cannot masquerade as mutation success, and a delivery receipt cannot masquerade as a directory or resolution result.

Each terminal turn result derives replay evidence from the exact owning turn's durable tool-call and tool-result events. Directory and resolution calls remain replay-safe; every mutation and every unclassified tool call is treated as a potential side effect. `didSendViaMessagingTool` is true for confirmed, accepted, retrying, or ambiguous `message.send` outcomes, and fails closed to true when a valid send has no classifiable result. It remains false for an explicit pre-dispatch `dead-letter` receipt or an obvious argument-validation failure. Sent texts, media URLs, and targets are stronger committed evidence and are populated only from a validated `confirmed` receipt.

## Model Experience

### Admitted channel input

#### What the model sees

The model sees admitted plain text and authenticated image attachment references as an ordinary user message. Sanitized channel provenance remains in the durable message source for reconstruction and policy audits; provider adapters receive message content, not local staging paths or credentials.

#### Token effect

Text contributes ordinary user-message tokens. Image cost is provider-dependent. Replayed completed results, delivery receipts, health state, and ledger metadata add no model request tokens.

#### KV Cache effect

Channel turns append to one route-generation Session, preserving its reusable history prefix. Resetting the generation starts a different Session; changing either selected preset can change the prefix and tool set when that Session is next created or resumed.

### Route-bound `message` tool

#### What the model sees

The model sees the `message` name, capability-checking description, the eleven-action argument schema, and JSON results. Owner Sessions may also see inherited tools selected by `ownerPreset`; safe Sessions see no inherited/global tools and retain only scope-local contributions such as `message` and audited safe-preset tools.

#### Token effect

The schema contributes a fixed tool-definition cost to every request in a channel-created Agent. Individual tool results contribute their sanitized JSON through the ordinary tool-result history.

#### KV Cache effect

The tool schema is stable within one Agent composition. Package upgrades or preset changes that alter the visible scoped tool set can invalidate reuse beyond the unchanged conversation prefix.

## Known Limitations and Deferred Work

- **Namespaced Session events await an upstream append API** — current DSH persistence rejects unknown required event names and downstream code cannot mark an informational append `ignorable`. This package therefore stores complete sanitized admission provenance in the known `user/message.source` fields and keeps admission/delivery authority in its storage-domain ledger. It must not append unrecoverable `channel/*` events until the [downstream event proposal](../../../docs/upstream-proposal/session-plugin-events.md) lands.
- **Images are the only inbound attachment class** — audio, video, and files remain rejected; assistant final results and model-originated `message` actions currently carry no media.
- **Progress is presentation-only** — text, reasoning, tool, and status notifications are best effort and never own the durable result. The communication-plane bridge must suppress notification kinds absent from its negotiated handshake.
- **Channel coordinates are not file locations** — the current generic tool presentation type defines `locations` only for filesystem paths, so this package uses structured `rawInput` instead of emitting misleading file navigation metadata.
