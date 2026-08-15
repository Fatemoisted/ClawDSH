# OpenClaw AgentHarness bridge

English | [中文](README.zh.md)

This directory is the only code loaded into the locked OpenClaw Gateway. It keeps platform credentials, admission policy, protocol clients, and final delivery inside OpenClaw while forwarding admitted Agent turns to ClawDSH over authenticated local NDJSON JSON-RPC.

## Entry points

- `stable-v1/index.js` is built JavaScript for OpenClaw `v2026.7.1-2` (`0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`).
- `canary-v2/index.ts` targets the audited `f1ced37ce5df8c7bc7f3b46c579e5ce181feaae0` AgentHarness V2 API.
- `canary-v2/provider-policy-api.js` is the host-loaded provider route policy. OpenClaw loads this public artifact only from a host-verified official external install; an ordinary untrusted install therefore fails route selection before the harness can run.

Registration and plugin inspection are lazy: neither entry point requires supervisor environment, opens the socket, opens state, or reads the staging root. Each entry registers an OpenClaw background service, which runs only in a live Gateway and must complete the authenticated handshake during Gateway startup. Agent turns, health queries, and outbound actions then reuse that connection. A failed startup handshake leaves the ClawDSH supervisor unready and never falls through to an OpenClaw model.

## IPC

The first UTF-8 NDJSON frame is an authenticated handshake. Every later frame is strict JSON-RPC 2.0. The client bounds frame bytes and in-flight calls, serializes writes with backpressure, validates the handshake acknowledgement before accepting RPC, and reconnects only after a complete disconnect. The startup token appears only in the first frame.

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

The bridge sends `turn.run`, `turn.cancel`, `session.reset`, and `session.close`; it serves `channel.action`, the internal read-only `channel.reconcile`, and `health.get`; and it accepts negotiated `turn.progress` notifications. Its advertised outbound actions are exactly `send` and `poll`. Send supports verified staged media and requires one atomic `sendPayload` adapter call for multiple media objects. Every action is durably claimed before platform dispatch; a duplicate running action is not resent, and an uncertain post-dispatch failure is returned as `ambiguous`. Reconciliation can replay only an exact completed ledger entry; a missing, changed, or non-terminal entry fails without dispatch.

`edit`, `delete`, `react`, `typing`, all `directory.*` operations, and `resolve` are protocol-valid but deliberately return JSON-RPC method-not-supported errors. `delivery.report` is not advertised because OpenClaw does not expose a public final-delivery correlation hook on both locked tracks.

The stable V1 AgentHarness does not expose a safe materialized inbound-media fact. It rejects image/media-bearing turns instead of dropping or trusting an unscoped path. V2 accepts only local materialized facts beneath the configured staging root and verifies realpath containment, absence of symlinks, regular-file type, byte count, and SHA-256. Remote URLs are rejected.

For a non-owner direct message, stable V1 proves only that OpenClaw admitted the sender; it does not expose whether pairing or an allowlist authorized that admission. The bridge records the conservative `admitted` class instead of inventing a more specific security fact. Owner direct messages and allowlisted groups retain their precise classes.

The synthetic provider contains only `clawdsh/local`, pins `agentRuntime.id` to `clawdsh`, and has no model fallback list. Harness support requires that exact provider, model, and runtime. V2 additionally requires a route with no transport overrides and a runtime policy explicitly compatible with `clawdsh`; unsupported decisions never provide an OpenClaw fallback runtime.

OpenClaw receives only a minimal user/final-assistant transcript mirror. DSH remains the model-history authority, and no DSH transcript is copied back into OpenClaw.

## Local checks

```sh
node --test packages/openclaw/channel-openclaw/bridge/test/*.test.mjs
node packages/openclaw/channel-openclaw/bridge/verify.mjs
```
