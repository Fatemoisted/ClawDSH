# Agent Note: ClawDSH native Slot integration

Status: implemented

English | [中文](2026-08-16-clawdsh-native-slot-integration.zh.md)

This decision refines [ADR-0007](../../../../docs/adr/0007-clawdsh-local-gui-product.md) and partially supersedes the earlier product-shell choices to own a second top-level navigation and avoid Client contributions in the [product-shell decision](2026-08-15-clawdsh-product-shell.md). That note remains authoritative for the profile boundary, control plane, Settings mutation rules, Activity storage, and privacy model.

## Problem

Wrapping the complete Harness application in a second ClawDSH sidebar duplicated Conversation, Settings, and diagnostic navigation. The two columns consumed space, presented Loader state as product readiness, and forced ClawDSH pages to obtain the selected Session or switch native views from outside their owners. A DOM bridge based on localized tab text could appear to connect Activity and Trajectory, but it was not a supported API and could select the wrong view after an upstream or locale change.

Native Settings sections unmount when users close the panel or select another section. Component-local drafts therefore cannot preserve unsaved capability changes, and durable browser storage is unacceptable for credential values. The UI also needs to distinguish package loading, business enablement, configuration completeness, and verified use without changing the frozen protocol-v1 responses.

## Decision

`/clawdsh/` renders one complete `buildRenderApp()` tree inside a minimal root container. ClawDSH removes its outer navigation and contributes only to five existing public Slots: `conversation.hero.agentPreset`, `sidebar.footer.action`, `settings.section`, `conversation.view`, and `conversation.chat.node`. The contributions fix the product identity, add the full-page Harness Advanced link, place ClawDSH first in native Settings, add `ClawDSH 记录` after Trajectory, and present Channel context through the standard Chat node. No contribution imports an upstream `src/*` path, registers a new Slot, searches localized DOM text, or simulates a click.

The product root retains the stable `[data-variant='think']` presentation rule, while Harness owns AppFrame, the sidebar, Session history, Chat, Settings chrome, Trajectory, the composer, and all associated React state. Opening or closing Settings does not remount that native application. `/clawdsh/settings` and `/clawdsh/activity` are one-cycle HTTP 308 aliases to `/clawdsh/`; protocol-v1 route fields remain unchanged until a separate versioned removal.

The minimal entry chunk loads the complete Client entry asynchronously. A failure while loading that chunk, materializing the public Client kernel, or parsing the boot manifest disposes any partial entry and replaces the mount with a dependency-free branded alert. Failures after the kernel signals exist continue through the normal branded loading gate. Both paths expose only stable ClawDSH error codes: the unknown exception, stack, path, and possible credential text never enter the DOM or browser console. The packed-product browser smoke must execute this path rather than treating an HTML response as successful startup.

The rc.6 static fallback does not assign a PNG media type. The product Host therefore owns exact GET/HEAD routes for the three raster icons named by its Web manifest and responds with `image/png`; every other product asset continues through the shared static server. These fixed routes are a release compatibility layer and can disappear when the published static server owns PNG MIME.

The published Settings shell currently exposes no responsive-layout seam. Below 600 px, a product-scoped compatibility rule uses the shell's semantic `role="dialog"`, `aria-modal`, and direct `nav` structure to stack navigation above content, and lifts the collapsed sidebar's clipping only while that dialog is present. This narrow exception changes no upstream source, does not hide or replace Harness identity, and is covered by the real-profile mobile journey. It must be removed when an upstream responsive Settings seam is available; other native DOM structure remains outside the product interface.

### Settings lifetime and evidence

A store created by the ClawDSH Client plugin owns Settings snapshots, namespace and credential drafts, save and conflict state, disclosure state, and dirty keys. The store outlives each `settings.section` mount, owns the `beforeunload` listener, and is disposed with the plugin. It writes no browser or Session persistence. Credential text exists only in private memory and the outgoing request, and is erased after success, failure, explicit clearing, or plugin disposal.

The browser derives presentation from existing `capabilities/list`, `settings/describe`, and `credentials/describe` responses. Mounted means implementation evidence exists, enabled means the business effect runs, configured means required local settings or credentials are present, and verified means direct execution evidence exists. The UI does not infer verified state. Unknown or malformed evidence yields `状态未知` instead of failing the complete section.

Soul, Memory, Skills Hub, Channels, and Automation are the five user features. Activity and component/package/Loader evidence are implementation details. Memory groups Ark Embeddings as semantic-search configuration rather than a second feature. Channels groups Agent Bridge and OpenClaw Gateway. Safe defaults remain visible as neutral product states: an unstarted Gateway means no platform is connected, and disabled Automation with no rules creates no scheduled work.

### Session records

The records contribution receives its Session id from the session-scoped `conversation.view` Slot. Session changes and view unmount abort old Activity requests and clear continuation. Prompt, Memory, Channels, Skills, and Automation filters retain source-specific availability and empty explanations. The corresponding event order remains available in folded technical details but has no navigation behavior because the public view API exposes no Session-sequence focus operation.

## Alternatives considered

**Keep the second product sidebar.** It can own arbitrary routes, but duplicates native controls, reduces usable width, and creates another lifecycle around the authoritative Session application.

**Open a separate ClawDSH Settings overlay.** It preserves drafts easily but leaves two Settings entry points and duplicates modal, focus, and accessibility behavior already owned by Harness.

**Persist drafts in local or Session storage.** Persistence would survive remounts, but credential text must not enter durable storage and namespace drafts would need a new invalidation and migration policy. A plugin-lifetime memory store covers the required UI lifecycle.

**Navigate to Trajectory through DOM selectors or add a local upstream patch.** Selectors are not an API, and a patch would violate upstream ownership. The adjacent native tab remains the only navigation until a public focus API exists; folded sequence metadata makes no stronger promise.

**Add readiness fields to protocol v1.** The existing responses already carry the available evidence. Reinterpreting them in a pure browser presenter avoids a wire change and prevents guessed remote readiness from becoming a protocol claim.

## Verification

Focused browser tests pin the five Slot registrations, single native root, wide and rail footer action, first Settings ordering, store lifetime, unload protection, credential cleanup and disposal, status matrix, conservative fallback, third-tab Session binding, cancellation, pagination, source-specific availability, and category-specific empty copy. Runtime tests pin legacy redirects, query preservation, method rejection, and unknown product paths. Static assertions reject private imports and DOM navigation bridges.

The normal `clawdsh` profile is exercised in the browser at desktop, rail, and narrow widths. Verification covers one sidebar, the native ClawDSH Settings section, five clean-install states, adjacent Conversation/Trajectory/Records tabs, records produced by a real Session, legacy redirects, product 404, and browser console output.

Bootstrap tests inject entry-chunk and boot-manifest failures and require the branded alert after partial-state disposal. Sentinel credentials and local paths prove that bootstrap, disposal, and ordinary plugin failures disclose only stable codes in the DOM and console. The packed-product smoke launches Chromium, waits for the settled native root and footer, and rejects page exceptions, console errors, failed product requests, and error responses.

## Consequences

ClawDSH gains a smaller information architecture and keeps one owner for Session and modal state. Product features depend on the stability of five published Slot contracts and the complete-root renderer. Only the temporary narrow-screen Settings compatibility rule depends on semantic native dialog structure.

Unsaved drafts last only for the current browser process and plugin lifetime. This deliberately avoids recovery after a reload in exchange for keeping credential text out of durable storage. Sequence labels correlate records with Session order but do not offer a deep link into Trajectory.
