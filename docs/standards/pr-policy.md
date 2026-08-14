# PR policy (anti-OpenClaw-disease)

English | [中文](pr-policy.zh.md)

> OpenClaw's death mode: community PRs flood the core without a gate, features stack up without specs, and no one owns regressions. This policy makes all of it impossible **by process** — the architecture, Cordis, has already made it hard.

## Merge gate (four rules, all required)

1. **Spec link**: the PR must link `docs/specs/feature-*.md` or the corresponding ADR; a new feature without a spec writes the spec before the code (spec = five sections: goals / non-goals / seam / config surface / acceptance criteria).
2. **Matrix sync**: a PR that changes a feature domain must update `docs/matrix/parity.md` in the same change (add / reclassify / advance status).
3. **Contract tests**: provide contract tests + profile smoke per section 6 of `docs/standards/plugin-contract.md`.
4. **Boundary declaration**: the PR description must state "which upstream files were changed (should be empty or only the brand section)" — **any PR touching upstream core code is rejected and steered toward a plugin/ADR approach**.

## Explicitly rejected types

- Functional changes that directly modify `packages/*` (except openclaw/), `vendor/`, `apps/`, `website/`;
- A "plugin" implemented by importing upstream internals rather than going through a seam;
- Channel/capability integrations that bypass the new-seam admission process;
- Duplicate features: check the matrix first; if a similar package already exists, change the PR into an improvement PR against the existing package.

## Milestone freeze

- At the close of each milestone (a roadmap phase), **feature freeze**: only bug fixes and contract fixes; new features go into the next milestone;
- During the freeze, community PRs are parked with the `next-milestone` label, **neither closed nor merged** — this is the most direct answer to the OpenClaw lesson: PRs can wait, the core cannot rot.

## Commitment to OpenClaw ecosystem compatibility

- Feature proposals from the OpenClaw community are welcome: translating them into "spec + plugin package" form is our core value;
- Proposal translation template: the "OpenClaw correspondence" section of `docs/specs/feature-*.md` must state the source (PR/issue link or feature name) to guarantee traceability.
