# ClawDSH → Harness reuse map

English | [中文](harness-reuse.zh.md)

This reference maps ClawDSH-owned packages to the public DeepSeek Harness capabilities they use. It is the integration view, not a duplicate Harness package catalog; follow the linked subsystem and package documentation for full contracts. The governing rule and rationale are in the [plugin contract](../standards/plugin-contract.md) and [ADR-0006](../adr/0006-harness-contract-first.md).

## Harness module entry

Use the maintained references below instead of building another hand-written inventory or traversing implementation source:

| Question | Maintained source |
|---|---|
| What package groups exist and what does each group own? | [Package-group map](../../packages/README.md) |
| What packages exist and how do their runtime dependencies connect? | [Generated module dependency graph](../module-graph.md) |
| What services, events, and public types does a subsystem expose? | [Subsystem reference](../subsystems/README.md) |
| How do capabilities, events, tools, configuration, composition, and lifecycles connect? | [Generated and curated graph index](../graph-atlas.md) |

The generated module graph is the exhaustive package inventory. Among upstream-owned top-level groups, the hand-maintained package-group map currently omits only [`mcp/`](../../packages/mcp/README.md), which bridges external MCP servers into Harness tools, and [`runtime-diagnostics/`](../../packages/runtime-diagnostics/invariants/README.md), which owns the runtime invariant registry and package companions. This supplement should disappear when those two rows reach the upstream package-group map.

## Development path

1. Locate the feature in the [OpenClaw alignment matrix](parity.md).
2. Select an existing extension point from the [Harness architecture](../architecture.md).
3. Use the Harness module entry above to select the owning subsystem, package, and generated relationship view.
4. Reuse the service, event, provider contract, utility, or maintained platform SDK through a ClawDSH plugin.
5. If no suitable seam exists, stop and write an ADR before adding a new `ctx.*` capability.

## Owned package mapping

`inject` lists mandatory runtime services. Every entry names its owner so a ClawDSH-defined seam cannot be mistaken for an upstream Harness capability; optional services and imported libraries remain separate from mandatory injection.

| Owned package | ClawDSH responsibility | Mandatory `inject`, by owner | Other reused components, by owner | Platform component |
|---|---|---|---|---|
| [`channel-core`](../../packages/openclaw/channel-core/README.md) | Defines `ctx.channels`; routes provider conversations into durable agent sessions | Harness: `agents`, `sessions`, `agentDefaultModel`, `agentPresets`, `sessionPersistence`, `timer` | Harness: agent create/resume, preset resolve/mount, model selection, session flush, timeout utility | — |
| [`channel-telegram`](../../packages/openclaw/channel-telegram/README.md) | Telegram event and send/reaction adapter | ClawDSH: `channels`; Harness: `timer` | — | grammY, `@grammyjs/auto-retry` |
| [`channel-discord`](../../packages/openclaw/channel-discord/README.md) | Discord Gateway/REST adapter | ClawDSH: `channels`; Harness: `timer` | Harness: optional `credentials`, launch environment, `credentials/updated` | discord.js |
| [`channel-feishu`](../../packages/openclaw/channel-feishu/README.md) | Feishu/Lark normalized-message adapter | ClawDSH: `channels`; Harness: `timer` | — | Official `LarkChannel` |
| [`soul`](../../packages/openclaw/soul/README.md) | Agent-scoped persona section | Harness: `systemPrompt` | Harness: scope ownership primitives | Node filesystem |
| [`memory`](../../packages/openclaw/memory/README.md) | Memory tools, prompt guidance, indexing, and flush lifecycle | Harness: `tools`, `systemPrompt`, `fs` | ClawDSH: optional `embeddings`; Harness: optional `sandboxPolicy`, `tokenMeter`, `llm`, and agent/session/compaction events | chokidar |
| [`embeddings`](../../packages/openclaw/embeddings/README.md) | Defines `ctx.embeddings` | — | Harness: Cordis `Service` base | — |
| [`embeddings-ark`](../../packages/openclaw/embeddings-ark/README.md) | Volcano Ark implementation of `ctx.embeddings` | — | ClawDSH: `embeddings` base service; Harness: optional `credentials`, launch environment, timeout bound | Ark HTTP API |
| [`skills-hub`](../../packages/openclaw/skills-hub/README.md) | ClawHub-style directory provider | Harness: `skills` | Harness: `SkillProvider` contract | Node filesystem, YAML |
| [`automation`](../../packages/openclaw/automation/README.md) | Config-declared scheduled agent turns | Harness: `agents`, `sessions`, `agentDefaultModel` | Harness: optional `sessionPersistence` and agent/model/session libraries | croner, Node timer |

Every owned package also exports an `./invariant` companion. That companion, rather than each main plugin, injects the Harness invariant registry.

## Composition, status, and limitations

The [OpenClaw profile README](../../tools/openclaw-preset-openclaw/README.md) owns default composition and installation behavior, the [feature matrix](parity.md) owns completion status, and each linked package README owns configuration, failure behavior, and known limitations.

## Maintenance

Update this map whenever an owned package adds or removes an injected service, optional service, imported contract, or platform component, and always preserve the Harness/ClawDSH provenance label. The generated module graph remains the exhaustive Harness inventory; this page records only its navigation entry, explicit package-map omissions, and the ClawDSH integration view.
