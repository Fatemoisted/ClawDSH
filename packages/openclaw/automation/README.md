# @clawdsh/dsh-automation

English | [中文](README.zh.md)

**Positioning**: scheduled tasks / automation — the user configures rules such as "send a digest at 9 every day" and "alert on file change", driving the agent to initiate sessions proactively.

**OpenClaw counterpart**: Cron / Automation (timer-triggered, event-triggered).

**Seam**: `ctx.schedule` / `ctx.jobs` (dsh natively has scheduling and background-job registration).

**Spec**: phase 3 deliverable · **status**: planning

## Notes

- Most likely a thin wrapper: dsh already has the `schedule` and `jobs` packages; this plugin only adds the "rule → agent session" bridge and the user-facing config surface;
- Messages produced by a trigger must be written to the session log as events, so they stay traceable.
