# Feature spec: ClawDSH local GUI

English | [中文](feature-gui-web.zh.md)

- **Status**: the ClawDSH product shell, capability overview, editable Settings control plane, and semantic Activity are implemented
- **Assembly**: `packages/openclaw/preset-openclaw/product-shell/`
- **Product role**: the local ClawDSH frontend alongside Gateway-connected messaging frontends

## Product boundary

The `clawdsh` profile starts one dsh Host process with two browser applications. `/clawdsh/` is the ClawDSH product entry point, while `/` remains the unmodified dsh Web application exposed as Harness Advanced. Both applications use the same Host services, Sessions, Connection transport, and persistence. A separately started `dsh --profile web` process remains the pure Harness entry point.

The product boundary is the process-level `clawdsh` profile, not a per-Session preset selection. New Sessions default to the `clawdsh` preset displayed as `ClawDSH 模式`; selecting another preset changes only that Session's Agent composition and does not unmount ClawDSH Host plugins.

The product shell adds no model-visible input. Conversation requests continue to use the selected agent preset and mounted capability plugins.

## Routes and navigation

The Host redirects `/clawdsh` to `/clawdsh/` with HTTP 308 and preserves the query string. It serves the product SPA and its assets under `/clawdsh/`, accepts only GET and HEAD for static product routes, rejects path traversal, and applies the same dsh index transforms used for the boot manifest and theme preboot. Unknown `/clawdsh/*` paths render the product's in-app 404.

The fixed navigation is:

1. **Conversation** at `/clawdsh/`.
2. **ClawDSH Settings** at `/clawdsh/settings`.
3. **ClawDSH Activity** at `/clawdsh/activity`.
4. **Harness Advanced**, a full-page link to `/`.

The ClawDSH runtime suppresses the stock Host ready line and prints `clawdsh web: http://127.0.0.1:<port>/clawdsh/` only after the Loader settles. A failed startup or disposed runtime does not print a successful product URL.

## Conversation assembly

Conversation loads the complete stock dsh Client plugin graph from the public boot manifest and static module table. `ClawdshWebEntry` uses the public Loader, `createSlotRenderer()`, and `buildRenderApp()` assembly, then keeps the resulting Harness root mounted inside the product shell. Chat, Session selection, streaming, approvals, tools, native Settings, and raw Trajectory therefore remain owned by dsh; ClawDSH does not copy their state or implement substitutes.

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

ClawDSH Settings shows Soul, Channels, Memory, Skills Hub, Automation, and Activity with dependencies, effect timing, component packages, and Loader state. It retains a complete read-only Loader inventory for diagnosis, while editable capability fields use product-owned Settings namespaces rather than arbitrary Loader mutation.

Loader composition state and channel-support evidence are separate concepts:

- Loader state is `disabled`, `starting`, `active`, `failed`, or `misconfigured` and derives from the configured entry and observed Fiber lifecycle.
- Channel support is `cataloged`, `installable`, `certified`, or `enabled` and derives from explicit product evidence, never from a running Gateway process.

The disabled state of the managed communication-plane parent is authoritative for Channels even though Cordis keeps the group carrier itself active and omits its disabled children. Soul is reported active only when the default `clawdsh` preset contains the exact enabled managed Soul row and its standing composition mounts successfully.

Channels contain three components: Channel Protocol (`@clawdsh/dsh-channel`), Agent Bridge (`@clawdsh/dsh-channel-agent`), and OpenClaw Gateway Provider (`@clawdsh/dsh-channel-openclaw`). Feishu, Telegram, and the other locked production entries appear beneath the Gateway as catalog items with `cataloged` support; they are not standalone dsh plugin cards. Legacy `channel-core`, `channel-feishu`, and `channel-telegram` entries may appear in the raw Loader inventory but do not affect product health.

Package provenance follows one fixed mapping: `@clawdsh/*` is ClawDSH, `@deepseek-ai/*` and `cordis:*` are Platform, and every other source is Community.

## Settings semantics

The fixed namespaces are `clawdsh-soul`, `clawdsh-channel-agent`, `clawdsh-channel-openclaw`, `clawdsh-memory`, `clawdsh-embeddings-ark`, `clawdsh-skills-hub`, `clawdsh-automation`, and the required managed `clawdsh-activity` namespace. Channel Protocol is required infrastructure and has no user namespace. A server-owned manifest controls field order, copy, editor selection, dependencies, and whether each exact field is editable or installer-managed; the browser cannot expand this allowlist.

Each capability registers its existing Config schema. Values resolve in `schema default → profile base → user settings` order. Reset removes only the namespace's user layer. A mutation carries `expectedRevision` and a bounded, non-empty set of distinct `set` or `unset` operations; the Host validates and persists the complete set atomically. A stale write returns `settings-conflict` without merge or retry. Responses distinguish `desiredRevision` from `runtimeRevision`, calculate `restartRequired` from desired and runtime values, and label effect timing as `live`, `new-session`, `next-call`, or `restart`.

Optional business plugins stay in Loader composition so their schemas remain available. Their `enabled` field controls effects at mount: disabled Memory registers no prompt, tools, watcher, or flush, disabled Skills Hub registers no provider, and disabled Automation creates no timer, runtime, or Automation Session. Soul changes apply to new Sessions. Channel Agent is required and remains network-inert by itself.

OpenClaw Gateway remains mounted with `enabled=false` without checking artifacts, binding a socket, starting a process, or registering a Provider. Enabling it runs managed-deployment preflight before persistence, so a failed preflight leaves the value and revision unchanged. Deployment identity, paths, extensions, and media limits remain visible but read-only. Gateway process state never implies that a platform account is ready, certified, or enabled.

Ark Embeddings uses only the fixed `ARK_API_KEY` credential reference and resolves it per call. Credential RPC exposes configured and writable metadata but never a value. OpenClaw exclusively owns Feishu, Telegram, and other platform credentials; they never enter dsh credentials, Settings RPC, retained browser state, logs, Session files, or Activity storage.

Each Settings card owns an independent draft and revision. The generic editor supports schema-described strings, numbers, booleans, enums, nested objects, and string arrays; Automation saves the complete `rules` field atomically, and Gateway uses a dedicated managed-deployment view. A conflict keeps the draft and disables another save until explicit reload. Credential inputs clear in `finally` after both success and failure, and responses retain only secret-free descriptors.

## Semantic Activity

The Activity route follows the Harness client's current Session and presents Prompt, Memory, Channel, Skill, and Automation records. It supports category filtering, ascending or descending time order, and cursor pagination; changing Session aborts the old request and resets its continuation. A missing current Session links back to Conversation, while Raw Trajectory remains available in Harness Advanced.

The always-mounted `@clawdsh/dsh-activity` service merges privacy-safe facts projected from standard Session history with bounded owner-private sidecars for ClawDSH-only contributions. Missing, malformed, or unwritable sidecars degrade only this view; history and sidecars remain independently usable, and no product response returns source paths or errors. Fixed kind-specific components render records without a raw JSON expansion. The [Activity specification](feature-activity.md) owns the record vocabulary, privacy mapping, storage, pagination, and degradation behavior.

## Integration constraints

- ClawDSH does not fork or reimplement dsh Chat, Session state, streaming, approvals, tool rendering, native Settings, or raw Trajectory.
- ClawDSH does not add a Client Slot, call `ctx.slots.register()` to inject product UI, or enter the root Client aggregate or Client Catalog.
- ClawDSH imports public package exports only; it does not import upstream `src/*` paths or alter `api-proxy`, Agent Loop, generated files, or upstream-owned source.
- The product uses `/clawdsh/` for static routes and the non-overlapping `/clawdsh-rpc` name for Connection RPC.
- The physical `preset-openclaw` directory remains internal because an existing repository check grants that path a narrow exception. Installed ids, commands, and product copy use `clawdsh`.

## Current verification

The nested build has independent browser and runtime typechecks, focused tests, and build output checks. The real-profile keyless journey builds the nested application, installs it into an isolated dsh home, waits for the Loader-settled product URL, verifies all product destinations and capability namespaces, confirms Gateway is disabled and Ark is unconfigured, confirms unknown product routes render the product 404, and confirms `/` contains no ClawDSH product navigation. Focused package, protocol, runtime, and browser coverage verifies strict requests, mutation and reset, stale revisions, restart state, managed fields, independent drafts, preflight-before-persist behavior, secret-free responses, credential cleanup, Activity privacy and degradation, current-Session cancellation, filtering, cursor pagination, the `clawdsh` preset, and idempotent development installation.
