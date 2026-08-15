# Agent Note: Pre-compaction memory flush turn on `agent/turn-stopping`

Status: implemented

English | [中文](2026-08-14-memory-flush-turn.zh.md)

## Problem

The memory spec's non-goals carried "no pre-compaction memory flush turn (Phase 3, hooks dsh compaction)". OpenClaw runs the flush as a **separate silent agent turn before the main turn**, sharing the session, triggered once per compaction cycle when `totalTokens >= contextWindow − reserveTokensFloor(20000) − softThresholdTokens(4000)`. dsh's compaction, however, runs synchronously inside `agent/pre-step` of every turn — there is no turn-shaped hook before it. The question: which dsh hook can express a silent pre-compaction turn, given a full agent turn cannot be nested inside the running agent's own pre-step?

## Decision

**The flush is a plugin row inside the memory package (not a separate package), queued from `agent/turn-stopping` via `agent.followup` — an ordinary logged turn with a plugin source, running between turns on the same agent and session.** The guard fires once per compaction cycle, keyed on the newest `compaction/end` seq in the session log.

Mechanics (all verified against `packages/core/agent-loop/src/agent.ts`):

- `agent/turn-stopping` fires when the model owes no response and the inbox has no next-step work (`agent.ts:295-298`); `agent.followup` queues an ordinary turn the same driver continues into (`agent.ts:299-324`) — no deadlock, no second agent, one transcript.
- The threshold reads `ctx.get('tokenMeter').measure(session).totalTokens` and `ctx.get('llm').resolveModelInfo(provider, model).context.contextWindow` (routed from `session.requestHeader()?.config`, the compaction-basic pattern), with config `flush.{reserveTokensFloor=20000, softThresholdTokens=4000, prompt, enabled}` z-validated.
- Once-per-cycle: `WeakMap<Agent, {throughSeq, pending}>`; `throughSeq` is the newest `compaction/end` seq at queue time (a durable, existing marker — no new session event needed); a newer compaction re-arms eligibility. The threshold check then blocks the post-compaction case naturally (a compaction shrinks `totalTokens` below the flush threshold).
- NO_REPLY: the default prompt asks for it and the observer logs it at info level. Canonical channel delivery is bound to the exact admitted `user/message` owning turn, so a later plugin-sourced flush turn cannot replace that result.
- Failures never block the main turn: the flush turn is a separate turn whose errors are contained by the driver.

**Documented degradations vs OpenClaw** (Known Limitations): the flush runs *between* turns, so an inbound queued before the flush completes runs first; and the flush turn's own pre-step may trigger the pressure compaction before the flush's model call, so the flush writes memories from the compacted summary. With dsh's default compaction threshold (0.8 × window) below the flush threshold (window − 24000), the common flow is compaction → flush-from-summary; deployments that want the OpenClaw ordering tune the compaction `thresholdRatio` above the flush threshold. The skip-list (heartbeat/CLI/sandbox-ro) maps to mount-level opt-in: profiles that don't mount the memory row never flush.

## Alternatives considered

**Run the flush inside `agent/pre-step` before the compaction listener (synchronously, same pre-step).** Rejected with source evidence: during pre-step the agent is in the `running` phase (`agent.ts:227`); `runMaintenance` throws when not idle (`agent.ts:142-143`); `await agent.whenIdle()` inside the waterfall deadlocks (the waterfall is awaited by the very `kick()` that resolves `activityDone`).

**`{kind:'reject'}` + requeue dance in pre-step.** Rejected: a rejected step ends the turn with `blocked` and the claimed message is "neither discarded nor re-emitted" (`runtime-types.ts:188-191`); a re-send during the running phase does not latch a wake and the exiting driver clears `wakeRequested`, parking the message with no driver.

**In-turn merge (prepend the flush instruction to the main turn's messages).** Rejected: the instruction and the reply share one turn, so there is no silent turn, no NO_REPLY, and the flush instruction leaks into the main reply's context.

**A second agent on the same session for the flush turn.** Rejected: sessions are per-agent; the duplicate-live-id guard makes a second handle on one session impossible, and a fresh session would lack the conversation context the flush is meant to mine.

**A separate `memory-flush` package.** Rejected for now: the flush is part of the memory row's spec and prompt convention (`RECALL_TEXT` teaches the exact `memory/YYYY-MM-DD.md` workflow the flush prompt references); a standalone package would add the full package ceremony for a ~250-line module. Revisitable if a non-memory storage backend needs the flush.

## Consequences

- The memory spec's non-goal is removed; the flush is part of the memory row's acceptance criteria.
- `feature-memory.md` and the memory README document the flush config, the model-visible prompt, and the two degradations above; the matrix memory row stays a single implemented row.
- The canonical channel Driver resolves output from the exact admitted message's owning turn; plugin-sourced maintenance turns remain separate logged turns and cannot replace that output.
- If upstream dsh ever adds a pre-compaction turn hook (or a compaction opt-out for one turn), this note's degradation list is the checklist for upgrading.
