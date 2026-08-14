# Feature spec: Automation (scheduled agent turns)

English | [中文](feature-automation.zh.md)

- **Status**: implemented (Phase 3 ✅, 2026-08-14)
- **Implementation package**: `packages/openclaw/automation` (`@clawdsh/dsh-automation`)
- **OpenClaw counterpart**: Cron (`v2026.1.5` `src/cron/`): job store + `cron`/`at`/`every` schedules, one dedicated session per job, prompt framing, in-flight dedup, no retries, no catch-up.
- **Decision record**: Agent Note [2026-08-14-openclaw-cron-mapping](../../.agents/notes/implemented/architecture/2026-08-14-openclaw-cron-mapping.md)

## Goals

- Config-declared rules drive one ordinary agent turn per occurrence, in a dedicated durable session (`automation:<id>`) resumed across restarts;
- Schedule kinds: `cron` (5-field + optional IANA tz, via the croner library OpenClaw pins), one-shot `at` (durable once-guard), anchored `every`;
- OpenClaw-isomorphic run semantics: at-least-once (`started` record before the turn), in-flight dedup, no automatic retries, missed occurrences skipped;
- The session log is the run log: `automation/run` records around each logged turn, no separate artifact.

## Non-goals

- No channel delivery (`deliver`) and no main-session summary (`System:` lines) — no main-session wiring exists in the openclaw profile yet;
- No runtime-editable rules (job store + `cron.add/remove/…` tools and CLI) — config-declared rules need no storage seam;
- No event-triggered rules (file-change watchers etc.);
- No `ctx.schedule` reuse: its 300s `every` floor, session-local delivery, live-root-only attach, and tools-only creation API cannot express this feature category (evidence in the decision record).

## Seam (written down)

- `ctx.agents` / `ctx.sessions` / `ctx.agentDefaultModel` (declared injects): per-rule durable agent, resume-or-create, `followup → whenIdle → sessions.flush` turn driving;
- `ctx.get('sessionPersistence')` (optional read): session artifacts for resume and the `at` once-guard;
- Session event `automation/run` (declaration-merged): `{ruleId, scheduledAt, status: 'started'|'ok'|'error', error?}` — structurally validated by `Session.append`, listed in the generated persistence catalog; the turn itself is an ordinary logged turn, so "model-visible means logged" holds.

## Config surface

```yaml
automation:
  rules:
    - id: morning-digest        # [a-zA-Z0-9_-]+；也是会话名后缀 automation:<id>
      name: Morning             # 可选，进入回合帧
      schedule: { kind: cron, expr: '0 9 * * *', timeZone: Asia/Shanghai }
      message: Post a morning digest of the session log.
    - id: weekly-review
      schedule: { kind: at, at: '2026-08-17T09:00:00+08:00' }
      message: Write the weekly review.
    - id: ping
      schedule: { kind: every, seconds: 3600 }
      message: Check whether anything needs attention.
```

## Acceptance criteria

1. ✅ Invalid cron expressions, timezones, `at` times, ids, and duplicate ids fail the mount loudly, naming the rule (test: `fails mount loudly on invalid rules`);
2. ✅ A cron rule fires at its minute boundary with the framed turn (`[automation:<id> <name>] <message>`, plugin source) and `started`/`ok` records (test: `fires a cron rule at the minute boundary`);
3. ✅ Overlapping fires are deduped while a run is in flight (test: `skips overlapping fires`);
4. ✅ Missed occurrences are skipped without catch-up and the next occurrence still fires (test: `skips missed occurrences`);
5. ✅ The same durable session resumes across remounts, keeping prior run records (test: `resumes the same durable session`);
6. ✅ A past one-shot `at` rule with an `ok` record does not re-fire after remount (test: `suppresses a past one-shot at rule`);
7. ✅ A failed turn records `error` and the next occurrence still fires (test: `records an error run and re-arms`);
8. ✅ Disposal stops firing and disposes the rule agents (test: `stops firing and disposes its agents`).
