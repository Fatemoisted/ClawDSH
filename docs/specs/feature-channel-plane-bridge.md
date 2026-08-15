# Feature specification: OpenClaw channel-plane bridge

English | [中文](feature-channel-plane-bridge.zh.md)

- **Status**: foundation implemented; assembly and certification incomplete (2026-08-15)
- **Decision**: [ADR-0008](../adr/0008-openclaw-channel-plane.md)
- **Sync owner**: [openclaw-channel-sync](../standards/openclaw-channel-sync.md)
- **Packages**: `@clawdsh/dsh-channel`, `@clawdsh/dsh-channel-agent`, `@clawdsh/dsh-channel-openclaw`

## Goals

- Reuse the complete, current OpenClaw communication plane without copying one platform implementation per ClawDSH package.
- Keep platform credentials, admission, identity normalization, native actions, and delivery behavior inside the locked OpenClaw Gateway.
- Make the Gateway-to-Agent handoff authenticated, versioned, capability-negotiated, durable, replay-safe, and observable.
- Preserve dsh ownership of Sessions, Agent execution, model selection, tools, and model-visible logging.
- Support production and canary as separate immutable tracks; never execute a floating OpenClaw ref.

## Non-goals

- Reimplementing platform SDKs or claiming uniform action support across channels.
- Allowing the OpenClaw sidecar to choose an independent model or fall back around ClawDSH.
- Treating catalog presence, package installation, package tests, or a historical live smoke as release certification.
- Enabling any channel by default before its exact production composition is certified.
- Reintroducing a direct platform adapter or a second channel runtime alongside the canonical bridge.

## Runtime composition

```text
platform
  → locked OpenClaw Gateway + channel plugin (authenticate, admit, normalize, stage)
  → authenticated private IPC (`turn.run`)
  → @clawdsh/dsh-channel-openclaw (Provider)
  → ctx.channels
  → @clawdsh/dsh-channel-agent (Driver)
  → durable route/session/idempotency ledger
  → dsh Agent + Session log
  → terminal replayable result
  → Gateway native delivery (+ durable receipt only when a correlated hook is negotiated)
```

`@clawdsh/dsh-channel` is the Service Definition. It admits one Provider and one Driver and contains no platform branches. `@clawdsh/dsh-channel-openclaw` owns the communication-side Provider, exact host identity, private IPC, health, and delivery ledger. `@clawdsh/dsh-channel-agent` owns the Agent-side Driver, deterministic session binding, route generations, crash quarantine, model execution, and the route-scoped `message` tool.

## V1 protocol

| Direction | Method or notification | Purpose |
|---|---|---|
| Gateway → Provider | `turn.run` | Submit one admitted, normalized, idempotent inbound turn |
| Gateway → Provider | `turn.cancel` | Cancel one exact live `turnId` and `runId` |
| Gateway → Provider | `session.reset` / `session.close` | Advance or retire one exact route generation |
| Agent → Gateway | `channel.action` | Execute a negotiated platform-native action |
| Either control path | `health.get` | Return sanitized provider, Gateway, and account health |
| Provider → Gateway | `turn.progress` | Optional negotiated text, reasoning, tool, or status progress |
| Gateway → Provider | `delivery.report` | Optional negotiated final-turn delivery update |

The handshake must match the configured Gateway instance, startup nonce, production or canary host lock, Node engine, AgentHarness generation, and complete capability lists. Strict schemas reject unknown fields, NUL-bearing strings, malformed opaque ids, non-contiguous media ordinals, invalid paths, inconsistent route/trust pairs, and inconsistent action or receipt subjects. The local endpoint admits one authenticated peer. Readiness additionally waits for durable route recovery. A transient detach rejects socket-owned waits but lets admitted handlers persist their terminal result; shutdown aborts and drains active and detached handlers before storage closes, and progress never crosses to a replacement peer.

The locked stable and canary hosts expose no public hook that correlates the final AgentHarness answer with its platform delivery, so the current bridge negotiates no `delivery.report` extension. Its local `health.get` proves the authenticated bridge and host identity but cannot enumerate real account connection state through a public aggregate host API. Both missing host seams block certification; protocol support does not imply that the current adapter can provide either fact. The required OpenClaw host contract is proposed in `docs/upstream-proposal/openclaw-agent-harness-channel-seams.md`.

## Durable execution rules

- An idempotency key is scoped by Gateway lineage. Reusing it with different content fails; an equal in-flight request attaches; a terminal request replays its stored result.
- A crash-observed `running` record becomes `needs-recovery`. The next request returns a non-retryable reconciliation failure because Agent tools may already have produced side effects.
- Route identity includes Gateway, OpenClaw session key, generation, channel, account, conversation, optional thread, and direct/group kind. A closed or stale generation is rejected.
- Reset and close persist a bridge-side transition intent before the DSH request. The acknowledged route mutation and prior-Session control identity are committed before that intent is removed, so startup or the next turn can finish an interrupted transition without advancing the generation twice.
- Owner direct messages may select the configured owner preset. Every other direct sender and every group uses the configured restricted preset. Groups require OpenClaw's `group-allowlisted` admission class.
- The known `user/message` event carries complete sanitized channel provenance. The Agent-side ledger commits admission and idempotency state before execution; Provider and Agent ledgers keep delivery authority outside the Session log.
- Delivery status is monotonic. An ambiguous receipt requires operator or provider reconciliation and never authorizes a blind Agent rerun or resend.

## Session-log compatibility

The source type of the known `user/message` event is merge-extensible, so channel provenance can enter model reconstruction without inventing an event envelope. The persisted admission and delivery ledgers remain authoritative for transport recovery and are not model input.

The declared `channel/turn-admitted` and `channel/delivery` names are not appended in the runnable path. Upstream persistence recognizes a generated static `KNOWN_SESSION_EVENT_TYPES`, and the public `Session.append()` surface cannot set an event envelope's `ignorable: true`. A downstream namespaced event would therefore write successfully but make a later resume refuse the log. ClawDSH must keep this fail-closed degradation until dsh accepts an ignorable append option or another composition-independent downstream event seam. The proposed upstream contract is `docs/upstream-proposal/session-plugin-events.md`.

## Native actions and media

The protocol and route-scoped model tool model send, edit, delete, react, poll, typing, directory self/peer/group/member queries, and target resolution. Both the handshake and the channel implementation narrow the available set; the locked bridge currently advertises only send and poll, and unsupported operations fail explicitly.

Inbound images are imported only after their relative path remains inside the configured canonical staging root, no path component is a symbolic link, declared and observed sizes match a configured byte cap, the media type is enabled, and SHA-256 matches. Stable AgentHarness V1 does not expose trustworthy materialized inbound-media facts, so the production bridge currently rejects all inbound media before this importer. Audio, video, and generic files are rejected until dsh owns a durable non-image attachment service. Outbound media is rejected until a dsh-to-Gateway staging writer and an adapter path that consumes authenticated bytes exist.

## Host tracks and catalog

Production is locked to OpenClaw `v2026.7.1-2` / commit `0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`, with a verified npm tarball, extracted tree, dependency lock, and reviewed Darwin arm64 and Linux x64 installed-runtime digests. Its public chat catalog contains 27 entries: 1 core, 2 bundled, 21 repository-official, and 3 external, conventionally summarized as **24+3**. The exact list and per-package integrities live in `tools/openclaw-channel-host/channels.production.json`.

Canary is locked to source commit `f1ced37ce5df8c7bc7f3b46c579e5ce181feaae0`; its 31-entry catalog is audit input, not a production compatibility promise. Because the canary lock has no built host tree, managed execution must fail rather than infer one.

## Support state and current limits

The only valid progression is `cataloged → installable → certified → enabled`, with the definitions in ADR-0008. The approved catalogs establish catalog provenance; verified stable artifacts can establish installability when their compatible host assembly passes. External packages additionally require approved license, platform-terms, and security reviews. Certification additionally requires the exact release composition, security checks, delivery behavior, a keyless assembled transcript, and platform live smoke where credentials are required. Enabled additionally requires an explicit shipped profile choice.

Current implementation evidence establishes only `cataloged`. The shipped profile always mounts the sidecar composition and its invariant companions while the Gateway setting remains disabled. An owned keyless smoke validates safe Telegram and Feishu configuration against the real stable schema, traverses the locked Gateway, stable bridge, and DSH Agent, and runs in Linux x64 CI; the reviewed Darwin arm64 assembly has also passed it locally. No credentialed Telegram or Feishu transport smoke has run. The final-delivery, aggregate-account-health, stable inbound-media, Windows ACL, and external-governance gates remain open. Resume coverage must also prove that only known Session event names are persisted while the downstream-event seam remains unavailable.

## Certification gate

A production channel can advance beyond `cataloged` only after all of the following are true for the production lock:

1. A reproducible managed host and bridge artifact are locked and the shipped profile assembles the Service Definition, Provider, and Driver without an OpenClaw model fallback.
2. Contract, integrity, authentication, idempotency, reset/close, action, delivery, crash-recovery, attachment, persistence, and resume tests pass without downstream `channel/*` Session events.
3. A keyless assembled Gateway-to-Agent snapshot or equivalent owned snapshot harness runs in CI.
4. Telegram and Feishu complete fresh credentialed inbound, Agent, outbound, duplicate-delivery, and failure-path smoke tests.
5. Documentation marks the certified combinations and the profile deliberately enables only those combinations.
