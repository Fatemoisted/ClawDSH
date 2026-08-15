# Historical feature reference: removed channel-core adapter path

English | [中文](feature-channel-core.zh.md)

- **Status**: removed; historical reference only
- **Removed packages**: `channel-core`, `channel-telegram`, and `channel-feishu`
- **Decision history**: [ADR-0002](../adr/0002-channel-seam.md)
- **Current replacement**: [OpenClaw channel-plane bridge](feature-channel-plane-bridge.md) / [ADR-0008](../adr/0008-openclaw-channel-plane.md)

## Purpose

`channel-core` was the Phase 2 feasibility implementation of an in-process `ctx.channels` registry. It proved that Telegram and Feishu adapters could share Session routing and Agent turn logic without modifying upstream dsh. The runtime implementation is absent; existing local configurations can be inventoried without copying secret values through `tools/openclaw-channel-migration.ts`.

The current architecture uses `@clawdsh/dsh-channel`; platform integrations belong to the locked OpenClaw Gateway rather than ClawDSH adapter packages.

## Legacy contract

- `registerAdapter(adapter)` registered a unique in-process `ChannelAdapter` and disposed it with the contributing Cordis effect.
- An adapter emitted `channel/inbound` with channel, optional thread and sender, and text; the core selected or created an in-memory per-thread Agent Session.
- Turns for one thread were serialized, driven through `ctx.agents`, flushed through `ctx.sessions`, and followed by a text reply through `adapter.send` and `channel/outbound`.
- Identity presentation, mention stripping, response prefix, and acknowledgement reaction were resolved within the old adapter path.
- The contract had no durable route binding, host identity, idempotency ledger, delivery receipt, capability negotiation, rich action, or attachment semantics.

## Current boundary

- No package registers `ctx.legacyChannels`; `ctx.channels → channel-agent → channel-openclaw` is the only runtime path.
- Do not add another direct adapter or revive the old `ChannelMessage`. Required channel coverage belongs to the sidecar catalog and V1 bridge.
- The migration inventory reports names only; it neither loads an adapter nor copies credential values.
- Release verification deny-lists the removed package names so they cannot enter the public bundle.
- Legacy identity-presentation and acknowledgement-reaction Agent Notes describe historical behavior and do not define the sidecar.

## Verification status

The removed package and adapter contract tests are historical implementation evidence. Earlier Telegram and Feishu development established that the minimal contract could be mounted; it does not establish current release certification. Removed adapters have no support state, and their evidence cannot certify the canonical sidecar.

## Removal result

The three direct-adapter packages and `ctx.legacyChannels` were removed together. Remaining package-name references are limited to migration, release rejection, and historical documentation; they do not provide runtime compatibility.
