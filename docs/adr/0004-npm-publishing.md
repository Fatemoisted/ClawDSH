# ADR-0004: npm publishing — private registry surface for the `@clawdsh/*` packages

English | [中文](0004-npm-publishing.zh.md)

- **Status**: Accepted (2026-08-14)
- **Date**: 2026-08-14
- **Depends on**: ADR-0001 (build-chain exemption), ADR-0002 (own-seam precedent), ADR-0003 (embeddings seam)

## Context

The ClawDSH own packages under `packages/openclaw/` are the reusable surface of the rebuild: the `@clawdsh/dsh-*` plugins (`channel-*`, `memory`, `embeddings`, `embeddings-ark`, `skills-hub`, `automation`, `soul`) composed by the internal `preset-openclaw` source into the `clawdsh` profile and preset. The development path reaches the running Harness through `tools/link-clawdsh.sh`, because the upstream release machinery (`scripts/release/*`) only knows the `@deepseek-ai/*` sequences. This decision publishes the packages to a **private registry** — the concrete URL and credentials are supplied at publish time — so that `dsh plugin --profile clawdsh add @clawdsh/dsh-memory` is declarative and the symlink remains a development convenience.

`scripts/check-workspace-constraints.ts` currently fails for these packages: it treats every `packages/<group>/<pkg>` dir as an upstream "release member" (expecting the `@deepseek-ai` repository URL and `private: false`) and expects every dir under `packages/openclaw/` to carry a `package.json` (which `_template`, `channel-wechat`, and `preset-openclaw` deliberately do not). This ADR records the publish decision, the manifest/registry shape, and the single upstream-file exemption it requires.

## Decision

1. **Publish target = private registry, parameterized.** The 9 packages (`automation`, `channel-core`, `channel-feishu`, `channel-telegram`, `embeddings`, `embeddings-ark`, `memory`, `skills-hub`, `soul`) drop `private: true` and gain `publishConfig.access: "public"` — public access *within* the private registry, kept so the constraint gate's access check stays uniform — plus `repository: { type: "git", url: "git+https://github.com/Fatemoisted/ClawDSH.git", directory: "packages/openclaw/<pkg>" }` pointing at the private origin. The registry URL itself is **not** hardcoded in manifests: it is parameterized and supplied at publish time as the workflow's `registry` input → `NPM_CONFIG_REGISTRY`, so no placeholder URL ever enters the source tree.
2. **Independent publish path, upstream release scripts unchanged.** `scripts/release/families.ts` and the `@deepseek-ai/*` sequences stay untouched; publishing runs `pnpm -r --filter './packages/openclaw/*' publish` in topological order (the `embeddings` Service Definition before `embeddings-ark`/`memory`; `channel-core` before the channel adapters). Version baseline = `0.1.0` (matching the current manifests).
3. **One upstream-file direct edit (exemption).** `scripts/check-workspace-constraints.ts` gains a `clawdshRepositoryUrl` constant, an `@clawdsh/` branch mirroring the `publicLandlockPackages` precedent (must not set `private`, `publishConfig.access` must be `"public"`, repository URL + directory must match the private origin), and a `clawdshNonPackageDirs` set (`_template`, `channel-wechat`, `preset-openclaw`) that the hierarchy-shape check skips under `packages/openclaw/`. The change is purely additive for clean replay on upstream rebase.
4. **ADR-0001 §4 revision.** The constraint script joins the build-orchestration exemption list ("registration points for newly added packages") under the same rule: additive edits only, replay on rebase, upstream internals unchanged.
5. **Symlink stays development-only.** `tools/link-clawdsh.sh` installs the `clawdsh` profile and preset and links the local packages; the registry install path is `dsh plugin --profile clawdsh add @clawdsh/dsh-<pkg>`. The script warns about legacy `openclaw` profile and preset directories, preserves them, and creates no compatibility alias.
6. **Publish workflow.** `.github/workflows/clawdsh-publish.yml` is a `workflow_dispatch` (inputs `registry` and `dry-run`) that checks out, installs, builds, typechecks, then publishes through `NPM_CONFIG_REGISTRY` + `NPM_TOKEN` — a minimal skeleton owned by this repository, isolated from the upstream release workflows.

## Consequences

- ✅ `@clawdsh/*` packages become installable from the private registry; the development symlink path and the upstream release machinery remain independent.
- ⚠️ The development script does not provide managed install state or integrity repair. The public-distribution CLI owns the manifest and `clawdsh doctor` rather than extending this transition script into a product installer.
- ⚠️ The registry URL/credentials are held outside the repo and must be supplied for every publish; a dry-run mode exists to validate the tarball without writing.
- ⚠️ One upstream script now carries a ClawDSH branch; on each upstream sync the diff must be replayed (the additive shape keeps this a clean replay), same as the tsconfig registration points.
- ⚠️ Publishing is a separate path from the `@deepseek-ai/*` sequences; version bumps for the two families are independent (ClawDSH stays at `0.1.0` until its own release sequence decides otherwise).

## Alternatives

- **Publish to the public npm registry (rejected)**: the packages are the initiator's private surface and not ready for public consumption; the decision is explicitly a private registry.
- **Fold `@clawdsh/*` into the upstream `families.ts` release sequences (rejected)**: would entangle the private registry and version cadence with the public `@deepseek-ai/*` sequences and expand the upstream-file diff beyond a single additive exemption.
- **Keep the symlink as the only distribution (rejected)**: works for the local machine but not for a reproducible, declarative install elsewhere; the registry path is the durable user-facing mechanism.
- **Hardcode the private registry URL in manifests (rejected)**: the URL is supplied at publish time; a placeholder would be invalid and would leak an unset default into `npm publish`.
