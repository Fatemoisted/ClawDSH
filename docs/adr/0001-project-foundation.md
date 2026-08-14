# ADR-0001: Project foundation shape — non-Fork local clone + upstream remote + monorepo extension

English | [中文](0001-project-foundation.zh.md)

- **Status**: Accepted
- **Date**: 2026-08-14
- **Decider**: Project initiator

> ADR convention: one decision per file, numbering increments; must contain four sections — Context / Decision / Consequences / Alternatives. Any new seam or architecture-level change must go through an ADR.

## Context

We are rebuilding OpenClaw's feature set on top of DeepSeek Harness (dsh). dsh is a pnpm monorepo (`vendor/` + `packages/*/*` + `apps/`); our own plugins must be placed in its workspace to reuse the type system, build chain, and profile mechanism.

Constraint: the initiator requires **no Fork** (a GitHub Fork cannot be set Private), so clone the official repository directly, then push to a private remote later.

## Decision

1. **Repository shape**: `git clone` the official repository directly to local `/Users/mac/ClawDSH`, rename `origin` to `upstream`; add `origin` later when the user creates a private remote (`git remote add origin <private-repo> && git push -u origin <branch>` — pushing a non-fork clone to a newly created empty repository is fully legitimate and can be set Private).
2. **Branch strategy**: `master` only mirrors upstream (fast-forward, direct commits forbidden); all our work is committed on the `clawdsh` branch, periodically `rebase upstream/master`. This keeps upstream sync always fast-forward, with conflicts appearing only on our own branch.
3. **Physical isolation**: product runtime code remains under `packages/openclaw/`; assembly and records live under `tools/`, `docs/{adr,specs,matrix,standards,journal}/`, and `.github/workflows/clawdsh-*`. Cross-cutting upstream files change only at explicit build, catalog, constraint, and release extension points needed to make that isolated code testable and distributable.
4. **Brand-layer overlay + additive orchestration exemptions**: a pinned brand section (README/CLAUDE.md→AGENTS.md symlink) is allowed, as are narrowly scoped root/package scripts and registration points for `@clawdsh/*`. These include TypeScript/build inputs, generated catalog/graph roots, workspace constraints, and the separate `clawdsh` release family (ADR-0004); existing upstream family members and behavior must not be renamed or semantically rewritten. On an upstream sync, start from the upstream version of each conflicted extension point, then replay and re-run the downstream gates. Upstream internal package names stay `@deepseek-ai/*` unchanged.
5. **Baseline pinning**: record the current upstream baseline commit (2026-08-14: `47f943859b`, v0.1.0-rc.5), update the baseline record on each sync (see `docs/standards/upstream-sync.md`).
6. **Skeleton stage not wired into the workspace**: `packages/openclaw/*` skeletons contain no `package.json` (the template is stored as `.tpl`), guaranteeing upstream `pnpm install/build/typecheck` stays all green; wire into the workspace per template at implementation time.

## Consequences

- ✅ Upstream rebase minimizes the zero-conflict surface; privatization has no obstacles; the build chain stays forever green.
- ⚠️ The brand section will produce a one-time conflict each time upstream changes README/AGENTS — low cost but unavoidable.
- ⚠️ Once upstream restructures the `packages/*/*` glob or build scan approach, revisit this decision (checkpoint: each sync).

## Alternatives

- **GitHub Fork (rejected)**: cannot be set Private, violating the initiator's constraint.
- **Independent repository depending on published npm packages (rejected)**: dsh is in developer preview; published-artifact API drift is harder to track than source sync, and the reuse advantage of profile/patch and the type system is lost.
- **git subtree/submodule import of upstream (rejected)**: dsh's pnpm workspace requires upstream and downstream packages to resolve within a single workspace; subtree's merge noise and submodule's pointer overhead are both less simple and reliable than "direct clone + branch strategy".
