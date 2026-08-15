# Product chain & correctness verification (Phase 0–3 shipped features)

English | [中文](product-chain.zh.md)

- **Status**: Phase 4 entry deliverable (2026-08-14)
- **Purpose**: one page that traces every shipped feature's wiring chain — OpenClaw source → dsh seam → landing package → trigger/presentation — and runs a three-way correctness check (parity matrix / code / contract test) that explicitly flags every doc–code inconsistency.
- **Method**: each feature gets a wiring table plus a ✅/⚠️/❌ checklist. ❌ marks a doc that is wrong today and must be fixed before publish; ⚠️ marks a verification gap or an ambiguous claim that needs reconciling.

| Marker | Meaning |
|---|---|
| ✅ | verified against matrix + code (+ contract test where applicable) |
| ⚠️ | verification gap or ambiguous claim — reconcile, but not a hard error |
| ❌ | doc–code inconsistency — the cited doc is wrong today |

## Summary index

| Feature | Landing package | dsh seam | Correctness |
|---|---|---|---|
| channel-core | `channel-core/` | **new** `ctx.channels` (ADR-0002) | ✅ |
| channel-telegram | `channel-telegram/` | `ctx.channels` | ✅ (e2e ⚠️ credentials) |
| channel-feishu | `channel-feishu/` | `ctx.channels` | ✅ (real e2e passed) |
| soul | `soul/` | `ctx.systemPrompt` | ✅ |
| memory (+embeddings +embeddings-ark) | `memory/`, `embeddings/`, `embeddings-ark/` | `ctx.fs` + `ctx.tools` + `ctx.get('embeddings')` (ADR-0003) | ✅ (one ⚠️) |
| skills-hub | `skills-hub/` | `ctx.skills` | ✅ (roster ❌) |
| automation | `automation/` | `ctx.agents` + `ctx.sessions` | ✅ (roster ❌ ×2) |
| ClawDSH assembly wiring | `preset-openclaw/` | `clawdsh` profile/patch + `clawdsh` agent preset | ✅ |

## channel-core

| Link | Content |
|---|---|
| OpenClaw 源 | channel gateway `Gateway` — message routing, thread management, adapter registry |
| dsh seam | **new** `ctx.channels` (ADR-0002); `ChannelRegistry extends Service`, `static inject = ['agents','sessions','agentDefaultModel']` |
| 落地包 | `packages/openclaw/channel-core/src/index.ts` |
| 触发 | adapter emits `channel/inbound` → `route()` → `getOrCreateThread()` (`SessionId('channel-${randomUUID()}')`) → `driveTurn()` (followup → whenIdle → `sessions.flush` → `extractReply` → `adapter.send` → emit `channel/outbound`) |
| 呈现 | `presentation.ts` pure resolvers: `resolveAckReaction` (default `👀`), `resolveResponsePrefix` (`auto` = `[name]`), `deriveMentionPatterns`, `stripMentions`, `stripZeroWidth` |

- ✅ matrix `parity.md`: "implemented".
- ✅ code: `ChannelRegistry`, `registerAdapter`, `getPresentation`, `route`, `driveTurn`, `extractReply` all present; `extractReply` filters plugin-sourced turns.
- ✅ contract test: `invariant.ts` ships an empty installer with a "No runtime invariant" reason — justified (the registry owns no assertion-able relationship beyond the adapter set it already exposes).
- ✅ model-visible ⟺ logged: inbound → `user/message`, outbound → `assistant/message` (via `driveTurn` → `sessions.flush`); ack reaction is channel-side and correctly *not* model-visible.

## channel-telegram

| Link | Content |
|---|---|
| OpenClaw 源 | `extensions/telegram` (grammY-based) |
| dsh seam | `ctx.channels` — implements `ChannelAdapter` |
| 落地包 | `packages/openclaw/channel-telegram/src/index.ts` |
| 触发 | grammY `Bot` polling → `toInbound` → `detectBotMention` → channel-core `route` |
| 呈现 | `setMessageReaction`; capabilities `{receive: polling, send: true, react: true}` |

- ✅ matrix: "implemented".
- ✅ code complete.
- ⚠️ transport e2e blocked on credentials (no Telegram bot token). This is a known, *documented* gap (`openclaw/README.md` "e2e pending credentials", journal "Telegram blocked on credentials") — consistent, not an inconsistency.

## channel-feishu

| Link | Content |
|---|---|
| OpenClaw 源 | `extensions/feishu` (since OpenClaw v2026.2.12) |
| dsh seam | `ctx.channels` — implements `ChannelAdapter` |
| 落地包 | `packages/openclaw/channel-feishu/src/index.ts` |
| 触发 | `Lark.WSClient` long-connection → `im.message.receive_v1` → dedup by `message_id` (`SEEN_CAP = 10000`) → route → `im.message.create` outbound |
| 呈现 | `im.messageReaction.create`; capabilities `{receive: true, send: true, react: true}`; config `{appId, appSecret, domain}` |

- ✅ matrix: "implemented".
- ✅ code complete.
- ✅ real e2e passed end-to-end (journal + `openclaw/README.md` "real e2e passed"). Credentials go through `FEISHU_APP_ID` / `FEISHU_APP_SECRET` env vars, not disk.

## soul

| Link | Content |
|---|---|
| OpenClaw 源 | Soul / identity system (`src/agents/` — persona, tone, behavioral guidelines) |
| dsh seam | `ctx.systemPrompt` — `section({name, order, text, complete?})` |
| 落地包 | `packages/openclaw/soul/src/index.ts`; `inject = ['systemPrompt']`, `SOUL_SECTION = 'clawdsh:soul'`, `SOUL_ORDER = 10` |
| 触发 | mount at boot → contributes a system-prompt section |
| 呈现 | `mode: replace` → `PERSONA_SECTION` with `complete: true` (soul becomes the whole prompt); `mode: append` → appended section; relative `source` resolves via `ctx.baseUrl` |

- ✅ matrix: "implemented".
- ✅ code + 12 test cases (baseUrl-relative resolution, cwd fallback); replace/append is the finalized form.
- ✅ preset wiring: `preset-openclaw/agent.cordis.yml` carries `source: ./souls/assistant.md`, `mode: append`.
- ✅ model-visible ⟺ logged: the soul is a prompt section, so assembly enters `request/header` (upstream session mechanism guarantees "model-visible means logged").

## memory (+ embeddings + embeddings-ark)

| Link | Content |
|---|---|
| OpenClaw 源 | Memory (v2026.1.15) — Markdown fact source + semantic recall |
| dsh seam | `ctx.fs` + `ctx.tools` + system-prompt section + `ctx.get('embeddings')` (ADR-0003) |
| 落地包 | `memory/` (`search.ts` `MemoryIndex`, `watch.ts` chokidar, `flush.ts`, `chunk.ts`, `memory-files.ts`) + `embeddings/` (abstract `Embeddings extends Service`) + `embeddings-ark/` (`ArkEmbeddings`, `doubao-embedding-vision-251215`) |
| 触发 | `memory_search` / `memory_get` tools (search requires `ctx.embeddings`, fail-loud otherwise); `agent/turn-stopping` flush hook; host fs watcher (`invalidateFile`) |
| 呈现 | `MEMORY_RECALL_SECTION = 'clawdsh:memory-recall'` (order 115); search hits as tool results |

- ✅ matrix: "implemented" (memory, embeddings, embeddings-ark).
- ✅ code: incremental `(version, size)` sync, `cosineSimilarity`, one embed batch per search, watcher closes same-size-edit blind spot.
- ✅ model-visible ⟺ logged: `memory_search` results are tool-result events; flush uses the `NO_REPLY` convention under the `memory-flush` source (logged, not model-visible); recall section is a prompt section.
- ⚠️ `openclaw/README.md` line 39 says embeddings-ark "e2e pending credentials", while `roadmap.md` Phase 2 status says "a real ARK e2e (tools/ark-e2e.ts)". Reconcile which is authoritative.

## skills-hub

| Link | Content |
|---|---|
| OpenClaw 源 | Skills / ClawHub (compatible skill directory loading) |
| dsh seam | `ctx.skills` |
| 落地包 | `packages/openclaw/skills-hub/src/index.ts`; `ClawHubProvider` name `'clawhub'`, ranks `WORKSPACE=300 / EXTRA=350 / MANAGED=450`, `DEFAULT_MANAGED_DIR = ~/.clawdbot/skills`, `metadata.clawdbot.requires.{bins,anyBins,env}` gating |
| 触发 | skills registry provider mount |
| 呈现 | skill catalog → model-visible tools/instructions (logged via skill tool events) |

- ✅ matrix: "implemented".
- ✅ code: pure incremental directory merge, no install execution, no credentials.
- ❌ `openclaw/README.md` line 40 roster status still "planning" — must read "implemented (phase 3 ✅)".

## automation

| Link | Content |
|---|---|
| OpenClaw 源 | Cron / Automation (scheduled agent turns) |
| dsh seam | `ctx.agents` + `ctx.sessions` via croner — **not** `ctx.schedule` (no such seam; `ctx.schedule` was rejected) |
| 落地包 | `packages/openclaw/automation/src/index.ts`; rule kinds `cron/at/every`, `SessionId('automation:${id}')`, `agent.session.append('automation/run', {ruleId, scheduledAt, status})`, resume-or-create via `ctx.agents.resume` |
| 触发 | cron/at/every rules → agent turn |
| 呈现 | `automation/run` session event (`AutomationRunEvent` declaration-merged into `SessionEventMap`) |

- ✅ matrix: "implemented".
- ✅ code: croner `Cron`, `MAX_TIMER_DELAY_MS`, session-event append, resume-or-create.
- ✅ model-visible ⟺ logged: `automation/run` logged + plugin-sourced turns.
- ❌ `openclaw/README.md` line 41: status still "planning" **and** seam mislabeled `ctx.schedule / ctx.jobs` — must read "implemented (phase 3 ✅, disabled opt-in)" and "`ctx.agents` + `ctx.sessions`".

## preset-openclaw wiring

| Link | Content |
|---|---|
| 形态 | `clawdsh` agent preset (`preset.yml` display name `ClawDSH 模式` + `agent.cordis.yml`), example soul (`souls/assistant.md`), and `clawdsh` profile template (`profile/cordis.patch.yml`) |
| 层叠 | `profile/package.json` composes `@deepseek-ai/dsh-base` then `@deepseek-ai/dsh-web-app`; soul mounts through the agent preset rather than the profile |
| profile patch | `system-prompt` persona → `channel-core` → `channel-telegram` (`disabled: true`) → `channel-feishu` (`disabled: true`, env credential references) → `memory` → `embeddings-ark` → `skills-hub` → `automation` (`disabled: true`) → `agent-presets.default: clawdsh` |
| 凭证 | Disabled channels may omit credentials; Feishu uses env references when enabled, and Ark resolves `ARK_API_KEY` on demand — no value is committed to the profile |

- ✅ wiring complete: all six runtime features are covered by the profile patch, and soul by the agent preset.
- ✅ layer separation correct: soul is an agent-preset concern, channels/memory/skills/automation are profile-patch concerns.
- ✅ Feishu, Telegram, and Automation ship `disabled: true`, so the clean-install Web Host starts without their credentials.
- ✅ these optional features temporarily use Loader `disabled`; the capability Settings increment keeps their business plugins mounted and moves control to validated `enabled` settings.
- ✅ `tools/link-clawdsh.sh` installs only the `clawdsh` ids and preserves legacy `openclaw` assets after warning; it creates no compatibility alias.
- ✅ the managed manifest, integrity repair, and `clawdsh doctor` belong to the public-distribution CLI rather than this profile source.

## Doc–code inconsistency ledger

| # | Location | Today | Should read | Severity |
|---|---|---|---|---|
| 1 | `openclaw/README.md:40` | skills-hub "planning" | "implemented (phase 3 ✅)" | ❌ |
| 2 | `openclaw/README.md:41` | automation "planning", seam "`ctx.schedule` / `ctx.jobs`" | "implemented (phase 3 ✅, disabled opt-in)", seam "`ctx.agents` + `ctx.sessions`" | ❌ |
| 3 | `openclaw/README.md:39` | embeddings-ark "e2e pending credentials" | reconcile vs `roadmap.md` "real ARK e2e" | ⚠️ |
| 4 | `docs/matrix/parity.md:46` | Federation "to be named / Deferred (evaluated at end of Phase 3)" | ADR-0005 `'clawd-federation'` transport provider; Phase 3 concluded | ❌ |
| 5 | `AGENTS.md:18` (CLAUDE.md symlink) | "当前阶段：阶段 2" | "阶段 4" | ❌ |
| 6 | `docs/specs/roadmap.md:36,42` | Phase 2 header lacks ✅; Phase 3 has no completion marker | both carry ✅ (completed 2026-08-14) | ⚠️ |
| 7 | `docs/adr/0001-project-foundation.md` decision 3 | physical-isolation list omits `docs/upstream-proposal/` | add it (CLAUDE.md brand section already lists it) | ⚠️ |

Items 1–2, 4–5 are publish-blocking (a reader would be actively misled); items 3, 6–7 are pre-publish cleanup with no correctness risk.

## Model-visible ⟺ logged, per feature

| Feature | Model-visible input | Logged as | Verdict |
|---|---|---|---|
| soul | system-prompt section | `request/header` | ✅ |
| memory recall | system-prompt section | `request/header` | ✅ |
| memory search | tool result | tool-result event | ✅ |
| memory flush | (not model-visible) | `memory-flush` source, `NO_REPLY` | ✅ |
| channel inbound | user message | `user/message` | ✅ |
| channel outbound | assistant message | `assistant/message` | ✅ |
| ack reaction | (not model-visible) | — | ✅ |
| automation run | plugin-sourced turn | `automation/run` event | ✅ |
| skills | skill tool/instructions | skill tool events | ✅ |
