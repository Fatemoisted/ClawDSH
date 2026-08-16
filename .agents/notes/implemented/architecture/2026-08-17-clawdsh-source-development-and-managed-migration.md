# Agent Note: ClawDSH source-development isolation and managed migration

Status: implemented

English | [中文](2026-08-17-clawdsh-source-development-and-managed-migration.zh.md)

The [public-distribution decision](../feature/2026-08-15-clawdsh-public-distribution.md) owns the managed product profile and `.clawdsh.json`. This note owns the separate source-development home and the one-time conversion from the recognized historical source-linked layout to that public managed profile.

## Problem

The source linker installed into the same `$DSH_HOME` used by the public product, copied the complete product patch into a path users also treated as their profile override, copied both presets on every refresh, and had no source-install ownership marker. Repeating it could therefore overwrite a user patch or preset, while a later public installer could not distinguish a clean source layout from a same-name directory created or modified by a user.

Public installation cannot solve that ambiguity by broadly adopting paths. Settings, credentials, Sessions, Memory, Skills, Activity, and OpenClaw state contain user data or secrets, and even the historical source-owned profile and presets may contain local changes. Migration needs a closed recognition rule, an owner-private backup, and one transaction whose management marker never claims a partial conversion.

## Decision

Source development uses `CLAWDSH_DEV_HOME`, defaulting to `~/.clawdsh-dev`, and never falls back to public `DSH_HOME`. `tools/run-clawdsh-dev.sh` resolves a relative development home from the caller's directory, refreshes it through the absolute source installer, exports it as `DSH_HOME`, pins the repository `tsconfig.json` for source-path resolution, and launches the source CLI without changing the caller's working directory. The caller therefore continues to own workspace and `.env` discovery; the checkout's root `.env` is not loaded implicitly. A public `.clawdsh.json` marker in the selected development home is an error, so public and source-managed homes may coexist but cannot share ownership.

The development profile composes `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, and private `@clawdsh/dsh-dev-bundle` in that order. The private bundle carries product composition and the closed source dependency set. `profiles/clawdsh/cordis.patch.yml` is created from the empty user-layer template only when the profile is first installed; later source refreshes never replace it. Presets and recorded symlinks remain development-owned, but a changed managed asset blocks refresh unless `tools/link-clawdsh.sh --backup-modified` first copies the development profile, presets, and link evidence to `.clawdsh-dev-backups/`. An owner-only management lock covers inspection, optional backup, candidate publication, and marker replacement so two refreshes cannot interleave.

The public CLI exposes a separate migration interface:

```text
clawdsh migrate source
clawdsh migrate source --apply
clawdsh migrate source --apply --backup-modified
```

The first form is read-only inspection. `--backup-modified` is accepted only with `--apply`; no force option accepts an unknown layout.

## On-disk formats

| Format | Purpose | Required schema v1 fields |
|---|---|---|
| `$CLAWDSH_DEV_HOME/.clawdsh-dev.json` | Development ownership and refresh evidence | `schemaVersion`, `profileId`, `repositoryRoot`, `profile.packageIntegrity`, `bundle.name`, `bundle.patchIntegrity`, closed `links`, and `presets` |
| `$DSH_HOME/.clawdsh-backups/source-<timestamp>-<digest>/source-backup.json` | Evidence for a public source-to-managed migration backup | `schemaVersion`, `profileId`, `createdAt`, `evidenceIntegrity`, `modified`, and `links[]` entries containing `path`, `target`, `resolvedTarget`, and `packageName` |

The development marker's link map has twelve exact home-relative entries: the eleven historical feature/runtime links plus `@clawdsh/dsh-dev-bundle`. Every target resolves into the marker's one repository root. The marker also records both preset digests and the private bundle patch digest, but intentionally records no Settings, credential, Session, Memory, Skill, Activity, or OpenClaw path.

Every applied public migration creates its backup directory with mode `0700`, including complete copies of the historical profile and the `clawdsh` and `clawdsh-messaging-safe` presets. The source-backup manifest preserves the original and resolved symlink targets for recovery evidence; those absolute paths may reveal checkout locations, so the backup remains owner-private. It contains no copied product data or secret file.

## Recognition and transaction

A historical source installation is recognized only when all of these facts hold:

- the two-layer `clawdsh` profile manifest has the known package identity;
- the profile patch and both preset trees match a known digest or are classifiable as modifications of that otherwise complete layout;
- all eleven historical package/runtime entries are symlinks with the expected package names and release identities;
- all resolved links belong to one ClawDSH checkout;
- the complete known profile, preset, and link set exists without a public or development marker.

A known layout becomes `modified` when its source-owned profile manifest bytes, patch, preset tree, or additional profile entries differ. Clean apply is permitted with `--apply`; modified apply requires `--apply --backup-modified`. A missing asset, different package identity, unsafe filesystem type, mixed checkout, unknown manifest, or unknown marker makes the layout unknown and permanently ineligible for automatic takeover.

Every apply, including a clean migration, writes the complete owner-private backup before changing managed targets. After preparing the exact public dependency tree, the installer rechecks the complete profile tree, raw and resolved symlink targets, and both preset digests against the inspected evidence; an edit during preparation aborts rather than overwriting newer bytes. One marker-last public-install transaction then replaces the profile and both presets, removes only the eleven recognized source symlinks, installs the prepared dependency tree, and publishes `.clawdsh.json` last. Other entries below `profiles/node_modules/@clawdsh/` are outside the removal allowlist and remain untouched. A failure before commit restores the prior targets and leaves no public marker claiming completion.

Migration inspection and apply never open, copy, move, or rewrite `settings.yaml`, `.credentials.yaml`, Sessions, Memory, Skills, Activity, or OpenClaw configuration and state. Ordinary `clawdsh init` detects a recognized historical footprint and reports the exact clean or modified migration command; an unknown footprint reports the reason and refuses takeover.

## Verification

Development-install tests pin a separate default home, caller-directory preservation, explicit source-path configuration, public-marker refusal, closed link and marker validation, first-install empty patch creation, byte-preserving repeated refresh, modified-preset refusal, explicit backup, path containment, concurrent-refresh locking, and rollback. Public CLI tests pin dry-run zero writes, known-clean and known-modified classification, unknown-layout refusal, the `--apply`/`--backup-modified` relation, owner-only complete backup, exact eleven-link removal, preservation of unrelated links and user data, management locking, pre-commit drift refusal, marker-last commit, and failure rollback.

Distribution tests run the migration through the real managed installer candidate rather than a simulated file copy. They verify that the resulting profile, presets, dependency tree, and `.clawdsh.json` pass the same `doctor` checks as a fresh public installation.

## Alternatives considered

**Use public `$DSH_HOME` for source development.** Rejected because source symlinks and public immutable dependencies have different owners and upgrade rules; one marker cannot safely describe both.

**Keep product composition in the profile user patch.** Rejected because a refresh would have to choose between stale product wiring and overwriting user changes. A private development bundle gives product composition its own immutable layer.

**Refresh presets and links unconditionally.** Rejected because the same-name directories may contain user edits or point into another checkout. Recorded digests and exact targets make drift explicit and require backup before replacement.

**Adopt any profile whose name is `clawdsh`.** Rejected because a name is not ownership evidence. Closed manifest, digest, symlink, package-identity, and one-checkout checks prevent the installer from claiming unrelated user data.

**Migrate in place without a complete backup.** Rejected because profile, preset, symlink, dependency-tree, and marker changes span multiple paths. Backup-before-mutation plus marker-last publication provides recoverable ownership.

## Consequences

Source and public ClawDSH installations can run on one account without sharing profile, preset, Settings, credential, or product-data state. Source refresh updates product-owned wiring while preserving the user patch exactly; modified development presets or links require an explicit owner-private backup.

`.clawdsh-dev.json` and `source-backup.json` schema v1 become release-candidate disk formats. Their closed inventories, path containment, negative ownership guarantees, and marker-last transaction order remain active design constraints for future installer changes; a new field set or broader adoption rule requires an explicit migration decision.

Historical source migration is intentionally narrow. Unknown layouts require manual recovery, and the source-backup manifest records but does not automatically recreate old symlinks. This gives up a force mode in exchange for never treating an ambiguous same-name tree as installer-owned.
