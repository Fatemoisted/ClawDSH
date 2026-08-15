# OpenClaw channel-host locks

English | [中文](README.zh.md)

This directory pins the production and canary OpenClaw channel hosts and their user-facing chat-channel catalogs. The catalogs cover 27 production and 31 canary chat channels; the related Voice Call plugin is outside this inventory.

## Artifacts

- [host.production.json](host.production.json) locks the stable Git tag, peeled commit, npm tarball, and extracted ordinary-file tree.
- [host.canary.json](host.canary.json) locks the approved `main` observation and verified GitHub source archive instead of resolving a moving branch at check time; its unpublished npm fields remain `null` and `cataloged`.
- [channels.production.json](channels.production.json) records the stable supported-channel catalog and verified install artifacts.
- [channels.canary.json](channels.canary.json) records the channel catalog observed at the canary commit.
- [support.production.json](support.production.json) records the four-level production support projection and explicit opt-in policy.
- [support.canary.json](support.canary.json) records the same projection for the source-only canary snapshot.
- [governance.production.json](governance.production.json) records the exact external packages plus license declarations and independent license, platform-terms, and security review states.
- [governance.canary.json](governance.canary.json) records the governance projection for every external package in the canary track, including canary-only packages.
- [schema.ts](schema.ts), [tree.ts](tree.ts), and [verify.ts](verify.ts) own structural, cross-file, evidence, and optional extracted-tree checks; [generate-parity.ts](generate-parity.ts) owns the generated four-state documentation projection.

## Distribution status

| Status | Meaning |
| --- | --- |
| `core` | The channel implementation is part of the host core and has no separate channel package. |
| `bundled` | The extension ships in the host artifact and has no separately verified install artifact. |
| `repo-official` | OpenClaw owns the extension source in its repository; an exact npm artifact is locked only when independently verified. |
| `external` | The channel source is maintained outside the OpenClaw repository and an exact trusted-catalog npm artifact is locked. |

`npm.status: "verified"` requires an exact package name, version, and canonical SHA-512 SRI. `npm.status: "cataloged"` identifies source-catalog evidence without claiming an exact install artifact, so unverified version and integrity fields are `null`.

Status rank expresses distance from host ownership, not feature quality. Canary must contain every production channel, and a shared channel may retain its status or move outward along `core` → `bundled` → `repo-official` → `external`.

## Support status

| Status | Meaning |
| --- | --- |
| `cataloged` | The channel identity and provenance are recorded; locked artifacts alone do not claim completed channel assembly. |
| `installable` | Exact artifacts, channel configuration instructions, a capability probe, and a keyless contract test are all recorded. |
| `certified` | The channel is installable and `certifications` records a timestamped real-account smoke test with an evidence reference. |
| `enabled` | The channel is certified and `enablements` records the deployment configuration that selected it. |

The production and source-only canary projections mark all 27 and 31 channels `cataloged`, respectively, and record no installability, certification, or enablement evidence. Exact production host and package locks remain independent artifact facts until each channel also has the three `installability` evidence references. A channel with distribution status `external` has `optIn: true`; every other channel has `optIn: false`. The verifier rejects `installable` or stronger status without exact artifacts and assembly evidence, `certified` or `enabled` without live-smoke evidence, `enabled` without deployment evidence, and any opt-in value that disagrees with distribution ownership.

## External governance

Every external package is repeated in the track-specific governance catalog with the same package name, version, and SRI as the channel catalog. A registry manifest license value is only a declaration, not legal approval. `license`, `platformTerms`, and `security` each carry an independent `pending-review`, `approved`, or `blocked` disposition and evidence references. An external channel cannot advance to `installable` until all three dispositions are `approved`. The checked-in records intentionally remain `pending-review`; QQ Bot 2.0.1 has no declared SPDX license in its registry manifest, while the other four observed packages declare MIT.

## Offline checks

The verifier performs no network requests. It checks the JSON files in this directory for schema versions, host, channel, support, and governance catalog agreement, fixed counts and distribution-status totals, sorted unique identifiers, package evidence, canonical SHA-512 SRI values, support and governance requirements, external opt-in policy, and production-to-canary membership and distribution-status monotonicity. HTTPS evidence references require a valid hostname. Repository-relative evidence references resolve against the ClawDSH repository root, must remain inside that root after symbolic-link resolution, and must identify ordinary files; `--repo-root` overrides the root for an alternate checkout. `generate-parity.ts` derives the four support-state counts embedded in both `docs/matrix/parity.md` documents; CI checks that generated region rather than accepting a hand-maintained checkbox summary.

```sh
pnpm exec tsx tools/openclaw-channel-host/verify.ts --check
pnpm exec tsx tools/openclaw-channel-host/generate-parity.ts --check
```

```sh
pnpm exec tsx tools/openclaw-channel-host/verify.ts --check --repo-root /absolute/path/to/ClawDSH
```

### Extracted production tree

Pass the root of an extracted production npm package to verify its content tree. The algorithm recursively collects ordinary files as absolute paths, sorts them with JavaScript `.sort()`, and updates one SHA-512 hash for each file with the relative POSIX path, NUL, decimal byte length, NUL, and the raw SHA-512 file digest. A symbolic link, socket, or other non-ordinary entry rejects the tree; none is silently omitted from the digest.

```sh
pnpm exec tsx tools/openclaw-channel-host/verify.ts --check --host-root /absolute/path/to/package
```

## Maintenance

1. Update a host lock, channel catalog, support catalog, and external-governance catalog together only after baseline approval, including the exact source ref, commit, observation time, and source manifest version.
2. Record npm metadata as `verified` only with an exact registry version and SRI; otherwise use `cataloged` and `null` for unverified fields.
3. Promote a support entry to `installable` only after recording configuration, capability-probe, and keyless-contract evidence; an external entry also requires approved license, platform-terms, and security reviews.
4. Promote a support entry to `certified` only with a real-account smoke record, and to `enabled` only with deployment evidence; external channels remain explicit opt-in at every level.
5. Run the offline check, focused Vitest suite, TypeScript check, and repository documentation checks.

```sh
pnpm exec vitest run --config tools/openclaw-channel-host/vitest.config.ts
pnpm exec tsc -p tools/openclaw-channel-host/tsconfig.json
```

## Limitations

- The verifier never downloads artifacts, resolves dist-tags, or contacts GitHub or npm; it reads repository-local evidence files only to validate their location and file type.
- Extracted-tree verification is optional and currently applies only to the production host lock.
- The canary source archive is a reproducible source input, not a built deployment artifact; managed deployment requires a separately locked build artifact.
- A registry license declaration is not legal approval, and the checked-in pending reviews do not approve credentials, platform terms, or supply-chain safety.
