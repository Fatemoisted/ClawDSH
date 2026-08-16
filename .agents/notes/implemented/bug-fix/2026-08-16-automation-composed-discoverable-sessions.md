# Agent Note: Composed and discoverable Automation sessions

Status: implemented

English | [中文](2026-08-16-automation-composed-discoverable-sessions.zh.md)

## Problem

The [initial cron mapping](../architecture/2026-08-14-openclaw-cron-mapping.md) chose the correct scheduler ownership but left each rule's execution agent under-composed and its session hard to find. A scheduled turn selected a model without mounting the configured ClawDSH preset, so it could lack Soul, Memory, Skills, and other capabilities available in an interactive ClawDSH conversation. A newly created session also lacked `cwd`, `agentPreset`, a readable title, and workspace membership, which kept the result out of the normal session list even though the run existed in persistence.

The runtime semantics had adjacent correctness gaps. An `every` rule fired immediately on mount instead of waiting one interval; a failed `at` run could be armed again; completion was inferred from idle state rather than an owned `turn/end`; and terminal persistence failure could enter the catch path after an `ok` append and append an `error` for the same attempt. Agent acquisition ran without an awaited initialization boundary, while disposal could race pending acquisition and timer work. The browser also generated positional ids such as `rule-1`; deleting one rule and creating another could reuse the durable `automation:<id>` Session and expose the new task to the previous task's context. A relative or edited `cwd` could fail workspace publication, while changing it could misleadingly appear to migrate an already-created Session whose header is immutable.

## Decision

Automation requires `agentPresets` beside the existing agent, session, and model-selection services. Config adds `preset` (default `clawdsh`) and an absolute `cwd` (default `process.cwd()`); a relative path fails before any agent is acquired. Both resumed and newly created rule agents install the selected model and mount that preset before use. New session metadata records `{cwd, agentPreset}`; an older resumed session keeps its immutable header but still receives the configured preset in its live agent context. The ClawDSH Settings manifest therefore treats `preset` and `cwd` as installer-managed fields rather than editable task settings.

Session publication uses optional host services without making generic headless Automation depend on the Web product. When `sessionTitle` is installed, a session without an existing title becomes `自动任务 · <name-or-id>`. When `workspaceRegistry` is installed, the immutable `session.header.cwd` must resolve to a registered workspace and the session is attached there after a session flush. New Sessions receive the current Config value; resumed Sessions retain and publish through their recorded value. An installed publication service that cannot complete its work rejects initialization; an absent service leaves that enrichment out.

The browser creates each new rule id from `crypto.randomUUID()` with a fixed `rule-` prefix. Deleting a rule and later adding another cannot reuse a positional id and therefore cannot accidentally resume the deleted rule's durable Session. The visible editor calls the objects “自动任务” and explains that a task combines a schedule with an instruction, requires explicit enable plus restart, and stores its result in a dedicated titled conversation.

The schedule kinds have distinct terminal semantics. `every` waits one complete interval after mount, then selects the next strictly future point on the original process anchor grid after each run completes. `cron` also computes its next occurrence after completion. Both skip boundaries missed by a long run. `at` makes exactly one attempt: a persisted `ok` or `error` for the same rule and timestamp is terminal across restarts, and the current runtime marks the rule complete after either outcome.

Each attempt appends and flushes `started` before submitting the framed prompt. After the agent becomes idle, Automation finds the turn's own `turn/end`; only `completed` maps to `ok`, while absence, error, cancellation, or another non-completed reason maps to `error`. It appends exactly one terminal event and performs one terminal flush. If that flush fails, the runtime warns that the status was not durable but does not synthesize a second terminal event.

Initialization is awaited and owns all acquired handles. Any rule acquisition or publication failure aborts initialization and disposes already acquired handles. Disposal is idempotent: it aborts pending acquisition, clears the timer, awaits initialization convergence, cancels active agents, awaits tracked ticks, and then disposes every handle.

## Alternatives considered

**Keep scheduled agents model-only and grant individual capabilities as rules need them.** Rejected because it creates a second, drifting composition model. A scheduled ClawDSH turn should receive the same declared preset capabilities as an interactive ClawDSH turn.

**Post every result into a current interactive conversation instead of publishing the dedicated session.** Rejected because Automation has no authoritative current-session owner, and cross-session injection would obscure which rule caused the turn. The dedicated session remains the run's durable and inspectable home.

**Make title and workspace services required injections.** Rejected because Automation remains valid in headless compositions. Their absence omits publication enrichment; their presence creates an obligation to publish completely or fail initialization.

**Retry a failed `at` rule or fire an `every` rule immediately at startup.** Rejected because either choice invents an occurrence not declared by the schedule and can duplicate side effects. A one-shot is one attempt, and an interval begins after one interval has elapsed.

**Append `error` after an `ok` terminal flush failure.** Rejected because persistence failure does not change the turn outcome, and two terminal records make the run log contradictory.

**Reuse short positional rule ids after deletion.** Rejected because a rule id is also a durable Session identity, not a disposable list index. Random ids prevent accidental context inheritance without deleting historical sessions.

## Consequences

Scheduled turns now use the complete configured preset and, in the Web host, appear beside ordinary sessions with a meaningful title and workspace association. The same session log contains prompt contributions, tool use, assistant output, and Automation run records, so the result is both capable and inspectable. Changing installation `cwd` affects newly created Automation Sessions only; resumed Sessions remain in the workspace recorded at creation.

Enabling Automation can now fail product initialization when the configured preset is unavailable, session acquisition fails, or an installed publication service cannot publish the session. This is intentional: no timer starts with a partially initialized rule set. A configured `cwd` in a Web composition must belong to a registered workspace.

The scheduler does not provide retries, channel delivery, or main-session summaries. Cron and interval failures wait for their next declared occurrence; one-shot failures remain terminal. If terminal persistence fails, an `at` rule stays terminal only for the current process and can run again after restart because the durable guard could not be written.

## Verification

Focused runtime tests exercise preset prompt contributions, new-session metadata, immutable resume workspace publication, relative-path rejection, title and workspace publication, first-interval timing, long-run and missed-boundary scheduling, durable success and failure guards for `at`, exact terminal recording, initialization failures, acquisition/disposal races, and final handle cleanup. Browser tests prove that deleting and adding a task does not reuse its Session id and that the plain-language explanation is present. The package typecheck, lint, bilingual pairing, and diff checks pass with the corrected implementation.
