# ADR-0004: npm publishing — private registry surface for the `@clawdsh/*` packages

English | [中文](0004-npm-publishing.zh.md)

- **Status**: Accepted (2026-08-14)
- **Date**: 2026-08-14
- **Depends on**: ADR-0001 (build-chain exemption), ADR-0002 (own-seam precedent), ADR-0003 (embeddings seam)

## Context

The ClawDSH own packages under `packages/openclaw/` are the reusable surface of the rebuild: the `@clawdsh/dsh-*` plugins (`channel-*`, `memory`, `embeddings`, `embeddings-ark`, `skills-hub`, `automation`, `soul`) that compose into the `preset-openclaw` profile. Until now they are `private: true` and reach the running harness only through a symlink transition (`tools/link-openclaw.sh`), because the upstream release machinery (`scripts/release/*`) only knows the `@deepseek-ai/*` sequences. The initiator decided to publish them to a **private registry** — its URL and credentials are controlled by the protected publish environment — so that `dsh plugin --profile openclaw add @clawdsh/dsh-memory` becomes the user-facing install path and the symlink remains a development convenience.

`scripts/check-workspace-constraints.ts` initially failed for these packages: it treated every `packages/<group>/<pkg>` dir as an upstream release member and expected every dir under `packages/openclaw/` to carry a `package.json` (while `_template`, `channel-wechat`, and `preset-openclaw` deliberately do not). The existing release scripts also had no independent ClawDSH family, so direct recursive publishing could not verify shared versions, dependency order, packed payloads, or reproducibility. This ADR records the private-registry decision and the isolated release sequence that enforces it.

## Decision

1. **Publish target = protected private registry.** The 10 packages (`automation`, `channel-core`, `channel-discord`, `channel-feishu`, `channel-telegram`, `embeddings`, `embeddings-ark`, `memory`, `skills-hub`, `soul`) drop `private: true` and gain `publishConfig.access: "public"` — public access *within* the private registry, kept so the constraint gate's access check stays uniform — plus `repository: { type: "git", url: "git+https://github.com/Fatemoisted/ClawDSH.git", directory: "packages/openclaw/<pkg>" }` pointing at the private origin. The registry URL is **not** hardcoded in manifests or accepted from a dispatch caller: the protected `npm-publish` environment owns `vars.NPM_REGISTRY_URL`. The release gate requires a credential-free HTTPS URL, explicitly rejects `registry.npmjs.org`, and supplies the token separately.
2. **Independent release family.** The shared release machinery gains a distinct `clawdsh` family without coupling it to the public `dsh` or vendor sequences. Its ten members share one version and `clawdsh-v*` tag; bump synchronizes the install-profile ranges, verify checks tag/version/range state and requires the tagged commit to be contained in `origin/clawdsh`, pack follows workspace dependency order after a clean build, packed-install drives every public entry and invariant from a fresh consumer, and publish uploads only those verified tarballs. Version baseline = `0.1.0`.
3. **Additive workspace constraints.** `scripts/check-workspace-constraints.ts` gains a `clawdshRepositoryUrl` branch (no `private`, `publishConfig.access` must be `"public"`, repository URL + directory must match the ClawDSH origin), independent shared-version enforcement, and a `clawdshNonPackageDirs` set (`_template`, `channel-wechat`, `preset-openclaw`) skipped by the hierarchy check. The public `dsh` and vendor rules remain unchanged.
4. **ADR-0001 §4 revision.** The constraint script joins the build-orchestration exemption list ("registration points for newly added packages") under the same rule: additive edits only, replay on rebase, upstream internals unchanged.
5. **Symlink stays development-only.** `tools/link-openclaw.sh` gains the missing `soul` symlink (a pre-existing bug, unrelated to publishing); the script remains the pre-publish transition, and the registry install path (`dsh plugin --profile openclaw add @clawdsh/dsh-<pkg>`) becomes the documented user path in `preset-openclaw/README`.
6. **Credential-isolated publish workflow.** `.github/workflows/clawdsh-publish.yml` runs runtime-closure verification plus the credential-free clean-build/pack/fresh-install gate on pull requests and `clawdsh` pushes, supplying local Harness/vendor tarballs for that payload-only smoke. A manual dispatch defaults to a dry run; publishing additionally requires a matching `clawdsh-v*` tag whose commit is contained in `origin/clawdsh`, approval by the protected environment, valid `NPM_REGISTRY_URL`, a read-only `NPM_READ_TOKEN`, and the write-capable `NPM_TOKEN`. The publish job installs its release tooling before configuring that target, downloads the pack-job artifact instead of rebuilding it, then repeats fresh install with **only** the ClawDSH tarballs local so all Harness/vendor prerequisites must resolve from the target registry. Installed-code probes run with a credential-free allowlisted environment and Node filesystem permissions confined to their throwaway consumer. The write token appears only in the final publish step. The final publisher accepts exactly the checkout-defined ten family artifacts in release order — no missing, extra, duplicate, traversal, wrong-identity, wrong-version, or invalid-payload tarball — and routes only the final registry smoke and publish through `NPM_CONFIG_REGISTRY`.

## Consequences

- ✅ `@clawdsh/*` packages become reproducibly installable from the private registry; the symlink remains a local-development transition.
- ✅ A release cannot silently leave the profile on an older family version or publish a workspace-only/stale payload.
- ✅ The credentialed job proves the target registry already carries every exact Harness/vendor prerequisite before it publishes any ClawDSH tarball.
- ⚠️ The registry URL plus separate read/write credentials are held by the protected environment and must be configured for an actual publish; ordinary CI and manual dry runs stay credential-free.
- ⚠️ Publishing remains independent from the `@deepseek-ai/*` sequences even though it reuses their audited release primitives; the families' versions and tags never move together implicitly.

## Alternatives

- **Publish to the public npm registry (rejected)**: the packages are the initiator's private surface and not ready for public consumption; the decision is explicitly a private registry.
- **Publish recursively with `pnpm -r` and no release family (rejected)**: it does not guard one shared version, synchronize the profile, verify packed consumer imports, or guarantee that publication uses the artifact CI tested. Reusing the machinery as a separate family provides those guarantees without joining the public sequences.
- **Keep the symlink as the only distribution (rejected)**: works for the local machine but not for a reproducible, declarative install elsewhere; the registry path is the durable user-facing mechanism.
- **Hardcode the private registry URL in manifests or accept it from the dispatch caller (rejected)**: the protected environment is the trust boundary; a manifest placeholder would be invalid, while a free-form dispatch value could route the publish token and public-access packages to an unintended registry.
