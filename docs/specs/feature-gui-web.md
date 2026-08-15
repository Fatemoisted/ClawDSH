# Feature spec: ClawDSH local GUI

English | [中文](feature-gui-web.zh.md)

- **Status**: the ClawDSH product shell and read-only capability overview are implemented; editable Settings and semantic Activity records are not available
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

## Read-only control plane

The frozen protocol-v1 Connection channel is `/clawdsh-rpc`. It is registered with loopback-only authority, so a configured trusted host cannot call it. Every request is an exact `{ version: 1 }` object; unknown fields, versions, endpoints, and response fields fail validation. The implemented methods are:

- `bootstrap/get`, which returns the product identity, stable routes, and read-only/local-control flags.
- `capabilities/list`, which returns JSON-only product capabilities, sanitized Loader evidence, and the locked OpenClaw channel catalog.

The control runtime returns data-transfer objects rather than live Cordis objects. The browser also refuses product-control calls when the Connection is not loopback. Remote trusted-host pages can continue to use the Harness conversation, but ClawDSH Settings and Activity control data remain local-only.

## Capability overview

ClawDSH Settings is currently a read-only overview. It shows Soul, Channels, Memory, Skills Hub, Automation, and Activity with dependencies, effect timing, component packages, and Loader state. It also presents a complete read-only Loader inventory for diagnosis. It provides no enable, disable, save, reset, arbitrary Loader mutation, or credential operation.

Loader composition state and channel-support evidence are separate concepts:

- Loader state is `disabled`, `starting`, `active`, `failed`, or `misconfigured` and derives from the configured entry and observed Fiber lifecycle.
- Channel support is `cataloged`, `installable`, `certified`, or `enabled` and derives from explicit product evidence, never from a running Gateway process.

The disabled state of the managed communication-plane parent is authoritative for Channels even though Cordis keeps the group carrier itself active and omits its disabled children. Soul is reported active only when the default `clawdsh` preset contains the exact enabled managed Soul row and its standing composition mounts successfully.

Channels contain three components: Channel Protocol (`@clawdsh/dsh-channel`), Agent Bridge (`@clawdsh/dsh-channel-agent`), and OpenClaw Gateway Provider (`@clawdsh/dsh-channel-openclaw`). Feishu, Telegram, and the other locked production entries appear beneath the Gateway as catalog items with `cataloged` support; they are not standalone dsh plugin cards. Legacy `channel-core`, `channel-feishu`, and `channel-telegram` entries may appear in the raw Loader inventory but do not affect product health.

Package provenance follows one fixed mapping: `@clawdsh/*` is ClawDSH, `@deepseek-ai/*` and `cordis:*` are Platform, and every other source is Community.

## Activity and Settings gaps

The Activity route currently renders an explicit empty state. It does not read Session history, create sidecars, expose filters, or claim that semantic Prompt, Memory, Channel, Skill, or Automation records exist. Raw Trajectory remains available in Harness Advanced.

The current RPC protocol does not implement `settings/describe`, `settings/mutate`, `settings/reset`, credential methods, or `activity/list`. No product setting is mutable, no secret crosses the ClawDSH browser control path, and no `@clawdsh/dsh-activity` package is mounted. The broader Settings and Activity design remains proposal scope until those server, browser, persistence, and privacy behaviors ship together.

## Integration constraints

- ClawDSH does not fork or reimplement dsh Chat, Session state, streaming, approvals, tool rendering, native Settings, or raw Trajectory.
- ClawDSH does not add a Client Slot, call `ctx.slots.register()` to inject product UI, or enter the root Client aggregate or Client Catalog.
- ClawDSH imports public package exports only; it does not import upstream `src/*` paths or alter `api-proxy`, Agent Loop, generated files, or upstream-owned source.
- The product uses `/clawdsh/` for static routes and the non-overlapping `/clawdsh-rpc` name for Connection RPC.
- The physical `preset-openclaw` directory remains internal because an existing repository check grants that path a narrow exception. Installed ids, commands, and product copy use `clawdsh`.

## Current verification

The nested build has independent browser and runtime typechecks, focused tests, and build output checks. The real-profile keyless journey builds the nested application, installs it into an isolated dsh home, waits for the Loader-settled product URL, verifies all product destinations and the read-only overview, confirms unknown product routes render the product 404, and confirms `/` contains no ClawDSH product navigation. Identity coverage verifies the `clawdsh` preset and idempotent development installation.
