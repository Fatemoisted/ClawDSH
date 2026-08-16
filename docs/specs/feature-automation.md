# Feature spec: Automation (scheduled agent turns)

English | [中文](feature-automation.zh.md)

- **Status**: implemented (Phase 3 ✅, corrected 2026-08-16)
- **Implementation package**: `packages/openclaw/automation` (`@clawdsh/dsh-automation`)
- **OpenClaw counterpart**: Cron (`v2026.1.5` `src/cron/`): config-declared `cron`/`at`/`every` schedules, one dedicated session per rule, prompt framing, in-flight dedup, no retries, and no catch-up.
- **Decision records**: initial scheduler mapping [2026-08-14-openclaw-cron-mapping](../../.agents/notes/implemented/architecture/2026-08-14-openclaw-cron-mapping.md); composed and discoverable session correction [2026-08-16-automation-composed-discoverable-sessions](../../.agents/notes/implemented/bug-fix/2026-08-16-automation-composed-discoverable-sessions.md).

## Goals

- Each enabled Config rule drives one ordinary agent turn per occurrence in its dedicated session (`automation:<id>`), resumed across restarts when session persistence is installed.
- Every scheduled agent mounts the configured full preset, `clawdsh` by default, so Soul, Memory, Skills, tools, and other preset contributions behave like they do in an interactive ClawDSH session.
- New sessions record the configured `cwd` and `agentPreset`; when the host provides title and workspace services, they also receive the title `自动任务 · <name-or-id>` and appear in the workspace that owns `cwd`.
- The scheduler supports `cron`, one-shot `at`, and anchored `every` rules with in-flight dedup, no automatic retries, and no catch-up bursts.
- The session log is the run log: a flushed `started` event precedes the turn, and exactly one `ok` or `error` terminal event follows an observed `turn/end` or execution failure.

The clean-install `clawdsh` profile keeps the Automation plugin mounted with `enabled=false` and no rules. Its Config schema remains available to ClawDSH Settings, while the disabled business effect creates no timer, runtime, or Automation session. Automation does not infer scheduled work from chat: the user must explicitly define both when to run and what the scheduled agent should do.

## Non-goals

- No channel delivery (`deliver`) and no main-session summary (`System:` lines); replies remain in the dedicated Automation session.
- No runtime-editable rules, job store, `cron.add/remove/…` tools, or CLI; Config is the rule store.
- No event-triggered rules such as file-change watchers.
- No `ctx.schedule` reuse: its 300-second `every` floor, session-local delivery, live-root-only attachment, and tools-only creation API cannot express this feature category.

## Runtime dependencies

- `ctx.agents`, `ctx.agentPresets`, `ctx.sessions`, and `ctx.agentDefaultModel` are required: each rule resumes or creates an agent, mounts the configured preset, and drives `followup → whenIdle → sessions.flush`.
- `ctx.get('sessionPersistence')` is optional: when present, its artifacts provide cross-process resume and the durable `at` terminal guard; without it, rules start fresh in each process.
- `ctx.get('sessionTitle')` and `ctx.get('workspaceRegistry')` are optional publication services. When installed, publication errors fail Automation initialization instead of leaving a partially published session.
- Session event `automation/run` is declaration-merged into `SessionEventMap` with `{ruleId, scheduledAt, status: 'started'|'ok'|'error', error?}`. The scheduled turn is an ordinary logged turn, so model-visible input remains reconstructable.

## Config surface

```yaml
automation:
  enabled: true
  preset: clawdsh
  cwd: /absolute/path/to/workspace
  rules:
    - id: morning-digest
      name: Morning
      schedule: { kind: cron, expr: '0 9 * * *', timeZone: Asia/Shanghai }
      message: Post a morning digest of the session log.
    - id: weekly-review
      schedule: { kind: at, at: '2026-08-17T09:00:00+08:00' }
      message: Write the weekly review.
    - id: ping
      schedule: { kind: every, seconds: 3600 }
      message: Check whether anything needs attention.
```

Rule ids match `[a-zA-Z0-9_-]+` and form the persisted session suffix. The Web editor generates a new UUID-backed id for every added task, so deleting and adding a task cannot resume the deleted task's Session by reusing a list position. Invalid ids, duplicate ids, relative `cwd`, cron expressions, time zones, and `at` timestamps fail initialization while naming the affected rule when applicable. In the ClawDSH Settings section, `preset` and `cwd` are installer-managed; the user edits only the business switch and task rules.

## Runtime guarantees

1. An `every` rule first runs only after one complete interval. After a run finishes, its next strictly future point is selected on the process's original anchor grid; intervals missed during a long run are skipped.
2. A `cron` rule computes its next occurrence after the prior run finishes, so elapsed cron boundaries do not trigger a catch-up burst.
3. An `at` rule makes one attempt. Either `ok` or `error` is terminal, and a matching persisted terminal event prevents a past occurrence from running again after restart.
4. Due rules run sequentially, and a rule already in flight cannot overlap itself.
5. `started` is appended and flushed before the prompt is submitted. Success requires an actual `turn/end` with reason `completed`; missing, errored, cancelled, or otherwise non-completed turn endings produce `error`.
6. Exactly one terminal event is appended per attempt. A terminal flush failure is logged as non-durable and does not cause a second terminal append.
7. Initialization acquires every rule session before arming the timer. Preset mounting, resume/create, title publication, flush, or workspace attachment failure disposes acquired handles and rejects plugin initialization.
8. Disposal aborts pending acquisition, clears the timer, cancels active agents, awaits in-flight ticks, and disposes every acquired handle.

## Failure and compatibility boundaries

- When `workspaceRegistry` is installed, a new Session records the current absolute `cwd`, which must resolve to a registered workspace; otherwise Automation fails initialization loudly. A resumed Session is published through its immutable header `cwd`, so changing installation config affects only new Sessions. Without the registry, the scheduled session still runs but has no workspace attachment.
- When `sessionTitle` is absent, the session still runs without the friendly title. An existing title is preserved.
- A terminal flush failure means the current process still treats an `at` attempt as complete, but persistence cannot guarantee the once-guard after restart; the warning identifies that durability loss.
- Sessions created by older builds can lack immutable `cwd` or `agentPreset` header fields. Resume still mounts the configured preset at runtime, but old header metadata is not rewritten.
