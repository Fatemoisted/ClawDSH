# Agent Note: ClawDSH product shell runtime and capability overview

Status: implemented

English | [中文](2026-08-15-clawdsh-product-shell-runtime.zh.md)

The [local GUI specification](../../../../docs/specs/feature-gui-web.md) owns the current user-visible behavior. The broader [product-shell decision](../../implemented/architecture/2026-08-15-clawdsh-product-shell.md) owns the complete assembly; editable Settings is owned by its [implemented decision](2026-08-15-clawdsh-settings-control-plane.md), and semantic Activity by its [feature specification](../../../../docs/specs/feature-activity.md).

## Problem

The original [dsh Web bundle assembly](2026-08-15-openclaw-gui-dsh-web-app.md) proves that the `clawdsh` preset can drive the stock Harness GUI, but a preset label cannot represent the product boundary. Agent presets vary per Session, while ClawDSH Host capabilities are process-wide. The stock navigation also cannot distinguish ClawDSH capability health from raw Loader diagnostics or channel certification evidence.

A separate product application must preserve the existing Harness conversation implementation and the repository's upstream-read-only rule. Adding a Client Slot, changing the Client Catalog, importing upstream private source, or forking Chat would make the ClawDSH interface depend on an unapproved upstream modification or duplicate stateful behavior.

## Decision

The `clawdsh` profile mounts `@clawdsh/dsh-product-runtime` beside the stock dsh Web runtime. The Host serves a ClawDSH SPA under `/clawdsh/`, redirects `/clawdsh` there with HTTP 308, and retains the stock application at `/`. The product runtime applies the public index transforms to product HTML and prints its URL only after the Loader settles. Both browser applications address the same Host services, Session store, Connection transport, and persistence.

The product code is a nested non-workspace build at `packages/openclaw/preset-openclaw/product-shell/`:

- `browser/` owns product navigation, the capability overview, editable Settings, semantic Activity presentation, and a `ClawdshWebEntry` that loads the public boot manifest and Client module table.
- `runtime/` owns static Host routes, the Loader-settled ready URL, capability projection, and Connection RPC registration.
- `shared/` owns strict protocol-v1 request and response data-transfer types used by both sides.

Conversation keeps the complete public Harness root mounted. `ClawdshWebEntry` uses the public Loader, `createSlotRenderer()`, and `buildRenderApp()` assembly; ClawDSH does not extract Chat, copy Session state, or hide native Harness areas through private imports or CSS. Harness Advanced is a document navigation to `/`, not an in-shell approximation of the stock GUI.

The product-control channel is `/clawdsh-rpc` and uses Connection's loopback-only authority. Its base read methods are `bootstrap/get` and `capabilities/list`; the Settings decision adds exact versioned setting and credential methods on the same protocol. Responses contain JSON-only data and never return live Cordis objects or secret values. Configured trusted hosts cannot use the product-control channel.

The capability overview separates Loader composition from product support evidence. Loader entries map to `disabled`, `starting`, `active`, `failed`, or `misconfigured`; locked channels map independently to `cataloged`, `installable`, `certified`, or `enabled`. Channels present Channel Protocol, Agent Bridge, and OpenClaw Gateway Provider as components, with Feishu, Telegram, and other locked entries nested under the Gateway as catalog items. Legacy channel plugins remain visible only in the raw Loader inventory and do not contribute to product health.

Semantic Activity composes through the separately owned `@clawdsh/dsh-activity` Host service and `activity/list` control method. The Activity route follows the current Session and renders its privacy-limited pages, while Raw Trajectory stays in Harness Advanced. Editable Settings likewise composes beside the capability overview under its separate validation, revision, credential, and lifecycle decision.

The shell is an application assembly rather than a reusable Harness Client contribution. It does not register a Client Slot, call `ctx.slots.register()` to inject product UI, enter the root Client aggregate or Client Catalog, import upstream `src/*` paths, or change `api-proxy`, Agent Loop, generated files, or upstream-owned source. This decision partially supersedes only the earlier choice to own no ClawDSH browser UI; reuse of the stock conversation runtime, profile composition, and the `clawdsh` preset remains unchanged.

## Verification

The nested project independently typechecks and tests the browser and runtime, then emits product assets with Vite base `/clawdsh/`. Runtime tests cover static method and traversal rejection, index transforms, strict RPC requests, loopback authority, capability projection, and Loader-settled URL reporting. Browser tests cover public-only imports, module loading, stable navigation, the capability overview, remote-control failure, and product 404 routing.

The real-profile keyless journey builds the nested project, installs it into an isolated dsh home, starts the `clawdsh` profile without external credentials or an OpenClaw artifact, and exercises `/clawdsh/`, Settings, Activity, the product 404, and `/`. It verifies that the stock application has no ClawDSH product navigation, the installed default preset remains `clawdsh` / `ClawDSH 模式`, the managed Soul composition mounts, the always-mounted Gateway reports Channels as disabled through its business setting, and all 27 production channels remain cataloged rather than certified.

Activity package, control-plane, and browser tests cover semantic projection, sidecar degradation, privacy mapping, current-Session selection, and pagination without expanding the shell's ownership into raw Trajectory.

## Alternatives considered

**Keep the stock dsh application as the entire product.** This leaves ClawDSH represented as a Session preset and cannot express process-level capabilities or distinguish Loader state from support evidence. The stock application remains available as Harness Advanced instead.

**Add ClawDSH pages through a Client Slot.** The shell is a top-level application, not a reusable occupant inside the Harness frame. A new Slot and catalog entry would require upstream-owned changes and still would not establish the profile-level product boundary.

**Fork or extract Chat.** Reimplementing Chat would duplicate Connection, Session, streaming, approval, and tool-rendering behavior. Importing a private Chat subtree or hiding adjacent UI with CSS would bind ClawDSH to undocumented upstream structure. The complete public root is retained.

**Expose Loader enable and disable controls in Settings.** Loader mutation can break dependencies and conflates implementation state with product configuration. The Loader inventory remains read-only; capability-owned schemas and validated lifecycle semantics provide the editable control plane.

**Use one route prefix for static pages and RPC.** Connection prefix matching would overlap product assets and control calls. `/clawdsh/` and `/clawdsh-rpc` have distinct ownership.

## Consequences

ClawDSH has a stable local product entry and navigation without changing upstream GUI code, while users retain the complete Harness conversation and raw diagnostics. The capability overview accurately presents ownership and runtime evidence without claiming that a running Gateway certifies any platform account.

The nested project carries its own install, typecheck, test, and build lifecycle because it intentionally stays outside the root Client aggregate. Development installation fails until its runtime and browser artifacts have been built. Product and Harness Advanced pages may keep different ephemeral browser state even though they share durable Host Sessions.

The product shell composes separately owned Settings and Activity capabilities. Semantic records use their own projection, storage, privacy, and degradation rules rather than being inferred from Loader evidence.
