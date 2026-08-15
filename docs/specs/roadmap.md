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

The preset-only dsh Web baseline uses the `clawdsh` profile and `clawdsh` preset, displayed as `ClawDSH 模式`. [ADR-0007](../adr/0007-clawdsh-local-gui-product.md) defines the accepted product shell:

- `/clawdsh/` is the default product route; `/` remains native dsh Web and is labeled Harness Advanced.
- Navigation is Conversation, ClawDSH Settings, ClawDSH Activity, and Harness Advanced.
- Conversation reuses the public dsh client plugin graph and renderer; ClawDSH owns the shell, Settings, Activity, and Control Runtime.
- Settings project allowlisted ClawDSH capability schemas, credential presence, revisions, and restart requirements without exposing arbitrary Loader mutation.
- Activity gives a semantic view of Prompt, Memory, Channels, Skills, and Automation while raw Trajectory remains available in Harness Advanced.
- `dsh --profile web` remains a pure Harness entry point.

### 4.2 Current channel plane

[ADR-0008](../adr/0008-openclaw-channel-plane.md) locks the production OpenClaw Gateway to `v2026.7.1-2` / commit `0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`, records a source-only canary, and establishes a production catalog of **24 core/bundled/repository-official + 3 external** public chat transports.

The foundation comprises `@clawdsh/dsh-channel`, `@clawdsh/dsh-channel-agent`, `@clawdsh/dsh-channel-openclaw`, and `tools/openclaw-channel-host`. The profile assembles the three runtime packages in a default-disabled group. No channel is certified or enabled; per-channel assembly, owned keyless snapshot evidence, current live smoke, Windows endpoint authorization, and remaining media support are incomplete.

The legacy channel packages remain separately available under `ctx.legacyChannels` for replacement verification. They must not connect to the same platform accounts as the OpenClaw communication plane and are removed only after the replacement conditions pass.

### 4.3 Public distribution

`tools/link-clawdsh.sh` is the development installer. It installs only `clawdsh` identities, warns about legacy `openclaw` profile and preset assets, and leaves them untouched. The public distribution work owns an idempotent CLI, exact dsh and ClawDSH bundle versions, a managed manifest, `clawdsh doctor`, preset backup and repair, clean-home smoke, and public npm provenance.

## 5. Work sequence

### Product GUI sequence

1. Build the nested ClawDSH Web entry, Control Runtime, `/clawdsh/` routes, product navigation, and read-only capability overview.
2. Add schema-driven Settings, credential references, optimistic revision checks, desired/runtime revision display, restart requirements, and the dedicated Automation editor.
3. Add current-Session Activity with bounded, permission-restricted sidecar JSONL plus fallback projection from standard Session history.
4. Preserve the native GUI, raw Trajectory, and `dsh --profile web` throughout browser and real-profile regression tests.

### Channel sequence

1. Maintain the reproducible production host and bridge assembly, including sole-AgentHarness routing and exact runtime inspection.
2. Add the owned keyless Gateway-to-Agent snapshot lane and close protocol, recovery, delivery, action, and attachment evidence gaps.
3. Run per-channel certification, starting with Telegram and Feishu, and record exact host, channel, OS, and live-traffic evidence.
4. Enable only certified combinations, then remove legacy packages and archive their Agent Notes in the same change.
5. Promote further production catalog entries in cohorts based on ecosystem value, credential availability, platform risk, and external-package review.

### Distribution sequence

1. Package the profile, presets, Control Runtime, GUI assets, and exact feature dependencies in the ClawDSH bundle.
2. Publish the CLI and owned packages as `0.1.0-rc.1` to the public npm `next` tag only after scope ownership, public-source provenance, and exact dsh compatibility pass.
3. Prove clean installation, second-run idempotency, user-change preservation, tarball integrity, and absence of private registry, workspace, file, or symlink references.

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

- [ ] Implement the ClawDSH product shell and read-only capability overview.
- [ ] Implement the Settings control plane and credential-safe mutation flow.
- [ ] Implement semantic Activity and sidecar degradation behavior.
- [ ] Add owned real-profile browser and keyless snapshots for the product shell.
- [ ] Add per-channel configuration, capability probes, and keyless contract evidence before promoting any production entry to installable.
- [ ] Complete fresh Telegram and Feishu certification; neither is certified or enabled.
- [ ] Add Windows named-pipe ACL enforcement before Windows channel support advances.
- [ ] Add durable non-image attachments and outbound staging before advertising those media paths.
- [ ] Add an ignorable Session append mechanism before persisting redundant `channel/*` events.
- [ ] Remove legacy channel packages only after all replacement conditions pass.
- [ ] Complete public npm ownership, provenance, exact-version compatibility, and clean-install smoke before publishing.
