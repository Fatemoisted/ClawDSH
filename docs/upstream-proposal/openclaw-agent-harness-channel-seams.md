# Proposal: expose complete channel-turn facts through OpenClaw AgentHarness

English | [中文](openclaw-agent-harness-channel-seams.zh.md)

- **Status**: proposed; not implemented in OpenClaw or ClawDSH
- **Owner sought**: OpenClaw Gateway and AgentHarness maintainers
- **Motivating consumer**: an external AgentHarness that reuses OpenClaw as its communication plane

## Motivation

OpenClaw already owns channel authentication, admission, normalized identity, media staging, native actions, account lifecycle, and final platform delivery. An external AgentHarness can reuse that ownership only when the host exports the corresponding facts through one versioned, channel-independent surface. The locked production AgentHarness V1 reaches an external Agent for text turns, but its public surface does not provide trustworthy materialized inbound-media facts, a final delivery update correlated to the harness invocation, aggregate account health, or a stable native-action dispatcher. Reaching into individual channel plugins would recreate the coupling that AgentHarness is intended to remove.

These gaps make successful text generation observable while leaving successful platform delivery unprovable. They also prevent a consumer from importing media safely, reconciling an ambiguous send after a crash, or reporting which configured accounts are actually connected. ClawDSH therefore fails closed for those capabilities and does not certify any channel from bridge protocol support alone.

## Proposed host contract

Expose the following capabilities through AgentHarness or an adjacent public Gateway service. Exact TypeScript names may follow current OpenClaw conventions, but all fields and lifecycle obligations below must remain channel-independent.

### Inbound turn projection

Every admitted harness request carries:

- a stable inbound idempotency key and canonical channel, account, conversation, thread, sender, reply, group, and mention identifiers;
- the admission classification produced by OpenClaw, without credentials or raw authentication material;
- ordered media descriptors whose paths are relative to an explicitly configured staging root and include byte size, observed media type, digest, and lifetime;
- a correlation id retained through Agent execution and every resulting delivery attempt.

The projection is produced only after OpenClaw admission succeeds. A plugin may omit an unsupported fact, but must not synthesize an authoritative value.

### Final delivery lifecycle

Provide an ordered event or callback for every final AgentHarness result and native outbound action. Each update includes the correlation id, an idempotent attempt id, channel/account destination, action kind, platform message id when known, and one terminal state: `delivered`, `failed`, `ambiguous`, or `dead-letter`.

The host must emit `ambiguous` when a platform might have accepted a request but no authoritative receipt is available. It must not report success merely because the Agent produced text, and replaying a completed harness result must reuse or reconcile the prior delivery attempt rather than silently issuing an unrelated send.

### Account health snapshot

Provide a sanitized aggregate snapshot and change notification for every configured channel account. The minimum fields are stable channel/account ids, configured/enabled state, connection state, last transition time, reconnect state, and a diagnostic code safe to expose outside the credential process. Reading health must not initialize, log in, or mutate an account.

### Native action capability and dispatch

Provide a stable capability query and dispatcher for `send`, `edit`, `delete`, `react`, `poll`, `typing`, directory lookup, and identity resolution. Capability results are scoped to the exact channel/account/conversation and distinguish unsupported, temporarily unavailable, and forbidden. Dispatch accepts an idempotency key and returns the same correlated delivery lifecycle used for final replies.

### Fail-closed Agent ownership

When a route selects an external AgentHarness, its terminal `completed`, `silent`, `cancelled`, or `failed` result is authoritative. Failure, timeout, malformed output, or disconnection must never fall through to an OpenClaw model provider. The host should expose the selected harness identity in diagnostics so a supervisor can verify exclusive routing before accepting traffic.

## Security and compatibility

- Media descriptors are capabilities to already admitted staged bytes, not arbitrary filesystem paths or remote URLs.
- Health and delivery surfaces exclude tokens, cookies, webhook secrets, local absolute paths, and raw platform authentication evidence.
- Correlation and idempotency identifiers are opaque and stable across process restart for the retention period declared by the host.
- Capability negotiation allows older hosts to omit a complete feature. Partial implementation must not advertise that feature.
- AgentHarness V1 may receive an additive backport. AgentHarness V2 may use different TypeScript types, but must preserve the same cross-process semantics.

## Acceptance criteria

1. A fake channel and one representative real channel exercise admitted text and media through the public harness surface without importing channel-internal modules.
2. Tests cover delivery success, permanent failure, lost receipt, replay after restart, and an ambiguous platform acceptance without duplicate automatic send.
3. Multiple accounts with identical conversation ids remain distinct in inbound projection, health, action dispatch, and delivery updates.
4. Unsupported native actions fail before platform dispatch and are never represented as success.
5. Disconnecting or failing the selected external harness proves that no OpenClaw model request occurs.
6. Public API and type tests run for both the maintained V1 release line and V2 canary line.

## ClawDSH transition policy

ClawDSH will not patch around these gaps with per-channel code. If a release-critical path requires a host change before an upstream release is available, the temporary patch must target one exact OpenClaw commit, carry a checksum, implement only the missing public seam, and be deleted when the released contract is adopted. Final delivery, aggregate account health, stable inbound media, and native-action certification remain blocked until the corresponding public host capability passes contract and live tests.
