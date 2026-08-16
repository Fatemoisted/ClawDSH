# Agent Note: ClawDSH public distribution

Status: implemented

English | [中文](2026-08-15-clawdsh-public-distribution.zh.md)

[ADR-0009](../../../../docs/adr/0009-public-npm-distribution.md) owns the public npm and managed-install decision. [ADR-0008](../../../../docs/adr/0008-openclaw-channel-plane.md) remains authoritative for the third-party OpenClaw artifact and support evidence; this note describes only its explicit installer path. The development linker remains documented separately and is not a product installer.

## Problem

The implemented ClawDSH profile previously depended on workspace links and checked-out build output. That was sufficient for development, but it could not provide a clean public install, prove which browser and Channel assets were shipped, repair managed presets without overwriting user data, or verify compatibility against a released dsh version. The old workflow also accepted an arbitrary private registry and a long-lived write token, and discovered packages by directory rather than a closed product release set.

Distribution also creates a local authority problem. A product installer needs to create and upgrade its own profile, presets, runtime, and management record, but it must not treat settings, credentials, memory, skills, OpenClaw state, custom patches, or an unmarked same-name profile as installer-owned. A failed multi-path update must not leave the management marker claiming a partial installation, and a modified preset must not be silently replaced.

## Decision

The public candidate is a fixed thirteen-package set at `0.1.0-rc.1`: ten functional packages, the restricted messaging preset, `@clawdsh/dsh-bundle`, and `@clawdsh/cli`. Legacy Channel packages remain private. Every ClawDSH dependency between public packages uses `workspace:0.1.0-rc.1` in source and must become the exact version in the real tarball. Release verification rejects an unexpected public package, a legacy dependency, an incorrect topological order, local dependency protocols, symlinks, undeclared files, source maps, or a private-registry URL.

The staged bundle is the immutable product layer. It rewrites only the development runtime mount in the checked profile patch, then copies the managed primary preset, current built Control Runtime and browser assets, production Channel locks, stable bridge, runtime dependency lock, license, and notices. A closed `assets.json` lists each delivered file with its source, role, byte length, and SHA-512. Staging requires current genuine builds, ordinary files beneath the repository, exact public source-package versions, and agreement among the profile, host lock, runtime lock, and bridge. The same closed-payload checks run against the real npm archive. Directly packing the source template fails closed.

The CLI depends exactly on `@deepseek-ai/dsh@0.1.0-rc.6` and the candidate bundle. Its managed profile installs `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, and the ClawDSH bundle in that order at exact versions. With no subcommand it initializes or upgrades and then starts the product; explicit commands cover initialization, start, doctor, preset reset, Channel install, and Channel doctor. Start passes only the supported host, port, and trusted-host arguments to the CLI-owned dsh executable, while a named custom profile is never adopted as managed. The CLI remains the foreground supervisor, forwards terminal signals to dsh, waits for the child to close, and then mirrors the signal; terminating the wrapper therefore cannot orphan the Harness process or its inherited output streams.

Initialization first verifies the CLI's bundle and its asset manifest, then builds a complete profile-and-preset candidate under a private transaction directory. The transaction journal names only normalized paths beneath the DSH home, moves existing managed targets into private backups, publishes the management marker last, and rolls back or recovers an interrupted operation before later work. `.clawdsh.json` records the installer and bundle identity, asset digests, preset digests, and Channel state. Existing user patch files remain in place on upgrade. An unmarked `profiles/clawdsh` or same-named preset is rejected. `--reset-preset` may replace an unmarked or changed preset only after copying it to a timestamped digest-bearing backup. Legacy `openclaw` identities produce warnings only.

`doctor` verifies only management metadata and installer-owned paths and never reads credential stores. Ordinary initialization does not acquire OpenClaw. `channel install` is a separate explicit transaction: it reads the bundled production lock, rejects a running Node executable outside the locked Gateway engine, downloads the immutable npm artifact without ambient authentication headers, validates its SHA-512 and archive members, invokes the locked npm `10.9.7` assembly tool under the current compatible Node with scripts disabled, validates every installed dependency and the OpenClaw ordinary-file tree, copies the stable bridge, and writes a credential-free fail-closed configuration. WebUI and Gateway therefore share the current Node executable by default; a second Node installation is not part of the managed deployment. Canary is not accepted. Channel install and doctor compare package, lock, installed-tree, and bridge identities recorded in the marker, then invoke the exact installed Provider's complete fail-closed configuration verifier without selecting, returning, or logging credential fields or recording a configuration digest.

The release workflow uses Node 24 with a 4 GiB heap, a literal thirteen-package order, the public npm registry, OIDC trusted publishing, and provenance. It stages and packs every archive before any remote write, validates an immutable release index, publishes the candidates to an unauthenticated loopback-only temporary registry, and performs an isolated install with a fresh home, npm configuration, and DSH home. The smoke resolves the exact dsh and bundle versions, runs CLI initialization, and waits for the keyless `/clawdsh/` ready URL.

The current registry state is `bootstrap-required`: none of the thirteen package names exists, and npm permits neither `npm trust` nor staged publishing for a brand-new package. Initial creation therefore requires separate user authorization and direct publication from an interactive 2FA-protected npm account. The bootstrap archives and version remain deliberately unselected because consuming `0.1.0-rc.1` outside OIDC would prevent the workflow from publishing that immutable version. This implementation performs no bootstrap.

After package creation, all thirteen trusted-publisher records must be configured in bulk for the same repository, `clawdsh-publish.yml`, environment `npm`, and `npm publish` permission. The `OIDC-ready` state requires the GitHub `npm` environment to admit only the canonical `clawdsh` branch, while release readiness independently requires `refs/heads/clawdsh`. Public publication remains blocked until those controls, scope ownership, repository-public approval, and the compatibility attestation all agree; this implementation neither changes repository visibility, configures trust, nor performs a publish.

## Verification

Bundle tests use genuine `npm pack` output and cover deterministic staging, exact dependency conversion, stale output, symlinks, path escape, local dependency protocols, private registries, source maps, undeclared files, and mismatched Channel locks. Release-tool tests cover the closed source-package inventory, archive parser, topological order, release index, readiness conditions, loopback registry restriction, publication command construction, and isolated-install attestation.

CLI tests inject only acquisition, npm, process, clock, and output effects. They cover clean initialization, exact three-layer profile dependencies, second-run idempotency, unmarked-profile and unmarked-preset rejection, user-patch preservation, changed-preset refusal, backup-before-reset, transaction rollback and recovery, legacy warnings, supported argument forwarding, secret-free doctor output, explicit Channel installation, malicious archive rejection, digest mismatch, and Channel integrity diagnosis. The release workflow repeats the product build and keyless clean-install journey on Node 24 before an artifact can reach its publish job.

## Alternatives considered

**Extend the development linker.** Rejected because symlinks, repository paths, and destructive repair assumptions are unsuitable for a public package install.

**Install or update files in place.** Rejected because a failure across profile, dependency tree, presets, and marker would expose a partial state as managed. Candidate staging and marker-last publication provide recoverable ownership.

**Download OpenClaw during normal initialization.** Rejected because a large third-party executable and its communication plane require explicit intent and independently locked integrity evidence.

**Publish every discovered OpenClaw workspace.** Rejected because legacy and internal packages must not become public through directory layout. An exact allowlist makes additions reviewable.

**Use a configurable registry and long-lived token.** Rejected because public release has one registry, and OIDC trusted publishing reduces secret lifetime and prevents an input from redirecting publication.

## Consequences

ClawDSH can now be packed and tested as a public, exact-version product without changing the upstream release machinery. A clean installation has a narrow repair owner, and development links remain separate. The managed marker and asset manifests become durable formats; incompatible changes require an explicit schema decision rather than silent reinterpretation.

The first public write remains intentionally unavailable until the separately authorized 2FA bootstrap plan, external ownership, all thirteen trusted-publisher records, the branch-restricted `npm` environment, public-source provenance, and release authorization are present. Staged publishing is available only after package creation and cannot satisfy the bootstrap. Updating dsh, OpenClaw, the product shell, or any public package requires rebuilding and revalidating the complete release set. Platform credentials remain exclusively in OpenClaw state and never enter the bundle, CLI marker, release attestations, or doctor output.
