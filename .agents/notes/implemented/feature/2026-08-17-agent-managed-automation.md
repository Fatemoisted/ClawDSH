# Agent Note: Agent-managed Automation with owner-bound delivery

Status: implemented

English | [中文](2026-08-17-agent-managed-automation.zh.md)

## Problem

Automation was mounted in the product profile but exposed only a restart-applied Config array. An interactive Agent had Bash and background-job tools but no Automation management tool, so a request such as “remind me in three minutes” could be approximated with Batch or a sleeping process instead of creating durable scheduled work. The Settings page consequently remained disabled until a user manually authored rules and restarted the Host.

Channel-created tasks had a second gap. A dedicated Automation Session preserved the result, but the user who created the task from Feishu received no scheduled reply in the originating conversation. Accepting raw destination ids from the model would have fixed delivery by introducing an authority escalation and an unreliable routing surface.

## Decision

The always-mounted Automation plugin registers one model-visible `automation` tool with `list`, `add`, `update`, and `remove` actions. Its description explicitly owns reminder, future-work, and recurring-task requests and forbids substituting Bash, Batch, jobs, sleep, or background processes. `add` accepts one of `after_seconds`, `at`, `every_seconds`, or `cron`; the plugin converts a relative delay to an absolute `at` timestamp before persistence. Rule ids are allocated with `randomUUID()` and are not model-selected.

The `clawdsh-automation` Settings namespace is the durable rule store and now applies live. A coordinator serializes mutations and revisions, completely disposes the current immutable scheduler, then validates and initializes its replacement. The product control response reads the current durable `enabled` value rather than treating the Loader Fiber or restart-time snapshot as Automation enablement.

Mutations require direct human input in the active Agent turn. Context providers may append model-visible user messages after that input without replacing its authority; a later autonomous turn cannot reuse authority from an earlier turn. A normal user message authorizes a session-only task. A Channel message additionally requires `trust: 'owner'`; the plugin derives the Gateway, channel, account, conversation, and optional thread from durable message provenance. These route fields are absent from the tool schema, so the model cannot fabricate or retarget them. The Web editor preserves this private metadata while editing the visible rule fields.

Each successful scheduled turn still belongs to its dedicated durable Session. When a rule carries an origin route, Automation extracts the final non-empty assistant text and sends one `channel.action` with a SHA-256 action id derived from the rule, scheduled occurrence, and target. An unavailable Channel Provider, empty final text, or dead-letter result changes the Automation run to `error`. UI- and Web-created rules have no route and remain session-only.

Settings persistence is the desired-state commit. If replacement initialization fails afterward, the durable revision remains and the mutation fails explicitly; a later valid mutation can replace it. The Settings page therefore reports the committed desired enablement, while the failed tool call reports that runtime application did not complete.

## Alternatives considered

**Teach the Soul to translate reminders into shell or Batch operations.** Rejected because process lifetime is not durable scheduling, and prompt wording cannot supply the missing lifecycle, persistence, inspection, and channel-delivery behavior.

**Expose separate `automation_add`, `automation_list`, `automation_update`, and `automation_remove` tools.** Rejected because one closed action tool provides the same authority with a smaller model-visible catalog and one explicit ownership description.

**Keep restart-applied Settings and have the tool only edit the file.** Rejected because a successful tool call would claim task creation while the scheduler continued running the previous revision until an unrelated restart.

**Let the model provide destination ids.** Rejected because durable authenticated message provenance already identifies the allowed destination. Model-authored routing would permit unintended cross-conversation delivery and make retries dependent on opaque text arguments.

**Inject results into the originating Web Session.** Rejected because an Automation task already has a durable, inspectable Session and Web interaction has no authoritative cross-restart delivery destination. Channel delivery is supported only where the communication plane provides an authenticated route.

## Consequences

Explicit reminder and recurring-task requests can now create durable Automation rules during the same Agent turn. The Settings page reflects current durable enablement immediately, and disabling or removing the final active rule releases its timer and Agent handles without a Host restart.

Tasks created from an owner Feishu conversation return their final answer to that conversation while preserving the complete run, tools, and output in the dedicated Automation Session. Channel ids remain private configuration metadata and are never user-editable or model-writable.

Changing a rule replaces the scheduler runtime, so an in-flight occurrence is cancelled and drained before the new revision starts. This favors one unambiguous applied revision over overlapping old and new schedules. A one-shot whose delivery fails remains terminal, matching the existing one-attempt `at` semantics.

## Validation

Real-composition tests execute the `automation` tool through `ctx.tools`, prove live add/list/update/remove persistence and scheduler replacement, and advance the scheduler to a real scripted Agent answer. The isolated installed-profile snapshot sends a prompt to a loopback-only DeepSeek-compatible provider and records the exact model-visible Automation name, ownership description, actions, and schedule selectors. Owner-channel tests prove private route capture through context injection, refusal to reuse authority across turns, deterministic outbound action identity, final-text delivery, and terminal run status. Existing scheduler, durability, resume, failure, and disposal tests continue to pass. Product-shell tests prove live desired Automation enablement, sanitized Channel health, authenticated-Bridge presentation, and preservation of private delivery metadata in the Web editor.
