# Feature spec: channel gateway seam (channel-core)

English | [中文](feature-channel-core.zh.md)

- **Status**: implemented (Phase 2 ✅, 2026-08-14)
- **Implementation package**: `packages/openclaw/channel-core` (`@clawdsh/dsh-channel-core`)
- **OpenClaw counterpart**: channel gateway (`src/gateway/`, baseline v2026.1.5). In OpenClaw every channel grows directly into the gateway and agent logic — the classic symptom of "architecture without seams"; this spec splits the gateway into a two-tier "thin assembly layer + channel adapters" structure.

## Goals

- Provide the `ctx.channels` service — the project's **only newly added seam** (design in docs/adr/0002-channel-seam.md):
  - **Adapter registry**: a channel plugin registers a `ChannelAdapter`, unique by id, unregistered on dispose (HMR-safe);
  - **Inbound routing**: `channel/inbound` message → locate/create a per-thread agent session → write to session log → drive an agent turn;
  - **Outbound delivery**: agent reply → `channel/outbound` + the corresponding `adapter.send`.
- A channel plugin implements only the two capability facets `receive` (inbound events) and `send` (outbound delivery); routing, session binding, turn serialization, and retry policy all belong to `channel-core`.
- The contract inherits dsh invariants: every inbound message and outbound reply must be written to the session log ("model-visible means logged").

## Non-goals

- Attachments / quoted replies / rich text / interactive cards — Phase 3 channel extensions (the ADR "minimal surface");
- Cross-message interleaving, multi-sender aggregation, message grouping — Phase 3; this phase falls back to per-thread tail-chain serialization;
- Unified abstraction of channel features (quotes, card model) — not assumed; extracted only after a second channel's features settle.

## Seam (confirmed in Phase 2)

`ctx.channels` (`ChannelRegistry extends Service`, `super(ctx, 'channels')`):

- `static inject = ['agents', 'sessions', 'agentDefaultModel']`;
- `registerAdapter(adapter)`: id-uniqueness validation → `adapter.start(ctx)` inside `ctx.effect` + store in map, returns disposer;
- `getAdapter(id)` / `listAdapters()`;
- private `route(message)`: per-thread session map (key = `${channel}\0${threadId ?? ''}`) → `ctx.agents.create` (first message) or reuse (subsequent) → `followup(createUserMessage(...))` → `whenIdle()` → `sessions.flush()` → scan `assistant/message` text blocks for the reply → `adapter.send(outMsg)` + `ctx.emit('channel/outbound', outMsg)`;
- events (declaration merging): `channel/inbound`, `channel/outbound`.

**Conclusion: the seam hypothesis holds** — channel integration = one `ChannelAdapter` implementation, no upstream source line changed, `agent-loop` untouched.

## Config surface

No `Config` (service package, not a function plugin). Adapter plugins register via `ctx.channels.registerAdapter(adapter)`; deployment-level credentials live in each adapter plugin's `Config`, overridden through profile/patch.

## Acceptance criteria (Phase 2 conclusion)

1. ✅ **Register/unregister (HMR rollback)**: after `registerAdapter`, `listAdapters` contains it, removed after dispose (test-covered);
2. ✅ **Duplicate id fail-loud**: registering an adapter with the same name throws (test-covered);
3. ✅ **Inbound → outbound round-trip loop**: MockAdapter + the seven-piece harness verifies "inbound → real agent turn → reply out" + `channel/outbound` received + reply text non-empty (test-covered, keyless);
4. ✅ **Per-thread session reuse**: same thread reuses the same session, different threads each create new ones (test asserts via `ctx.agents.list().length`);
5. ✅ **Dual-channel verification**: Telegram (polling) + Feishu (webhook) two adapters mount the same contract, core has no channel-specific branches (`channel-telegram`/`channel-feishu` contract-test-covered);
6. ✅ **Full typecheck green**: three build-chain registrations (tsconfig.base paths, tsconfig.host references, tsdown exclude removal).
