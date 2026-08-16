# @clawdsh/dsh-automation

English | [中文](README.zh.md)

**Positioning**: scheduled agent turns — config-declared rules ("post a digest at 9 every day") drive one ordinary agent turn per occurrence in a dedicated durable session (`automation:<id>`, resumed across restarts). OpenClaw-cron semantics: at-least-once, no automatic retries, in-flight dedup, missed occurrences skipped, one-shot `at` rules guarded durably against re-firing.

**OpenClaw counterpart**: Cron (`v2026.1.5` `src/cron/`): `cron`/`at`/`every` schedules via the croner library OpenClaw pins, one dedicated session per job, `[cron:<jobId> <name>] <message>` framing, a single re-arming timer for the earliest occurrence.

**Seam** (all pre-existing, none added):
- `ctx.agents` / `ctx.sessions` / `ctx.agentDefaultModel` (declared injects): one durable agent per rule, resume-or-create across restarts (`ctx.agents.resume` fallback to `create` when no artifact exists), turns driven with the proven `followup → whenIdle → sessions.flush` idiom (channel-agent / headless);
- `ctx.get('sessionPersistence')` (optional read): session artifacts; without a persistence service rules start fresh per process;
- The session log is the run log: `automation/run` records (`started`/`ok`/`error` + `scheduledAt`) bookend each logged turn — no separate run-log artifact.

**Why not `ctx.schedule`**: its `every` floor is 300s, delivery is strictly session-local, runtimes attach only to live root agents created after plugin load, and records are creatable only through the agent-facing tools — minute-granularity cron, cold start, and one dedicated durable session per rule are inexpressible on it (`ctx.jobs` is an in-memory work tracker, not a scheduler). See the [cron-mapping Agent Note](../../../.agents/notes/implemented/architecture/2026-08-14-openclaw-cron-mapping.md).

**Spec**: docs/specs/feature-automation.md · **Status**: implemented (Phase 3 ✅)

The row stays mounted and owns the `clawdsh-automation` settings namespace. Its business-level `enabled` defaults to `false`; while disabled it creates no runtime, timer, or automation session. Settings are restart-applied.

## Usage

```yaml
- id: automation
  name: '@clawdsh/dsh-automation'
  config:
    enabled: true
    rules:
      - id: morning-digest
        name: Morning            # optional label in the turn framing
        schedule: { kind: cron, expr: '0 9 * * *', timeZone: Asia/Shanghai }
        message: Post a morning digest of the session log.
      - id: weekly-review
        schedule: { kind: at, at: '2026-08-17T09:00:00+08:00' }
        message: Write the weekly review.
      - id: ping
        schedule: { kind: every, seconds: 3600 }
        message: Check whether anything needs attention.
```

Rule ids must match `[a-zA-Z0-9_-]+` (they land in persisted session names). Invalid cron expressions, timezones, `at` times, ids, or duplicate ids fail the mount loudly, naming the rule.

## Design notes

- **Config is the durable store**: rules live in cordis.yml, so no job-store file, no CRUD tools, no new storage seam (runtime-editable rules are deferred);
- **Disabled by default**: the schema defaults `enabled` to false, and the disabled path validates configuration but creates no runtime, timer, or session;
- **One re-arming unref'd timer**: armed to the earliest occurrence across rules; on wake, due rules run sequentially, then the timer re-arms (OpenClaw's scheduler shape);
- **Per-rule session lifecycle**: resume-or-create keeps the session log (and thus the run history) across restarts; the rule fires immediately at mount for `every` rules (OpenClaw's "first run at/after the anchor");
- **Failure semantics**: a `started` record lands before the turn (at-least-once); only `completed` and `max-tokens` terminal reasons become `ok`; `error`, `blocked`, `aborted`, and any non-success terminal become `error`. Cron/every failures log and the next occurrence still fires. A failed one-shot `at` attempt stays dormant for the current mount (no zero-delay retry loop) but is not written as a durable success, so an explicit later remount can recover it.

## Changelog

- 0.1.0: first release (cron/at/every rules, per-rule durable sessions, run records, once-guard; 8 contract tests, real-composition keyless).

## Model Experience

### Scheduled turn

#### What the model sees

One plugin-sourced user message per occurrence. The `name` segment is absent when the rule has no name, and the message carries `source: {kind: 'plugin', plugin: 'automation'}` so channels can tell automated turns from human input. The framing is exactly:

##### Turn framing

```markdown
[automation:<id> <name>] <message>
```

#### Token effect

One framed message plus the assistant reply per occurrence — proportional to the rule message and the reply, independent of the number of rules that did not fire.

#### KV Cache effect

Append-only: the framed message lands mid-log like any turn input; no system-prompt prefix changes, so prior request prefixes stay reusable.

## Known Limitations and Deferred Work

- **No channel delivery**: OpenClaw's `deliver` (post the reply to a channel) is not ported; replies stay in the rule's session log;
- **No main-session summary**: OpenClaw's `main` target (`System:` lines injected into the main session) is not ported — the `clawdsh` profile has no main-session wiring yet;
- **No automatic retries**: failures record an `error` run; cron/every wait for their next scheduled occurrence, while a failed `at` rule stays dormant until a later remount (OpenClaw-isomorphic);
- **No runtime-editable rules**: rules are config-declared; OpenClaw's job store + `cron.add/remove/…` tools and CLI are deferred until a consumer needs runtime edits;
- **`at` once-guard needs the session artifact**: if the persisted session log is deleted, a past one-shot re-fires once (at-least-once semantics);
- **`every` re-anchors at mount**: each boot fires once immediately, then runs on the anchor grid (OpenClaw's anchor semantics, no catch-up of missed ticks).
