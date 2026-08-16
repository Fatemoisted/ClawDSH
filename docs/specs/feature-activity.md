# Feature spec: ClawDSH semantic Activity

English | [中文](feature-activity.zh.md)

- **Status**: implemented
- **Implementation package**: `packages/openclaw/activity` (`@clawdsh/dsh-activity`)
- **Product surface**: current-Session `ClawDSH 记录` conversation tab, backed only by the loopback `/clawdsh-rpc` control plane

## Product role

The `ClawDSH 记录` tab explains product behavior in five semantic categories: Prompt, Memory, Channels, Skills, and Automation. The technical package, RPC endpoint, and sidecar path retain the Activity name. The tab complements the adjacent raw Trajectory; it neither replaces that diagnostic record nor claims to reconstruct the final flattened System Prompt.

The `clawdsh` profile always mounts `@clawdsh/dsh-activity` as a required Host capability. Its `clawdsh-activity` Settings namespace has only the installer-managed value `enabled: true`. Producers still treat `ctx.clawdshActivity` as optional and best-effort: an absent service, append failure, permission failure, rotation failure, or unreadable sidecar can make the Activity view incomplete but cannot fail prompt assembly, Memory, channel execution or delivery, skill behavior, or Automation.

Activity never contributes model-visible content. Its sidecars and browser projection do not enter the Session log, `request/header`, prompt, tool schema, tool result, or model request.

## Public record vocabulary

Every record uses format version 1 and contains an opaque id, canonical timestamp, owning Session id, category, fixed kind, package-generated summary, kind-specific scalar metadata, and an optional lifecycle status. The closed kinds are:

| Category | Kinds |
|---|---|
| Prompt | `prompt.contribution` |
| Memory | `memory.search`, `memory.read`, `memory.write`, `memory.update`, `memory.flush` |
| Channels | `channel.received`, `channel.delivery` |
| Skills | `skill.catalog`, `skill.loaded`, `skill.invoked` |
| Automation | `automation.run` |

The optional status is one of `started`, `succeeded`, `failed`, or `sent`. `started` means that no matching completion was recorded; it does not claim that work is still running. An ambiguous channel delivery omits status instead of being reported as failed. Producers cannot supply an arbitrary summary or metadata object; one typed service method owns each kind and constructs its complete public representation.

## Sources and privacy

Activity merges two sources. Standard Session history is authoritative when it already records a fact, while bounded sidecars retain ClawDSH-only facts. Semantic duplicates prefer the history-derived record; a conflicting duplicate id degrades the page instead of choosing silently.

Prompt records are emitted only for a ClawDSH contribution proven to enter the final request header. They retain the fixed section identity, append/replace mode, character count, SHA-256 digest, producer, and Session sequence, but never prompt text or a source path. The label states that this is a ClawDSH Prompt contribution, not the final System Prompt.

Memory projection matches standard tool calls and results by `(turn, step, callId)` and recognizes search, read, write, exact update or forget, and memory-flush history. It retains only operation kind, lifecycle status, Session sequence, write scope, update action, and a package-owned privacy-safe outcome. Write outcomes distinguish stored content from an exact durable duplicate; update outcomes distinguish an actual update or deletion from already-current or not-found no-ops. Older records without an outcome remain valid and receive neutral presentation. Queries, filenames, fact text, snippets, arbitrary results, and error text are excluded.

Channel receive projection uses a standard `user/message` whose source kind is `channel`. Channel delivery is recorded only when the Agent bridge commits a new durable receipt, so replaying an existing receipt does not create another Activity record. The public fields are limited to adapter, direct/group class, mention fact, lifecycle state, and Session sequence. Sender, account, conversation, thread, message and delivery identifiers, message text, and transport errors are excluded.

Skill projection recognizes standard skill tool, catalog, and invocation history. It retains a bounded skill identity or catalog count, lifecycle state, and Session sequence, but not skill text, provider paths, tool arguments, results, or errors. Automation projection recognizes `automation/run` and retains only rule id, scheduled time, lifecycle state, and sequence; prompts, model output, and errors are excluded. The page collapses the `started` and terminal records for one scheduled occurrence before sorting and pagination, so one run appears once at its final known state and time.

The durable format has no field for credential values, access tokens, filesystem paths, arbitrary producer prose, raw tool data, message content, or error text. RPC and browser validation repeat the closed kind-to-metadata mapping before rendering a record.

## Sidecar storage

Sidecars live below `$DSH_HOME/clawdsh/activity/v1/<sha256(sessionId)>/`. A raw Session id is hashed and never becomes a path segment. Each Session has five fixed producer streams: `soul.jsonl`, `memory.jsonl`, `channels.jsonl`, `skills.jsonl`, and `automation.jsonl`.

On POSIX hosts, directories are forced to `0700` and active or rotated files to `0600`. One complete record including its newline is limited to 8 KiB. Each active stream is limited to 1 MiB and retains `.1` and `.2`; appends are serialized by `(Session, producer)`. Service disposal stops admission and waits for appends already accepted into a queue.

A missing sidecar is normal for an older Session. Invalid lines and an incomplete tail are skipped without rewriting the file and mark the result degraded. Directory, permission, append, rotation, read, and close failures become sanitized availability and warning values; physical paths and filesystem diagnostics never cross the public read interface.

Retention is bounded rather than complete: each producer keeps at most three 1 MiB files per Session. Queue ordering is process-local, so two independent Harness processes writing the same dsh home are not coordinated.

## History merge and pagination

The trusted Host supplies either the live current Session events or validated `sessionPersistence.inspect()` events. Live history takes precedence; inspection is the fallback for a non-live Session. History or sidecars may be unavailable independently, and `activity/list` still returns the other source with explicit availability, degradation, and stable warnings.

`activity/list` is a strict protocol-v1 `/clawdsh-rpc` request with `sessionId`, optional category filter, optional `asc` or `desc` order, optional limit, and optional cursor. The default is the newest 50 records and the maximum is 100. The versioned canonical base64url cursor binds the hashed Session identity, canonical category filter, order, complete filtered-result snapshot digest, timestamp, and record id. A malformed cursor, a cursor from another query, or a result set changed between pages fails instead of silently skipping, duplicating, or reordering records.

The endpoint inherits the product control plane's loopback-only authority. A remote trusted-host page can continue to use Conversation but cannot read Activity. Responses expose only canonical records, continuation, availability, degraded state, and stable warnings; they do not expose a sidecar path or source error.

## Browser behavior

ClawDSH registers `clawdsh-records` as the third public `conversation.view` entry after Chat and Trajectory. The Slot supplies the current Session id directly. A Session switch or view unmount aborts the previous request, clears records and continuation, and starts the next selected Session from its first page.

Users can select any combination of the five plain-language categories—identity and context, memory, external messages, skills, and scheduled tasks—choose newest-first or oldest-first order, and load another page when a continuation exists. Prompt contributions for the same request are grouped into one context-preparation card. Every operation has a Chinese title and explanation; Memory no-op outcomes are stated explicitly, while content and errors stay private. Package kind, event sequence, hashes, and other diagnostic fields are folded under `技术详情`; the tab offers neither raw JSON nor a simulated jump into Trajectory.

The view reloads after the public conversation snapshot reports a new completed turn, aborts and resets on Session or filter changes, and always offers a manual `重新读取` action for sidecar-only records that arrive later. A changed pagination snapshot asks the user to reload from page one. Historical missing sidecars, a current Session with no sidecar yet, an unreadable sidecar, unavailable Session history, partial degradation, no selected category, and category-specific empty results have distinct explanations. When a source is missing or degraded, an empty result says only that no selected record is displayable; it never concludes that the capability was unused.

## Integration constraints

- No ClawDSH Activity type is added to the upstream `SessionEventMap`; standard history is only projected from already-known events.
- The Activity package is a Host plugin registered through the existing ClawDSH additive build exception. The browser remains in the nested non-workspace product shell.
- Product records are human-facing observability, not an authoritative commit ledger. Business subsystems retain their existing durable authority.
- The service and RPC use fixed vocabularies and sanitized errors. Extending a kind or metadata field requires coordinated package, control-protocol, browser, privacy, and documentation changes.

## Verification

Focused package tests cover typed record construction, privacy allowlists, permissions, bounded records, rotation, queue draining, malformed tails, unavailable storage, `(turn, step, callId)` tool pairing, privacy-safe Memory outcomes, Automation lifecycle collapse, deduplication, ordering, snapshot-bound cursors, and one-source degradation. Control-plane and browser tests cover strict protocol parsing, Slot-bound Session selection, completed-turn refresh, switch and unmount cancellation, manual reload, filtering, ordering, pagination restart, human-facing cards, folded technical details, remote denial, source-specific availability explanations, degradation, and category-specific empty results.
