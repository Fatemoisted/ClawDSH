# `ctx.channels` Service Definition record

English | [中文](ctx-channels.zh.md)

> This is an internal seam record in the historical `docs/upstream-proposal/` location. No upstream pull request is currently proposed. ADR-0008 supersedes the adapter registry described by ADR-0002; the current code lives entirely under `packages/openclaw/`.

## Motivation

DeepSeek Harness owns Agent execution and durable Sessions but has no provider-neutral messaging transport seam. ClawDSH needs one narrow junction where an external communication plane can submit admitted turns and where an Agent can request platform-native actions. Platform SDKs, credentials, admission policy, and delivery must not leak into the Agent driver, while Agent and Session lifecycle must not move into the transport host.

## Current seam

`@clawdsh/dsh-channel` provides `ctx.channels` with two lifecycle-scoped slots:

- one `ChannelProviderV1`, owned by the communication plane, implements `action()` and `health()`;
- one `ChannelDriverV1`, owned by the Agent plane, implements `runTurn()`, exact cancellation, reset, close, and optional delivery-ledger reconciliation.

The Service dispatches between those roles and fails when a required role is absent or duplicated. It contains strict provider-neutral V1 protocol types and validators, but no OpenClaw import, platform branch, credential, Session creation logic, transport retry, or default provider.

## Protocol obligations

An admitted turn names the Gateway lineage, OpenClaw session key, reset generation, channel, account, conversation, optional thread, direct/group kind, sender admission class, platform message, idempotency key, turn/run ids, text, ordered staged media, and optional trace. Terminal results are replayable and distinguish completed, silent, cancelled, and failed outcomes.

`channel.action` is a closed union for send, edit, delete, react, poll, typing, directory queries, and resolution. Provider delivery receipts distinguish accepted, confirmed, retrying, ambiguous, and dead-letter states. The optional `delivery.report` extension reconciles final-turn delivery with the Agent-side durable ledger. An ambiguous receipt never authorizes the Service to rerun a turn or resend an action.

## Composition

The current Provider is `@clawdsh/dsh-channel-openclaw`, which authenticates and verifies a locked local OpenClaw Gateway. The current Driver is `@clawdsh/dsh-channel-agent`, which owns durable route/session binding, idempotency, Agent execution, model-visible logging, and attachment import. Their current behavior and limitations are specified in `docs/specs/feature-channel-plane-bridge.md`.

`@clawdsh/dsh-channel-core` implements the superseded in-process adapter contract under `ctx.legacyChannels`. A deployment must not connect both paths to the same platform account. The legacy package remains only until ADR-0008's replacement conditions pass.

## Required upstream Session-event seam

Channel provenance reaches the model through the known `user/message.source.kind = 'channel'` path. Admission, idempotency, and delivery authority remains in channel ledgers. The current implementation does not append `channel/turn-admitted` or `channel/delivery`: dsh's static known-event vocabulary excludes downstream names, and `Session.append()` cannot mark a non-surface event `ignorable: true`, so persistence would make resume refuse the log.

`session-plugin-events.md` proposes the independent upstream seam needed before ClawDSH can add redundant namespaced diagnostics. It is not part of `ctx.channels`, because safe event-envelope creation belongs to the Session owner and can serve any downstream plugin.

## Upstream boundary

If DeepSeek Harness later needs a general channel capability, only the provider-neutral Service Definition is a candidate for upstreaming. The OpenClaw Provider, channel catalogs, host locks, and migration policy remain ClawDSH-owned. An upstream proposal would need an independent consumer and provider, stable demand beyond ClawDSH, and the normal complete-seam requirement; this document does not claim those conditions are met.

## Current validation limits

Package-level protocol and lifecycle evidence does not certify a platform. The production sidecar is not enabled in a shipped profile, the owned keyless assembled snapshot is missing, Windows endpoint ACL enforcement is missing, namespaced Session events remain disabled, and this change ran no current Telegram or Feishu live smoke. Support claims therefore follow `cataloged → installable → certified → enabled`; no channel reaches the final two states in this record.
