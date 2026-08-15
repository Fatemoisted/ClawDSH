# @clawdsh/dsh-channel

English | [中文](README.zh.md)

`@clawdsh/dsh-channel` is the Service Definition for ClawDSH messaging. It keeps one communication-plane provider and one Agent-plane driver behind `ctx.channels`, and defines the versioned values exchanged with an OpenClaw Gateway. Platform credentials, protocol clients, Agent execution, session persistence, and delivery ledgers remain outside this package.

## Service API

| Member | Contract |
|---|---|
| `registerProvider(provider)` | Reserves the single communication-plane slot. A blank id or second provider fails before publication. The returned disposer releases the slot with its Cordis fiber. |
| `registerDriver(driver)` | Reserves the single Agent-plane slot. A second driver fails before publication. The returned disposer releases the slot with its Cordis fiber. |
| `runTurn(turn, execution)` | Sends one validated inbound envelope to the driver. `execution.signal` belongs to the run lifecycle; a transient IPC disconnect must not abort it. Optional progress uses `execution.notify`. |
| `cancel`, `reset`, `close` | Forward explicit turn and session controls to the driver, preserving the supplied `AbortSignal`. |
| `reportDelivery(report)` | Projects a provider-committed final-turn receipt to a driver that implements the negotiated `delivery.report` extension. Provider ledger durability precedes this call. |
| `action(action, signal?)` | Sends one discriminated native operation to the provider and returns a delivery receipt, sanitized directory entries, or target-resolution results. |
| `health(signal?)` | Returns sanitized provider, Gateway, and per-account state. |

Missing roles, duplicate registrations, an invalid provider id, and an unsupported delivery-report projection throw `ChannelError` with stable codes. Provider and driver failures propagate unchanged.

## Protocol

Every base payload carries `protocolVersion: 1`. `CHANNEL_BRIDGE_METHODS_V1` names the six requests: `turn.run`, `turn.cancel`, `session.reset`, `session.close`, `channel.action`, and `health.get`. `CHANNEL_BRIDGE_NOTIFICATIONS_V1` names the id-less `turn.progress` notification and the optional `delivery.report` extension; a peer must not emit either without the corresponding negotiated capability.

`protocol.ts` exports strict zod validators for the handshake, inbound and terminal turns, controls, outbound and query action variants, action results, delivery receipts, progress notifications, health, and delivery reports. `ChannelBridgeRequestMapV1` and `ChannelBridgeNotificationMapV1` provide the corresponding compile-time method maps. Validators reject unknown object fields. Opaque external identifiers are branded after validation. Staged media uses a relative path, exact byte count, canonical lowercase SHA-256, media type, and contiguous ordinal; providers must still verify the opened bytes and staging-root containment before publication.

Sender trust records the strongest admission fact the host actually exposes. `admitted` means the host proved a direct message passed admission but did not expose whether pairing or an allowlist made the decision; consumers must treat it no more permissively than the restricted preset.

The handshake identifies the Gateway lineage, locked OpenClaw tag and commit, artifact SHA-512, Node engine, AgentHarness generation, supported actions and notifications, optional extensions, and startup nonce. It authenticates no peer by itself; the provider owns local IPC authentication and compares these fields to its deployment lock.

`ChannelActionV1` is closed over `send`, `edit`, `delete`, `react`, `poll`, `typing`, the four OpenClaw directory operations, and target resolution. Directory results omit provider `raw` data and avatar URLs; resolution results carry branded platform identities only after validation. A provider checks the selected account's live capabilities before execution and fails an unsupported operation rather than reporting success. `ChannelDeliveryReceiptV1` distinguishes accepted, confirmed, retrying, ambiguous, and dead-letter states. An ambiguous receipt never authorizes blind resend.

## Extension points

A provider registers `ChannelProviderV1`; the OpenClaw sidecar provider is the intended implementation. A consumer registers `ChannelDriverV1`; the Agent consumer owns DSH session mapping, presets, model execution, model-visible logging, and optional delivery receipt projection. Production and canary runtimes use separate contexts, so each still has exactly one provider and one driver.

## Model Experience

### Channel Service Definition

#### What the model sees

Nothing directly from `ctx.channels`. A consumer may turn admitted messages into model input or expose channel actions as tools; that consumer owns the exact text, schemas, permissions, and session events.

#### Token effect

Zero direct tokens. This package contributes no system-prompt section, user message, tool schema, or model request.

#### KV Cache effect

No direct invalidation. Provider registration, health checks, wire validation, and delivery receipts do not alter a model request prefix.

## Known Limitations and Deferred Work

- **Chat and directory actions only** — voice calls and meeting streams require separate lifecycle types; they are not encoded as fake chat actions.
- **Negotiated delivery projection is optional** — the provider always owns the authoritative delivery ledger. A driver without `reportDelivery` causes `CHANNEL_DELIVERY_REPORT_UNSUPPORTED`, and the extension must not be advertised for that assembly.
- **Validation is not transport security** — frame limits, Unix-socket permissions, Windows named-pipe ACLs, ephemeral authentication, artifact verification, and staged-file opening belong to the provider.
