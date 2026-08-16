# @clawdsh/dsh-activity

English | [中文](README.zh.md)

`@clawdsh/dsh-activity` provides the optional `ctx.clawdshActivity` semantic Activity sink and a safe sidecar reader. Producers call typed methods for Prompt, Memory, Channels, Skills, and Automation; the service selects the public summary and metadata fields, so a caller cannot submit arbitrary prose or an arbitrary metadata object.

## Configuration

The `clawdsh-activity` Settings namespace contains one installer-managed field:

```yaml
enabled: true
```

The schema accepts only `true`. Activity is a required ClawDSH product capability, while producer plugins remain independent: they discover the service with `ctx.get('clawdshActivity')` and continue their authoritative work when the service is absent or an append returns a degraded result.

## Producer API

The service exposes one typed method for each fixed sidecar kind: `promptContribution`, `memorySearch`, `memoryRead`, `memoryWrite`, `memoryUpdate`, `memoryFlush`, `channelReceived`, `channelDelivery`, `skillCatalog`, `skillLoaded`, `skillInvoked`, and `automationRun`. Every method returns `{ written, degraded }` and contains filesystem failures; producers must not treat Activity success as the commit point for their own operation.

Prompt records retain only the fixed section identity, append/replace mode, character count, SHA-256, producer, and Session sequence. Memory records retain only kind, lifecycle status, sequence, write scope, update action, and the optional closed outcome. Channel records retain only adapter, direct/group class, mention fact, lifecycle status, and sequence. Skill records retain only skill identity or catalog count, lifecycle status, and sequence. Automation records retain only rule identity, scheduled time, lifecycle status, and sequence.

`list({ sessionId, producers? })` waits for writes already accepted by this service instance, validates every JSONL line against the selected Session and producer file, and returns only canonical records plus `availability`, `degraded`, and the stable `activity-data-incomplete` warning. It never returns a physical path or a filesystem error.

`page(request, { live?, inspect? })` projects standard Session history, preferring a supplied live log and falling back to validated `sessionPersistence.inspect()` events, then merges that projection with sidecars. The projector pairs supported tool calls and results by `(turn, step, callId)`. It recognizes Memory search, read, write, update, and flush; channel-origin user messages; skill tool, catalog, and invocation records; and `automation/run`. It reads only exact package-owned Memory success text to derive `stored`, `already-stored`, `updated`, `forgotten`, `already-current`, or `not-found`; unknown older results omit the outcome instead of guessing. It never retains message content, arbitrary tool arguments or results, platform identities, provider paths, or error text. Semantic duplicates prefer the standard-history record, conflicting duplicate ids mark the page degraded, and each Automation occurrence is collapsed to one final known lifecycle record before ordering.

Pages default to 50 newest records and accept at most 100. The version-1 base64url cursor binds the Session hash, canonical category filter, order, complete filtered-result snapshot digest, timestamp, and id. A cursor from another query or a changed result snapshot fails instead of silently skipping, duplicating, or reordering records. If history or sidecars are unavailable, the page still returns the other source with explicit availability and stable warnings.

## Sidecar storage

Each Session uses a SHA-256 path below `$DSH_HOME/clawdsh/activity/v1`; the raw Session id never becomes a path segment. The five fixed active files are `soul.jsonl`, `memory.jsonl`, `channels.jsonl`, `skills.jsonl`, and `automation.jsonl`.

Directories are forced to mode `0700` and active or rotated files to `0600` on POSIX hosts. A complete JSONL record, including its newline, is limited to 8 KiB. Each active file is limited to 1 MiB and retains two rotations, `.1` and `.2`. Appends are serialized by `(Session, producer)`, and service disposal stops admission before awaiting every append that already entered a queue.

Missing files are normal for old Sessions. Invalid lines and an incomplete tail are skipped without rewriting the file and mark the result degraded. Directory, permission, append, rotation, read, and close failures degrade Activity without throwing through a typed producer method.

## Privacy

The durable format has a closed kind-to-metadata mapping and package-generated summaries. It has no field for prompt text, message text, sender, account, conversation id, thread id, message id, delivery id, tool arguments, tool results, credential values, paths, or error text. Channel delivery with an ambiguous receipt omits `status` instead of manufacturing a failure.

## Model Experience

### Semantic Activity records

#### What the model sees

Nothing. Activity sidecars are a human-facing projection and never enter a Session log, `request/header`, prompt, tool schema, tool result, or model request.

#### Token effect

Zero direct tokens. Recording and reading Activity do not change model input or output.

#### KV Cache effect

None. The package does not alter the system-prompt prefix or any later request content.

## Known Limitations and Deferred Work

- **Best-effort completeness** — a missing, malformed, unwritable, or rotated-away record leaves the authoritative subsystem unchanged, so Activity history can be incomplete and reports that state instead of repairing source data.
- **One Host writer** — queue ordering is process-local; two independent Harness processes that write the same DSH home are not coordinated.
- **Bounded retention** — each producer retains at most three 1 MiB files per Session; older semantic records are discarded by rotation.
