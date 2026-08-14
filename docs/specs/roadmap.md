# ClawDSH project purpose and implementation plan

English | [中文](roadmap.zh.md)

> This document is ClawDSH's charter: it answers "why build it, what to build, how to build it". Decision details are in `docs/adr/`, feature alignment in `docs/matrix/parity.md`, standards in `docs/standards/`.

## 1. Project purpose

**ClawDSH = OpenClaw's personal-assistant feature set, rebuilt on DeepSeek Harness (dsh)'s Cordis plugin foundation.**

The essence of OpenClaw's predicament is not "too many community PRs" but an **architecture without seams**: no community feature can land as a plugin, so they keep piling into the core, driving coupling out of control, making the code unmaintainable, and finally collapsing.

dsh's Cordis architecture (everything is a plugin: plugins declare dependencies via `inject`, collaborate through typed events, and mount/unmount reversibly) fixes this at the architectural level: **each community feature is an independent plugin, and adding a capability no longer touches the core**. Users freely compose the personal Agent they want through the profile/patch mechanism.

## 2. Core principles (non-negotiable)

1. **Upstream read-only**: dsh upstream code (`vendor/`, `packages/*` (except openclaw/), `apps/`, `website/`) untouched by a single line; all customization goes through plugins, profile, patch.
2. **Upstream-first**: when a seam is missing, first raise a PR upstream, bridge locally with a patch, and delete the patch after upstream merges (avoiding a fork's death).
3. **Port the feature category, not the PR**: of OpenClaw's tens of thousands of PRs, most are bugfix/refactor/duplicate features; we want 20~40 feature domains.
4. **Vertical slice first**: each phase must have "something runnable", no big-and-complete fantasy.
5. **Anti-OpenClaw-disease**: any PR must link a spec + update the matrix + pass contract tests before merging (see `docs/standards/pr-policy.md`).

## 3. Implementation phases

### Phase 0 · Feasibility Spike ✅ (completed 2026-08-14)

- Output: feature alignment matrix v1; the `@clawdsh/dsh-soul` plugin (replace/append dual mode + soul-file loading).
- Exit criteria **all met**: soul can replace/overlay the agent system prompt (contract tests 10/10), hot-plug (unload rolls back), no upstream source line changed (build-registration exemption only, see ADR-0001 decision 4); full typecheck green; `--profile openclaw --dump-config` smoke passed.
- **Conclusion: the seam hypothesis holds, the project continues.** Verification details in docs/specs/feature-soul.md's acceptance-criteria section.

### Phase 1 · Baseline selection + matrix finalization ✅ (completed 2026-08-14)

- **Baseline finalized: `v2026.1.5` (`197b8f7c3b`)** — the first release tag, complete gateway + 5 channels + cron + sessions core experience, the thinnest codebase of all tags (1537 files/1.6MB), no bloat signs; from v2026.1.15 file count doubles and extensions/plugins/deploy matrix appear. Feature-completion reference: whatsapp/memory/channels → v2026.1.15 (`9c4c9c5edd`).
- Feature-domain four-way classification finalized, see `docs/matrix/parity.md` (matrix v2, with each feature domain's baseline-source path).

### Phase 2 · Core skeleton (vertical slice)

- `channel-core` (new seam, per ADR-0002) + `channel-telegram` (first channel) + **`channel-feishu` (initiator's first priority, ADR-0002 seam-verification alternate channel)** + `soul` + `memory` + `preset-openclaw`.
- Exit criteria: `pnpm dsh --profile openclaw` starts, Telegram message in → personalized agent runs → reply out; the `ctx.channels` contract passes verification through both the Telegram and Feishu adapters (Feishu source: OpenClaw `extensions/feishu`, v2026.2.12).

### Phase 3 · Channel rollout + automation

- One package per channel (WhatsApp/Email/Web Chat…), none blocking each other; `automation` (schedule bridging), `skills-hub` (ClawHub provider).
- **Channel-scope principle**: only build channels that have a source in OpenClaw upstream (see docs/matrix/parity.md "Domestic platforms" section) — WeChat-family/DingTalk/QQ have no upstream counterpart, not implemented.
- Federation node (clawd) goes over `ctx.subagents` transport, evaluated as an independent milestone.

### Phase 4 · Ecosystem

- Plugin development template + contract docs published; joins dsh's `dsh-plugin` discovery mechanism; migration guide for old OpenClaw users (session/skill import).

### Throughout

- Upstream sync CI (weekly rebase + smoke); milestone feature freeze (bug fixes only, no new features).

## 4. Success criteria

1. One community feature = one plugin package, merging touches no core — OpenClaw's death mode is architecturally impossible;
2. Users can freely compose channels/persona/memory/automation from a single config and get their own personal Agent;
3. Net divergence from dsh upstream trends to zero (everything upstreamable is upstreamed).

## 5. Open items

- [ ] OpenClaw baseline commit (Phase 1 first task)
- [x] Soul Spike conclusion (✅ feasible, continue)
- [ ] Whether the `ctx.channels` seam is accepted by dsh upstream (affects patch-layer thickness)
- [x] Private remote repo creation (Fatemoisted/ClawDSH, completed 2026-08-14)
