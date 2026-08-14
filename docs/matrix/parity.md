# OpenClaw ↔ dsh feature alignment matrix

English | [中文](parity.zh.md)

> This matrix is ClawDSH's **single source of truth**: each OpenClaw feature domain gets its sole classification and status here. Any PR touching a feature change must update this file in sync (see `docs/standards/pr-policy.md`).
>
> Classification meanings:
> - **Reuse**: native dsh capability, used directly, no code written;
> - **Plugin**: incremental package mounted on an existing dsh seam (`packages/openclaw/*`);
> - **New seam**: dsh has no corresponding seam, must add (requires an ADR; upstream-first unless that ADR records an explicit project decision otherwise);
> - **Deferred**: not this round, reason recorded.

## Baseline (finalized Phase 1, 2026-08-14)

**OpenClaw baseline = tag `v2026.1.5` (commit `197b8f7c3b`)**, selection rationale (full analysis in docs/journal/2026-08-14.md Phase 1 section):

| Metric | 2025-12-31 | **v2026.1.5 ✅** | v2026.1.15 | v2026.1.20 | v2026.1.30 |
|---|---|---|---|---|---|
| File count | 1197 | **1537** | 3367 (doubled) | 4041 | 4543 |
| Channels | discord/telegram | **+imessage/signal/slack** | +whatsapp | — | — |
| channels abstraction | ✗ | ✗ | ✓ | ✓ | ✓ |
| memory directory | ✗ | ✗ | ✓ | ✓ | ✓ |
| Bloat signs (extensions/plugins/docker deploy matrix) | ✗ | **✗** | appears | worsens | worsens |

- **Why v2026.1.5**: first release tag (1.5-1/2/3 minor versions only fix bugs), the "gateway + 5 channels + cron + sessions + tui/wizard" personal-assistant core experience complete and stable; thinnest codebase of all tags (1537 files / 1.6MB); no bloat signs; timing = the project's peak-virality period.
- **Feature-completion reference**: whatsapp / memory / channels abstraction do not yet appear in the baseline → consult `v2026.1.15` (`9c4c9c5edd`) when porting; earlier gateway prototype reference `2025-12-31` (`f03605d8ae`).
- Reference repo local cache: `/tmp/openclaw-ref` (partial clone, blob:none; re-pull after machine restart, command in journal).

## Matrix v2 (baseline finalized)

| OpenClaw feature domain | Baseline source (v2026.1.5) | dsh seam | Classification | Landing package | Status |
|---|---|---|---|---|---|
| Sessions / message history | `src/sessions/` | `ctx.sessions` (append-only log) | Reuse | — | directly usable |
| Session tracing / replay / forking | — (dsh-native) | Trajectory view / replay | Reuse | — | directly usable |
| Tool execution (bash/file/browser…) | `src/agents/*-tools.ts` | `ctx.tools` / `ctx.shell` / `ctx.fs` / `ctx.web` | Reuse | — | directly usable |
| Skills (Skill) | top-level `skills/` | `ctx.skills` (provider merge) | Plugin | `skills-hub` | **implemented** (Phase 3 ✅) |
| Scheduling / automation | `src/cron/` | own unref'd croner timer + `agent.followup`/`whenIdle`/`sessions.flush` turn bridge (`ctx.schedule` rejected: session-local + 300s floor + tools-only API) | Plugin | `automation` | **implemented** (Phase 3 ✅) |
| Persona (Soul) | `src/agents/system-prompt.ts` first line + workspace six files (AGENTS/SOUL/TOOLS/IDENTITY/USER/BOOTSTRAP.md) | system-prompt assembly (persona first line / soul append / complete section / tool guidance band) + channel presentation (IDENTITY ✅) | Plugin | `soul` | **implemented** (Phase 0 ✅ + Phase 2 deep-read finalization ✅) |
| Memory | baseline absent → reference v2026.1.15 `src/memory/` + `src/agents/memory-search.ts`, `memory-tool.ts` | Harness `ctx.fs`/sandbox + tools/system prompt + embeddings | Plugin | `memory` + `embeddings` + `embeddings-ark` | **implemented** (three tools, configured defaults, missing-root startup, durable flush cycle ✅) |
| **Channel gateway (Gateway)** | `src/gateway/` | **none** | **new seam** | `channel-core` | **implemented** (awaited durability, deterministic resume/preset/FIFO, legacy thread-only compatibility, `groupMode`/structured-mention policy ✅) |
| Channel: Telegram | `src/telegram/` | `ctx.channels` | Plugin | `channel-telegram` | **implemented** (commands/mentions/captions/topics/replies/reactions, Unicode-safe 4096 splitting, lifecycle catches ✅) |
| Channel: Discord | `src/discord/` | `ctx.channels` | Plugin | `channel-discord` (to be built) | planning |
| Channel: iMessage / Signal / Slack | `src/imessage/` etc. | `ctx.channels` | Plugin | per-package later | Deferred (Phase 3) |
| Channel: WhatsApp | reference v2026.1.15 `src/whatsapp/` | `ctx.channels` | Plugin | per-package later | Deferred (Phase 3) |
| Approval / security policy | `src/security/` (from 1.15) | `ctx.approval` / guard | Reuse (config) | — | directly usable |
| Federation node (clawd) | absent in early baseline | `ctx.subagents` (transport) | Plugin | to be named | Deferred (evaluated at end of Phase 3) |
| Smart home (casa) | absent in baseline | none | new plugin domain | to be named | Deferred |
| Desktop/mobile client | `ui/` (+ `apps/`) | `apps/web` (dsh Web UI) | Reuse | — | customization surface evaluated later |

## Domestic platforms (principle: only implement what OpenClaw upstream has)

> **Project principle (established by the initiator 2026-08-14)**: only implement features that have a source in OpenClaw upstream, feeling for stones while crossing the river; do not invent feature domains upstream lacks. Domestic platforms verified one by one under this principle:

| Platform | OpenClaw upstream status | Verdict |
|---|---|---|
| **Feishu (Lark)** | ✅ official `extensions/feishu` (introduced 2026-02-03: `2483f26c23`→`0223416c61`; released since v2026.2.12) | **do it, and initiator's first priority** (see matrix row below) |
| WeCom / WeChat / Official Account / personal WeChat | ❌ upstream (latest main) has no WeChat-family channel (the `tencent` extension is a Tencent Cloud LLM provider, not a channel) | **no core package** — principled exclusion; follow up when upstream adds wecom |
| DingTalk / QQ | ❌ upstream absent | no — principled exclusion, same as above |

### Feishu channel (matrix row)

| Feature domain | Source | dsh seam | Classification | Landing package | Status |
|---|---|---|---|---|---|
| Channel: Feishu (Lark) | OpenClaw `extensions/feishu` (since v2026.2.12; introducing commit `0223416c61`) | `ctx.channels` + official SDK 1.73 `LarkChannel` | Plugin | `channel-feishu` | **implemented** (normalized rich messages, identity backoff, topic-safe 3500 replies, failed-handshake cleanup, reactions ✅) |

WeChat family not in the matrix (not implemented), decision record in `docs/specs/feature-channel-wechat.md`.

## Distribution status (not feature parity)

The nine `packages/openclaw/*` members now form an independent, shared-version `clawdsh` release family with `clawdsh-v*` tags. Synchronized bump/verify/pack/publish, workspace constraints, pack artifacts, fresh packed-install verification for the main and invariant paths, and the protected private-registry `.github/workflows/clawdsh-publish.yml` path are implemented. No ClawDSH npm publication has been executed from this worktree; local profile assembly still uses `tools/link-openclaw.sh` symlinks.

## Maintenance rules

1. Add/remove/reclassify any feature domain = edit this table + note in commit message;
2. "Deferred" entries must write the reason and unblocking condition;
3. Re-review this table after each dsh upstream sync (the OpenClaw baseline is a feature-list snapshot, no longer changing; to deep-read a feature, look up `/tmp/openclaw-ref` by the "baseline source" column);
4. Feature domains with no upstream source do not enter the matrix (principled exclusion), decision recorded in the corresponding package README or journal.
