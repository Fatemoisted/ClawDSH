# Feature spec: ClawDSH local GUI

English | [中文](feature-gui-web.zh.md)

- **Status**: the preset-only dsh Web baseline is implemented; the ClawDSH product shell is accepted by [ADR-0007](../adr/0007-clawdsh-local-gui-product.md) and implementation is pending
- **Current assembly**: `packages/openclaw/preset-openclaw/`
- **Product role**: the local ClawDSH frontend alongside the Feishu, Telegram, and future channel frontends

## Current baseline

`pnpm dsh --profile openclaw` currently composes the stock `dsh-web-app` bundle with an OpenClaw agent preset. The browser starts at `http://127.0.0.1:3080`, new Sessions default to the "OpenClaw 形态" preset, and a GUI conversation receives Soul, Memory, Skills, and the standard agent tools. This baseline is implemented and remains supported until the identity and product-shell migrations replace its user-facing names and entry point.

The baseline intentionally contains no ClawDSH-owned browser code. Its Settings and Trajectory therefore expose the Harness information model rather than the complete ClawDSH product model.

## Goals

The target local GUI is an independent ClawDSH product interface over the public dsh Web runtime. It keeps the mature Harness conversation implementation while giving users one place to understand, configure, and inspect the additional capabilities that turn the Harness into ClawDSH. Because the public `buildRenderApp()` face renders the complete Harness root rather than Chat alone, v1 mounts that complete root inside the Conversation destination.

The shell does not create a second agent runtime. ClawDSH and Harness Advanced share the same Host process, Session store, Connection transport, and persistence; they differ only in application navigation and presentation.

## Non-goals

- Do not fork or reimplement dsh Chat, Session state, streaming, approvals, tool rendering, or raw Trajectory.
- Do not insert product navigation into the stock Settings or Trajectory Slots and do not add a new Client Slot.
- Do not extract or hide a Chat-only subtree with CSS, private Slots, or private imports.
- Do not expose unrestricted Cordis Loader mutation as a normal product setting.
- Do not describe a per-Session preset selection as unloading process-wide ClawDSH capabilities.
- Do not change the Feishu, Telegram, or other channel frontend paths.

## Entry points and lifecycle

- `http://127.0.0.1:<port>/clawdsh/` is the default ClawDSH product entry point.
- `/` remains the unmodified dsh Web application and is linked as “Harness Advanced.”
- `dsh --profile web` starts a pure Harness process without the ClawDSH Host capability set.
- The ClawDSH profile eventually uses the id `clawdsh`, and new Sessions default to the `clawdsh` agent preset shown as `ClawDSH 模式`.
- Selecting another agent preset inside a running ClawDSH profile changes only the Session's Agent composition. It does not unmount process-wide ClawDSH plugins and is not presented as a switch to pure Harness.

## Navigation

The product shell has four stable top-level destinations:

1. **Conversation** mounts the complete existing dsh Client root, including its native frame and diagnostics, and thereby reuses Chat, streaming, approvals, tool rendering, paging, and Session persistence.
2. **ClawDSH Settings** presents product capabilities and their supported configuration rather than arbitrary Cordis Loader entries.
3. **ClawDSH Activity** presents semantic records for ClawDSH behavior associated with the current Session.
4. **Harness Advanced** opens the stock dsh Web interface for raw Settings, Loader, and Trajectory diagnostics.

## Configuration surface

The Settings view treats each ClawDSH feature as a product capability with a stable namespace. For every capability it shows the owning package, corresponding Loader entries and Fiber state, dependencies, enabled state, credential readiness, configuration fields, and when a change takes effect. Provenance follows one fixed mapping: `@clawdsh/*` is ClawDSH, `@deepseek-ai/*` and `cordis:*` are Platform, and every other source is Community.

| Capability | Namespace | Profile base | Effect time |
|---|---|---:|---|
| Soul | `clawdsh-soul` | enabled | new Sessions |
| Channel Core | `clawdsh-channel-core` | required | restart |
| Feishu | `clawdsh-feishu` | disabled | restart |
| Telegram | `clawdsh-telegram` | disabled | restart |
| Memory | `clawdsh-memory` | enabled | restart |
| Ark Embeddings | `clawdsh-embeddings-ark` | on demand | next call or restart |
| Skills Hub | `clawdsh-skills-hub` | enabled | restart |
| Automation | `clawdsh-automation` | disabled | restart |

Configuration fields are described by each capability's server-owned Config schema. User settings override the profile base, reset removes the user layer, and revision-checked writes prevent an old browser state from overwriting newer values. The view distinguishes desired and runtime revisions and reports when a restart is required.

Secret values remain in the dsh credentials provider. The browser may learn whether an allowed credential reference is configured, but the Host never returns the value. A secret exists in the browser only in a write-only input draft and its outgoing `credentials.set` request, is cleared when that request settles, and is not retained in Settings state or persisted to logs, Session files, or Activity records. Disabled optional capabilities may have missing credentials; enabling a capability validates its required references at the earliest resolvable point.

Channel Core remains a required internal capability, and implementation dependencies such as Embeddings are shown under their owning product capability instead of as unrelated top-level switches. The Advanced view retains a read-only Loader inventory; the product UI does not expose unrestricted plugin mutation.

## ClawDSH Activity

Activity groups records into Soul/Prompt, Memory, Channels, Skills, and Automation. It follows the current Session and supports pagination, time ordering, and category filters. Prompt entries describe only ClawDSH-owned contributions; they do not claim to reconstruct the final flattened System Prompt.

The view derives records from standard Session history when that history already contains the required fact and supplements it with privacy-limited ClawDSH sidecars for facts the Session log does not own. Missing, damaged, rotated, or unwritable sidecars degrade Activity only and never block conversation, channel delivery, or automation. Raw Trajectory remains available in Harness Advanced and is not replaced by Activity.

## Assembly seam and integration constraints

- The product shell reuses the public dsh boot manifest, browser module graph, loading state, complete root renderer, Connection transport, and Client plugins; it does not fork Chat or Session state.
- ClawDSH owns the shell, routes, control runtime, Settings page, Activity page, capability schemas, and sidecar storage.
- Browser and runtime source remains nested under `packages/openclaw/preset-openclaw/` and does not enter the root Client aggregate or shipped Client Catalog.
- ClawDSH-owned shell code does not register a new Client Slot, call `ctx.slots.register()` to inject product UI, modify `api-proxy`, Agent Loop, generated files, or any upstream-owned source, and it does not disguise a catalog change to evade repository checks. Reused dsh Client plugins continue to register their existing Slots.
- Static product routes own `/clawdsh/`; control methods use the non-overlapping `/clawdsh-rpc` Connection channel registered with `{ authority: 'loopback' }`, so configured trusted hosts remain unable to call it.
- The channel owns only `bootstrap/get`, `capabilities/list`, `settings/describe`, `settings/mutate`, `settings/reset`, `credentials/describe`, `credentials/set`, and `credentials/unset`.
- If implementation discovers that the product needs a missing dsh capability or any upstream modification, this GUI work stops and is redesigned within the approved local-only boundary; it does not open an upstream PR.

## Model-visible surface

The product shell itself adds no model-visible input. Conversation requests continue to use the selected agent preset and mounted capability plugins. Any future Settings change that alters prompts, tools, Memory, Skills, channels, or Automation must remain reconstructable from the authoritative Session events required by the owning dsh seam.

## Target acceptance criteria

1. An empty dsh home with no external credentials can start the ClawDSH profile and open `/clawdsh/`.
2. New ClawDSH Sessions default to the `clawdsh` preset displayed as `ClawDSH 模式`.
3. Conversation, ClawDSH Settings, ClawDSH Activity, and Harness Advanced are all reachable.
4. The product shell uses the same Host Session and persistence as the stock dsh Web application, mounts its complete public root in Conversation, and does not reimplement or privately extract Chat.
5. Settings show capability provenance, dependencies, configuration, credential readiness, desired/runtime revisions, and restart requirements; stale writes fail with a conflict.
6. Secret values cross the browser boundary only through the write-only credential draft and its outgoing request; the Host never returns them, the draft clears after settlement, and no Settings state, log, Session persistence, or Activity storage retains them.
7. Optional channels and Automation start disabled without credentials, and capability changes alter the real runtime at their documented effect time.
8. Activity shows available Prompt, Memory, Channel, Skill, and Automation records while privacy-limited sidecar failures leave the underlying behavior operational.
9. Raw Trajectory remains accessible through Harness Advanced, and `dsh --profile web` retains pure Harness behavior.
10. Browser typechecking, a real-profile Playwright journey, and a keyless product snapshot cover the assembled application before the product shell is marked implemented.
