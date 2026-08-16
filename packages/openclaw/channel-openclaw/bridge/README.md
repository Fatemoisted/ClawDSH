# OpenClaw AgentHarness bridge

English | [中文](README.zh.md)

This directory is the only code loaded into the locked OpenClaw Gateway. It keeps platform credentials, admission policy, protocol clients, and final delivery inside OpenClaw while forwarding admitted Agent turns to ClawDSH over authenticated local NDJSON JSON-RPC.

## Entry points

- `stable-v1/index.js` is built JavaScript for OpenClaw `v2026.7.1-2` (`0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`).
- `canary-v2/index.ts` targets the audited `f1ced37ce5df8c7bc7f3b46c579e5ce181feaae0` AgentHarness V2 API.
- `canary-v2/provider-policy-api.js` is the host-loaded provider route policy. OpenClaw loads this public artifact only from a host-verified official external install; an ordinary untrusted install therefore fails route selection before the harness can run.

The manifest is explicitly inert for unconditional Gateway startup and declares the narrower `clawdsh` AgentHarness activation. A Gateway configured with `agentRuntime.id: "clawdsh"` loads the plugin during agent-runtime startup planning, then one background-service lease owns the authenticated transport. Registration and plugin inspection remain side-effect free: neither entry point requires supervisor environment, opens the socket, opens state, or reads the staging root. The service reports ready only after the authenticated handshake and durable route-transition recovery complete. Agent turns, health queries, and outbound actions then reuse that connection. A failed handshake or recovery leaves the ClawDSH supervisor unready and never falls through to an OpenClaw model.

OpenClaw may evaluate the startup service and its process-wide AgentHarness through separate transformed module loaders. A native CommonJS singleton therefore owns the process-local lease registry instead of either transformed module's global object. Both adapters lease one transport keyed by AgentHarness generation and a digest of the complete immutable bridge environment, handshake, and bridge config. A mismatched instance fails service startup without opening another socket. The last matching service lease stops admitting attempts but defers transport disposal until every already admitted AgentHarness attempt settles; a later first lease creates a fresh bridge and connection, so Gateway service restart does not reuse disposed state or cut off a slow answer.

Presentation-only progress omits whitespace-only text and reasoning chunks before assigning sequence numbers because the wire protocol accepts only non-blank deltas. The final answer remains authoritative and is not derived from the progress stream.

## IPC

The first UTF-8 NDJSON frame is an authenticated handshake. Every later frame is strict JSON-RPC 2.0. The client bounds frame bytes and in-flight calls, serializes writes with backpressure, validates the handshake acknowledgement before accepting RPC, and reconnects only after a complete disconnect. Closing a connection rejects new calls, aborts every admitted inbound handler signal, and waits for those handlers to settle before bridge disposal completes. The startup token appears only in the first frame.

Required environment:

- `CLAWDSH_CHANNEL_ENDPOINT`
- `CLAWDSH_CHANNEL_TOKEN`
- `CLAWDSH_CHANNEL_STARTUP_NONCE`
- `CLAWDSH_CHANNEL_GATEWAY_INSTANCE_ID`
- `CLAWDSH_CHANNEL_STAGING_ROOT`
- `CLAWDSH_CHANNEL_MAX_FRAME_BYTES`
- `CLAWDSH_CHANNEL_MAX_IN_FLIGHT`
- `CLAWDSH_CHANNEL_MAX_MEDIA_BYTES`
- `CLAWDSH_OPENCLAW_TAG`
- `CLAWDSH_OPENCLAW_COMMIT_SHA`
- `CLAWDSH_OPENCLAW_ARTIFACT_SHA512`
- `CLAWDSH_OPENCLAW_NODE_ENGINE`
- `CLAWDSH_OPENCLAW_AGENT_HARNESS` (`v1` or `v2`, matching the selected adapter)

The plugin config exposes `controlTimeoutMs`, `routeStateMaxEntries`, and `deliveryStateMaxEntries`. All three are validated positive integers and have manifest defaults. Trusted official installs use OpenClaw's keyed state service. A locked external install cannot access that service in the stable host, so the bridge falls back to crash-consistent `0600` file-per-key state inside a private `0700` directory under OpenClaw's state directory; it does not silently fall back for any other state-service error. Reset and close write a durable route-transition intent before the DSH request, commit the acknowledged route change, then remove the intent. Startup and the next turn recover an incomplete intent before accepting that route; OpenClaw's prior Session id also makes an exact repeated reset hook idempotent.

## Implemented capability

The bridge sends `turn.run`, `turn.cancel`, `session.reset`, and `session.close`; it serves `channel.action`, the internal read-only `channel.reconcile`, and `health.get`; and it accepts negotiated `turn.progress` notifications. Its advertised outbound actions are exactly `send` and `poll`. Every action resolves the current host configuration through OpenClaw's public `api.runtime.config.current()` API, so channel-only hot reload and credential rotation do not retain the configuration used at bridge startup. Send supports verified staged media and requires one atomic `sendPayload` adapter call for multiple media objects. Every action is durably claimed before platform dispatch; a duplicate running action is not resent, and an uncertain post-dispatch failure is returned as `ambiguous`. Reconciliation can replay only an exact completed ledger entry; a missing, changed, or non-terminal entry fails without dispatch.

The stable host's public outbound adapter methods do not accept an `AbortSignal`. A shutdown signal can stop validation, authorization, and reconciliation before adapter dispatch; once a platform adapter call begins, bridge shutdown waits for it to settle and records an uncertain acknowledgement as `ambiguous` instead of claiming cancellation or resending it.

Platform ingress uses OpenClaw's stable platform message id for the DSH idempotency key. A Gateway-originated `agent` request without a platform message id uses its namespaced stable OpenClaw run id; a turn with neither identity fails before DSH execution. When OpenClaw prefixes transcript text with that exact message id, the bridge removes only the matching outer transport marker; for direct messages it also removes an exact structured sender prefix, while preserving any identical text authored inside the message. Message and sender identities remain in the validated envelope provenance instead of entering user-visible or model-visible text. The complete generated envelope is validated before `turn.run`, including NUL rejection, media ordering, and route/principal trust consistency.

`edit`, `delete`, `react`, `typing`, all `directory.*` operations, and `resolve` are protocol-valid but deliberately return JSON-RPC method-not-supported errors. `delivery.report` is not advertised because OpenClaw does not expose a public final-delivery correlation hook on both locked tracks.

The stable V1 AgentHarness does not expose a safe materialized inbound-media fact. It rejects image/media-bearing turns instead of dropping or trusting an unscoped path. V2 accepts only local materialized facts beneath the configured staging root and verifies realpath containment, absence of symlinks, regular-file type, byte count, and SHA-256. Remote URLs are rejected.

For a non-owner direct message, stable V1 proves only that OpenClaw admitted the sender; it does not expose whether pairing or an allowlist authorized that admission. The bridge records the conservative `admitted` class instead of inventing a more specific security fact. Pairing alone is not owner authorization; an operator must appear in OpenClaw's explicit `commands.ownerAllowFrom` configuration. Owner direct messages retain `owner`; every group is projected as `group-allowlisted`, including an owner-originated group, so the Agent consumer always selects the safe group preset.

The synthetic provider contains only `clawdsh/local`, pins `agentRuntime.id` to `clawdsh`, and has no model fallback list. Harness support requires that exact provider, model, and runtime. V2 additionally requires a route with no transport overrides and a runtime policy explicitly compatible with `clawdsh`; unsupported decisions never provide an OpenClaw fallback runtime.

OpenClaw receives only a minimal user/final-assistant transcript mirror. DSH remains the model-history authority, and no DSH transcript is copied back into OpenClaw.

Bridge failures use one fixed public code and message. Arbitrary local exceptions, RPC messages, paths, and credential-like values are not copied into assistant output or the OpenClaw transcript mirror.

## Local checks

```sh
node --test packages/openclaw/channel-openclaw/bridge/test/*.test.mjs
node packages/openclaw/channel-openclaw/bridge/verify.mjs
```
