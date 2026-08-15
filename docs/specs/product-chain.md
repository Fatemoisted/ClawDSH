# Product chain and verification status

English | [中文](product-chain.zh.md)

- **Status**: current-state map for Phase 4
- **Purpose**: trace each ClawDSH feature from input through its dsh seam to model-visible or user-visible output without converting implementation evidence into certification

| Marker | Meaning |
|---|---|
| ✅ | current code or owned configuration supports the stated relationship |
| ⚠️ | implementation or verification gap; the statement is intentionally limited |
| ⏳ | accepted follow-up work, not current behavior |

## Summary

| Feature | Landing packages | Primary seam | Current result |
|---|---|---|---|
| ClawDSH local GUI | `preset-openclaw` | public dsh Web assembly | ✅ preset-only baseline; ⏳ product shell, Settings, and Activity |
| Current channel plane | `channel`, `channel-agent`, `channel-openclaw` | owned `ctx.channels` V1 | ✅ foundation; ⚠️ no certified or enabled channel |
| Legacy channel path | `channel-core`, `channel-telegram`, `channel-feishu` | `ctx.legacyChannels` | ✅ retained compatibility; ⚠️ no current certification |
| Persona | `soul` | `ctx.systemPrompt` | ✅ implemented |
| Memory | `memory`, `embeddings`, `embeddings-ark` | filesystem, tools, system prompt, owned embeddings seam | ✅ implemented |
| Skills | `skills-hub` | `ctx.skills` | ✅ implemented |
| Automation | `automation` | Agents and Sessions | ✅ implemented; disabled by default |
| Product identity | internal `preset-openclaw` source | `clawdsh` profile and presets | ✅ `ClawDSH 模式`; legacy `openclaw` assets are warning-only |

## ClawDSH local GUI

### Current baseline

`tools/link-clawdsh.sh` installs the `clawdsh` profile and preset. `pnpm dsh --profile clawdsh` starts the native dsh Web client, and new Sessions default to `ClawDSH 模式`. Feishu, Telegram, and Automation are disabled in the clean-install baseline, so the Web Host does not require their credentials.

### Accepted product chain

| Link | Owner and behavior |
|---|---|
| Entry | `/clawdsh/` is the ClawDSH product route; `/` remains native dsh Web |
| Conversation | reuse the public dsh client module graph, loading state, and chat renderer |
| Settings | ClawDSH Control Runtime projects allowlisted feature schemas, desired/runtime revisions, restart state, and credential presence |
| Activity | current-Session semantic projection for Prompt, Memory, Channels, Skills, and Automation; raw Trajectory stays in Harness Advanced |
| Harness Advanced | explicit route to the unmodified native dsh GUI and diagnostics |
| Isolation | no new Client Slot and no changes to `api-proxy`, Client Catalog, Agent Loop, generated files, or upstream GUI source |

⏳ ADR-0007 accepts this product posture, but the product shell and control pages are not implemented by the preset-only baseline. `dsh --profile web` remains a pure Harness path.

## Current OpenClaw channel plane

### Wiring

| Link | Owner and behavior |
|---|---|
| Platform transport | locked OpenClaw Gateway and channel plugins own credentials, ingress, admission, canonical ids, native actions, media staging, and delivery |
| Host provenance | `tools/openclaw-channel-host` locks production `v2026.7.1-2` / `0790d9f...` and a source-only canary; production catalog is **24+3** |
| Local Provider | `channel-openclaw` verifies host identity, authenticates private IPC, enforces handshake capabilities, reports health, forwards actions, and persists delivery receipts |
| Service Definition | `channel` validates V1 payloads and dispatches between exactly one Provider and one Driver |
| Agent Driver | `channel-agent` persists route generations, Session bindings, idempotency and recovery state, imports verified images, chooses a preset, drives an Agent, and exposes a route-scoped `message` tool |
| Durable output | terminal Agent results and delivery receipts are reconciled without treating ambiguous delivery as permission to resend |

The chain is platform → OpenClaw admission → authenticated `turn.run` → `ctx.channels` → durable Agent driver → dsh Session/Agent → terminal result → OpenClaw delivery. The bridge rejects a different host tag, commit, artifact digest, Node engine, Gateway lineage, startup nonce, AgentHarness generation, protocol version, or unnegotiated capability. OpenClaw must select `clawdsh/local` exclusively with no model fallback.

### Execution and replay

- ✅ One Gateway-scoped idempotency key maps to one envelope digest. Equal in-flight requests attach, terminal records replay, and conflicting content fails.
- ✅ A crash-observed running turn becomes `needs-recovery` instead of rerunning tools with unknown side effects.
- ✅ Route identity includes Gateway, OpenClaw Session key, generation, channel, account, conversation, optional thread, and direct/group kind; reset and close retire exact generations.
- ✅ The Agent ledger commits admission before model execution, and the known `user/message` event carries complete sanitized channel provenance.
- ✅ Delivery receipts are durable and monotonic; ambiguous delivery requires reconciliation and never permits blind resend.
- ⚠️ The complete group is disabled by default, and no channel has the assembled and live evidence required for certification.

### Actions and attachments

The protocol covers send, edit, delete, react, poll, typing, directory queries, and target resolution. The connected Gateway advertises the allowed subset, and each platform can still reject an operation explicitly.

Inbound images are confined to a canonical staging root, checked for symlinks, size, media type, and SHA-256, then stored through dsh attachments. Audio, video, and general files fail until dsh has durable non-image attachments. Outbound media fails until dsh owns a staging writer.

### Verification state

| Claim | Current state |
|---|---|
| Production roster provenance | **cataloged**: 27 entries, 24 core/bundled/repository-official + 3 external |
| Production sidecar channels | **cataloged** only; no exact per-channel assembly or certification |
| Canary | **cataloged** audit input only; its source archive is not a runnable built artifact |
| POSIX IPC authorization | private parent, socket mode, token, nonce, and exact handshake checks implemented |
| Windows IPC authorization | unsupported and fail-closed until named-pipe ACL enforcement exists |
| Plugin Session events | `channel/*` names disabled because downstream append cannot mark them ignorable |
| Keyless assembled transcript | missing because the upstream snapshot lane does not discover owned packages |
| Telegram / Feishu live traffic | no current certification evidence; neither sidecar nor legacy path is enabled |

## Legacy channel path

`channel-core` registers in-process text adapters under `ctx.legacyChannels`; Telegram uses grammY polling and Feishu uses the Lark long connection. Identity prefix, mention handling, and acknowledgement reactions belong to this legacy path.

- ✅ Packages remain available for replacement verification, and their historical tests describe their behavior.
- ⚠️ The contract has no exact OpenClaw host identity, durable route/idempotency/delivery ledgers, media path, or native action negotiation.
- ⚠️ Historical transport work does not satisfy the current release's certification requirements. Telegram and Feishu are at most installable.
- ⏳ Delete the three packages together only after the sidecar assembles, an owned keyless snapshot exists, and fresh Telegram and Feishu certification passes. Archive their Agent Notes only with that removal.

## Persona, Memory, Skills, and Automation

| Feature | Chain | Logged or user-visible result |
|---|---|---|
| Persona | preset → `soul` → ordered system-prompt section | prompt reaches the model through logged `request/header` |
| Memory recall | Markdown facts → index → recall prompt section | recall reaches logged `request/header` |
| Memory tools | `memory_search` / `memory_get` → tool result | result is a normal logged tool result; semantic search fails loud without a Provider |
| Skills | ClawHub-compatible directories → `skills-hub` → `ctx.skills` | mounted skill instructions and tools use normal dsh logging |
| Automation | cron/at/every rule → Agent Session → `automation/run` → plugin-sourced turn | event and turn remain reconstructable; feature is disabled by default |

✅ These features reuse dsh lifecycle and logging. Automation composes `ctx.agents` and `ctx.sessions`; it does not claim a nonexistent scheduling service.

## Profile composition

`preset-openclaw` is the internal source for the `clawdsh` Agent preset, example soul, and profile. The profile composes dsh base and Web bundles, then mounts Memory, Embeddings, Skills, opt-in Automation, and a default-disabled `channel → channel-agent → channel-openclaw` group. The physical directory name does not become a user-visible id.

- ✅ New Web Sessions default to `clawdsh`, displayed as `ClawDSH 模式`.
- ✅ Owner channel turns use `clawdsh`; every non-owner or group turn uses `clawdsh-messaging-safe` after OpenClaw admission.
- ✅ Disabled channel and Automation behavior may omit credentials; the product Settings increment will move optional runtime control behind mounted plugins' validated `enabled` settings.
- ✅ `tools/link-clawdsh.sh` installs only ClawDSH ids, warns about legacy `openclaw` assets, and neither aliases nor mutates them.
- ⚠️ A channel configuration row does not establish `enabled`; ADR-0008 requires certification first.

## Model-visible logging ledger

| Feature input | Model-visible form | Logged as | Status |
|---|---|---|---|
| Persona | system prompt | `request/header` | ✅ |
| Memory recall | system prompt | `request/header` | ✅ |
| Memory search | tool result | normal tool-result event | ✅ |
| Automation trigger | plugin-sourced user turn | `automation/run` plus normal turn events | ✅ |
| Current channel admission | user content and verified images | known `user/message` with sanitized channel source; authority in Agent ledger | ✅ |
| Current delivery update | not model input | Provider and Agent delivery ledgers | ✅ |
| Channel health and IPC bookkeeping | not model input | Provider health and ledger only | ✅ |
| Activity semantic record | not an additional model input | standard Session history plus ClawDSH sidecar projection | ⏳ |

## Release gaps

1. Implement the `/clawdsh/` product shell, Settings control plane, semantic Activity, and Harness Advanced navigation without changing upstream GUI source.
2. Finish the public installer and managed preset/profile repair path while preserving user settings, credentials, memory, and skills.
3. Add an owned keyless Gateway-to-Agent snapshot lane and complete exact per-channel assembly evidence.
4. Keep Windows fail-closed until named-pipe ACL enforcement provides equivalent authorization.
5. Add durable non-image attachments and outbound staging before enabling those media paths.
6. Run fresh Telegram and Feishu certification before enabling either route.
7. Obtain an ignorable append mechanism before persisting namespaced `channel/*` Session events.
8. Remove legacy adapters and archive their Notes only after every replacement condition passes.
