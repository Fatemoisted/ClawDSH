# ADR-0002: Legacy in-process channel adapter seam

English | [中文](0002-channel-seam.zh.md)

- **Status**: Superseded by [ADR-0008](0008-openclaw-channel-plane.md) (2026-08-15)
- **Date**: 2026-08-14
- **Depends on**: ADR-0001

## Context

ClawDSH initially needed to prove that a messaging input could select a dsh Session, enter the append-only log, drive an Agent turn, and return a reply without changing upstream `agent-loop`. DeepSeek Harness had no messaging-channel Service Definition, so the Phase 2 spike introduced an owned `ctx.channels` service and tested it with Telegram and Feishu packages.

The experiment intentionally used a minimal text-only adapter. It answered the feasibility question but did not preserve OpenClaw's current communication plane: each additional channel would still require ClawDSH to copy platform authentication, transport lifecycle, identity and admission rules, attachments, native actions, and delivery behavior.

## Historical decision

`@clawdsh/dsh-channel-core` registered multiple in-process `ChannelAdapter` implementations. An adapter emitted `channel/inbound` and implemented text `send`; the core kept an in-memory per-thread Session map, serialized turns, drove `ctx.agents`, flushed `ctx.sessions`, extracted the assistant reply, sent it, and emitted `channel/outbound`. `channel-telegram`, `channel-feishu`, and the later `channel-discord` compatibility adapter implemented that contract with their platform SDKs.

The seam required model-visible channel text to enter the Session log and kept platform credentials in adapter configuration. Attachments, reply references, rich text, interactive cards, durable route bindings, crash recovery, delivery receipts, and native action capability negotiation were outside its contract.

## Superseding decision

ADR-0008 replaces this architecture with a locked OpenClaw Gateway sidecar and a provider-neutral V1 `ctx.channels` Service Definition. OpenClaw owns the communication plane; `@clawdsh/dsh-channel-openclaw` is the authenticated Provider and `@clawdsh/dsh-channel-agent` is the durable Agent-plane Driver. The legacy registry remains under `ctx.legacyChannels`; a deployment must never connect both paths to the same platform account.

`channel-core`, `channel-telegram`, `channel-discord`, and `channel-feishu` remain legacy compatibility packages until ADR-0008's replacement conditions pass. Their package tests and historical transport work show only what that older path did. None of the adapters is `certified` or `enabled` without current credentialed evidence.

## Consequences

- This ADR remains the historical record for the Phase 2 adapter experiment; it is not current implementation guidance.
- New channel work targets the Gateway sidecar, bridge protocol, and locked catalogs in ADR-0008 rather than adding another native adapter.
- The legacy identity-presentation and acknowledgement-reaction Agent Notes remain valid only for the legacy path until that code is deleted; they do not define sidecar behavior.
- Removing the legacy packages requires an assembled production sidecar, an owned keyless snapshot path, and fresh certification for every platform still used for migration, including Telegram, Feishu, and Discord where applicable.

## Alternatives considered

- **Keep expanding the text adapter**: superseded because it would grow into a second, incomplete OpenClaw channel subsystem.
- **Connect each platform directly to dsh Sessions**: rejected because every adapter would duplicate route and lifecycle logic.
- **Use an external Gateway sidecar**: originally deferred, now accepted by ADR-0008 after current ecosystem coverage made whole-plane reuse the lower-risk design.
