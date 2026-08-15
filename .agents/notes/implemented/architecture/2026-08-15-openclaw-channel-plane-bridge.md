# Agent Note: A locked OpenClaw Gateway owns the channel plane

Status: implemented

English | [中文](2026-08-15-openclaw-channel-plane-bridge.zh.md)

## Problem

The first ClawDSH channel seam made a useful architectural test but chose the wrong reuse boundary. Its in-process `ChannelAdapter` reduced a platform to text receive/send, so every additional transport still required ClawDSH to own the SDK, credentials, webhook or polling lifecycle, identity model, admission policy, rich actions, attachments, retries, and platform drift. OpenClaw's current production catalog already contains 27 chat transports. Repeating that work would replace one difficult upstream ecosystem with dozens of incomplete local forks.

The opposite shortcut was also unsafe: starting an arbitrary OpenClaw checkout next to dsh would leave runtime identity, model fallback, message replay, and delivery ambiguity implicit. Communication software receives untrusted network input and can trigger tools, so “the process started” is not an acceptable admission condition.

## Decision

ClawDSH now separates the communication plane from the Agent plane at a strict authenticated V1 protocol. A supervised, immutable OpenClaw Gateway remains responsible for platform plugins, credentials, ingress, pairing and allowlists, identity normalization, native actions, media staging, and delivery. dsh remains responsible for the Session, Agent, tools, model choice, attachment store, and reconstructable model input. The Gateway is configured with the ClawDSH AgentHarness as its only provider and model path; fallback to an OpenClaw model is invalid configuration.

Three packages express the seam roles. `@clawdsh/dsh-channel` is the Service Definition and strict wire vocabulary, with one Provider and one Driver. `@clawdsh/dsh-channel-openclaw` is the Provider: it verifies the host lock, authenticates one private IPC peer, enforces the handshake, reports health, forwards actions, and owns the delivery ledger. `@clawdsh/dsh-channel-agent` is the Consumer/Driver: it binds complete OpenClaw route identities to dsh Sessions, persists generations and idempotency, imports verified media, drives the Agent, registers a route-scoped `message` tool, and stores complete sanitized provenance on the known `user/message` source.

Production admits only OpenClaw `v2026.7.1-2` at commit `0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`, with its npm artifact, extracted host tree, checked npm dependency lock, and complete installed runtime bytes locked. Installed-runtime digests are platform- and architecture-specific; the initial approved assembly is Darwin arm64, and every other pair fails closed until it has its own reviewed lock. Canary admits source commit `f1ced37ce5df8c7bc7f3b46c579e5ce181feaae0` only for isolated audit and compatibility work; it has no locked built host and cannot use managed execution. The stable catalog is 1 core + 2 bundled + 21 repository-official + 3 external, or **24+3**. QQ Bot is repository-official in that lock; the external entries are WeChat, Yuanbao, and Zalo ClawBot. Track-specific governance catalogs bind every external entry to the same exact package and record license declaration, platform-terms review, and security review separately; all reviews remain pending and therefore block installability.

An opt-in external plugin is one isolated npm project rather than one primary package. Its lock covers the project manifest, visible and hidden npm locks, primary plugin, every transitive dependency file, and internal file-link targets. An optional nested `openclaw` peer may point only to the separately verified host; its presence remains part of the project digest while the host runtime lock owns its target bytes. An empty extension list remains the default and rejects every untracked project.

## Protocol and ownership

The handshake binds the protocol version, Gateway state lineage, per-startup nonce, exact tag, commit, artifact SHA-512, Node engine, AgentHarness generation, actions, notifications, and extensions. A mismatch closes the peer. POSIX endpoint ownership is enforced with a private `0700` parent and `0600` socket plus an ephemeral token. Windows is fail-closed until a native named-pipe ACL seam can provide equivalent authorization. Every Node preflight and the Gateway also receives deletion entries for inherited `NODE_*`, native-loader, OpenSSL module/config, TLS trust-path, and TLS key-log variables, so ambient process settings cannot replace loaders or weaken the verified execution context.

Inbound operations are `turn.run`, exact `turn.cancel`, and generation-aware `session.reset` / `session.close`. The Provider can query `health.get`; the bridge may negotiate `turn.progress` and `delivery.report`. Agent-originated `channel.action` covers messaging, reaction, poll, typing, directory, and resolution operations, but capability negotiation may narrow the set and the platform remains authoritative for support.

Durability distinguishes repeated transport from repeated Agent execution. An equal idempotency request attaches to a live run or replays a terminal record. Reusing a key with different content fails. A crash-orphaned running record becomes `needs-recovery`, because tools may have produced side effects and no automatic rerun is safe. Reset and close write a durable bridge transition before the DSH request, commit the acknowledged route and prior-Session control identity, then remove the transition; startup and the next turn recover any interrupted transition. Delivery receipts are also durable and monotonic; `ambiguous` is an operator/provider reconciliation state, never implicit permission to resend.

Before model execution, the Driver commits admission and idempotency to its durable ledger. The known `user/message` contains complete sanitized channel provenance. Owner direct messages may mount the owner preset; every other sender and group mounts a restricted preset, and groups must already carry OpenClaw's group-allowlist admission.

## Session logging

The original implementation declared `channel/turn-admitted` and `channel/delivery` Session events, but dsh cannot safely persist them from an out-of-tree plugin. `Session.append()` exposes no way to set `ignorable: true`, while resume accepts only the upstream-generated static `KNOWN_SESSION_EVENT_TYPES`. Writing either downstream name would make a later reader fail closed even though TypeScript declaration merging accepts the payload at compile time.

The implemented safe degradation therefore appends neither name. Model reconstruction uses the existing `user/message` envelope and its merge-extensible `source.kind = 'channel'`; admission, idempotency, and delivery state remain authoritative in the channel-agent and Provider durable ledgers. Delivery metadata is not model input. Namespaced Session events stay deferred until dsh provides an ignorable append option or another composition-independent downstream event registration seam; `docs/upstream-proposal/session-plugin-events.md` records the required surface.

## Media and action limits

Inbound images cross the staging boundary only after canonical-root confinement, per-component symlink rejection, size checks, media-type checks, and SHA-256 verification, then become dsh image attachments. Audio, video, and generic files stay rejected because dsh has no durable non-image attachment seam. Outbound media also stays rejected because no dsh staging writer exists. These failures are explicit rather than silent text-only degradation.

The route-scoped model tool exposes send, edit, delete, react, poll, typing, directory queries, and target resolution. Every call still passes through the connected Gateway's negotiated action list, and the locked bridge currently advertises only send and poll. No action is treated as successful merely because it is protocol-valid or another channel implements it.

## Support and replacement

Support advances only through `cataloged → installable → certified → enabled`. Cataloged records provenance; installable proves exact locked assembly plus per-Channel configuration, capability-probe, and keyless contract evidence; certified additionally proves the current release composition, security and delivery behavior, keyless assembled transcript, and required live platform traffic; enabled is an explicit active shipped-profile decision. The implementation foundation does not skip these gates.

The current sidecar is not installable, certified, or enabled at any individual Channel. The production profile contains the complete new seam as a default-disabled group and no longer starts a legacy adapter, but the upstream snapshot runner does not discover the owned channel packages and this change ran no fresh Telegram or Feishu live smoke. Stable V1 cannot project safely staged inbound media; the locked host exposes neither a correlated final-answer delivery hook nor aggregate account health; external reviews remain pending; and persistence and resume evidence must prove the known-event degradation above. The legacy packages remain separately available, under a non-conflicting Service namespace, until the owned snapshot path and equivalent live smokes pass; their historical tests do not certify the new host or execution path.

## Alternatives considered

- **Continue adding native in-process adapters** — rejected because ClawDSH would own every platform integration and continuously lag upstream behavior and fixes.
- **Port the OpenClaw channel source into ClawDSH packages** — rejected because internal imports and Gateway lifecycle assumptions turn copied source into a fork rather than reusable code.
- **Embed OpenClaw in the dsh process** — rejected because dependency, failure, and credential ownership would mix with the Agent runtime and make exact-host replacement harder.
- **Track a floating OpenClaw branch** — rejected because it cannot supply reproducible artifacts, reviewable deltas, or durable certification evidence.
- **Use an optional pre-Agent hook as the handoff** — rejected because a missing or unhandled hook can fail open; the sole configured AgentHarness is a stronger execution choke point.

## Consequences

The migration unit is now an audited Gateway release and catalog rather than a channel implementation. This makes current OpenClaw ecosystem coverage reachable without placing platform SDKs in ClawDSH, and it gives dsh a narrow Service Definition that can outlive a particular Gateway release. The cost is a real deployment subsystem: immutable artifacts, a supervised child, private IPC, durable reconciliation, track-specific compatibility, per-channel live certification, explicit media and Windows follow-up work, and an upstream Session append seam before redundant namespaced channel events can be persisted. ADR-0008 owns the architecture, the bridge feature spec owns current behavior and gaps, and the channel sync standard owns future lock promotion.
