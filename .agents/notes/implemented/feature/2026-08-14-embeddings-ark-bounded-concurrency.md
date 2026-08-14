# Agent Note: embeddings-ark bounded per-text request concurrency

Status: implemented

English | [中文](2026-08-14-embeddings-ark-bounded-concurrency.zh.md)

## Problem

The Ark multimodal embeddings endpoint embeds the whole input array as ONE multimodal item, so batching is impossible: `embed(N)` sends N requests, one per text. The phase-2 closeout shipped this strictly serially, with concurrency explicitly deferred to phase 3 ("One request per text ... concurrency deferred"). Large-corpus recall (memory's incremental re-embed) pays N sequential round-trips.

## Decision

**A bounded worker pool inside `embed()`: at most `maxConcurrentTexts` (Config, default 4, `z.number().step(1).min(1)` validated) in-flight requests; each worker claims the next index from a shared counter, so results land in input order; `Promise.all` rejects the whole call on any failure (the embeddings seam contract already demands whole-batch rejection and order preservation, `embeddings/src/index.ts:34-45`). In-flight siblings are not force-cancelled when one fails.** `maxConcurrentTexts: 1` reproduces the previous serial behavior exactly.

- Order preservation falls out of index assignment — no sorting, no result reordering pass;
- No per-request controllers are wired: force-cancelling siblings on a failure would complicate `embedOne`'s signal plumbing for zero correctness gain (the seam rejects the whole call either way, and already-started work is wasted, not wrong);
- The concurrency cap is deployment-tuning (small consumer vs. server rate limits), so it is a validated Config field with the tool-jobs `maxConsecutiveWakes`-style rationale, not a hardcoded constant.

## Alternatives considered

**Unbounded `Promise.all(texts.map(embedOne))`.** Rejected: a large batch (memory corpus chunks) would open N sockets at once with no pressure valve; the endpoint and consumer both want a bound.

**Keep serial only.** Rejected: this is exactly the deferred phase-3 work; memory's incremental re-embed is the current consumer that pays N round-trips.

**Force-cancel in-flight siblings on the first failure.** Rejected: adds abort-controller plumbing through `embedOne` for no observable benefit — the seam contract rejects the whole call regardless, and the provider never delivers partial results.

## Consequences

- `embed(N)` latency drops from N round-trips to ⌈N / maxConcurrentTexts⌉ round-trips at the cost of at most `maxConcurrentTexts` concurrent sockets;
- Five contract tests pin the behavior: concurrency cap (deferred-gate fetch mock counting in-flight), input-order preservation under out-of-order completion, whole-batch rejection on one failure, `maxConcurrentTexts: 1` serial equivalence, and schema rejection below 1;
- The config-catalog regenerates with the new key, and the pre-existing `config-catalog.zh.md` debt (the missing `@clawdsh/*` sections) is paid off in the same change.
