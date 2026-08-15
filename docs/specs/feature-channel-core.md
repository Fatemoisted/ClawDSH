# Feature specification: legacy channel-core adapter path

English | [中文](feature-channel-core.zh.md)

- **Status**: implemented legacy compatibility path; superseded for new development
- **Implementation package**: `packages/openclaw/channel-core` (`@clawdsh/dsh-channel-core`)
- **Decision history**: [ADR-0002](../adr/0002-channel-seam.md)
- **Legacy image/address decision**: [ADR-0011](../adr/0011-deferred-channel-images-and-address-continuity.md)
- **Current replacement**: [OpenClaw channel-plane bridge](feature-channel-plane-bridge.md) / [ADR-0008](../adr/0008-openclaw-channel-plane.md)

## Purpose

`channel-core` was the Phase 2 feasibility implementation of an in-process `ctx.channels` registry. It proved that Telegram, Feishu, and later Discord adapters could share Session routing and Agent turn logic without modifying upstream dsh. It is retained temporarily so existing local configurations are not deleted before the sidecar replacement has equivalent evidence.

This package is no longer the owner of the current channel architecture. New consumers use `@clawdsh/dsh-channel`; new platform integrations belong to the locked OpenClaw Gateway rather than new ClawDSH adapter packages.

## Legacy contract

- `registerAdapter(adapter)` registered a unique in-process `ChannelAdapter` and disposed it with the contributing Cordis effect.
- An adapter emits `channel/inbound` with provider, current conversation, optional stable Session conversation, optional thread, sender, text/caption, reply identity, and ephemeral image sources. The core deterministically resumes or creates the matching Agent Session.
- Turns for one stable conversation/thread are serialized, driven through `ctx.agents`, flushed through `ctx.sessions`, and followed by a reply through `adapter.send` and `channel/outbound`.
- Identity presentation, mention stripping, response prefix, and acknowledgement reaction were resolved within the old adapter path.
- For an image-capable model, materialization occurs only after mention admission and exact-model modality resolution; Harness validates and stores the resulting attachment references. Text-only and import-failure behavior follows ADR-0011.
- The contract still has no durable provider ingress/outbox, exact host identity, idempotency or delivery ledger, capability negotiation, or general native-action surface. Process loss can replay ingress or lose delivery after Session persistence.

## Compatibility rules

- The legacy service registers as `ctx.legacyChannels`. Do not connect it and the current `ctx.channels` path to the same platform account.
- The shipped `clawdsh-legacy-channel-plane` group and every adapter entry are default-disabled. While its opt-in is present, Gateway startup and Settings preflight reject canonical enablement.
- Do not add another adapter or widen `ChannelMessage`. Required channel coverage belongs to the sidecar catalog and V1 bridge.
- Keep credentials in environment-backed adapter configuration while the legacy path remains installed.
- Keep the legacy identity-presentation and acknowledgement-reaction Agent Notes with the code until removal; do not project their behavior onto the sidecar.

## Verification status

The package and adapter tests cover deterministic Session reuse, per-conversation FIFO, awaited shutdown, group mention policy, native replies/reactions, provider-safe splitting, credentials lifecycle, and provider-specific normalization. Telegram additionally has keyless image/address coverage under ADR-0011.

Credentialed historical evidence is narrower: Feishu text completed an end-to-end round trip on 2026-08-14; Telegram direct/group text and caption plus recovery/tool paths completed on 2026-08-15; Discord never completed a credentialed real-server E2E. Later Telegram image/rotation/migration behavior and later Feishu credential-reference/hot-rotation behavior remain keyless-only. These facts establish legacy behavior, not current release certification and never sidecar certification. All three adapters remain at most `installable`, default-disabled, and neither `certified` nor `enabled`.

## Removal gate

Delete `channel-core`, `channel-telegram`, `channel-discord`, and `channel-feishu` together only after the production OpenClaw sidecar is reproducibly assembled, its owned keyless Gateway-to-Agent snapshot is running, and fresh certification covers every legacy platform still used for migration, including inbound admission, Agent execution, outbound delivery, duplicates, reconnect, and failure paths. Archive the legacy Agent Notes only in that removal change.
