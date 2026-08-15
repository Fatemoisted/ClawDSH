# ADR-0008: Reuse the current OpenClaw channel plane through a locked Gateway sidecar

English | [中文](0008-openclaw-channel-plane.zh.md)

- **Status**: Accepted (2026-08-15)
- **Date**: 2026-08-15
- **Supersedes**: ADR-0002
- **Depends on**: ADR-0001

## Context

ADR-0002 proved that a Cordis channel seam could drive an Agent turn, but its text-only `ChannelAdapter` design made ClawDSH reimplement each platform transport, identity rule, admission policy, media path, and native action. That approach cannot keep pace with the part of OpenClaw that controls ecosystem reach. The approved production OpenClaw release already catalogs 27 public chat transports: 1 core WebChat, 2 bundled channels, 21 repository-official extensions, and 3 externally maintained plugins. Rebuilding those integrations independently would duplicate mature code and create platform-specific security and delivery failures.

The channel plane therefore needs a different version policy from the older feature baseline. Non-channel parity may continue to use the early reference selected in Phase 1, while communication compatibility follows immutable, separately audited OpenClaw host locks. A floating branch, a historical adapter test, or package availability alone is not deployment evidence.

## Decision

### 1. Run OpenClaw's channel plane as the communication-plane owner

ClawDSH reuses an exact OpenClaw Gateway distribution in a supervised local sidecar instead of porting platform SDK integrations one by one. OpenClaw owns channel plugin discovery, platform authentication, webhook or polling lifecycles, sender and conversation identity, pairing and allowlist admission, inbound normalization, native channel actions, media staging, and final platform delivery. The sidecar must select the ClawDSH AgentHarness exclusively; an OpenClaw model provider or fallback may not answer a channel turn.

The production lock is OpenClaw `v2026.7.1-2`, dereferenced commit `0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`, npm package `openclaw@2026.7.1-2`, and its checked-in archive and extracted-tree digests. The approved canary is commit `f1ced37ce5df8c7bc7f3b46c579e5ce181feaae0`, observed 2026-08-15, but its lock names a source archive rather than a built deploy artifact. Canary is therefore isolated and source-audit-only until a separately reproducible built artifact is locked. The machine-readable authorities are `tools/openclaw-channel-host/host.production.json`, `host.canary.json`, and their channel catalogs.

| Track | Approved immutable input | Runtime disposition |
|---|---|---|
| Production | Tag object `be8b8a9e8838f832e4fa47cde8bea0a33aec71ba`; commit `0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`; npm SRI `sha512-ycF3yPcbjN6bUPeaUx6Mh6vze1hQWoD3CT/wWcmD7a8xaHHHRUaAlaq+lFxMHf1ssEgODVAwjlzYqp2twkYZ7g==`; 8,550-file tree SRI `sha512-t7hGQR0QkaIGfP6WS5OV1EOq4KZK6dcHB7nu0B7E6UlxS4UdtuFT6f+E2akFVAii6xjHndlEANWSk9OaZI4Niw==` | Managed host candidate; AgentHarness V1 |
| Canary | Commit `f1ced37ce5df8c7bc7f3b46c579e5ce181feaae0`, observed `2026-08-15T08:18:37Z`; 100,754,581-byte source archive SRI `sha512-PEjiTam3vygesQ22Pr0DF51CEqF6d9eCaxhzHxgyOkwKAIWJgoJO1ooskLPMakolKmP6J797QkG5aIyM4B/hRQ==` | Audit/compatibility only; AgentHarness V2; no managed execution without a built-artifact lock |

### 2. Split ownership at an authenticated protocol

| Owner | Authoritative responsibilities |
|---|---|
| OpenClaw Gateway and channel plugins | Platform SDKs, credentials, ingress, admission, canonical platform ids, channel feature mapping, staged transport media, native action execution, and delivery attempts |
| `@clawdsh/dsh-channel-openclaw` | Exact-host verification and supervision, private local IPC, startup authentication, handshake lock enforcement, provider health, and the authoritative delivery-receipt ledger |
| `@clawdsh/dsh-channel` | Provider-neutral V1 types and strict validation, plus exactly one communication provider and one Agent driver in `ctx.channels` |
| `@clawdsh/dsh-channel-agent` | Durable route generations, session binding, idempotency and replay, Agent execution, model-visible provenance on the known `user/message` event, attachment import, the route-scoped `message` tool, and the Agent-side durable ledger |
| Existing dsh services | Agent and Session lifecycle, persistence, model selection, tools, storage domains, and durable image attachments |

The V1 bridge admits `turn.run`, `turn.cancel`, `session.reset`, `session.close`, `channel.action`, and `health.get`; it can negotiate `turn.progress` notifications and the `delivery.report` extension. Every handshake pins the protocol version, Gateway lineage, startup nonce, OpenClaw tag, commit, artifact SHA-512, Node engine, AgentHarness generation, and exact capability lists. The handshake is identity evidence, not transport authorization: the provider also owns the per-startup secret and private endpoint policy.

`channel.action` is a closed union covering send, edit, delete, react, poll, typing, directory queries, and target resolution. A negotiated capability only says that the connected Gateway accepts the action; the selected platform may still return an explicit unsupported result. Delivery states distinguish accepted, confirmed, retrying, ambiguous, and dead-letter outcomes. An ambiguous result never permits a blind rerun of Agent tools or a blind resend.

Model-visible admission provenance is stored on the known `user/message` event as `source.kind = 'channel'`. Admission, idempotency, and delivery authority stays in the durable channel ledgers. ClawDSH does not currently append `channel/turn-admitted` or `channel/delivery` Session events: `Session.append()` cannot set `ignorable: true`, and persisted readers reject downstream event names absent from the upstream-generated `KNOWN_SESSION_EVENT_TYPES`. Namespaced Session events require the upstream seam proposed in `docs/upstream-proposal/session-plugin-events.md` and a separate ADR update.

### 3. Use four monotonic support states

Channel support claims use only `cataloged → installable → certified → enabled`.

- **Cataloged**: the channel appears in an approved machine catalog with known provenance. This says nothing about installation or runtime behavior.
- **Installable**: the exact channel artifact or locked in-repository source can be assembled with the compatible locked host and passes its integrity and manifest checks. This does not prove credentials, platform traffic, or an Agent round trip.
- **Certified**: that exact host-and-channel combination passes the release's contract, composition, security, delivery, and required live transport smoke. Historical tests and another channel's evidence do not qualify.
- **Enabled**: a certified channel is deliberately active in a shipped deployment profile. Enabled is operational state, not a synonym for implemented code.

Each state implies every state to its left. The production catalog is 24 core, bundled, or repository-official entries plus 3 external entries; the external entries are WeChat, Yuanbao, and Zalo ClawBot. QQ Bot is repository-official in the production lock. No channel is certified or enabled by this ADR.

### 4. Keep the legacy adapters until replacement gates pass

`channel-core`, `channel-telegram`, and `channel-feishu` remain legacy in-process compatibility adapters. Their earlier package and contract tests remain useful implementation history but do not certify a current deployment. They may be removed only after the sidecar composition is assembled, the required keyless snapshot path exists, and equivalent Telegram and Feishu live smokes pass on the production lock. This ADR supersedes ADR-0002 as the current architecture; it does not erase the legacy code or its Agent Notes before that gate.

## Known gaps

- **Gateway bridge and deployment**: the V1 Service Definition, durable Agent driver, lock verification, authenticated POSIX IPC provider, and protocol support are implemented. The production profile assembles them in one default-disabled group, but enables no channel. Canary has no locked built artifact.
- **Windows endpoint authorization**: POSIX uses a private `0700` parent and `0600` Unix socket. Windows named-pipe ACL enforcement lacks the required native seam, so the provider fails closed on Windows.
- **Attachments**: inbound staged images are path-, symlink-, size-, media-type-, and SHA-256-verified before entering the dsh attachment store. Audio, video, and generic files lack a durable non-image attachment seam. Outbound media lacks a dsh staging writer and fails explicitly.
- **Plugin Session events**: the current safe path uses the known `user/message` source plus durable sidecar ledgers. Persisting the declared `channel/*` events would make resume fail closed because downstream code cannot mark them ignorable; those event names remain disabled pending an upstream append seam.
- **Snapshots**: the upstream snapshot configuration does not discover `packages/openclaw/`, while the upstream `examples/` tree is read-only. No keyless assembled Gateway-to-Agent transcript exists yet.
- **Live certification**: this change did not run credentialed Telegram or Feishu traffic. Neither legacy adapter nor sidecar channel may be labeled certified or enabled.

## Consequences

- Channel ecosystem growth comes from updating one audited OpenClaw host and catalog rather than cloning dozens of platform implementations into ClawDSH.
- The cross-process protocol and durable ledgers add deployment work, but make identity, replay, cancellation, delivery ambiguity, and ownership explicit.
- Production updates must follow `docs/standards/openclaw-channel-sync.md`; a new upstream release never silently replaces an approved lock.
- Platform credentials remain in the OpenClaw communication plane. Only admitted, sanitized identities and verified staged content cross into the Agent plane.

## Alternatives

- **Continue one native ClawDSH adapter per channel**: rejected because it duplicates upstream SDK, admission, identity, and delivery logic and cannot cover the catalog safely.
- **Embed or fork the OpenClaw Gateway inside the dsh process**: rejected because dependency and lifecycle ownership would mix, and exact-host verification would be weaker.
- **Track OpenClaw `main` directly**: rejected because a floating runtime cannot be reproduced, audited, or certified.
- **Admit messages through an optional OpenClaw hook**: rejected because missing or bypassed hooks can fail open; the AgentHarness bridge must be the sole configured execution path.
