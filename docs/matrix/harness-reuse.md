# ClawDSH → Harness reuse map

English | [中文](harness-reuse.zh.md)

This reference maps ClawDSH-owned packages to the public DeepSeek Harness capabilities they use. It is the integration view, not a duplicate Harness package catalog; follow the linked subsystem and package documentation for full contracts. The governing rule and rationale are in the [plugin contract](../standards/plugin-contract.md) and [ADR-0010](../adr/0010-harness-contract-first.md).

## Harness module entry

Use the maintained references below instead of building another hand-written inventory or traversing implementation source:

| Question | Maintained source |
|---|---|
| What package groups exist and what does each group own? | [Package-group map](../../packages/README.md) |
| What packages exist and how do their runtime dependencies connect? | [Generated module dependency graph](../module-graph.md) |
| What services, events, and public types does a subsystem expose? | [Subsystem reference](../subsystems/README.md) |
| Which Cordis services and channel events does ClawDSH add? | [Generated ClawDSH Service projection](../subsystems/clawdsh.md) |
| How do capabilities, events, tools, configuration, composition, and lifecycles connect? | [Generated and curated graph index](../graph-atlas.md) |

The generated module graph is the exhaustive inventory of the root Harness workspace. Among upstream-owned top-level groups, the hand-maintained package-group map currently omits only [`mcp/`](../../packages/mcp/README.md), which bridges external MCP servers into Harness tools, and [`runtime-diagnostics/`](../../packages/runtime-diagnostics/invariants/README.md), which owns the runtime invariant registry and package companions. The intentionally nested `preset-openclaw/product-shell` application has its own lockfile and is outside that root workspace and generated graph; its Harness reuse is recorded below. The upstream supplement should disappear when those two package-group rows reach the upstream map.

## Development path

1. Locate the feature in the [OpenClaw alignment matrix](parity.md).
2. Select an existing extension point from the [Harness architecture](../architecture.md).
3. Use the module entry above to select the owning subsystem, package, and generated relationship view.
4. Reuse the service, event, provider contract, utility, or maintained platform SDK through a ClawDSH plugin.
5. If no suitable seam exists, stop and write an ADR before adding a new `ctx.*` capability.

For channel work, [ADR-0008](../adr/0008-openclaw-channel-plane.md) is an additional ownership boundary: the locked OpenClaw Gateway owns platform transports, while Harness owns Agent, Session, tools, storage, and model execution. Do not extend a legacy in-process adapter to bypass the sidecar plan.

## Local product-shell mapping

The product shell is a private nested build rather than another published feature package. It keeps Harness's browser and Host runtime intact and composes only their public seams:

| Owned component | ClawDSH responsibility | Mandatory `inject`, by owner | Other reused components, by owner | Build component |
|---|---|---|---|---|
| [`product-shell/runtime`](../../packages/openclaw/preset-openclaw/product-shell/runtime/src/index.ts) | `/clawdsh/` static routes, loopback-only control RPC, sanitized capability manifests, validated Settings/credential writes, semantic Activity pages, and product readiness | Harness: `webServer`, `connection`, `loader`, `agentPresets`, `settings`, `credentials` | Harness: frontend-static `serveStatic`, WebServer index transforms, Connection RPC, Loader entries/fibers, preset inspection, layered Settings, write-only credentials, and Session persistence inspection; ClawDSH: optional `clawdshOpenClawControl` and `clawdshActivity` | tsdown |
| [`product-shell/browser`](../../packages/openclaw/preset-openclaw/product-shell/browser/src/ClawdshWebEntry.tsx) | Product navigation, editable capability Settings, privacy-limited semantic Activity, and mounting the complete native Harness application | Harness: browser `slots`, `sessions`, `layout`, `connection` | Harness: Client module boot manifest/static table, public Loader, `createSlotRenderer()`, `buildRenderApp()`, and Connection `isLoopback`; ClawDSH: typed control client and shared RPC protocol | React, Vite |

The browser does not fork Chat or Session state, and the Host does not expose unrestricted Loader mutation or secret values. `/` remains the unmodified Harness application; both browser entries share the same Host, Sessions, persistence, and Connection transport. [ADR-0007](../adr/0007-clawdsh-local-gui-product.md) and the [GUI feature spec](../specs/feature-gui-web.md) own the implemented Settings and Activity boundary.

## Current channel-plane mapping

The generated [ClawDSH Service projection](../subsystems/clawdsh.md) is the method-level authority for `ctx.channels`; this table records package ownership and Harness reuse rather than duplicating that Cordis surface.

| Owned package | ClawDSH responsibility | Mandatory `inject`, by owner | Other reused components, by owner | External component |
|---|---|---|---|---|
| [`channel`](../../packages/openclaw/channel/README.md) | Provider-neutral V1 Service Definition and strict bridge values | — | Harness: Cordis `Service` base; zod validation | — |
| [`channel-agent`](../../packages/openclaw/channel-agent/README.md) | Durable route generations, Session binding, Agent execution, verified image import, recovery ledger, route-bound `message` tool, and channel Activity | Harness: `agents`, `sessions`, `sessionPersistence`, `agentDefaultModel`, `agentPresets`, `attachments`, `storageDomain`, `tools`, `settings`; ClawDSH: `channels` | Harness: Agent follow-up, Session events/flush, attachment validation/storage, scoped tool restriction; ClawDSH: optional `clawdshActivity` | Locked OpenClaw AgentHarness protocol |
| [`channel-openclaw`](../../packages/openclaw/channel-openclaw/README.md) | Verify and supervise the locked Gateway, authenticate IPC, expose the Provider, persist action/delivery state, and validate managed enablement | Harness: `storageDomain`, `subprocess`, `settings`; ClawDSH: `channels` | Harness: optional `credentials`, launch-environment snapshot, process lifecycle, executable resolution, and durable storage primitives; ClawDSH: `clawdshOpenClawControl` | Locked OpenClaw Gateway and channel plugins |
| [`preset-clawdsh-messaging-safe`](../../packages/openclaw/preset-clawdsh-messaging-safe/README.md) | Restricted composition for non-owner and group channel Sessions | — | Harness: preset discovery and system-prompt composition; channel-agent applies inherited-tool restriction | — |

These rows are the canonical communication plane. Their package and protocol tests establish implementation foundations only. The profile keeps the whole group disabled, and no sidecar Channel is currently certified or enabled.

## Retained legacy-channel mapping

| Owned package | Compatibility responsibility | Mandatory `inject`, by owner | Other reused components, by owner | Platform component |
|---|---|---|---|---|
| [`channel-core`](../../packages/openclaw/channel-core/README.md) | Defines `ctx.legacyChannels`; routes legacy provider conversations and accepted image references into Agent Sessions | Harness: `agents`, `sessions`, `llm`, `agentDefaultModel`, `agentPresets`, `sessionPersistence`, `timer` | Harness: Agent create/resume, preset resolve/mount, exact-model `resolveModelInfo`, text/image blocks, attachment reference types, Session flush, timeout utility | — |
| [`channel-telegram`](../../packages/openclaw/channel-telegram/README.md) | Legacy Telegram event, image-materialization, and send/reaction adapter | ClawDSH: `legacyChannels`; Harness: `timer` | Harness: optional `credentials`, launch environment, `credentials/updated`, and `ctx.attachments` limits/validate/save | grammY, `@grammyjs/auto-retry`, `@grammyjs/files` |
| [`channel-discord`](../../packages/openclaw/channel-discord/README.md) | Legacy Discord Gateway/REST adapter | ClawDSH: `legacyChannels`; Harness: `timer` | Harness: optional `credentials`, launch environment, `credentials/updated` | discord.js |
| [`channel-feishu`](../../packages/openclaw/channel-feishu/README.md) | Legacy Feishu/Lark normalized-message adapter | ClawDSH: `legacyChannels`; Harness: `timer` | Harness: optional `credentials`, launch environment, `credentials/updated` | Official `@larksuiteoapi/node-sdk` `LarkChannel` |

This table records how compatibility code reuses Harness; it is not a recommendation for new channel work. The 2026-08-15 Telegram real-client run and earlier Feishu text smoke exercised this legacy path. Discord has keyless coverage only. None of those facts certifies the locked sidecar because the host, provider namespace, admission path, ledgers, media boundary, and delivery path differ.

## Other owned package mapping

| Owned package | ClawDSH responsibility | Mandatory `inject`, by owner | Other reused components, by owner | Platform component |
|---|---|---|---|---|
| [`activity`](../../packages/openclaw/activity/README.md) | Privacy-limited semantic Activity service, bounded sidecars, history projection, and pagination | Harness: `settings` | Harness: `resolveDshHome` and standard Session event types; ClawDSH producers discover optional `clawdshActivity` through Cordis | Node filesystem |
| [`soul`](../../packages/openclaw/soul/README.md) | Settings-backed, Agent-scoped persona section and prompt Activity | Harness: Settings host uses `settings`; session row uses `systemPrompt`; ClawDSH: `clawdshSoulSettings` | Harness: scope ownership and system-prompt assembly; ClawDSH: optional `clawdshActivity` | Node filesystem |
| [`memory`](../../packages/openclaw/memory/README.md) | Settings-backed Memory tools, prompt guidance, indexing, flush lifecycle, and semantic Activity | Harness: `tools`, `systemPrompt`, `fs`, `settings` | ClawDSH: optional `embeddings` and `clawdshActivity`; Harness: optional `sandboxPolicy`, `tokenMeter`, `llm`, and Agent/Session/compaction events | chokidar |
| [`embeddings`](../../packages/openclaw/embeddings/README.md) | Defines `ctx.embeddings` | — | Harness: Cordis `Service` base | — |
| [`embeddings-ark`](../../packages/openclaw/embeddings-ark/README.md) | Settings-backed Volcano Ark implementation of `ctx.embeddings` | Harness: `settings` | ClawDSH: `embeddings`; Harness: optional `credentials`, launch environment, and timeout bound | Ark HTTP API |
| [`skills-hub`](../../packages/openclaw/skills-hub/README.md) | Settings-backed ClawHub-style directory provider | Harness: `skills`, `settings`, `subprocess` | Harness: `SkillProvider` contract and `resolveExecutable()` | Node filesystem, YAML |
| [`automation`](../../packages/openclaw/automation/README.md) | Settings-backed scheduled Agent turns | Harness: `agents`, `sessions`, `agentDefaultModel`, `settings` | Harness: optional `sessionPersistence` and Agent/model/Session libraries | croner, Node timer |

Every runtime package also exports an `./invariant` companion where applicable. That companion, rather than each main plugin, injects the Harness invariant registry.

## Composition, status, and limitations

The [ClawDSH assembly README](../../packages/openclaw/preset-openclaw/README.md) owns default composition and installation behavior, the [feature matrix](parity.md) owns completion and channel support states, and each linked package README owns configuration, failure behavior, and known limitations. The [Telegram legacy E2E cookbook](../cookbook/telegram-e2e.md) owns the repeatable historical live-test procedure and its evidence boundary.

## Maintenance

Update this map whenever an owned package adds or removes an injected service, optional service, imported contract, or platform component, and always preserve the Harness/ClawDSH/OpenClaw provenance label. The generated module graph remains the exhaustive root Harness workspace inventory; this page records its navigation entry, explicit package-map omissions, the separately built nested product shell, and the ClawDSH integration view.
