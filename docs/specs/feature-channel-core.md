# Feature specification: legacy channel-core adapter path

English | [中文](feature-channel-core.zh.md)

- **Status**: implemented legacy compatibility path; superseded for new development
- **Implementation package**: `packages/openclaw/channel-core` (`@clawdsh/dsh-channel-core`)
- **Decision history**: [ADR-0002](../adr/0002-channel-seam.md)
- **Current replacement**: [OpenClaw channel-plane bridge](feature-channel-plane-bridge.md) / [ADR-0008](../adr/0008-openclaw-channel-plane.md)

## Purpose

`channel-core` was the Phase 2 feasibility implementation of an in-process `ctx.channels` registry. It proved that Telegram and Feishu adapters could share Session routing and Agent turn logic without modifying upstream dsh. It is retained temporarily so existing local configurations are not deleted before the sidecar replacement has equivalent evidence.

This package is no longer the owner of the current channel architecture. New consumers use `@clawdsh/dsh-channel`; new platform integrations belong to the locked OpenClaw Gateway rather than new ClawDSH adapter packages.

## Legacy contract

- `registerAdapter(adapter)` registered a unique in-process `ChannelAdapter` and disposed it with the contributing Cordis effect.
- An adapter emitted `channel/inbound` with channel, optional thread and sender, and text; the core selected or created an in-memory per-thread Agent Session.
- Turns for one thread were serialized, driven through `ctx.agents`, flushed through `ctx.sessions`, and followed by a text reply through `adapter.send` and `channel/outbound`.
- Identity presentation, mention stripping, response prefix, and acknowledgement reaction were resolved within the old adapter path.
- The contract had no durable route binding, host identity, idempotency ledger, delivery receipt, capability negotiation, rich action, or attachment semantics.

## Compatibility rules

- The legacy service registers as `ctx.legacyChannels`. Do not connect it and the current `ctx.channels` path to the same platform account.
- Do not add another adapter or widen `ChannelMessage`. Required channel coverage belongs to the sidecar catalog and V1 bridge.
- Keep credentials in environment-backed adapter configuration while the legacy path remains installed.
- Keep the legacy identity-presentation and acknowledgement-reaction Agent Notes with the code until removal; do not project their behavior onto the sidecar.

## Verification status

The package and adapter contract tests remain historical implementation evidence. Earlier Telegram and Feishu development established that the minimal contract could be mounted; it did not establish current release certification. Both legacy adapters are at most `installable`, not `certified` or `enabled`, under ADR-0008's state model without current credentialed evidence.

## Removal gate

Delete `channel-core`, `channel-telegram`, and `channel-feishu` together only after the production OpenClaw sidecar is reproducibly assembled, its owned keyless Gateway-to-Agent snapshot is running, and fresh Telegram and Feishu certification covers inbound admission, Agent execution, outbound delivery, duplicates, reconnect, and failure paths. Archive the legacy Agent Notes only in that removal change.
