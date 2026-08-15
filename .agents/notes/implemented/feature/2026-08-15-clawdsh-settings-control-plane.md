# Agent Note: ClawDSH Settings control plane

Status: implemented

English | [中文](2026-08-15-clawdsh-settings-control-plane.zh.md)

The [local GUI specification](../../../../docs/specs/feature-gui-web.md) owns the current user-visible behavior. This decision owns the Settings portion of the broader [product-shell decision](../../implemented/architecture/2026-08-15-clawdsh-product-shell.md); semantic Activity has separate storage and projection rules in its [feature specification](../../../../docs/specs/feature-activity.md).

## Problem

The ClawDSH product shell can identify capability ownership and Loader health, but a read-only inventory does not let users configure the product. Raw Loader mutation is not a safe replacement: optional behavior, dependencies, validation, credentials, and effect timing belong to the capability that implements them, and unmounting a plugin can remove the schema needed to repair its configuration.

A local settings UI also crosses durable and secret-bearing interfaces. Concurrent browser drafts must not overwrite newer values, reset must preserve installer-owned profile configuration, a saved restart-bound value must not be reported as active, and secret values must not return through RPC or remain in browser state.

## Decision

The loopback-only `/clawdsh-rpc` protocol v1 exposes `settings/describe`, `settings/mutate`, `settings/reset`, `credentials/describe`, `credentials/set`, and `credentials/unset` beside the existing read methods. Requests use exact versioned objects; the Host rejects unknown fields, namespaces, credential ids, setting paths, and prototype-pollution path segments before persistence. The product manifest, rather than browser input, owns namespace order, copy, dependencies, editor choice, and field write permissions.

The fixed Settings namespaces are:

| Capability | Namespace | Product behavior |
|---|---|---|
| Soul | `clawdsh-soul` | User editable; changes affect new Sessions |
| Channel Protocol | — | Required Service Definition with no user namespace |
| Agent Bridge | `clawdsh-channel-agent` | Required; managed preset and media fields remain read-only |
| OpenClaw Gateway | `clawdsh-channel-openclaw` | Disabled by default; deployment identity and paths remain managed |
| Memory | `clawdsh-memory` | Enabled by default; runtime effects change after restart |
| Ark Embeddings | `clawdsh-embeddings-ark` | Memory dependency; API key is a separate fixed credential reference |
| Skills Hub | `clawdsh-skills-hub` | Enabled by default; provider registration changes after restart |
| Automation | `clawdsh-automation` | Disabled by default; rules save as one atomic field |
| Activity | `clawdsh-activity` | Required package namespace with managed fields only |

Each namespace registers its existing Config schema with the dsh Settings service. Resolution is `schema default → profile base → user settings`; `reset` removes the complete user layer for that namespace and never rewrites profile base configuration. The Host returns the resolved value, schema, base and user layers when present, field permissions, effect timing, and separate `desiredRevision` and `runtimeRevision` values.

Each mutation carries `expectedRevision` and a bounded, non-empty set of distinct `{ op: 'set' | 'unset', path, value? }` operations. The server validates the complete candidate and persists the operations atomically, so cross-field constraints never observe a partially saved draft. A stale revision fails as `settings-conflict`; the server neither merges nor retries it. `restartRequired` compares the desired and runtime values rather than revision numbers, so changing a value and then resetting it to the applied value clears the restart marker. Effect timing is one of `live`, `new-session`, `next-call`, or `restart`.

ClawDSH capability plugins remain present in Loader composition so their schemas and health stay available. Their validated `enabled` field controls business effects at mount: disabled Memory registers no prompt, tools, watcher, or flush behavior; disabled Skills Hub registers no provider; disabled Automation creates no timer, runtime, or Automation Session. Soul uses a Host-owned singleton namespace and Session instances only read the resolved value, so existing Sessions do not change. Agent Bridge remains required and performs no external network work by itself.

OpenClaw Gateway stays mounted with `enabled=false` and then performs no artifact validation, socket binding, Gateway launch, or Provider registration. An attempt to enable it runs the complete managed-deployment preflight before persistence; failure leaves both the stored value and revision unchanged. Managed track, deployment identity, artifact/runtime/config/state/staging/socket paths, locked extensions, and media limits are visible but read-only. A running Gateway does not make a platform account ready, certified, or enabled.

Ark Embeddings uses the fixed `ARK_API_KEY` credential reference and resolves it for each call. It does not accept a literal API key setting. The credential RPC allowlist exposes only credentials owned by dsh, reports configured and writable state without a value, and never includes Feishu, Telegram, or another OpenClaw platform credential. OpenClaw exclusively owns those platform secrets, accounts, and state; they do not enter dsh credentials, Settings RPC, browser state, logs, Session files, or Activity storage.

The Settings page gives each namespace an independent draft and revision. Schema metadata drives generic string, number, boolean, enum, nested-object, and string-array fields; the product manifest selects dedicated Automation rules and Gateway deployment editors. A conflict preserves the draft and blocks another save until the user explicitly reloads that namespace. A credential value exists only in the password field and outgoing set request, and the browser clears the field in `finally` after success or failure; responses and retained component state contain only secret-free descriptors.

## Verification

Protocol and runtime tests pin exact-object parsing, static allowlists, pollution-path rejection, stale-revision conflicts, reset layering, desired/runtime value comparison, preflight-before-persist ordering, and secret-free credential responses. Capability tests pin that disabled plugins remain describable while their business effects are absent and that Ark resolves only the fixed reference.

Browser tests pin independent drafts, schema controls, the atomic Automation editor, managed Gateway fields, conflict-and-reload behavior, and credential cleanup after both successful and failed requests. The keyless real-profile journey starts without an OpenClaw artifact or external credential, discovers every mounted capability namespace, confirms Gateway is disabled, and confirms that platform credentials are absent from the product control plane. Focused Host tests cover mutation, reset, restart state, and stale-write rejection.

The required Activity package registers the managed Activity namespace. Its Session-history projection, sidecar records, pagination, and UI remain governed by the separate Activity specification rather than the Settings mutation model.

## Alternatives considered

**Expose arbitrary Loader enable and disable controls.** Loader entries are implementation composition, not a stable product configuration API. Unmounting a capability can remove its validation and dependencies, so the advanced inventory remains read-only.

**Proxy every dsh namespace and credential through the product RPC.** This would give the ClawDSH browser authority over platform and community configuration outside the product manifest. Static namespace, field, and credential allowlists keep authority reviewable and fail closed.

**Accept last-writer-wins changes or automatically retry conflicts.** Either behavior can replace a newer value without the author seeing it. Optimistic revisions preserve the rejected draft and require an explicit reload.

**Store OpenClaw platform credentials in dsh.** Duplicating Feishu, Telegram, or other account secrets creates two owners and expands the disclosure path. OpenClaw remains the sole owner, while ClawDSH manages only the Ark credential it consumes directly.

**Apply every change live.** Several plugins establish timers, watchers, providers, or Session-scoped prompt state at mount. Reporting those values as live would be false; explicit effect timing and runtime-value comparison expose the required restart or new-Session transition.

## Consequences

Users can configure ClawDSH through one product page without receiving arbitrary Loader or credential authority. Conflicts fail without data loss, reset preserves deployment defaults, and the UI distinguishes a desired value from the value used by the mounted runtime.

The server-owned product manifest must stay synchronized with capability schemas and managed installer fields. Restart-bound settings intentionally do not mutate mounted plugin effects, and a new Session is required for Soul changes. OpenClaw deployment remains unavailable until its managed runtime passes preflight, while platform account readiness continues to require OpenClaw-owned evidence.

The control plane remains local-only. Remote trusted-host users may use Conversation, but they cannot read or mutate product Settings or credentials. Semantic Activity composes on the same local channel under its own read protocol; public distribution is not part of this decision.
