# Context map — what to build, what to skip

English | [中文](context-map.zh.md)

- **Status**: Phase 4 productization; the product shell and read-only capability overview are implemented
- **Purpose**: entry point for ClawDSH ownership, package roles, and the upstream material an implementation needs to read
- **Companions**: [documentation inventory](doc-inventory.md) · [roadmap](roadmap.md) · [GUI spec](feature-gui-web.md) · [channel bridge spec](feature-channel-plane-bridge.md)

## 1. Owned build surface

| Location | Ownership |
|---|---|
| `packages/openclaw/` | ClawDSH packages, product assembly, nested GUI/runtime source, and package templates |
| `docs/{adr,specs,matrix,standards,journal,upstream-proposal}/` | ClawDSH decisions, current requirements, status, operations, and history |
| `tools/` | ClawDSH installers, verification, migration, e2e drivers, and OpenClaw host locks |
| `.github/workflows/clawdsh-*` | ClawDSH-specific CI and release workflows |
| New date-stamped files under `.agents/notes/` | ClawDSH decisions; archived notes remain frozen |

### Owned packages and assembly directories

| Directory | Role | Consumes | Provides or does |
|---|---|---|---|
| `channel/` | Service Definition | Cordis lifecycle | current `ctx.channels` V1 protocol; one Provider and one Driver |
| `channel-agent/` | Consumer / Driver | channels, Agents, Sessions, presets, attachments, storage, tools | durable route binding, idempotency, Agent turns, logging, media import, route-scoped `message` tool |
| `channel-openclaw/` | Service Provider | channels, subprocess, storage | locked OpenClaw supervision, authenticated IPC, health, actions, delivery ledger |
| `channel-core/` | legacy Service | Agents, Sessions, default model | superseded in-process registry under `ctx.legacyChannels`; retained for replacement verification |
| `channel-telegram/` | legacy adapter | legacy channel service | Telegram polling adapter; no current certification |
| `channel-feishu/` | legacy adapter | legacy channel service | Feishu long-connection adapter; no current certification |
| `channel-wechat/` | historical decision record | — | non-executable record superseded as availability guidance by the locked catalog |
| `soul/` | function plugin | system prompt | replace or append persona sections |
| `memory/` | function plugin | tools, system prompt, filesystem, optional embeddings | memory tools, recall section, indexing, flush |
| `embeddings/` | Service Definition | Cordis lifecycle | owned `ctx.embeddings` seam |
| `embeddings-ark/` | Service Provider | embeddings | Volcano Ark embeddings |
| `skills-hub/` | Service Provider | skills | ClawHub-compatible skill directory |
| `automation/` | function plugin | Agents, Sessions, default model | opt-in scheduled Agent turns |
| `preset-openclaw/` | product assembly | public dsh Web and Host APIs | `clawdsh` profile and preset plus the nested product-shell browser, Host runtime, shared protocol, read-only Settings overview, and Activity empty state |
| `preset-clawdsh-messaging-safe/` | preset carrier | soul | restricted channel preset installed as `clawdsh-messaging-safe` |
| `_template/` | skeleton | — | starting point for a new owned plugin |

The physical `preset-openclaw/` name remains only because an existing repository check grants that path a narrow exception. Installed ids and product copy use `clawdsh`. The legacy and current channel services can coexist as packages, but a deployment must not connect both paths to the same platform account.

## 2. Upstream read-only surface

| Location | Rule |
|---|---|
| `vendor/` | sync only through its manifest procedure |
| `packages/*` except `packages/openclaw/` | read a Service Definition only when its seam is relevant; do not implement ClawDSH behavior there |
| `apps/`, `website/`, `native/`, `python/`, `examples/`, `assets/`, `patches/`, `scripts/` | upstream applications, runtimes, examples, assets, and checks; no ClawDSH feature edits |
| Upstream pages under `docs/` | architecture and generated catalogs; use as reference, not as a ClawDSH rewrite surface |
| Root configuration | upstream-owned with only ADR-backed branding or additive workspace registration |

OpenClaw is a separate external upstream for the channel plane, not a writable subtree. Approved artifacts and catalogs are recorded under `tools/openclaw-channel-host/`; do not vendor a checkout into `packages/openclaw/`.

## 3. Architecture in one read

### Cordis lifecycle

A dsh runtime is a plugin tree. Services, events, and registrations are scoped effects that unwind with their plugin. Cross-package work uses typed Service Definitions and declared injection, not imports into another package's implementation.

### ClawDSH product shell

The local GUI is a ClawDSH product over the public dsh Web runtime, not another dsh agent preset. `/clawdsh/` owns the product navigation—Conversation, ClawDSH Settings, ClawDSH Activity, and Harness Advanced—while `/` retains the native dsh Web GUI. Conversation reuses the public client module graph, Loader, Slot renderer, and complete `buildRenderApp()` root. The nested non-workspace build under `preset-openclaw/product-shell/` owns the outer shell, static routes, Host runtime, shared DTOs, and `/clawdsh-rpc` Connection channel.

The control channel currently implements only loopback-authorized `bootstrap/get` and `capabilities/list`. Settings is a read-only capability and Loader projection, and Activity is an explicit empty state; setting mutations, credential operations, semantic records, and sidecar storage are not part of the current runtime. This assembly does not register a new Client Slot and does not modify `api-proxy`, Client Catalog, Agent Loop, upstream generated files, or upstream GUI source. `dsh --profile web` remains a pure Harness entry point.

### Profile layering and identity

`dsh --profile <name>` stacks the profile bundles, its `cordis.patch.yml`, the home-level patch, and later `--patch` overlays. `tools/link-clawdsh.sh` installs the internal profile source as `clawdsh`, installs the `clawdsh` and `clawdsh-messaging-safe` presets under the dsh user preset root, and links owned packages for development.

The clean-install profile keeps the complete `channel → channel-agent → channel-openclaw` group and Automation disabled, so the Web Host starts without platform credentials. Legacy `openclaw` profile and preset directories are warning-only inputs and remain untouched; no compatibility alias is installed. The public CLI owns the managed manifest, integrity repair, and `clawdsh doctor` flow.

### Complete capability seams

A capability seam contains a Service Definition, Service Provider, and Consumer. ClawDSH owns `ctx.embeddings` and the current `ctx.channels`. For channels, `channel` is the definition, `channel-openclaw` is the communication Provider, and `channel-agent` is the Agent Consumer/Driver.

### Model-visible means logged

Anything reaching a model request must be reconstructable from the Session log. Channel Agent input uses the known `user/message` event with complete sanitized `source.kind = 'channel'` provenance; admission, idempotency, and delivery authority stays in durable channel ledgers. Declared `channel/*` Session events remain disabled because downstream code cannot mark them ignorable and persistence resume would reject their unknown names. Communication-only health and transport bookkeeping stay outside model context.

### Relevant seams

| Seam | Owner | ClawDSH consumers | Use here |
|---|---|---|---|
| `ctx.systemPrompt` | dsh | soul, memory | ordered prompt sections |
| `ctx.tools` | dsh | memory, channel-agent | tool registry and route-scoped `message` tool |
| `ctx.fs` | dsh | memory | policy-controlled filesystem access |
| `ctx.sessions` | dsh | channel-agent, legacy channel-core, automation, Activity | append-only events, projection, and durable flush |
| `ctx.agents` | dsh | channel-agent, legacy channel-core, automation | create, resume, and drive Agent Sessions |
| `ctx.attachments` | dsh | channel-agent | durable images; no general-file seam yet |
| `ctx.storageDomain` | dsh | channel-agent, channel-openclaw | durable route, execution, and delivery ledgers |
| `ctx.subprocess` | dsh | channel-openclaw | supervised Gateway lifecycle |
| Settings and Credentials | dsh | later ClawDSH Settings control plane | available public APIs; not consumed by the current read-only runtime |
| Connection RPC | dsh | ClawDSH Control Runtime and product shell | loopback-only `/clawdsh-rpc` with `bootstrap/get` and `capabilities/list` |
| `ctx.skills` | dsh | skills-hub | skill Provider registry |
| `ctx.subagents` | dsh | future federation | delegation transport |
| `ctx.channels` | ClawDSH, ADR-0008 | channel-openclaw, channel-agent | bidirectional channel V1 dispatch |
| `ctx.embeddings` | ClawDSH, ADR-0003 | memory, embeddings-ark | text embeddings |

The upstream service catalog remains authoritative for the complete dsh seam list. Consult `docs/capability-seams.md` or the generated API catalog before reading package implementations.

## 4. Owning references

| Need | Read |
|---|---|
| GUI posture, routes, and prohibited upstream changes | [ADR-0007](../adr/0007-clawdsh-local-gui-product.md) |
| GUI pages and acceptance behavior | [local GUI spec](feature-gui-web.md) |
| Channel architecture and ownership | [ADR-0008](../adr/0008-openclaw-channel-plane.md) |
| Current channel protocol and gaps | [channel bridge spec](feature-channel-plane-bridge.md) |
| Exact host and channel identities | `tools/openclaw-channel-host/*.json` |
| Channel update and certification process | [OpenClaw channel sync standard](../standards/openclaw-channel-sync.md) |
| Current product and support projection | [parity matrix](../matrix/parity.md) |
| Required OpenClaw AgentHarness host semantics | [OpenClaw proposal](../upstream-proposal/openclaw-agent-harness-channel-seams.md) |
| Required downstream Session-event support | [dsh proposal](../upstream-proposal/session-plugin-events.md) |

ADR-0002, `feature-channel-core`, and `channel-wechat` explain the legacy path; they are not current channel-availability guidance.

## 5. Reading strategy

| Task | Read | Skip |
|---|---|---|
| Any ClawDSH change | this page, the owning feature spec, and the parity row | broad upstream source rereads |
| Product-shell change | ADR-0007, GUI spec, and public dsh Web entry APIs | Client Catalog, generated GUI files, and unapproved Slots |
| Settings or Activity change | GUI spec, owning Config schemas, Settings/Credentials/Session APIs, and the current `/clawdsh-rpc` protocol | arbitrary Loader controls and upstream SessionEventMap edits |
| Channel protocol change | channel package sources, ADR-0008, bridge spec, sync standard | platform SDK implementations unless locked-host compatibility changed |
| OpenClaw release update | machine locks/catalogs, release artifact, exact compatibility inputs | floating `main` after resolving the approved commit |
| New dsh seam | the corresponding upstream Service Definition and complete-seam rules | unrelated packages |
| dsh rebase | `docs/standards/upstream-sync.md` | ad hoc edits to upstream packages |
| Legacy channel removal | ADR-0008 replacement conditions and legacy Agent Notes | archiving notes before code removal |
