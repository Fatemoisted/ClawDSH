# ADR-0009: Public npm distribution with managed local installation

English | [中文](0009-public-npm-distribution.zh.md)

- **Status**: Accepted (2026-08-15); bootstrap required and publication not yet authorized
- **Date**: 2026-08-15
- **Supersedes**: ADR-0004; ADR-0006 decision 5 and its related registry statements
- **Depends on**: ADR-0006, ADR-0007, ADR-0008

## Context

The ClawDSH local product now comprises eleven reusable packages, an installable profile layer, managed presets, a Control Runtime, browser assets, semantic Activity, and a locked OpenClaw communication-plane assembly. The private-registry transition in ADR-0004 cannot provide a one-command public install, reproducible product assets, managed repair, or npm provenance. ADR-0006 deliberately separated source posture from registry reach; this decision now selects the public distribution model while retaining a separate human approval gate for making the repository public and performing the first publish.

Public distribution crosses two different trust paths. Package publication must prove that thirteen tarballs contain only declared, immutable assets and exact ClawDSH dependency versions. Local installation must preserve user-owned settings, credentials, memory, skills, OpenClaw state, and custom profile patches while repairing only assets previously marked as ClawDSH-managed. Channel installation additionally downloads a large third-party runtime whose identity is governed by ADR-0008, so normal product initialization must not acquire or execute it implicitly.

None of the thirteen public package names currently exists on the npm registry. npm requires a package to exist before `npm trust` can configure its trusted publisher, and staged publishing also requires an existing package. The release is therefore `bootstrap-required`, not `OIDC-ready`; checked workflow YAML and `id-token: write` do not by themselves establish publish authority.

## Decision

### 1. Publish a closed thirteen-package release set

The first public candidate version is `0.1.0-rc.1`, designated for publication to the public npm registry under the `next` tag after every release gate passes. The release set is exactly:

1. `@clawdsh/dsh-soul`
2. `@clawdsh/dsh-embeddings`
3. `@clawdsh/dsh-embeddings-ark`
4. `@clawdsh/dsh-memory`
5. `@clawdsh/dsh-skills-hub`
6. `@clawdsh/dsh-automation`
7. `@clawdsh/dsh-channel`
8. `@clawdsh/dsh-channel-agent`
9. `@clawdsh/dsh-channel-openclaw`
10. `@clawdsh/dsh-activity`
11. `@clawdsh/dsh-preset-messaging-safe`
12. `@clawdsh/dsh-bundle`
13. `@clawdsh/cli`

The removed `channel-core`, `channel-feishu`, and `channel-telegram` package names remain on the release denylist. Source manifests use `workspace:0.1.0-rc.1` for dependencies within the release set; packed manifests must contain the exact `0.1.0-rc.1` version and no `workspace:`, `file:`, symlink, private-registry URL, or undeclared asset. The CLI depends exactly on `@deepseek-ai/dsh@0.1.0-rc.6`; compatibility failure blocks the candidate rather than replacing that version with `latest` or a range.

### 2. Make the bundle the immutable product layer

`@clawdsh/dsh-bundle` carries the profile patch, the managed `clawdsh` preset, Control Runtime, built `/clawdsh/` browser assets, Activity runtime dependency, restricted messaging preset dependency, production Channel host/catalog/support/governance locks, stable bridge, and third-party notices. Its profile metadata fixes bundle order as `@deepseek-ai/dsh-base → @deepseek-ai/dsh-web-app → @clawdsh/dsh-bundle`, with exact versions for every layer.

The bundle is staged from genuine current builds into a new directory. A closed asset manifest records every shipped file's size and SHA-512. Staging rejects stale builds, symlinks, path escapes, source maps, legacy packages, and dependency or lock disagreement. Verification runs again against the actual npm tarball; a source-directory `npm pack` fails closed so only the staged package can be published.

### 3. Give the CLI narrow managed-install authority

`@clawdsh/cli` provides `clawdsh`, `init`, `start`, `start --profile <name>`, `doctor`, `init --reset-preset`, `channel install`, and `channel doctor`. With no subcommand it performs an idempotent initialize-or-upgrade and then starts the managed `clawdsh` profile by invoking the CLI's exact dsh dependency. `--host`, `--port`, and `--trusted-host` pass through unchanged. A custom profile is started but never adopted as a ClawDSH-managed profile.

Initialization constructs a complete candidate under a staging directory, verifies bundle order and every managed asset digest, then publishes the candidate atomically where the platform permits. `.clawdsh.json` records installer version, bundle identity, managed asset and preset digests, and Channel runtime state. Existing user settings, credentials, memory, skills, OpenClaw config/state, and custom profile patches are outside installer authority. A same-named profile or preset without the management marker is never taken over silently. `--reset-preset` may replace an unmarked or modified preset only after creating a timestamped digest-bearing backup. Legacy `openclaw` identities produce warnings and are not removed.

`doctor` reports integrity and repair guidance without accessing credential stores. Normal `init` does not download the OpenClaw runtime. `channel install` first requires the running Node executable to satisfy the locked Gateway engine, then explicitly downloads only the production artifact in the checked host lock, verifies SHA-512, assembles its checked runtime dependency lock and stable bridge, and creates a fail-closed configuration without platform credentials. Channel install and doctor delegate the complete configuration policy to the installed Provider without selecting, returning, or logging credential fields. Canary inputs remain audit-only.

### 4. Publish only through an artifact-first OIDC workflow

The ClawDSH workflow fixes the public registry, package allowlist, topological order, Node 24, 4 GiB heap, candidate version, and `next` tag. It accepts no registry input and uses npm trusted publishing with `id-token: write` and provenance; a long-lived npm write token is prohibited. Before any remote write, it builds and tests the product, stages the bundle, creates all thirteen real tarballs, validates the immutable release manifest, and installs them through an isolated temporary registry and DSH home.

Initial package creation is a separate one-time bootstrap outside this workflow. It requires new user authorization for the exact archive set, versions, public repository transition, and registry writes, followed by direct publication from an interactive npm account protected by 2FA. Staged publishing cannot replace this step because npm does not allow a brand-new package to be staged. The bootstrap version must be chosen explicitly: consuming `0.1.0-rc.1` interactively would make that immutable version unavailable for the later OIDC workflow. This implementation neither selects bootstrap artifacts nor performs the bootstrap.

After all thirteen package objects exist, a maintainer configures and verifies one trusted-publisher record per package. Every record must name the same GitHub repository, workflow filename `clawdsh-publish.yml`, environment `npm`, and `npm publish` permission. The GitHub `npm` environment must admit deployments only from the canonical `clawdsh` branch, while the workflow independently requires the exact ref `refs/heads/clawdsh`; tags and other branches are not publication authorities. Only this complete state is `OIDC-ready`.

The workflow may publish only when the bootstrap is complete, all thirteen trust records and the `npm` environment branch rule are verified, `@clawdsh` scope ownership is confirmed, the exact dsh compatibility smoke passes, the repository is public, and the user has separately authorized the release. This implementation does not change repository visibility, create npm packages, configure trust, or perform an npm publish. Until every condition is met, the workflow remains a preparation and dry-run path.

## Consequences

- Users receive one exact, repairable product install instead of assembling development symlinks or individual plugins.
- The bundle and CLI become security-sensitive release components. Their closed manifests, staging transaction, preservation rules, and tarball tests are release gates rather than best-effort checks.
- Channel runtime acquisition remains explicit and independently verifiable; an ordinary GUI install stays small, keyless, and offline-capable after npm dependencies are present.
- The release cadence is independent from upstream, but each candidate is coupled to one tested dsh version. A dsh upgrade requires a new compatibility result and release candidate.
- Public npm reach does not itself authorize publishing private source. Provenance makes public-repository approval a hard prerequisite, not an implied side effect of this ADR.
- The first package-name creation is an exceptional human bootstrap. Routine releases gain OIDC authority only after every package-level trust record and the branch-restricted `npm` environment are verified.

## Alternatives

- **Continue the parameterized private registry**: rejected because it does not provide the intended public install, trusted provenance, or a stable consumer path.
- **Publish every workspace package discovered under `packages/openclaw/`**: rejected because directory discovery can accidentally include legacy or internal packages; the release set is an explicit allowlist.
- **Let `init` download and start OpenClaw automatically**: rejected because a large third-party executable and platform plane require explicit user intent and independent integrity checks.
- **Overwrite modified managed assets during upgrade**: rejected because the installer cannot distinguish intentional user changes from damage without reporting a conflict and offering backup-first repair.
- **Use a floating dsh version**: rejected because the product shell and profile depend on exact preview APIs; compatibility must be reproduced against one release.
- **Use a long-lived npm token or configurable registry**: rejected because trusted publishing narrows credential exposure and a fixed registry prevents redirection of a public release.
- **Use staged publishing to create the package names**: rejected because npm requires a package to exist before it can be staged; the initial creation must use a separately authorized interactive 2FA publication.
