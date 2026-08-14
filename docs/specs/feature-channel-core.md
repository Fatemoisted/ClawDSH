# Feature spec: channel gateway seam (channel-core)

English | [中文](feature-channel-core.zh.md)

- **Status**: implemented (Phase 2 ✅, 2026-08-14)
- **Implementation package**: `packages/openclaw/channel-core` (`@clawdsh/dsh-channel-core`)
- **OpenClaw counterpart**: channel gateway (`src/gateway/`, baseline v2026.1.5). In OpenClaw every channel grows directly into the gateway and agent logic — the classic symptom of "architecture without seams"; this spec splits the gateway into a two-tier "thin assembly layer + channel adapters" structure.

## Goals

- Provide the `ctx.channels` service — the project's **only newly added seam** (design in docs/adr/0002-channel-seam.md):
  - **Adapter registry**: a channel plugin registers a `ChannelAdapter`, unique by id, unregistered on dispose (HMR-safe);
  - **Inbound routing**: awaited parallel `channel/inbound` message → resolve a conversation/topic → resume/create its durable Harness agent session → write to the session log → drive and flush one FIFO turn; success or failure returns to the adapter;
  - **Outbound delivery**: agent reply → `channel/outbound` + the corresponding `adapter.send`.
- A channel plugin implements `receive`, `send`, and optional `react`; routing, deterministic session binding, preset composition, turn serialization, group policy, and idle lifecycle belong to `channel-core`.
- The contract inherits dsh invariants: every inbound message and outbound reply must be written to the session log ("model-visible means logged").

## Non-goals

- Binary attachment transport through `ctx.attachments` and interactive card/action events;
- Cross-process/multi-daemon ownership and multi-sender batching; one process already single-flights creation and serializes each conversation/topic;
- A persistent provider outbox after adapter/SDK retries are exhausted;
- Unified abstraction of channel features (quotes, card model) — not assumed; extracted only after a second channel's features settle.

## Seam (confirmed in Phase 2)

`ctx.channels` (`ChannelRegistry extends Service`, `super(ctx, 'channels')`):

- `static inject = ['agents', 'sessions', 'agentDefaultModel', 'agentPresets', 'sessionPersistence', 'timer']`;
- `registerAdapter(adapter)`: id-uniqueness validation → `adapter.start(ctx)` inside `ctx.effect` + store in map, returns an async drain-aware disposer;
- `getAdapter(id)` / `listAdapters()`;
- private `route(message)`: structured group mention gate → deterministic opaque id from channel/conversation/topic → `sessionPersistence` inspect + `agents.resume/create` → `agentPresets.mount` → FIFO `followup`/`whenIdle`/`sessions.flush` → native reply metadata + `adapter.send` + `ctx.emit('channel/outbound', outMsg)`; the caller sees failure while an absorbed queue tail preserves later turns;
- address normalization: `conversationId` + optional `threadId`, while a legacy thread-only input is treated as one conversation and mirrors its thread id on output;
- events (declaration merging): parallel `channel/inbound` and emit-only `channel/outbound`. Adapters await `ctx.parallel`; legacy `ctx.emit` producers remain accepted without completion backpressure.

**Conclusion: the seam hypothesis holds** — channel integration = one `ChannelAdapter` implementation, no upstream source line changed, `agent-loop` untouched.

## Config surface

`agentPreset`, `groupMode`, `ackReactionScope`, `idleTimeoutMs`, and presentation-only identity/prefix/reaction settings. Provider credentials remain in each adapter's Config.

## Acceptance criteria (Phase 2 conclusion)

1. ✅ **Register/unregister (HMR rollback)**: after `registerAdapter`, `listAdapters` contains it, removed after dispose (test-covered);
2. ✅ **Duplicate id fail-loud**: registering an adapter with the same name throws (test-covered);
3. ✅ **Inbound → outbound round-trip loop**: MockAdapter + the seven-piece harness verifies "inbound → real agent turn → reply out" + `channel/outbound` received + reply text non-empty (test-covered, keyless);
4. ✅ **Durable reuse**: stable opaque ids, single-flight first admission, FIFO turns, JSONL process-style restart resume, and logged preset reuse are test-covered;
5. ✅ **Awaited durability + compatibility**: adapter handlers await the routed turn through `sessions.flush`/delivery, failures propagate, and normal teardown drains admitted work; the old thread-only source shape is accepted without conflating new conversation/topic addresses;
6. ✅ **Policy/presentation**: structured group mention fail-closed behavior and every ack scope are test-covered;
7. ✅ **Dual-channel verification**: Telegram polling covers bot-addressed commands, official bounded API retry, UTF-16-safe 4096 splitting and middleware drain; official Feishu SDK 1.73 `LarkChannel` covers identity backoff, topic-safe 3500 splitting and failed-handshake cleanup, with no provider branch in core;
8. ✅ **Build/release chain**: dedicated aggregate types/bundle scripts, test typecheck, profile install smoke, independent shared-version `clawdsh` release family, packed-install verification and protected workflow. Actual npm publication remains a deliberate manual operation and has not run from this worktree.
