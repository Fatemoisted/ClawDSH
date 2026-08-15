# ADR-0010: Contract-first Harness reuse

English | [中文](0010-harness-contract-first.zh.md)

- **Status**: Accepted (2026-08-15)
- **Date**: 2026-08-15
- **Depends on**: ADR-0001 (upstream isolation)

## Context

ClawDSH is an additive plugin layer over DeepSeek Harness. Harness already documents its runtime composition, package groups, subsystem APIs, events, capability seams, generated catalogs, and dependency graphs. Re-reading all Harness implementation code for each ClawDSH feature repeats discovery work, encourages dependencies on concrete providers, and makes reviews depend on undocumented knowledge.

An absolute ban on reading Harness source would also be unsafe. Public documentation cannot describe every internal failure, lifecycle race, security condition, performance property, or breaking upstream change. Source inspection remains necessary when a documented contract is missing or appears incorrect.

## Decision

1. **Harness documentation is the default development interface.** Ordinary ClawDSH work starts with `docs/architecture.md`, `packages/README.md`, the owning `docs/subsystems/` page, generated catalogs/graphs, and the owning package README.
2. **ClawDSH records only its integration view.** `docs/matrix/harness-reuse.md` maps each owned package to the Harness services, events, libraries, and platform components it reuses. It links upstream-owned references instead of copying their package or API catalogs.
3. **Owned plugins depend on public contracts.** They consume documented `ctx.*` services, events, public types, and maintained SDKs. They do not import or copy a concrete Harness provider merely to reuse its implementation.
4. **Source inspection is an explicit exception.** Maintainers inspect the owning Harness source when diagnosing an internal bug, security/concurrency/performance behavior, an undocumented contract, a missing seam, or an upstream breaking change. A missing contract found this way is added to the owning ClawDSH map, specification, or ADR in the same change when it affects future integration work.
5. **Missing capabilities follow the existing ADR path.** A feature first uses an existing Harness seam. If no suitable seam exists, development stops at an ADR and follows the admission rule in `docs/standards/plugin-contract.md`; it does not bypass the gap with a private copy of Harness internals.

## Consequences

- Ordinary feature work can select proven Harness components without traversing the full upstream source tree.
- Reviews can verify dependencies against stable service/event contracts and the ClawDSH reuse map.
- Generated Harness references remain the detailed source of truth, avoiding a second hand-maintained catalog in the root README.
- Maintainers still need source-level investigation for defects and undocumented behavior; this decision changes the default path, not the available evidence.

## Alternatives

- **Copy every Harness module into the ClawDSH README (rejected)**: a manual duplicate of hundreds of packages and APIs would drift and violate the repository's one-home-per-fact documentation rule.
- **Never read Harness source (rejected)**: lifecycle, security, concurrency, performance, and defect diagnosis cannot be made reliable from summaries alone.
- **Start every feature with source exploration (rejected)**: this ignores the existing contract documentation and makes concrete implementation details the accidental integration interface.
