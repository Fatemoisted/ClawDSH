# @clawdsh/dsh-automation

English | [中文](README.zh.md)

**Positioning**: optional scheduled agent turns — a rule combines when to run with what ClawDSH should do (for example, "post a digest at 9 every day"). Each occurrence drives one ordinary turn in a dedicated durable session (`automation:<id>`, resumed across restarts). Normal chat does not depend on Automation. OpenClaw-cron semantics are at-least-once, no automatic retries, in-flight dedup, skipped missed occurrences, and a durable terminal guard for one-shot `at` rules.

**OpenClaw counterpart**: Cron (`v2026.1.5` `src/cron/`): `cron`/`at`/`every` schedules via the croner library OpenClaw pins, one dedicated session per job, `[cron:<jobId> <name>] <message>` framing, a single re-arming timer for the earliest occurrence.

**Seam** (all pre-existing, none added):
- `ctx.agents` / `ctx.agentPresets` / `ctx.sessions` / `ctx.agentDefaultModel` (declared injects): one durable agent per rule, composed from the configured ClawDSH preset and resumed or created across restarts; turns use `followup → whenIdle → sessions.flush`;
- `ctx.get('sessionPersistence')` (optional read): session artifacts; without a persistence service rules start fresh per process;
- `ctx.get('sessionTitle')` and `ctx.get('workspaceRegistry')` (optional reads): when installed, a scheduled session receives a readable title and is attached to the workspace owning its configured `cwd`; an installed service that cannot complete this publication fails plugin initialization;
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
    preset: clawdsh
    cwd: /absolute/path/to/workspace
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

Rule ids must match `[a-zA-Z0-9_-]+` (they land in persisted session names). The Web editor creates UUID-backed ids instead of positional `rule-1` values, so a replacement task cannot accidentally resume the deleted task's durable Session. `cwd` must be absolute. New sessions record the current value, while resumed sessions keep and publish through their immutable header value; the ClawDSH Settings UI therefore exposes `preset` and `cwd` as installer-managed fields. Invalid cron expressions, timezones, `at` times, ids, duplicate ids, or relative `cwd` fail the mount loudly, naming the rule when applicable.

## Design notes

- **Config is the durable store**: rules live in cordis.yml, so no job-store file, no CRUD tools, no new storage seam (runtime-editable rules are deferred);
- **Disabled by default**: the schema defaults `enabled` to false, and the disabled path validates configuration but creates no runtime, timer, or session;
- **One re-arming unref'd timer**: armed to the earliest occurrence across rules; on wake, due rules run sequentially, then the timer re-arms (OpenClaw's scheduler shape);
- **Per-rule session lifecycle**: resume-or-create keeps the session log across restarts; new sessions record current `cwd` and `agentPreset`, resumed sessions retain their recorded workspace, and the configured preset is mounted before publication, so its Soul, Memory, Skills, and other contributed capabilities are available to scheduled turns;
- **Interval semantics**: an `every` rule first runs after one complete interval. The next occurrence is chosen after the prior run completes, so long runs do not trigger catch-up bursts;
- **Failure semantics**: a durable `started` record lands before the turn; exactly one terminal record follows and requires an actual `turn/end`. Cron and interval failures wait for their next declared occurrence. An `at` attempt is terminal whether it succeeds or fails, so it is never an implicit retry loop.

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
- **No main-session summary**: OpenClaw's `main` target (`System:` lines injected into the main session) is not ported; scheduled sessions are nevertheless visible in their workspace with the title `自动任务 · <name-or-id>` when the host's title and workspace services are installed;
- **No automatic retries**: failures record an `error` run and the next occurrence proceeds (OpenClaw-isomorphic);
- **No runtime-editable rules**: rules are config-declared; OpenClaw's job store + `cron.add/remove/…` tools and CLI are deferred until a consumer needs runtime edits;
- **`at` once-guard needs the session artifact**: if the persisted session log is deleted, a past one-shot re-fires once (at-least-once semantics);
- **`every` re-anchors at mount**: each boot begins a fresh interval and waits for it to elapse; process downtime does not create catch-up runs.
