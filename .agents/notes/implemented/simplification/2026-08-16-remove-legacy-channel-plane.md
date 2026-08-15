# Agent Note: Remove the duplicate legacy channel plane

Status: implemented

English | [中文](2026-08-16-remove-legacy-channel-plane.zh.md)

## Problem

ClawDSH carried two competing channel integration planes: the canonical locked OpenClaw Gateway seam and an in-process `channel-core` registry with direct Telegram and Feishu adapters. Both paths owned transport configuration, lifecycle, platform behavior, and tests. Keeping both made the supported runtime ambiguous and required ClawDSH to repeat work already owned by OpenClaw.

## Decision

The only runnable channel integration is the canonical `ctx.channels → channel-agent → channel-openclaw` plane described by the [channel-plane architecture note](../architecture/2026-08-15-openclaw-channel-plane-bridge.md). `@clawdsh/dsh-channel` defines the protocol, `@clawdsh/dsh-channel-agent` owns Agent execution, and `@clawdsh/dsh-channel-openclaw` connects the locked OpenClaw Gateway. The `channel-core`, `channel-telegram`, and `channel-feishu` packages and their workspace, graph, catalog, notice, and profile references are absent.

Two references to the removed packages remain intentionally. The read-only migration inventory recognizes legacy package and credential names without loading an adapter, reading credential values into its report, or copying secrets. The release-tool denylist rejects the old package names so a distribution cannot reintroduce the second runtime accidentally.

Telegram, Feishu, and Discord support follows only the canonical channel support ladder and its current evidence. Removing the direct adapters does not certify, enable, or claim live end-to-end support for any of those platforms.

## Alternatives considered

**Keep both planes behind separate configuration.** Rejected because two implementations still divide ownership, duplicate platform behavior, and leave operators unsure which path defines support.

**Move direct-adapter presentation and reaction behavior into the canonical packages.** Rejected because platform identity, mentions, reactions, credentials, and SDK lifecycle belong to OpenClaw; the DSH packages own the authenticated protocol and Agent execution instead.

**Remove every textual reference to the old packages.** Rejected because migration recognition and release denylisting are negative safeguards, not executable adapters. Deleting them would make migration less observable and permit accidental republication.

## Consequences

The source tree, workspace graph, generated catalogs, and distribution have one channel runtime. Direct-adapter-specific identity, mention, acknowledgement, and reaction behavior is not a ClawDSH package contract; the archived [identity-presentation](../../archived/feature/2026-08-14-channel-identity-presentation.md) and [ack-reaction](../../archived/feature/2026-08-14-ack-reaction-scope.md) notes are historical snapshots only. Any platform capability must advance through the canonical support ladder, while migration detection and the release denylist continue to prevent an unsafe cutover or reintroduction.
