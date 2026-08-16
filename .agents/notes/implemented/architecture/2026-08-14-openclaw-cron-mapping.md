# Agent Note: OpenClaw cron domain → dsh automation mapping

Status: implemented

English | [中文](2026-08-14-openclaw-cron-mapping.zh.md)

**Superseded in part.** The scheduler ownership decision remains current; preset composition, session discoverability, `every`/`at` timing, terminal run persistence, and lifecycle failure behavior are owned by [Composed and discoverable Automation sessions](../bug-fix/2026-08-16-automation-composed-discoverable-sessions.md).

## Problem

The parity matrix's Scheduling/automation row (source: OpenClaw `src/cron/`, seam: `ctx.schedule` / `ctx.jobs`) was planning. The natural dsh landing — mounting on the existing schedule seam — turns out to be inexpressible: the schedule package is session-local task scheduling for live agents, while OpenClaw cron is a global, cold-start, minute-granularity scheduler with one dedicated durable session per job. The question: which dsh seam does the cron feature category actually land on, and what is the honest increment?

## Decision

A deep-read of OpenClaw `v2026.1.5` (`197b8f7c3b`) `src/cron/` settles it: **automation owns a single re-arming unref'd timer + the `croner` library, and reuses dsh's proven turn-driving machinery. `ctx.schedule` and `ctx.jobs` are rejected with evidence.**

The OpenClaw side:

- **Declaration**: persistent JSON5 store `~/.clawdbot/cron/jobs.json` (`{version:1, jobs:[]}`), created via gateway `cron.add/update/remove/run/list` + CLI + hooks. Job shape: `{id, name, description?, enabled, schedule, sessionTarget: 'main'|'isolated', wakeMode, payload, state:{nextRunAtMs, runningAtMs?, lastRunAtMs?, lastStatus, lastError?, lastDurationMs?}}`.
- **Schedules**: `at` (one-shot epoch, auto-disables after ok, stays due after downtime), `every` (interval + anchor, no catch-up), `cron` (via `croner`, 5-field, optional IANA tz).
- **Execution**: `isolated` jobs spawn a real agent turn in a dedicated session key `cron:<jobId>` with prompt framing `[cron:<jobId> <name>] <message>`; after finishing, a summary is posted to the main session. `main` jobs inject `System:` lines into the next main-session turn.
- **Failure semantics**: no automatic retries; in-memory `runningAtMs` in-flight dedup (stuck after 2h); at-least-once (persist state before starting); atomic store writes; per-job JSONL run log. Single unref'd `setTimeout` armed to the earliest `nextRunAtMs`; missed ticks are skipped (no catch-up).

The dsh mapping:

| OpenClaw cron part | dsh realization |
|---|---|
| Job store `cron/jobs.json` | Config-declared `rules` array (z schema) — the cordis.yml is the durable store; no new storage seam, no CRUD tools in this batch |
| `cron` schedule | `croner` ^9.1.0 (the exact library OpenClaw proves), validated at mount |
| `every` / `at` schedules | Same semantics: anchor-based interval with no catch-up; one-shot with a durable once-guard |
| Single re-arming timer | One unref'd `setTimeout` to the earliest `nextRunAt` (OpenClaw's scheduler shape) |
| `isolated` session per job | One dedicated agent per rule, `SessionId('automation:' + rule.id)`, resume-or-create across restarts (`ctx.agents.resume` catch → `persistence.list()` absent → `create`) |
| Prompt framing `[cron:<jobId> <name>] <message>` | `[automation:<id> <name>] <message>` via `agent.followup` with `source: {kind:'plugin', plugin:'automation'}` |
| Run log `cron/runs/<jobId>.jsonl` | The session log itself: `automation/run` events (`started`/`ok`/`error` + `scheduledAt`) around the logged turn — no separate artifact |
| In-flight dedup / no retries / no catch-up | Same: per-rule WeakMap dedup, failures logged and re-armed, missed ticks skipped |
| `main` session `System:` injection | Not ported in this batch — no main-session concept is wired in the `clawdsh` profile (Known Limitation) |
| Channel `deliver` | Not ported in this batch (Known Limitation) |

Why not the dsh seams:

- **`ctx.schedule`** (packages/schedule/schedule/): `every` has a 300s floor (`domain.ts:24`), delivery is strictly session-local (`types.ts:111-115`), runtimes attach only to live root agents created after plugin load (`index.ts:45-46`), and records are created only through the agent-facing tools (`registerScheduleTools`, `index.ts:49`) — no programmatic API. Minute-granularity cron, cold start, and one dedicated durable session per rule are inexpressible on it.
- **`ctx.jobs` / jobs-local**: pure in-memory registry (`store = new Map`, `jobs-local/src/index.ts:102`), no persistence, tool-oriented (`job_output/list/kill`) — it tracks spawned work, it does not schedule recurring turns.

## Alternatives considered

**A bridge over `ctx.schedule` restricted to `at`/`every ≥300s`.** Rejected: cannot express cron, cannot guarantee the dedicated-session model, and the attach condition fights one-session-per-rule.

**Port the OpenClaw job store + CRUD tools + CLI.** Rejected for this batch: config-declared rules need no new storage seam and no mutable store; a runtime-mutable store with agent-facing CRUD tools is a later surface, revisitable when a consumer needs runtime-editable rules.

**Use `runMaintenance` + `followup` (the schedule package's pattern) for firing.** Partially reused: the fire path uses the same `followup → whenIdle → sessions.flush` idiom channel-core and headless prove, but `runMaintenance` is schedule-internal (agent-owned); automation drives its own agents directly.

## Consequences

- The matrix row's seam cell is corrected to `own unref'd croner timer + agent.followup/whenIdle/sessions.flush turn bridge（ctx.schedule rejected: session-local + 300s floor + tools-only API）`.
- The `clawdsh` preset mounts `automation` disabled (opt-in; a misconfigured rule fails mount loudly naming the rule).
- `automation/run` is a session event declaration-merged into `SessionEventMap`; the turn itself is a normal logged turn, so "model-visible means logged" holds without a new mechanism.
- Channel delivery, main-session summaries, and retries revisit this note rather than assuming structure.
