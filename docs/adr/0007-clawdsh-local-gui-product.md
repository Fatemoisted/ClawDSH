# ADR-0007: ClawDSH local GUI as a product shell over the dsh Web runtime

English | [中文](0007-clawdsh-local-gui-product.zh.md)

- **Status**: Accepted (product shell, Settings control plane, and semantic Activity implemented)
- **Date**: 2026-08-15
- **Depends on**: ADR-0001 (own-code isolation), the [current dsh Web GUI assembly](../../.agents/notes/implemented/feature/2026-08-15-openclaw-gui-dsh-web-app.md)

## Context

The local GUI composes the stock `dsh-web-app` bundle, the `clawdsh` agent preset displayed as `ClawDSH 模式`, and an owned product runtime. `/clawdsh/` provides the native Session interface with a ClawDSH capability section and semantic records, while `/` preserves the complete DeepSeek Harness application.

A profile and an agent preset have different lifecycles. The profile mounts Host plugins for the process, while a preset composes one Session's Agent plane. Selecting the `standard` preset inside the ClawDSH profile therefore does not unload ClawDSH channels, Memory, Skills, or Automation and cannot truthfully mean “pure DeepSeek Harness.”

The public dsh Web assembly already supplies the Session runtime, browser module graph, RPC carrier, Settings infrastructure, raw Trajectory, one renderer for the complete Harness root, and public Slots for feature-owned navigation and content. ClawDSH therefore keeps that complete root as the product UI and contributes through those existing Slots. The assembly stays in ClawDSH-owned files and requires no upstream PR; if implementation would require an upstream change, private extraction, or DOM navigation bridge, this GUI work stops and is redesigned within its local-only boundary.

## Decision

1. **Product and engine have separate entry points.** `/clawdsh/` is the default ClawDSH interface. `/` retains the unmodified DeepSeek Harness GUI as “Harness Advanced.” `dsh --profile web` remains the pure Harness process; changing an agent preset inside the ClawDSH profile is not presented as a product-mode switch.
2. **Harness owns the top-level information architecture.** The product keeps one native sidebar. Session history and new-Session actions carry Conversation, the existing Settings button opens ClawDSH as the first native section, Harness Advanced is an added sidebar footer link, and each selected Session exposes Conversation, Trajectory, and `ClawDSH 记录` as adjacent tabs.
3. **Reuse the complete dsh browser root without forking Chat.** The product shell consumes the public boot manifest, module graph, load state, and `buildRenderApp()` root renderer, then mounts that complete Harness root once inside a minimal container. ClawDSH does not extract a Chat-only subtree through private Slots, private imports, or layout selectors. The product stylesheet may suppress the stable semantic `[data-variant='think']` reasoning row because reasoning belongs in raw Trajectory rather than the product transcript. Session state, the agent loop, RPC transport, Chat, approvals, streaming, persistence, Settings chrome, and raw Trajectory remain dsh responsibilities.
4. **ClawDSH contributes only through existing public Slots.** Its source stays under `packages/openclaw/preset-openclaw/`, outside the root Client aggregate. `conversation.hero.agentPreset` displays the fixed `ClawDSH 模式` identity, `sidebar.footer.action` links Harness Advanced, `settings.section` owns the first Settings section, and `conversation.view` owns the third Session tab. The assembly registers no new Slot or `dsh.client` package, imports no upstream `src/*` path, enters no shipped occupant catalog, and does not modify `api-proxy`, Agent Loop, generated files, or upstream source. It never locates a tab by text or calls DOM `.click()` to navigate the native application.
5. **Settings control ClawDSH capabilities, not arbitrary Loader rows.** The primary view keeps mounted, enabled, configured, and verified meanings separate and includes only Soul, Memory, Skills Hub, Channels, and Automation in user counts. Activity, package provenance, component state, the channel catalog, and Loader inventory remain collapsed diagnostics. A plugin-lifetime memory store retains namespace and credential drafts across native section unmounts and keeps dirty unload protection active without persistent browser storage. The Host never returns secret values; credential success, failure, explicit clearing, and plugin disposal erase the private draft. Business plugins remain mounted so their Config schemas stay available, while validated `enabled` fields control optional runtime effects. OpenClaw exclusively owns platform credentials; the ClawDSH credential allowlist contains only dsh-owned references.
6. **The control plane has a separate loopback RPC prefix.** Static product routes own `/clawdsh/`, so control methods use the non-overlapping `/clawdsh-rpc` Connection channel. It is registered with `{ authority: 'loopback' }`, which reuses the JSON, Host, and same-origin fences with an empty trusted-host set; configured trusted hosts cannot call it.
7. **ClawDSH records complement rather than replace Trajectory.** The `ClawDSH 记录` tab explains Soul/Prompt, Memory, Channels, Skills, and Automation in product terms while the technical Activity package and sidecar format retain their names. Raw Trajectory remains the authoritative Harness diagnostic view. The same-Session event sequence stays available only in folded technical details; Prompt records describe ClawDSH contributions and do not claim to reconstruct every section of the final flattened prompt.
8. **The product identity is ClawDSH.** The user-visible mode is `ClawDSH 模式`; the profile and preset ids are `clawdsh`. The physical `preset-openclaw` source directory remains only because the repository's existing hierarchy check treats it as the assembly directory; it is not a user-facing term.
9. **Legacy identity is warning-only.** `tools/link-clawdsh.sh` warns when legacy `openclaw` profile or preset directories exist and leaves them untouched; it neither deletes them nor creates compatibility aliases. The managed install manifest, integrity checks, and `clawdsh doctor` repair operation belong to the public-distribution CLI.

The detailed ownership and verification rationale lives in the implemented [ClawDSH product-shell Agent Note](../../.agents/notes/implemented/architecture/2026-08-15-clawdsh-product-shell.md), [native Slot integration decision](../../.agents/notes/implemented/architecture/2026-08-16-clawdsh-native-slot-integration.md), and [Settings control-plane decision](../../.agents/notes/implemented/feature/2026-08-15-clawdsh-settings-control-plane.md).

## Consequences

- ClawDSH gains a stable product identity and an independently evolvable Settings and Activity experience while retaining the complete dsh conversation runtime.
- The Harness native frame is the product frame. Harness Advanced opens the stock application directly as a full page at `/`; the product route adds only the four public Slot contributions and the semantic reasoning-row policy.
- The repository owns and tests one additional Web application shell and control runtime. Their compatibility must be pinned to the public dsh browser APIs they consume.
- The product and advanced routes share one Host process and persistence, but they may have separate page-local UI state.
- The ClawDSH Conversation surface fixes the visible preset identity and omits reasoning rows; Harness Advanced retains the complete preset manager and reasoning evidence remains available in raw Trajectory.
- Capability switches describe ClawDSH behavior. They do not expose unrestricted Cordis Loader mutation.
- The managed `clawdsh` preset temporarily lives in dsh's user preset root. ClawDSH Settings offers no delete action, while the unmodified Harness preset manager can still delete it as a user preset; the public-distribution `clawdsh doctor` repairs that state explicitly.
- The Host owns the canonical product route and legacy redirects; native Harness components own navigation chrome. ClawDSH owns capability Settings content and semantic records. Activity data remains bounded, privacy-limited, and fail-open rather than an authoritative replacement for Session history or raw Trajectory.

## Alternatives

- **Keep the stock dsh GUI with only a ClawDSH preset (rejected)**: it runs the capabilities but cannot own product navigation, complete ClawDSH settings, provenance, dependency state, or semantic activity, and it keeps conflating profile and preset lifecycles.
- **Fork or directly modify the dsh GUI (rejected)**: this duplicates upstream UI ownership, expands every upstream sync conflict, and violates the repository's upstream-read-only rule.
- **Keep a second ClawDSH navigation shell (rejected)**: it duplicates Conversation, Settings, and Activity navigation already owned by the native application, consumes horizontal space, and risks unmounting or desynchronizing Session UI state.
- **Reimplement Chat and Session state (rejected)**: streaming, reconnect, approvals, paging, persistence, and tool presentation already have one owner in dsh and would otherwise acquire divergent behavior.
- **Extract or hide a Chat-only subtree with private imports, private Slots, or layout CSS (rejected)**: the public renderer owns the complete Harness root. The narrow semantic reasoning-row policy and public preset-identity override do not extract or replace that tree; a broader Chat-only experience still requires a new architecture decision.
- **Switch native views through selectors, tab text, or simulated clicks (rejected)**: DOM structure and localized labels are not public APIs. ClawDSH registers its own section and view and leaves cross-view selection to the native controls.
- **Use the `standard` preset to represent pure Harness (rejected)**: Host-plane ClawDSH plugins remain mounted, so the label would promise a lifecycle change that did not occur.
- **Replace raw Trajectory with Activity (rejected)**: semantic explanation cannot substitute for the ordered Session and request evidence needed for diagnosis.
