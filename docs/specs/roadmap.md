# ClawDSH project purpose and implementation plan

English | [中文](roadmap.zh.md)

> This charter states why ClawDSH exists and how work is sequenced. Decisions live in `docs/adr/`, exact status in `docs/matrix/parity.md`, and operational rules in `docs/standards/`.

## 1. Purpose

**ClawDSH rebuilds OpenClaw's personal-assistant form on DeepSeek Harness's Cordis plugin foundation.** dsh owns Agent execution, Sessions, tools, and composable capability seams; ClawDSH contributes persona, memory, skills, automation, product presentation, and communication-plane integration as isolated packages.

The project keeps community features out of a monolithic core. A feature belongs in one complete capability seam or on an existing seam, declares dependencies, mounts reversibly, logs every model-visible input, and carries its specification and verification evidence with the implementation.

## 2. Principles

1. **dsh upstream stays read-only.** Owned code is confined to `packages/openclaw/`, designated docs, tools, and ClawDSH workflows; root build registrations are narrow ADR-backed additions.
2. **Complete seams only.** A new capability includes a Service Definition, Service Provider, and Consumer. A missing dsh seam requires an ADR and an owned implementation or explicit proposal.
3. **Reuse whole subsystems at the right boundary.** Non-channel features use the early OpenClaw reference where sufficient. Communication follows separately approved current OpenClaw locks because platform reach and security behavior live there.
4. **Immutable inputs and explicit support.** A floating ref is never a deploy dependency. Channel support advances only through `cataloged → installable → certified → enabled`.
5. **Vertical evidence.** Package tests prove local behavior, assembled snapshots prove user-visible composition, and credentialed smoke proves one external transport. None substitutes for another.
6. **ClawDSH is the product.** The local GUI presents ClawDSH by default and keeps the native Harness as an advanced entry point. Switching an Agent preset does not uninstall Host capabilities.
7. **No upstream GUI patch.** The product shell consumes public dsh Web and Host APIs and does not add a Client Slot or modify `api-proxy`, Client Catalog, Agent Loop, generated files, or upstream GUI source.
8. **No premature legacy deletion.** A replacement removes an older path only after equivalent assembly, snapshots, live behavior, and failure handling pass.

## 3. Completed foundations

### Phase 0 · Feasibility spike

The `soul` plugin proves that an owned package can contribute or replace system-prompt sections, unwind through Cordis lifecycle, and compose through a profile without changing upstream Agent code.

### Phase 1 · Feature-domain mapping

The project selected OpenClaw `v2026.1.5` as the compact non-channel reference and classified Sessions, tools, persona, memory, skills, automation, channels, federation, and clients by reuse, plugin, new seam, product assembly, or deferral. Later source references remain allowed where the early tag lacks a selected domain.

### Phase 2 · Personal-assistant vertical slice

`soul`, Memory and Embeddings packages, the internal `preset-openclaw` assembly, and the legacy `channel-core` / Telegram / Feishu path established the first runnable personal-assistant composition. The legacy adapter path demonstrates Session routing but does not establish current channel certification.

### Phase 3 · Local ecosystem plugins

`skills-hub` and opt-in `automation` use existing dsh seams. Channel identity presentation and acknowledgement behavior remain available through the legacy path. Federation remains evaluation-only under ADR-0005.

## 4. Current Phase 4 · Product GUI, channel plane, and distribution

Phase 4 has three parallel workstreams. They share the `clawdsh` product identity and clean-install requirement but have separate evidence.

### 4.1 ClawDSH local GUI

The `clawdsh` profile composes the stock dsh Web application with the owned nested product runtime. The product-shell and Settings slices of [ADR-0007](../adr/0007-clawdsh-local-gui-product.md) are implemented:

- `/clawdsh/` is the default product route; `/` remains native dsh Web and is labeled Harness Advanced.
- Navigation is Conversation, ClawDSH Settings, ClawDSH Activity, and Harness Advanced.
- Conversation reuses the public dsh client plugin graph and renderer; ClawDSH owns the shell, Settings, Activity, and Control Runtime.
- ClawDSH Settings combines the read-only capability and Loader overview with schema-driven mutation, optimistic revisions, desired/runtime state, restart requirements, and secret-free dsh credential metadata.
- ClawDSH Activity follows the current Session and presents privacy-limited Prompt, Memory, Channels, Skills, and Automation records merged from standard history and bounded sidecars; raw Trajectory stays available in Harness Advanced.
- `dsh --profile web` remains a pure Harness entry point.
- The real-profile browser journey starts from a clean home without model keys or OpenClaw artifacts and verifies both routes, all four destinations, mounted Settings namespaces, disabled Gateway state, secret absence, unknown-route handling, and the keyless product snapshot. Focused control-plane tests cover mutation, reset, and stale-revision rejection.

### 4.2 Current channel plane

[ADR-0008](../adr/0008-openclaw-channel-plane.md) locks the production OpenClaw Gateway to `v2026.7.1-2` / commit `0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`, records a source-only canary, and establishes a production catalog of **24 core/bundled/repository-official + 3 external** public chat transports.

The foundation comprises `@clawdsh/dsh-channel`, `@clawdsh/dsh-channel-agent`, `@clawdsh/dsh-channel-openclaw`, and `tools/openclaw-channel-host`. The profile always mounts the three runtime packages; Channel Protocol and Agent Bridge remain available while the OpenClaw Gateway business setting defaults to disabled. No channel is certified or enabled; per-channel assembly, owned keyless snapshot evidence, current live smoke, Windows endpoint authorization, and remaining media support are incomplete.

Channel execution uses only `ctx.channels → channel-agent → channel-openclaw`. Old direct-adapter configuration names remain readable through the migration inventory, but ClawDSH does not load those packages or own platform transports outside OpenClaw.

### 4.3 Public distribution

`tools/link-clawdsh.sh` remains the development installer. The public distribution source provides `@clawdsh/dsh-bundle` and `@clawdsh/cli`, an idempotent managed manifest, `clawdsh doctor`, backup-before-preset-reset, an explicit production-only Channel installer, exact tarball audits, and isolated clean-install smoke. The fixed release set contains exactly [13 packages](../../packages/openclaw/README.md#public-release-set) at `0.1.0-rc.1`; the CLI pins `@deepseek-ai/dsh@0.1.0-rc.6`.

The release workflow targets public npm `next` through OIDC trusted publishing with provenance and never accepts an arbitrary registry or long-lived npm token for a routine release. The current state is `bootstrap-required`, not `OIDC-ready`: all thirteen package names are absent, while npm trust and staged publishing require an existing package. A separately authorized interactive 2FA bootstrap must create the package objects before every trust record can be bound to `clawdsh-publish.yml`, environment `npm`, and `npm publish`. The GitHub `npm` environment must then admit only branch `clawdsh`, and release readiness requires the canonical ref `refs/heads/clawdsh`. This preparation performs none of those external writes.

## 5. Work sequence

### Product GUI sequence

1. ✅ The nested ClawDSH Web entry, product runtime, `/clawdsh/` routes, four-destination navigation, capability overview, and keyless real-profile journey are implemented.
2. ✅ Schema-driven Settings, credential references, optimistic revision checks, desired/runtime state, restart requirements, and dedicated Automation and Gateway editors are implemented.
3. ✅ Current-Session Activity uses bounded, permission-restricted sidecar JSONL plus fallback projection from standard Session history.
4. Preserve the native GUI, raw Trajectory, and `dsh --profile web` throughout browser and real-profile regression tests.

### Channel sequence

1. Maintain the reproducible production host and bridge assembly, including sole-AgentHarness routing and exact runtime inspection.
2. Add the owned keyless Gateway-to-Agent snapshot lane and close protocol, recovery, delivery, action, and attachment evidence gaps.
3. Run per-channel certification, starting with Telegram and Feishu, and record exact host, channel, OS, and live-traffic evidence.
4. Enable only certified combinations, then remove legacy packages and archive their Agent Notes in the same change.
5. Promote further production catalog entries in cohorts based on ecosystem value, credential availability, platform risk, and external-package review.

### Distribution sequence

1. ✅ Package the profile, presets, Control Runtime, GUI assets, locked Channel assets, and exact feature dependencies in the ClawDSH bundle.
2. ✅ Provide the managed CLI, production-only Channel installer, exact 13-package packer, tarball verifier, temporary-registry smoke, and public npm OIDC/provenance workflow.
3. Select and separately authorize a one-time bootstrap archive and version, then create all thirteen package objects through an interactive 2FA publication; staged publishing cannot create a brand-new package, and bootstrap must not silently consume the intended OIDC candidate version.
4. Configure and verify all thirteen npm trusted-publisher records for `clawdsh-publish.yml`, environment `npm`, and `npm publish`, and restrict that GitHub environment to branch `clawdsh`.
5. Publish the approved candidate to public npm `next` from `refs/heads/clawdsh` only after public-source provenance, exact dsh compatibility, and release authorization pass.

## 6. Success criteria

1. A clean dsh home starts `/clawdsh/` without channel credentials and defaults new Sessions to `ClawDSH 模式`.
2. Conversation, ClawDSH Settings, ClawDSH Activity, and Harness Advanced are reachable while pure `dsh --profile web` behavior remains unchanged.
3. ClawDSH capability settings are schema-driven, conflict-safe, credential-redacted, and honest about restart requirements and runtime state.
4. Activity explains ClawDSH Prompt, Memory, Channels, Skills, and Automation behavior without claiming to reconstruct the final flattened prompt or replacing raw Trajectory.
5. One approved OpenClaw production host exposes the stable 27-entry catalog without copying platform SDK integrations into ClawDSH.
6. No OpenClaw model fallback can answer a channel turn, and repeated input or ambiguous delivery cannot silently duplicate Agent or delivery side effects.
7. Support labels correspond to evidence, and a shipped profile activates only certified host-and-channel combinations.
8. Public installation is exact, idempotent, recoverable, and preserves user settings, credentials, memory, skills, and custom patches.

## 7. Open conditions

- [x] Implement the ClawDSH product shell and read-only capability overview.
- [x] Implement the Settings control plane and credential-safe mutation flow.
- [x] Implement semantic Activity and sidecar degradation behavior.
- [x] Add owned real-profile browser and keyless snapshots for the product shell.
- [ ] Add per-channel configuration, capability probes, and keyless contract evidence before promoting any production entry to installable.
- [ ] Complete fresh Telegram and Feishu certification; neither is certified or enabled.
- [ ] Add Windows named-pipe ACL enforcement before Windows channel support advances.
- [ ] Add durable non-image attachments and outbound staging before advertising those media paths.
- [ ] Add an ignorable Session append mechanism before persisting redundant `channel/*` events.
- [x] Remove the direct channel packages so the runtime has one channel execution path.
- [x] Prepare the exact 13-package bundle, managed CLI, tarball verification, isolated install smoke, and OIDC/provenance workflow without publishing.
- [ ] Obtain explicit authorization for the one-time interactive 2FA bootstrap, including its exact archives and version, and create all thirteen package objects without treating staged publishing as an initial-creation path.
- [ ] Configure and verify all thirteen npm trust records plus the `npm` environment branch rule for `clawdsh`; until then the workflow is not `OIDC-ready`.
- [ ] Confirm scope ownership, public-repository approval, canonical `refs/heads/clawdsh`, and exact-version compatibility before an OIDC publication.
