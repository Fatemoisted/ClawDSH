# Feature spec: ClawDSH local GUI

English | [中文](feature-gui-web.zh.md)

- **Status**: the ClawDSH product shell, capability overview, editable Settings control plane, and semantic Activity are implemented
- **Assembly**: `packages/openclaw/preset-openclaw/product-shell/`
- **Product role**: the local ClawDSH frontend alongside Gateway-connected messaging frontends

## Product boundary

The `clawdsh` profile starts one dsh Host process with two browser applications. `/clawdsh/` is the ClawDSH product entry point, while `/` remains the unmodified dsh Web application exposed as Harness Advanced. Both applications use the same Host services, Sessions, Connection transport, and persistence. A separately started `dsh --profile web` process remains the pure Harness entry point.

The product boundary is the process-level `clawdsh` profile, not a per-Session preset selection. New product Sessions use the `clawdsh` preset displayed as `ClawDSH 模式`; the product entry does not offer the internal `clawdsh-messaging-safe` composition or legacy user presets. Harness Advanced retains the complete preset manager, where selecting another preset changes only that Session's Agent composition and does not unmount ClawDSH Host plugins.

The product shell adds no model-visible input. Conversation requests continue to use the selected agent preset and mounted capability plugins.

## Routes and navigation

The Host redirects `/clawdsh` to `/clawdsh/` with HTTP 308 and preserves the query string. `/clawdsh/` is the only canonical product route. `/clawdsh/settings` and `/clawdsh/activity` are deprecated aliases that redirect to it with HTTP 308 and preserve the query string. The protocol-v1 bootstrap response retains those route fields for compatibility; removing them requires a separate protocol-version change. Unknown `/clawdsh/*` paths render the product's in-app 404.

The product uses the native Harness information architecture. The single sidebar owns new Sessions and history, its existing Settings button opens a panel whose first section is ClawDSH, and `Harness 高级` is an additional footer link to `/`. A selected Session exposes `对话 | 轨迹 | ClawDSH 记录`; no second product sidebar or duplicate Conversation button exists.

The ClawDSH runtime suppresses the stock Host ready line and prints `clawdsh web: http://127.0.0.1:<port>/clawdsh/` only after the Loader settles. A failed startup or disposed runtime does not print a successful product URL.

## Conversation assembly

Conversation loads the complete stock dsh Client plugin graph from the public boot manifest and static module table. `ClawdshWebEntry` uses the public Loader, `createSlotRenderer()`, and `buildRenderApp()` assembly, then keeps one resulting Harness root mounted inside a minimal ClawDSH root container. Chat, Session selection, streaming, approvals, tools, Settings, and raw Trajectory therefore remain owned by dsh; ClawDSH does not copy their state or implement substitutes.

The product assembly contributes only to existing public Slots: `conversation.hero.agentPreset` fixes the `ClawDSH 模式` identity, `sidebar.footer.action` adds Harness Advanced, `settings.section` adds the first Settings section, and `conversation.view` adds the third Session tab. It suppresses only the stable semantic `[data-variant='think']` row from the product transcript. Harness Advanced retains the stock preset controls, and complete reasoning stays available in raw Trajectory. The integration uses no private import, layout selector, tab-text lookup, or simulated DOM click.

The browser, Host runtime, and shared protocol form a nested non-workspace build below `preset-openclaw/product-shell/`. The build emits the browser application into the runtime distribution and uses Vite base `/clawdsh/`. `tools/link-clawdsh.sh` refuses to install the development profile until both runtime and browser artifacts exist, then links the runtime as `@clawdsh/dsh-product-runtime`.

## Local control plane

The frozen protocol-v1 Connection channel is `/clawdsh-rpc`. It is registered with loopback-only authority, so a configured trusted host cannot call it. Every request is an exact versioned object; unknown fields, versions, endpoints, response fields, namespaces, setting paths, credential ids, and prototype-pollution path segments fail validation. The implemented methods are:

- `bootstrap/get`, which returns the product identity, stable routes, and the local read-write control mode.
- `capabilities/list`, which returns JSON-only product capabilities, sanitized Loader evidence, and the locked OpenClaw channel catalog.
- `settings/describe`, `settings/mutate`, and `settings/reset`, which expose only product-allowlisted schemas and fields with optimistic revisions.
- `credentials/describe`, `credentials/set`, and `credentials/unset`, which expose secret-free state and write-only mutation for allowlisted dsh-owned references.
- `activity/list`, which returns one privacy-limited current-Session page merged from standard Session history and bounded ClawDSH sidecars.

The control runtime returns data-transfer objects rather than live Cordis objects. The browser also refuses product-control calls when the Connection is not loopback. Remote trusted-host pages can continue to use the Harness conversation, but ClawDSH Settings, credentials, and Activity control data remain local-only.

## Capability overview

The primary status view contains five user features: Soul, Memory, Skills Hub, Channels, and Automation. Activity is required observability infrastructure and appears only under the collapsed implementation details. Package names, component rows, state sources, the channel catalog, and the complete Loader inventory also remain in that diagnostic section.

The browser presentation combines three protocol-v1 responses without changing their schemas. `capabilities/list` proves package and Fiber loading, `settings/describe` proves desired and runtime settings plus restart timing, and `credentials/describe` proves only whether an allowlisted credential is configured. The UI keeps four meanings separate: mounted implementation, enabled business effect, complete configuration, and verified runtime use. It never infers the fourth from the first three; unknown or malformed evidence becomes `状态未知` without crashing the panel.

On a clean installation, Soul reports `新会话启用`, Memory reports `已启用` with an Ark configuration reminder when needed, Skills Hub reports `来源已启用`, Channels reports `尚未连接平台`, and Automation reports `尚未设置`. The Skills status proves only that the ClawHub-compatible source participates; actual discovery is verified during a directory scan. A configured Ark key says only that first use will verify it. An active Gateway without an enabled-channel signal says that the Gateway started but the platform connection is unverified. Automation distinguishes no rules, saved rules while disabled, enabled with no runnable rule, normal running, and restart-pending state. Summary counts cover only these five features.

## Settings semantics

The fixed namespaces are `clawdsh-soul`, `clawdsh-channel-agent`, `clawdsh-channel-openclaw`, `clawdsh-memory`, `clawdsh-embeddings-ark`, `clawdsh-skills-hub`, `clawdsh-automation`, and the required managed `clawdsh-activity` namespace. Channel Protocol is required infrastructure and has no user namespace. A server-owned manifest controls field order, copy, editor selection, dependencies, and whether each exact field is editable or installer-managed; the browser cannot expand this allowlist.

Each capability registers its existing Config schema. Values resolve in `schema default → profile base → user settings` order. Reset removes only the namespace's user layer. A mutation carries `expectedRevision` and a bounded, non-empty set of distinct `set` or `unset` operations; the Host validates and persists the complete set atomically. A stale write returns `settings-conflict` without merge or retry. Responses distinguish `desiredRevision` from `runtimeRevision`, calculate `restartRequired` from desired and runtime values, and label effect timing as `live`, `new-session`, `next-call`, or `restart`.

Optional business plugins stay in Loader composition so their schemas remain available. Their `enabled` field controls effects at mount: disabled Memory registers no prompt, tools, watcher, or flush, disabled Skills Hub registers no provider, and disabled Automation creates no timer, runtime, or Automation Session. Soul changes apply to new Sessions. Channel Agent is required and remains network-inert by itself.

OpenClaw Gateway remains mounted with `enabled=false` without checking artifacts, binding a socket, starting a process, or registering a Provider. Enabling it runs managed-deployment preflight before persistence, so a failed preflight leaves the value and revision unchanged. Deployment identity, paths, extensions, and media limits remain visible but read-only. Gateway process state never implies that a platform account is ready, certified, or enabled.

Ark Embeddings uses only the fixed `ARK_API_KEY` credential reference and resolves it per call. Credential RPC exposes configured and writable metadata but never a value. OpenClaw exclusively owns Feishu, Telegram, and other platform credentials; they never enter dsh credentials, Settings RPC, retained browser state, logs, Session files, or Activity storage.

One plugin-lifetime in-memory store owns loading, snapshots, namespace drafts, credential drafts, save and conflict state, disclosures, and dirty keys. Closing Settings, switching to another native section, or reopening the panel does not discard a draft. Dirty keys keep the page-unload warning active even while the ClawDSH section is unmounted; save, reset, reload, explicit clear, and accepted replacements clear the relevant key. The store writes nothing to local storage or Session files.

Configuration is grouped by feature rather than by raw namespace. Soul has one heading; Memory contains Memory behavior, Ark semantic search, and the Ark key; Channels contains Agent Bridge and OpenClaw Gateway; Skills Hub and Automation each have one feature group. The generic editor supports schema-described strings, numbers, booleans, enums, nested objects, and string arrays. Channel and Automation Session workspaces are installer-managed because an existing Session retains its creation-time `cwd`. Automation saves the complete `rules` field atomically and gives each newly added task a UUID-backed durable id; Gateway runs deployment preflight before persistence, and an optimistic revision conflict preserves the draft until explicit reload.

A credential value exists only in the store's private browser memory and its outgoing write request. Success, failure, explicit clear, and plugin disposal erase it. Neither errors, responses, logs, persistent browser storage, Settings files, Session files, nor Activity sidecars retain the value. Credential descriptors remain secret-free.

## Semantic Activity

The `ClawDSH 记录` third tab uses the Session id supplied by `conversation.view` and presents identity/context, Memory, external-message, Skill, and scheduled-task records. It supports category filtering, ascending or descending time order, and snapshot-bound cursor pagination; changing Session or unmounting the tab aborts the old request and resets its continuation. A completed turn automatically reloads the first page, while a persistent manual reload covers sidecar-only facts that arrive later. User-facing cards explain the observed result in Chinese, distinguish actual Memory mutations from no-ops, and never describe an unmatched `started` event as work known to be running. Session sequence, fixed kind, digest, and other implementation fields remain in folded technical details. The adjacent Trajectory tab provides standard Session diagnostics, but a sidecar-only failure may have no matching raw row, so the records tab does not promise that every detail exists there or simulate cross-tab navigation.

The always-mounted `@clawdsh/dsh-activity` service merges privacy-safe facts projected from standard Session history with bounded owner-private sidecars for ClawDSH-only contributions. Missing, malformed, or unwritable sidecars degrade only this view; history and sidecars remain independently usable, and no product response returns source paths or errors. Fixed kind-specific components render records without a raw JSON expansion. The [Activity specification](feature-activity.md) owns the record vocabulary, privacy mapping, storage, pagination, and degradation behavior.

## Integration constraints

- ClawDSH does not fork or reimplement dsh Chat, Session state, streaming, approvals, tool rendering, native Settings, or raw Trajectory.
- ClawDSH registers no new Client Slot and does not enter the root Client aggregate or Client Catalog. The product browser contributes only to the existing public `conversation.hero.agentPreset`, `sidebar.footer.action`, `settings.section`, and `conversation.view` Slots.
- ClawDSH imports public package exports only; it does not import upstream `src/*` paths or alter `api-proxy`, Agent Loop, generated files, or upstream-owned source.
- The product uses `/clawdsh/` for static routes and the non-overlapping `/clawdsh-rpc` name for Connection RPC.
- The physical `preset-openclaw` directory remains internal because an existing repository check grants that path a narrow exception. Installed ids, commands, and product copy use `clawdsh`.

## Current verification

The nested build has independent browser and runtime typechecks, focused tests, and build output checks. The real-profile keyless journey runs the normal `clawdsh` profile, waits for the Loader-settled product URL, verifies the single sidebar, native Settings section, three Session tabs, safe default states, semantic records, responsive layout, legacy redirects, product 404, and a clean console. Focused package, protocol, runtime, and browser coverage verifies strict requests, mutation and reset, stale revisions, restart state, plugin-lifetime drafts, unload warnings, public Slot registrations, presentation fallbacks, preflight-before-persist behavior, secret-free responses, credential cleanup and disposal, Activity privacy and availability, Session switch and unmount cancellation, filtering, cursor pagination, and compatibility redirects.
