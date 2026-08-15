# ADR-0007: ClawDSH local GUI as a product shell over the dsh Web runtime

English | [中文](0007-clawdsh-local-gui-product.zh.md)

- **Status**: Accepted (product shell, Settings control plane, and semantic Activity implemented)
- **Date**: 2026-08-15
- **Amended**: 2026-08-15 — channel Settings follow the canonical/legacy split from ADR-0008 and the test1 rebuild
- **Depends on**: ADR-0001 (own-code isolation), [ADR-0008](0008-openclaw-channel-plane.md), the [current dsh Web GUI assembly](../../.agents/notes/implemented/feature/2026-08-15-openclaw-gui-dsh-web-app.md)

## Context

The local GUI composes the stock `dsh-web-app` bundle, the `clawdsh` agent preset displayed as `ClawDSH 模式`, and an owned product runtime. `/clawdsh/` provides the ClawDSH navigation, capability overview, allowlisted Settings control plane, and semantic Activity, while `/` preserves the complete DeepSeek Harness application.

A profile and an agent preset have different lifecycles. The profile mounts Host plugins for the process, while a preset composes one Session's Agent plane. Selecting the `standard` preset inside the ClawDSH profile therefore does not unload ClawDSH channels, Memory, Skills, or Automation and cannot truthfully mean “pure DeepSeek Harness.”

The public dsh Web assembly already supplies the Session runtime, browser module graph, RPC carrier, Settings infrastructure, raw Trajectory, and one renderer for the complete Harness root. It does not expose Chat as a standalone application assembly. ClawDSH therefore accepts the complete Harness root inside its v1 Conversation destination and adds an application-level product assembly around it. The assembly stays in ClawDSH-owned files and requires no upstream PR; if implementation would require an upstream change or a private Chat extraction, this GUI work stops and is redesigned within its local-only boundary.

## Decision

1. **Product and engine have separate entry points.** `/clawdsh/` is the default ClawDSH interface. `/` retains the unmodified DeepSeek Harness GUI as “Harness Advanced.” `dsh --profile web` remains the pure Harness process; changing an agent preset inside the ClawDSH profile is not presented as a product-mode switch.
2. **ClawDSH owns the top-level navigation.** The product shell exposes Conversation, ClawDSH Settings, ClawDSH Activity, and Harness Advanced. Harness continues to own the conversation implementation and its internal diagnostic navigation.
3. **Reuse the complete dsh browser root without forking Chat.** The product shell consumes the public boot manifest, module graph, load state, and `buildRenderApp()` root renderer. In v1, Conversation mounts that complete Harness root, including its native frame and diagnostics; ClawDSH does not extract a Chat-only subtree through CSS, private Slots, or private imports. ClawDSH owns only the outer shell, routes, control runtime, Settings view, and Activity view; Session state, the agent loop, RPC transport, Chat, approvals, streaming, persistence, and raw Trajectory remain dsh responsibilities.
4. **The product shell is an application assembly, not a Client Slot contribution.** Its source stays under `packages/openclaw/preset-openclaw/`, outside the root Client aggregate. ClawDSH-owned shell code does not register a `dsh.client` package or a new Slot, does not enter the shipped occupant catalog, and does not modify `api-proxy`, Agent Loop, Client Catalog, generated files, or upstream source. The reused dsh graph continues to register its own existing Slots.
5. **Settings control ClawDSH capabilities, not arbitrary Loader rows.** The primary view presents capability provenance, dependencies, enabled state, credential readiness, and effect timing. The raw Loader inventory remains an advanced read-only diagnostic. The Host never returns secret values. A secret exists in the browser only in the write-only input draft and its outgoing `credentials.set` request, is cleared after settlement, and is not retained in Settings state, logs, Session files, or Activity storage. Business plugins remain mounted so their Config schemas stay available, while validated `enabled` fields control optional runtime effects. OpenClaw exclusively owns canonical platform credentials; the ClawDSH credential allowlist contains only dsh-owned references. The compatibility-only legacy group (Telegram, Discord, and Feishu) stays on the separate `ctx.legacyChannels` seam, is default-disabled, and remains outside the Settings capability surface. The [test1 rebuild decision](../../.agents/notes/implemented/architecture/2026-08-15-test1-channel-plane-rebuild.md) owns its migration and certification boundary.
6. **The control plane has a separate loopback RPC prefix.** Static product routes own `/clawdsh/`, so control methods use the non-overlapping `/clawdsh-rpc` Connection channel. It is registered with `{ authority: 'loopback' }`, which reuses the JSON, Host, and same-origin fences with an empty trusted-host set; configured trusted hosts cannot call it.
7. **Activity complements rather than replaces Trajectory.** ClawDSH Activity explains Soul/Prompt, Memory, Channels, Skills, and Automation in product terms. Raw Trajectory remains the authoritative Harness diagnostic view. Prompt records describe ClawDSH contributions and do not claim to reconstruct every section of the final flattened prompt.
8. **The product identity is ClawDSH.** The user-visible mode is `ClawDSH 模式`; the profile and preset ids are `clawdsh`. The physical `preset-openclaw` source directory remains only because the repository's existing hierarchy check treats it as the assembly directory; it is not a user-facing term.
9. **Legacy identity is warning-only.** `tools/link-clawdsh.sh` warns when legacy `openclaw` profile or preset directories exist and leaves them untouched; it neither deletes them nor creates compatibility aliases. The managed install manifest, integrity checks, and `clawdsh doctor` repair operation belong to the public-distribution CLI.

The detailed ownership and verification rationale lives in the implemented [ClawDSH product-shell Agent Note](../../.agents/notes/implemented/architecture/2026-08-15-clawdsh-product-shell.md) and [Settings control-plane decision](../../.agents/notes/implemented/feature/2026-08-15-clawdsh-settings-control-plane.md).

## Consequences

- ClawDSH gains a stable product identity and an independently evolvable Settings and Activity experience while retaining the complete dsh conversation runtime.
- The Harness native frame and its built-in diagnostic entries remain visible inside the v1 Conversation destination. Harness Advanced opens that same native application directly as a full page at `/`; a future Chat-only experience without the inner frame requires a new architecture decision.
- The repository owns and tests one additional Web application shell and control runtime. Their compatibility must be pinned to the public dsh browser APIs they consume.
- The product and advanced routes share one Host process and persistence, but they may have separate page-local UI state.
- Capability switches describe ClawDSH behavior. They do not expose unrestricted Cordis Loader mutation.
- Channel Core is not a required canonical capability: it exists only inside the default-disabled legacy group. When that legacy opt-in is present, Gateway startup and Settings preflight reject canonical enablement.
- The managed `clawdsh` preset temporarily lives in dsh's user preset root. ClawDSH Settings offers no delete action, while the unmodified Harness preset manager can still delete it as a user preset; the public-distribution `clawdsh doctor` repairs that state explicitly.
- The product shell owns routing, navigation, capability Settings, and semantic Activity. Activity is bounded, privacy-limited, and fail-open rather than an authoritative replacement for Session history or raw Trajectory.

## Alternatives

- **Keep the stock dsh GUI with only a ClawDSH preset (rejected)**: it runs the capabilities but cannot own product navigation, complete ClawDSH settings, provenance, dependency state, or semantic activity, and it keeps conflating profile and preset lifecycles.
- **Fork or directly modify the dsh GUI (rejected)**: this duplicates upstream UI ownership, expands every upstream sync conflict, and violates the repository's upstream-read-only rule.
- **Implement every ClawDSH page as a new Client Slot contribution (rejected for v1)**: top-level product navigation is application composition rather than a reusable Harness feature, and the static shipped roster belongs to dsh. ClawDSH will not falsify that catalog or modify it locally.
- **Reimplement Chat and Session state (rejected)**: streaming, reconnect, approvals, paging, persistence, and tool presentation already have one owner in dsh and would otherwise acquire divergent behavior.
- **Extract or hide a Chat-only subtree with private imports, private Slots, or CSS (rejected)**: the public renderer owns the complete Harness root. v1 accepts that root inside Conversation; if that product tradeoff becomes unacceptable, this GUI work must stop and be redesigned without upstream modification.
- **Use the `standard` preset to represent pure Harness (rejected)**: Host-plane ClawDSH plugins remain mounted, so the label would promise a lifecycle change that did not occur.
- **Replace raw Trajectory with Activity (rejected)**: semantic explanation cannot substitute for the ordered Session and request evidence needed for diagnosis.
