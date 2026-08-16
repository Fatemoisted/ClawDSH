# Agent Note: Truthful and readable ClawDSH records

Status: implemented

English | [中文](2026-08-16-truthful-clawdsh-records.zh.md)

## Problem

The first native `ClawDSH 记录` view exposed package terminology, repeated Prompt contributions as separate cards, and placed sequence numbers, hashes, and internal kinds in the primary reading path. It told a user that a `started` operation was still running even when an old Session had no matching result. Memory write and update records also treated any successful tool result as an actual mutation, so exact duplicates, already-current updates, and not-found corrections could appear as writes or changes that never happened.

The history projector paired tool calls and results by `callId` alone even though that identity can be reused across turns or steps. Automation lifecycle records were folded only in the browser after pagination, which could duplicate a run or move it between pages when its terminal record arrived. Timestamp/id cursors did not bind the result snapshot, so a changing live Session could skip or duplicate records between pages. Empty-state copy could also conclude that a capability was unused when history or sidecar data was unavailable.

## Decision

The package projector pairs supported tools by `(turn, step, callId)`. A completed Memory result derives an optional closed outcome only from the exact, package-owned success text: write is `stored` or `already-stored`; update is `updated`, `forgotten`, `already-current`, or `not-found`. The record never retains the fact, query, path, arbitrary result, or error. Older records without an outcome remain valid and render as a neutral completed request. An unmatched call renders as `未记录完成结果`, not as work known to be running.

Automation `started` and terminal records for the same rule occurrence collapse on the Host before ordering and pagination. The terminal record supplies the visible state and actual terminal timestamp. A duplicate terminal or otherwise ambiguous lifecycle marks the page degraded rather than silently claiming certainty.

The version-1 cursor now binds a SHA-256 digest of the complete filtered record snapshot in addition to Session, categories, order, timestamp, and id. If records change while the user pages, the next request returns the existing `cursor-mismatch` class and the browser offers to reload page one. This strengthens behavior without changing the RPC method or public protocol version.

The browser presents five user concepts: `身份与上下文`, `记忆`, `外部消息`, `技能`, and `定时任务`. Prompt contributions at one Session sequence become one context-preparation card. Each operation receives a Chinese explanation that distinguishes preparation from execution and actual mutation from no-op. Internal kind, event sequence, digest, and source fields stay available under collapsed `技术详情`.

The conversation Slot's public Session snapshot supplies the latest completed-turn sequence. A new completion reloads the first page; Session changes and unmount abort stale reads. The page always exposes `重新读取` because sidecar-only facts can land after the standard turn event. Missing or degraded sources change an empty result to `no displayable selected record`; the UI does not infer that a feature was unused.

## Alternatives considered

**Show raw Activity records and document the fields.** Rejected because the product view is for explaining behavior, while raw event inspection already belongs to the adjacent Trajectory tab. Internal fields remain available as folded diagnostics.

**Expose Memory fact text so the result is self-explanatory.** Rejected because Activity is a privacy-limited observability projection. The authoritative fact is available through the Memory tools and Markdown store; duplicating it into sidecars or UI responses would enlarge sensitive retention.

**Keep timestamp/id pagination and accept live drift.** Rejected because silent omissions and duplicates make an explanatory record unreliable. Restarting from page one on a changed snapshot is explicit and bounded.

**Poll continuously for Activity changes.** Rejected because chunk and sidecar writes can be frequent and Activity has no public push seam. Completed-turn refresh plus an explicit reload covers the supported evidence without background request churn.

## Consequences

The record view now answers what ClawDSH prepared or attempted in user language and states when the retained evidence cannot establish an outcome. It does not reconstruct hidden content and remains non-authoritative: Memory files, Session events, channel receipts, and Automation sessions continue to own business state.

Memory result recognition intentionally depends on exact package-owned success messages. A future text change must update the projector in the same change; otherwise the record safely falls back to a neutral outcome instead of fabricating a mutation. Sidecar-only events that arrive after the last completed turn require the visible manual reload action.

## Verification

Activity tests cover call-id reuse across steps, malformed pairing, every Memory mutation outcome, old outcome-less records, Automation collapse and order, lifecycle changes between ascending and descending pages, snapshot cursor mismatch, privacy allowlists, and degraded sources. Browser tests cover grouped context, human-facing Memory and Automation cards, folded technical details, completed-turn refresh, manual reload, Session cancellation, pagination restart, and source-aware empty states. The normal-profile acceptance exercises a real Memory write and cross-Session recall and then inspects the resulting `ClawDSH 记录` cards.
