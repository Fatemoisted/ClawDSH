# Proposal: allow downstream plugins to append ignorable Session events

English | [中文](session-plugin-events.zh.md)

- **Status**: proposed; not implemented in ClawDSH or dsh
- **Owner sought**: upstream `@deepseek-ai/dsh-session`
- **Motivating consumer**: ClawDSH channel admission and delivery diagnostics

## Motivation

dsh deliberately refuses to resume a Session containing an unknown required event. `KNOWN_SESSION_EVENT_TYPES` is generated from `SessionEventMap` declarations inside the upstream repository, so out-of-tree plugin event names are absent by construction. The event envelope already supports `ignorable: true`, allowing a reader to skip an unknown informational event safely, and persistence codecs preserve that marker.

The public live writer cannot produce it. `Session.append()` accepts required surface metadata only for surface event types and no options for non-surface events. A downstream plugin can declaration-merge a typed event and append it successfully, but after persistence a first-party reader rejects the Session because the name is unknown and the marker is absent. Compile-time extensibility therefore creates a durable fail-closed trap.

ClawDSH discovered this with proposed `channel/turn-admitted` and `channel/delivery` records. Those records are redundant diagnostics: model reconstruction already uses a known `user/message` with channel provenance, and the channel sidecar ledgers own admission, idempotency, and delivery. ClawDSH has disabled the namespaced events rather than writing Sessions that cannot resume.

## Proposed contract

Add a typed append option that lets a writer mark a **non-surface, purely informational** event ignorable:

```ts ignore-check
session.append('plugin/informational-event', payload, { ignorable: true })
```

The exact TypeScript overload may follow the existing conditional `SurfaceIntent` design, but it must enforce these obligations:

1. `ignorable` accepts only the literal `true`; absent continues to mean required.
2. A surface event cannot be marked ignorable. Unknown model-visible surface content must never disappear from reconstruction.
3. A non-surface event can receive `{ ignorable: true }`; other envelope fields remain unavailable to the caller.
4. `Session.append()` snapshots, validates, freezes, publishes, and returns the marker with the same atomicity as type, data, sequence, and time.
5. JSONL, SQLite, seed validation, fork, replay, wire schemas, and persistence coordination preserve the marker exactly as they do for restored events today.
6. The generated `KNOWN_SESSION_EVENT_TYPES` remains repository-wide and composition-independent. This proposal does not add a runtime known-type registry.

## Safety rule for plugin authors

A plugin may set `ignorable: true` only when deleting every event of that type leaves model reconstruction, tool side-effect reconciliation, security decisions, Session lifecycle, and compatibility semantics unchanged. The event can aid audit, metrics, or presentation, but another durable source must remain authoritative for any operational state.

For ClawDSH channels, a future ignorable admission event may duplicate sanitized provenance already stored in `user/message.source`, and a future delivery event may duplicate a receipt in the Provider/Agent ledger. Neither event may become the sole idempotency, admission, or delivery record. If that redundancy cannot be maintained, the event must remain absent until its type becomes a first-party required event with a format/version decision.

## Why runtime registration is not proposed

A runtime registry of “known” plugin events would make readability depend on which plugins happen to be mounted. A lean composition could reject a same-version log written by a fuller composition, while uninstalling a plugin could make its old Sessions unreadable. The existing static repository vocabulary plus per-event ignorable marker gives uniform readers and makes skip safety a writer obligation.

## Compatibility

This is an additive writer surface over an envelope field already accepted by current persistence and wire schemas. Old readers that understand the envelope rule can skip the event; readers predating that rule are outside the current pre-release compatibility promise. The default remains required, so an author who forgets the option causes a loud resume refusal rather than silent reconstruction loss.

No Session format bump is needed if the accepted envelope and persistence backends already carry `ignorable`. If implementation reveals a backend or wire path that drops the field, that path must be fixed and its owning version policy reevaluated before release.

## Acceptance criteria

1. Type tests accept an ignorable non-surface downstream event and reject `ignorable` on surface events, `false`, and unrelated fields.
2. Unit tests show the live event, `session/event` observer, returned value, seed, fork, and replay all retain `ignorable: true`.
3. JSONL and SQLite round trips resume a Session containing an unknown ignorable event and still refuse the same unknown type without the marker.
4. Generated persistence catalogs remain unchanged when only an out-of-tree declaration is added.
5. Documentation states the author safety rule and links the existing Session versioning decision.
6. ClawDSH keeps its channel events disabled until it can consume a released upstream version carrying this contract and adds persistence/resume coverage in its own composition.

## Alternatives considered

- **Write directly through `ctx.sessionPersistence.append`**: rejected because it bypasses the live Session's sequence, surface validation, publication, and ownership path.
- **Cast a complete `SessionEvent` into the private log**: rejected because it defeats the append-only API and can corrupt live/persisted agreement.
- **Add ClawDSH event names to the upstream generated set locally**: rejected by the upstream read-only rule and because every downstream plugin would require a fork patch.
- **Store channel authority only in Session events**: rejected because ignorable records cannot own operational recovery state, while required downstream names remain unreadable to first-party builds.
