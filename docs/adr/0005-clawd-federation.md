# ADR-0005: clawd federation (`clawd-federation` transport provider) — ClawDSH-native multi-node delegation

English | [中文](0005-clawd-federation.zh.md)

- **Status**: Accepted (2026-08-14)
- **Date**: 2026-08-14
- **Depends on**: ADR-0001 (build-chain exemption), ADR-0002 (own-seam precedent)

## Context

"clawd" is the ClawDSH personal assistant: a resident daemon that runs the OpenClaw feature set on dsh's Cordis chassis. **Federation** is the ability for one clawd instance (node) to delegate a turn to another node over a wire, and to discover and authorize that peer before delegating — the OpenClaw "gateway + node bridge" capability that lets several assistants share work (a home node offloads a long task to a workstation node, a personal node calls a shared node's capability). The initiator confirmed this ADR must state what federation is and why ClawDSH needs it, because it is a new product concept, not a port.

Deep reading and two-tag verification (`v2026.1.15`, `v2025.9.13`) confirm **there is no OpenClaw origin to port**: the upstream gateway/node-bridge is entangled with OpenClaw's own message gateway and IM event loop, and no separable "federation" package exists. Federation is therefore a ClawDSH-native design. Its design template is OpenClaw's node bridge (`hello` + `caps`, `pair`/`approve`/`verify` with a 5-minute pairing TTL, `invoke` with an `idempotencyKey`) and its gateway protocol (a versioned `connect`/`hello-ok` handshake and a capability `snapshot` exchange) — the protocol *shape* is portable even though the code is not.

dsh already supplies the pieces a federation transport needs:

- the **subagent seam** — `ctx.subagents.registerProvider(provider: SubagentProvider)` (`packages/subagent/subagent/src/index.ts`) registers a named, effect-scoped, HMR-safe provider;
- the **out-of-process settlement vocabulary** — `NO_START_CAPABILITIES`, `settleRunResult`, `subprocessRunHandle` (`packages/subagent/subagent/src/out-of-process.ts`) — the seam contract that a remote run's `result` never rejects and is flattened to a stop reason;
- the **stdio JSON-RPC template** — `@deepseek-ai/dsh-subagent-dsh-sdk` (`packages/subagent/subagent-dsh-sdk/`) — which already drives a complete child DeepSeek Harness runtime over stdio JSON-RPC through `@deepseek-ai/dsh-sdk-client`.

This ADR is **evaluation-only**: the initiator decided **no spike package** this batch. The ADR records the design and the discovered gap; implementation stays deferred.

## Decision

1. **Federation is a `'clawd-federation'` subagent transport provider.** A node is modeled as a `SubagentProvider` registered on the existing subagent seam, not a new top-level service. Delegating to a peer reuses `ctx.subagents` start/run/dispose; the provider owns the wire driver.
2. **Node registration + pairing.** Peers are registered by an address (a stdio command/URI) and authorized through a pairing exchange (`pair`/`approve`/`verify`, 5-minute TTL) modeled on OpenClaw's node bridge, so an unpaired node can never be invoked.
3. **Capability exchange = `SubagentCapabilities`.** The `hello`/`caps` handshake maps to the existing capability shape (`outputSchema`/`depthLimit`/`toolFilter`/`persona`); a remote node advertises `NO_START_CAPABILITIES` — an out-of-process child cannot honor parent-enforced start features, and the seam already rejects those requests before `start`.
4. **Wire = versioned JSON-RPC over stdio, first.** The transport reuses the `subagent-dsh-sdk` template (versioned `connect`/`hello-ok` handshake, capability snapshot exchange); a remote node is a distinct binary, so stdio is the zero-dependency default, with the wire versioned for a later TCP/WS upgrade.
5. **`invoke` is idempotent.** Each invoke carries an `idempotencyKey` (OpenClaw's node-bridge pattern) so a retried transport never double-runs a turn.
6. **Settlement reuses the seam contract.** The provider publishes through `subprocessRunHandle` and settles via `settleRunResult`, so `result` never rejects and a peer failure becomes a `stopReason: 'error'` / `'aborted'` exactly like any other out-of-process backend.

## Deferred implementation and the discovered gap

This ADR writes down the plan and one gap found during reconnaissance; no code lands this batch.

- **`list_agents` discovery gap.** `list_agents` (`packages/subagent/tool-subagent-control/src/list-agents.ts`) reads `ctx.subagents.listChildren(parent.id)` — the session-backed continuable projection — and filters to `entry.mode === 'continuable'` (line 77). A remote federated node is not a session child, so it never appears in discovery, and the model cannot name it as a delegation target. **Recorded extension plan**: either widen the registry visibility (teach the projection to surface registered remote-node entries), or add a federation-specific discovery tool; both are evaluated when federation is implemented, not now.
- **Security hardening, reconnect, backpressure.** Peer authorization beyond the pairing TTL (key rotation, revocation), reconnection after a peer restarts, and per-invoke backpressure are deferred with the implementation.

## Consequences

- ✅ clawd gains a native federation design that reuses the subagent seam (no new top-level service) and the stdio template, so a future implementation is a provider + wire driver, not a new seam;
- ✅ the OpenClaw protocol *shape* (node bridge + gateway) is preserved while the entangled upstream code is deliberately not ported;
- ⚠️ this is an evaluation-only ADR — no spike package and no contract code exist yet; the design rests on the reconnaissance above, not on a running prototype;
- ⚠️ the `list_agents` discovery gap is real and must be resolved before federation is usable from the model's perspective; it is recorded, not fixed, this batch;
- ⚠️ a future federation transport reintroduces network surface (pairing, wire trust, reconnect), which the stdio-first default keeps minimal until then.

## Alternatives

- **gateway-WS-first (rejected at spike stage)**: a WebSocket-first transport would jump straight to the network surface before a single-node stdio path is proven; the stdio-first default defers that risk.
- **Extend `list_agents` this batch (rejected)**: the gap is only reachable once federation exists; widening the session-backed projection now would add an unowned change for a consumer that does not yet exist.
- **Port OpenClaw's device federation (rejected — nothing to port)**: two-tag verification found the gateway/node-bridge entangled with OpenClaw's IM event loop, not a separable package; the protocol shape is the only portable artifact, and it is captured here.
