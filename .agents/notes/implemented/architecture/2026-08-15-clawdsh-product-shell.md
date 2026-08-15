# Agent Note: ClawDSH product shell over the dsh Web application

Status: implemented

English | [中文](2026-08-15-clawdsh-product-shell.zh.md)

The product posture is accepted by [ADR-0007](../../../../docs/adr/0007-clawdsh-local-gui-product.md), and the user-facing behavior is defined by the [ClawDSH local GUI](../../../../docs/specs/feature-gui-web.md) and [semantic Activity](../../../../docs/specs/feature-activity.md) specifications. The [product-shell runtime](../../implemented/feature/2026-08-15-clawdsh-product-shell-runtime.md) and [Settings control plane](../../implemented/feature/2026-08-15-clawdsh-settings-control-plane.md) own their narrower implementation decisions.

## Problem

The original [GUI assembly](../../implemented/feature/2026-08-15-openclaw-gui-dsh-web-app.md) correctly reuses the stock dsh Web application and changes only the default agent preset. The implemented product shell resolves that product-boundary problem while preserving the complete Harness conversation runtime.

The product-shell and Settings decisions are current authority for shipped behavior. They partially supersede only the earlier choice to own no ClawDSH browser UI and preserve the decisions to reuse `dsh-web-app`, compose through a profile and preset, and keep the Harness conversation runtime authoritative.

That information architecture cannot explain the product accurately. A [profile bundle](../../implemented/architecture/2026-08-05-profile-plugin-bundles.md) owns process-wide Host composition, while a [per-Session preset](../../implemented/architecture/2026-08-03-per-session-agent-presets.md) owns Agent composition. Selecting `standard` does not unmount ClawDSH Host plugins, so a preset selector cannot be the product boundary between ClawDSH and pure Harness.

The implemented Settings control plane resolves the configuration mismatch with product-owned capability taxonomy, field permissions, credential ownership, revisions, and effect timing while leaving raw Loader entries read-only.

The raw [Trajectory ledger](../../implemented/feature/2026-07-27-trajectory-inspection-ledger.md) is authoritative for ordered Harness evidence, but it does not group ClawDSH behavior into Soul/Prompt, Memory, Channels, Skills, and Automation. Replacing Trajectory would lose diagnostic detail, while leaving it as the only view makes product behavior difficult to understand.

## Decision

### Product and engine responsibilities

The ClawDSH profile starts one dsh Host process and exposes two browser applications. `/clawdsh/` is the default product route. `/` remains the stock dsh Web application and is linked as Harness Advanced. A separately started `dsh --profile web` process remains the only pure Harness mode.

The product shell owns top-level navigation, ClawDSH Settings, ClawDSH Activity, capability presentation, and product branding. dsh continues to own Connection transport, Session state, Chat, streaming, approvals, tool rendering, persistence, raw Settings diagnostics, and raw Trajectory. Both routes address the same Host services and Session store; neither copies conversation state into a second product database.

The fixed product navigation is Conversation, ClawDSH Settings, ClawDSH Activity, and Harness Advanced. The public `buildRenderApp()` face renders the complete Harness root, so v1 Conversation mounts that root, including its native frame and diagnostic views, rather than extracting Chat. Harness Advanced opens the same stock application directly at `/`; it is a diagnostic route, not a competing product mode.

### Composition and identity

The product boundary is the `clawdsh` profile. The default Agent identity is the `clawdsh` preset, shown as `ClawDSH 模式`. A Session may still select another compatible preset, but the UI describes that action as changing the Session's Agent composition and never as unloading ClawDSH.

The shell consumes the public boot manifest, static browser module table, loading state, Connection protocol, and complete root rendering assembly described by the [Web Client architecture](../../implemented/architecture/2026-07-19-gui-web-client-architecture.md), [Client plugin loading model](../../implemented/architecture/2026-07-23-client-plugin-loading-model.md), and [GUI RPC layering](../../implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md). Its browser, runtime, and distribution source stays nested under `packages/openclaw/preset-openclaw/`, outside the root Client aggregate. ClawDSH does not use CSS, a private Slot, or a private import to remove the native Harness frame.

This is an application assembly, not a reusable Client contribution. It does not register a new Slot, add a `dsh.client` package, enter the shipped occupant catalog, or modify `api-proxy`, Agent Loop, generated files, or upstream source. It also does not use runtime package injection or scanner exceptions to imitate a catalog entry. The proposed [dynamic package runtime](../../proposed/architecture/2026-08-08-cordis-web-dynamic-packages.md) has a different trust and lifecycle model and is not a dependency of this shell.

The physical `preset-openclaw` directory remains temporarily because the repository's current hierarchy gate recognizes that assembly path. Product copy, installed profile and preset ids, default selection, commands, safe clean-install defaults, and legacy handling follow the [ClawDSH identity decision](../../implemented/feature/2026-08-15-clawdsh-identity-and-safe-defaults.md); the directory name is not exposed as a compatibility promise.

### Settings and activity

The capability overview is read-only. It maps product capabilities to owning packages, dependencies, Loader entries, and Fiber state, classifying `@clawdsh/*` as ClawDSH, `@deepseek-ai/*` and `cordis:*` as Platform, and every other source as Community. This inventory provides runtime evidence without offering a Loader toggle; editable fields follow the separate Settings decision.

ClawDSH Settings uses a static allowlist of product capability namespaces and credential references. Each capability contributes a server-owned Config description; the control plane resolves profile base, user override, and schema default into one desired configuration. Mutations carry an expected revision, resets remove only the user layer, and the response distinguishes desired revision, runtime revision, and restart requirements.

Capabilities remain mounted so Settings can describe and validate them. A supported `enabled` field controls optional behavior at the capability's documented lifecycle point; users do not toggle arbitrary Loader entries. Required infrastructure cannot be disabled, and implementation dependencies are grouped under their owning capability. A read-only Loader inventory remains available for advanced diagnosis.

Credentials remain in the dsh credentials provider. RPC methods accept only allowlisted references, never return secret values, and expose readiness as metadata. A secret exists in the browser only in the write-only input draft and its outgoing `credentials.set` request; the draft clears after settlement, and the value is not retained in Settings state or persisted to logs, Settings files, the Session log, or Activity sidecars. A disabled optional capability may omit credentials; enabling it fails at the earliest resolvable point when a required reference is absent.

ClawDSH Activity is a semantic projection that complements Trajectory. The always-mounted `@clawdsh/dsh-activity` Host service derives records from standard Session history when a standard event owns the fact and uses separate, bounded sidecar streams for ClawDSH-only facts. Records carry a Session id, category, fixed kind, optional status, package-generated summary, and privacy-limited scalar metadata; Prompt records store contribution identity and digest rather than prompt text, and Channel records exclude sender, account, conversation, thread, message and delivery identifiers, message bodies, and errors.

Sidecar ownership is per subsystem to avoid competing appenders. A SHA-256 of the Session id selects the directory; five fixed producer files use owner-only permissions, 8 KiB record limits, 1 MiB active-file limits, and two rotations. Appends are serialized per Session and producer, disposal drains accepted writes, and parsing skips damaged lines or tails without rewriting source data. Sidecar failure marks Activity degraded but cannot fail model execution, channel delivery, Memory, Skills, or Automation. Sessions without sidecars still show records derivable from standard history.

The loopback-only `activity/list` request follows the selected Session and merges live or inspected history with sidecars. It filters the five categories, orders by timestamp and id, defaults to 50 records, accepts at most 100, and uses a versioned base64url cursor bound to Session, filter, order, timestamp, and id. The browser aborts an old request and clears its cursor when the Session changes, renders one fixed component per kind without raw JSON, and keeps Raw Trajectory linked through Harness Advanced.

### Security and extension boundary

Static product routes own the `/clawdsh/` prefix, so the control plane cannot register the same Connection prefix. It registers `/clawdsh-rpc` through `ctx.connection.rpc.handle(..., { authority: 'loopback' })`. This reuses the [browser trust boundary](../../implemented/architecture/2026-07-28-api-browser-trust-boundary.md), JSON media-type check, Host check, same-origin check, and Connection lifecycle with an empty trusted-host set; a configured trusted host remains unable to call the channel.

Capability namespace, field name, credential reference, Activity metadata, and route ownership are explicit allowlists. Unknown names fail before storage or runtime mutation. The control runtime returns product DTOs rather than live Cordis objects, Loader entries, Config providers, or credential records.

If later work needs a dsh capability that the public assembly does not expose or any upstream modification, implementation stops at that dependency and this GUI design is revised within its approved local-only boundary. This decision does not justify an upstream Slot or catalog modification.

## Alternatives considered

**Keep the stock dsh Web application as the complete product.** This preserves the smallest code surface but cannot represent profile lifecycle, capability provenance, safe settings, dependencies, or semantic Activity, so it remains the advanced diagnostic interface instead.

**Treat `standard` and `clawdsh` presets as two product modes.** Presets do not own Host plugins; this would label a Session-level change as a process-level unload and give users a false security and behavior guarantee.

**Fork Chat or the whole dsh GUI.** A fork would duplicate Connection, Session, streaming, approvals, tool presentation, and upstream UI maintenance. The shell composes the public browser runtime and owns only the product-specific application layer.

**Extract or hide Chat with private imports, private Slots, or CSS.** The public assembly renders the complete root. Depending on undocumented structure would create a local fork by another name, so v1 accepts the complete Harness frame inside Conversation; if that is not acceptable, the GUI must be redesigned.

**Insert ClawDSH pages through new Client Slots.** The top-level product frame is an application concern, not a reusable occupant inside the Harness application. Adding or disguising Slot/catalog entries would cross the repository's upstream-read-only boundary without supplying a general dsh seam.

**Expose Loader entry enable/disable as the Settings model.** Loader state is an implementation mechanism and can break dependencies or unmount the very schema needed to repair configuration. Stable capability namespaces and validated `enabled` behavior provide a supportable product contract.

**Replace Trajectory with Activity or store every Activity fact in the Session log.** Activity cannot preserve all raw diagnostic evidence, while ClawDSH-only observability does not justify upstream Session event types. The two views remain complementary, and privacy-limited sidecars cover product-only facts.

## Verification

- The `clawdsh` profile starts `/clawdsh/`, preserves the stock application at `/`, and prints the product URL only after the Loader settles.
- Both browser routes use the same Host Session services and persistence; Conversation mounts the existing complete Client root and does not reimplement or privately extract Chat.
- `dsh --profile web` remains a pure Harness process, and a preset change inside ClawDSH is not described as unloading Host capabilities.
- Product navigation contains Conversation, ClawDSH Settings, ClawDSH Activity, and Harness Advanced.
- No implementation change touches upstream-owned source, the Client Catalog, a generated file, an existing Slot definition, `api-proxy`, or Agent Loop. ClawDSH-owned shell code never calls `ctx.slots.register()` to inject product UI; reused dsh plugins continue to register their existing Slots.
- Settings expose only allowlisted capabilities, fields, and credential references; revision conflicts reject stale writes, reset preserves the profile base, and effect timing is visible.
- Secret values cross the browser boundary only through the write-only input draft and its outgoing request; the Host never returns them, the draft clears after settlement, and Settings state, logs, Session files, and Activity storage do not retain them.
- Activity presents privacy-limited Prompt, Memory, Channel, Skill, and Automation records, while missing, damaged, or unwritable sidecars degrade only the view.
- Raw Trajectory remains available in Harness Advanced, and Prompt Activity is labeled as a ClawDSH contribution rather than a reconstruction of the final System Prompt.
- Keyless clean-home startup, browser and runtime typechecks, focused package and control-plane tests, the real-profile Playwright journey, and product snapshots verify the assembled application.

## Consequences

The shell supplies a distinct ClawDSH product without forking Chat, while the full native application remains available for advanced diagnosis. It also carries an independent nested browser/runtime build whose compatibility tests must pin every consumed public dsh export and verify `/clawdsh/` asset resolution.

The product and advanced applications can hold different page-local selection or draft state even though they share Host Sessions; product copy cannot imply synchronized ephemeral UI state. The dedicated control channel also requires continuing loopback, Host, same-origin, and exact-schema tests so a trusted remote host cannot gain product-control authority.

Restart-bound capabilities can have persisted desired settings that differ from their mounted runtime values. Desired/runtime values and effect timing expose that cost, while the Host-singleton Soul settings owner ensures changes affect only new Sessions rather than rewriting a running prompt.

Semantic Activity improves explainability but is intentionally incomplete and non-authoritative. Privacy allowlists, per-subsystem files, owner-only permissions, bounded rotation, and fail-open observability must remain coordinated; losing any one would either expose personal data or couple business success to diagnostics.

The retained `preset-openclaw` source path remains an internal repository exception. Identity tests inspect installed assets and rendered copy so obsolete branding does not become a command, id, or compatibility promise.
