# Feature spec: ClawDSH semantic Activity

English | [中文](feature-activity.zh.md)

- **Status**: implemented
- **Implementation package**: `packages/openclaw/activity` (`@clawdsh/dsh-activity`)
- **Product surface**: current-Session Activity at `/clawdsh/activity`, exposed only through the loopback `/clawdsh-rpc` control plane

## Product role

ClawDSH Activity explains product behavior in five semantic categories: Prompt, Memory, Channels, Skills, and Automation. It complements the complete raw Trajectory in Harness Advanced; it neither replaces that diagnostic record nor claims to reconstruct the final flattened System Prompt.

The `clawdsh` profile always mounts `@clawdsh/dsh-activity` as a required Host capability. Its `clawdsh-activity` Settings namespace has only the installer-managed value `enabled: true`. Producers still treat `ctx.clawdshActivity` as optional and best-effort: an absent service, append failure, permission failure, rotation failure, or unreadable sidecar can make the Activity view incomplete but cannot fail prompt assembly, Memory, channel execution or delivery, skill behavior, or Automation.

Activity never contributes model-visible content. Its sidecars and browser projection do not enter the Session log, `request/header`, prompt, tool schema, tool result, or model request.

## Public record vocabulary

Every record uses format version 1 and contains an opaque id, canonical timestamp, owning Session id, category, fixed kind, package-generated summary, kind-specific scalar metadata, and an optional lifecycle status. The closed kinds are:

| Category | Kinds |
|---|---|
| Prompt | `prompt.contribution` |
| Memory | `memory.search`, `memory.read`, `memory.flush` |
| Channels | `channel.received`, `channel.delivery` |
| Skills | `skill.catalog`, `skill.loaded`, `skill.invoked` |
| Automation | `automation.run` |

The optional status is one of `started`, `succeeded`, `failed`, or `sent`. An ambiguous channel delivery omits status instead of being reported as failed. Producers cannot supply an arbitrary summary or metadata object; one typed service method owns each kind and constructs its complete public representation.

## Sources and privacy

Activity merges two sources. Standard Session history is authoritative when it already records a fact, while bounded sidecars retain ClawDSH-only facts. Semantic duplicates prefer the history-derived record; a conflicting duplicate id degrades the page instead of choosing silently.

Prompt records are emitted only for a ClawDSH contribution proven to enter the final request header. They retain the fixed section identity, append/replace mode, character count, SHA-256 digest, producer, and Session sequence, but never prompt text or a source path. The label states that this is a ClawDSH Prompt contribution, not the final System Prompt.

Memory projection recognizes the standard Memory tool lifecycle and memory-flush history. It retains only the operation kind, lifecycle status, and Session sequence; queries, filenames, snippets, returned content, and error text are excluded.

Channel receive projection uses a standard `user/message` whose source kind is `channel`. Channel delivery is recorded only when the Agent bridge commits a new durable receipt, so replaying an existing receipt does not create another Activity record. The public fields are limited to adapter, direct/group class, mention fact, lifecycle state, and Session sequence. Sender, account, conversation, thread, message and delivery identifiers, message text, and transport errors are excluded.

Skill projection recognizes standard skill tool, catalog, and invocation history. It retains a bounded skill identity or catalog count, lifecycle state, and Session sequence, but not skill text, provider paths, tool arguments, results, or errors. Automation projection recognizes `automation/run` and retains only rule id, scheduled time, lifecycle state, and sequence; prompts, model output, and errors are excluded.

The durable format has no field for credential values, access tokens, filesystem paths, arbitrary producer prose, raw tool data, message content, or error text. RPC and browser validation repeat the closed kind-to-metadata mapping before rendering a record.

## Sidecar storage

Sidecars live below `$DSH_HOME/clawdsh/activity/v1/<sha256(sessionId)>/`. A raw Session id is hashed and never becomes a path segment. Each Session has five fixed producer streams: `soul.jsonl`, `memory.jsonl`, `channels.jsonl`, `skills.jsonl`, and `automation.jsonl`.

On POSIX hosts, directories are forced to `0700` and active or rotated files to `0600`. One complete record including its newline is limited to 8 KiB. Each active stream is limited to 1 MiB and retains `.1` and `.2`; appends are serialized by `(Session, producer)`. Service disposal stops admission and waits for appends already accepted into a queue.

A missing sidecar is normal for an older Session. Invalid lines and an incomplete tail are skipped without rewriting the file and mark the result degraded. Directory, permission, append, rotation, read, and close failures become sanitized availability and warning values; physical paths and filesystem diagnostics never cross the public read interface.

Retention is bounded rather than complete: each producer keeps at most three 1 MiB files per Session. Queue ordering is process-local, so two independent Harness processes writing the same dsh home are not coordinated.

## History merge and pagination

The trusted Host supplies either the live current Session events or validated `sessionPersistence.inspect()` events. Live history takes precedence; inspection is the fallback for a non-live Session. History or sidecars may be unavailable independently, and `activity/list` still returns the other source with explicit availability, degradation, and stable warnings.

`activity/list` is a strict protocol-v1 `/clawdsh-rpc` request with `sessionId`, optional category filter, optional `asc` or `desc` order, optional limit, and optional cursor. The default is the newest 50 records and the maximum is 100. The versioned canonical base64url cursor binds the hashed Session identity, canonical category filter, order, timestamp, and record id; a malformed cursor or one from a different query fails instead of changing meaning.

The endpoint inherits the product control plane's loopback-only authority. A remote trusted-host page can continue to use Conversation but cannot read Activity. Responses expose only canonical records, continuation, availability, degraded state, and stable warnings; they do not expose a sidecar path or source error.

## Browser behavior

The Activity page follows the Session selected by the mounted Harness client. With no current Session it directs the user to Conversation. A Session switch aborts the previous request, clears records and continuation, and starts the new Session from its first page.

Users can select any combination of the five categories, choose newest-first or oldest-first order, and load another page when a continuation exists. Each fixed kind has a dedicated presentation; the page offers no raw JSON expansion. Missing sidecars display that early Activity may be incomplete, while malformed or failed data displays a degraded warning. Raw Trajectory remains a full-page link to Harness Advanced.

## Integration constraints

- No ClawDSH Activity type is added to the upstream `SessionEventMap`; standard history is only projected from already-known events.
- The Activity package is a Host plugin registered through the existing ClawDSH additive build exception. The browser remains in the nested non-workspace product shell.
- Product records are human-facing observability, not an authoritative commit ledger. Business subsystems retain their existing durable authority.
- The service and RPC use fixed vocabularies and sanitized errors. Extending a kind or metadata field requires coordinated package, control-protocol, browser, privacy, and documentation changes.

## Verification

Focused package tests cover typed record construction, privacy allowlists, permissions, bounded records, rotation, queue draining, malformed tails, unavailable storage, standard-history projection, deduplication, ordering, cursor binding, and one-source degradation. Control-plane and browser tests cover strict protocol parsing, current-Session selection, cancellation, filtering, ordering, pagination, kind-specific cards, remote denial, missing-sidecar copy, degraded warnings, and the Raw Trajectory link.
