# ADR-0006: Formally publishable open-source — ClawDSH as protagonist

English | [中文](0006-open-source-posture.zh.md)

- **Status**: Accepted (2026-08-14)
- **Date**: 2026-08-14
- **Depends on**: ADR-0001 (brand/build exemption), ADR-0004 (npm publishing)
- **Distribution clauses superseded by**: ADR-0009 (2026-08-15)

ADR-0009 supersedes decision 5, the related private-registry consequences, and the public-npm alternative. The source, license, attribution, and contribution posture in this ADR remains current; making the repository public still requires separate user authorization.

## Context

Phase 4 ("用户生态") makes ClawDSH a project with users. For a stranger to adopt it, the repository must read as **ClawDSH's project** — a rebuild of OpenClaw's personal-assistant feature set on DeepSeek Harness (dsh) — not as DeepSeek's repo with some private plugins bolted on. Today three root files still say otherwise: `CONTRIBUTING.md` carries upstream's "we cannot accept external pull requests at the moment"; `LICENSE` is `Copyright (c) 2026 DeepSeek` only; root `package.json` has `"name": "clawdsh"` but no `homepage`/`bugs`/`repository`. Separately, several own docs are stale (the ❌ rows in `docs/specs/product-chain.md`): a reader following `packages/openclaw/README.md`, `docs/matrix/parity.md`, `AGENTS.md`, or `docs/specs/roadmap.md` would be actively misled about what is shipped.

This ADR commits the repository to a formally publishable open-source posture and records the exact upstream dispositions and cleanup items that posture requires. It governs **source + license + contribution posture**, not the npm distribution surface, which ADR-0004 already governs.

## Decision

1. **Open-source posture is the Phase 4 target.** ClawDSH is the protagonist of the repository; upstream `deepseek-ai/deepseek-harness` (git remote `upstream`) stays attributed and tracked. "Publishable" means a stranger can read the README, LICENSE, and CONTRIBUTING and correctly attribute the project, without any upstream file being rewritten beyond the existing ADR-0001/ADR-0004 exemptions and the three new ones below.

2. **Three new upstream dispositions (exemptions).** Going open-source requires three additional upstream-file touches, each additive and rebase-replayable:
   - `CONTRIBUTING.md` / `CONTRIBUTING.zh.md`: add a ClawDSH brand section above the upstream text, and extend the ADR-0001 brand-editable list to include CONTRIBUTING. The upstream body ("we cannot accept external pull requests") is factually wrong for a project now open to contributions; it stays as a quoted upstream remainder below the brand section.
   - `LICENSE`: append `Copyright (c) 2026 ClawDSH contributors` below the retained upstream `Copyright (c) 2026 DeepSeek` line. MIT is inherited from upstream; a derivative keeps both notices.
   - root `package.json`: add `homepage` / `bugs` / `repository` pointing at `github.com/Fatemoisted/ClawDSH` (the `@clawdsh/*` manifests already carry this per ADR-0004).

3. **Stale-doc cleanup is publish-gating.** The ❌ inconsistencies from the product-chain ledger — `packages/openclaw/README.md` roster (skills-hub/automation still "planning", automation seam mislabeled), `docs/matrix/parity.md` federation row, `AGENTS.md` stage marker, `docs/specs/roadmap.md` Phase 3 marker — are not optional: they actively mislead. They land before the first public release, together with the ⚠️ reconcile item (embeddings-ark e2e claim, which contradicts between two own docs).

4. **Ratify the own-content surface list.** Reconcile ADR-0001 decision 3 with the CLAUDE.md brand section: add `docs/upstream-proposal/` to the physical-isolation list (the directory postdates that decision), and enumerate `.agents/notes/` as the append-only own-notes surface (date-stamped, rebase-clean). Both are de-facto already in use; this makes the list authoritative.

5. **Decouple npm registry from open-source.** This ADR does not reopen ADR-0004's private-registry decision. The `@clawdsh/*` npm surface stays private until the initiator separately decides public npm; source openness and registry reach are orthogonal.

## Consequences

- ✅ A stranger can correctly attribute the project and contribute without being told "no PRs"; upstream stays rebase-clean (three more additive edits, replayed like ADR-0001/ADR-0004).
- ⚠️ `CONTRIBUTING`, `LICENSE`, and root `package.json` become (c)-class upstream edits — replayed on every upstream sync, same as the tsconfig registration points.
- ⚠️ The repository is open-source while the npm registry stays private (ADR-0004); the split must be documented clearly so the posture is not misread as public npm distribution.
- ⚠️ The cleanup checklist below is a one-time cost; after it lands, `doc-sync` + the translation-pairing gate keep the docs honest.

## Cleanup checklist (pre-publish)

| # | Target file | Action | Reason | Deadline |
|---|---|---|---|---|
| 1 | `packages/openclaw/README.md:40` | skills-hub "planning" → "implemented (phase 3 ✅)" | roster contradicts matrix + code | 发布前必须完成 |
| 2 | `packages/openclaw/README.md:41` | automation "planning" + seam "`ctx.schedule` / `ctx.jobs`" → "implemented (phase 3 ✅, disabled opt-in)" + "`ctx.agents` + `ctx.sessions`" | roster contradicts matrix + code; seam names a rejected seam | 发布前必须完成 |
| 3 | `packages/openclaw/README.md:39` | reconcile embeddings-ark "e2e pending credentials" vs `roadmap.md` "real ARK e2e (tools/ark-e2e.ts)" | two own docs contradict | 发布前必须完成 |
| 4 | `docs/matrix/parity.md:46` | federation name "to be named" → "`clawd-federation`"; status → "ADR-0005 evaluation-only, implementation deferred" | ADR-0005 named it; Phase 3 concluded | 发布前必须完成 |
| 5 | `AGENTS.md:18` (= `CLAUDE.md` symlink) | "当前阶段：阶段 2" → "阶段 4" | stage marker stale | 发布前必须完成 |
| 6 | `docs/specs/roadmap.md:42` | add Phase 3 completion marker ✅ (2026-08-14) | charter has no Phase 3 close-out marker | 发布前必须完成 |
| 7 | `CONTRIBUTING.md` + `.zh.md` | pin ClawDSH contribution brand section; extend brand-editable list (decision 2) | upstream "cannot accept PRs" contradicts open-source | 发布前必须完成 |
| 8 | `LICENSE` | append `Copyright (c) 2026 ClawDSH contributors` (retain upstream MIT, decision 2) | derivative attribution | 发布前必须完成 |
| 9 | root `package.json` | add `homepage` / `bugs` / `repository` → `Fatemoisted/ClawDSH` (decision 2) | publishable package metadata | 发布前必须完成 |
| 10 | `docs/specs/roadmap.md:36` | add Phase 2 header ✅ (align with Phase 0/1) | charter cosmetic consistency | 可延后 |
| 11 | `docs/adr/0001-project-foundation.md` decision 3 | add `docs/upstream-proposal/` to the physical-isolation list (decision 4) | reconcile with CLAUDE.md brand section | 可延后 |
| 12 | `AGENTS.md` brand section | add `.agents/notes/` (append-only own notes) to the own-content list (decision 4) | ratify the de-facto note surface | 可延后 |
| 13 | `docs/specs/` | add dedicated `embeddings` / `embeddings-ark` feature specs (currently grouped under `feature-memory`); canonical channel behavior remains owned by `feature-channel-plane-bridge` | per-plugin spec completeness without reviving direct adapters | 可延后 |

## Alternatives

- **Keep upstream CONTRIBUTING / LICENSE / metadata untouched (rejected)**: a "publishable" project that says "we cannot accept PRs" and copyrights only DeepSeek is not actually publishable as ClawDSH.
- **Carry contribution guidance only in the README brand section (rejected)**: GitHub still surfaces the stale upstream CONTRIBUTING first for contributors; the mismatch is exactly what must be fixed.
- **Re-license (rejected)**: MIT is inherited from upstream; re-licensing the derivative would need upstream permission and serves no Phase 4 goal.
- **Flip the npm registry to public in this ADR (rejected)**: registry reach is a distribution decision, orthogonal to source openness; it stays with ADR-0004.
