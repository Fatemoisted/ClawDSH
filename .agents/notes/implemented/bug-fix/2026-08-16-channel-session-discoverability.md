# Agent Note: Channel Session discoverability preserves stored workspace identity

Status: implemented

English | [中文](2026-08-16-channel-session-discoverability.zh.md)

## Problem

The [OpenClaw channel-plane bridge](../architecture/2026-08-15-openclaw-channel-plane-bridge.md) gives every admitted route generation a deterministic durable DSH Session, but those Sessions were difficult to find in the ordinary Web workspace. Channel turns did not publish a readable title or workspace membership, so a successful external conversation could exist in persistence without an obvious entry in the session list.

Adding publication exposed a persistence hazard. The runtime `cwd` is restart-scoped configuration, while a Session header records immutable creation metadata. Resolving workspace membership from the current config would move a resumed route to a different workspace after a configuration change, then make `attachSession()` reject the mismatch between that new path and the stored header. A presentation failure could therefore prevent an otherwise valid external message from reaching the Agent. Older Session headers can also lack `cwd`, so publication needs an explicit degradation instead of inventing a path.

## Decision

`@clawdsh/dsh-channel-agent` publishes optional host presentation metadata after a newly created or resumed Agent reaches idle. When `sessionTitle` is installed and reports no existing title, the driver assigns `外部消息 · <channel> · 私聊` or `外部消息 · <channel> · 群聊` and flushes the Session. The title contains only a normalized, bounded channel name and the route kind. It excludes message text, account and conversation identifiers, and sender identifiers or names; an existing title is never overwritten.

Workspace publication treats the Session header as authoritative. The configured `cwd` is validated as an absolute path before driver creation and is passed only when a new route Session is created. A resumed Session keeps its immutable header, and `workspaceRegistry.resolveByPath()` receives `handle.agent.session.header.cwd`, never the current restart config. Changing config from workspace A to B therefore leaves an existing route associated with A, while a newly created route records and publishes B.

When a legacy Session header has no `cwd`, title handling still runs, workspace resolution and attachment are skipped, and the driver emits one fixed warning without route data or paths. Title lookup, title persistence, workspace resolution, and workspace attachment failures are contained independently and emit only fixed diagnostics. None of these optional presentation failures changes the channel-turn result or suppresses message delivery.

## Alternatives considered

**Resolve every Session against the current configured `cwd`.** Rejected because restart configuration is not durable Session identity. It would publish a resumed Session under a path that disagrees with its immutable header and could make ordinary configuration drift break channel delivery.

**Rewrite the stored header or migrate an existing route when `cwd` changes.** Rejected because Session header metadata and persistence location are immutable. Moving a conversation needs an explicit Session migration mechanism; presentation code cannot silently redefine its history or storage identity.

**Derive a more descriptive title from message, sender, account, or conversation data.** Rejected because those values can contain private content and platform identifiers. The route's channel type and direct/group distinction are sufficient for discovery without copying personal data into a global session list.

**Require title and workspace services, or fail the turn when publication fails.** Rejected because channel execution remains valid in headless compositions and presentation is not part of platform delivery. Optional host enrichment must not expand the failure domain of an admitted external message.

## Consequences

Channel conversations appear beside ordinary Web sessions when the host provides the corresponding services, while headless deployments retain the same execution behavior. Restart-time `cwd` changes have predictable scope: they affect only subsequently created route Sessions. An existing route remains in its recorded workspace until an explicit lifecycle action creates a different Session.

The privacy-safe title is intentionally less specific than a platform conversation name. Legacy Sessions without `cwd` can receive or retain a title but cannot be attached to a workspace through this mechanism. Operators receive a bounded warning rather than a failed message, and no dependency error, local path, route identity, sender identity, or message content enters that diagnostic.

## Verification

Focused Channel Agent tests exercise a new Session title and workspace attachment, existing-title preservation, sanitized title and workspace failure diagnostics, a legacy header without `cwd`, and restart config drift from workspace A to B followed by a new route using B. Settings-path coverage rejects a relative `cwd` before driver creation. The complete Channel Agent test directory, package typecheck, focused lint, bilingual pairing, Agent Note gates, and diff check validate the shipped behavior.
