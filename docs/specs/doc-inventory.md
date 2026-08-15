# Documentation and ownership inventory — dsh vs ClawDSH

English | [中文](doc-inventory.zh.md)

- **Status**: Phase 4 productization; the product shell, Settings, Activity, and public-distribution preparation are implemented
- **Purpose**: identify repository locations that are upstream read-only, ClawDSH-owned, or narrow ADR-backed additions
- **Authority**: root `AGENTS.md`, ADR-0001, ADR-0004, ADR-0006, [GUI ADR-0007](../adr/0007-clawdsh-local-gui-product.md), [channel ADR-0008](../adr/0008-openclaw-channel-plane.md), and [public-distribution ADR-0009](../adr/0009-public-npm-distribution.md)

## 1. Upstream read-only locations

Upstream means `deepseek-ai/deepseek-harness` through the `upstream` remote. Direct edits are prohibited by default. Branded sections and additive build metadata are the listed exceptions, not permission to rewrite the surrounding file.

### Brand-editable files

| File | Allowed ClawDSH edit |
|---|---|
| `README.md`, `README.zh.md` | pinned ClawDSH brand section above retained upstream text |
| `AGENTS.md` (`CLAUDE.md` symlink) | pinned ClawDSH repository rules above retained upstream rules |
| `CONTRIBUTING.md`, `CONTRIBUTING.zh.md` | ClawDSH contribution section under ADR-0006 while retaining upstream attribution |

### Fully upstream-owned trees

| Location | Treatment |
|---|---|
| `vendor/` | sync through the vendoring procedure only |
| `packages/*` except `packages/openclaw/` | do not modify for ClawDSH behavior |
| `apps/`, `website/`, `native/`, `python/`, `examples/`, `assets/`, `patches/` | upstream application, runtime, SDK, example, and asset sources |
| upstream documentation and generated catalogs | reference or regenerate only through the owning upstream workflow |
| `scripts/` | upstream checks and generators; no ClawDSH feature implementation |
| `.github/workflows/*` except `clawdsh-*` | upstream CI |
| `.agents/skills/` and pre-existing `.agents/notes/` | upstream operational knowledge; archived notes are frozen |

## 2. ClawDSH-owned locations

| Location | Current content |
|---|---|
| `packages/openclaw/` | feature packages, the current channel seam, retained legacy channel packages, restricted preset, product assembly, nested non-workspace GUI/runtime and distribution builds, and package template |
| `docs/adr/` | ClawDSH decisions; ADR-0007 owns the GUI product posture, ADR-0008 supersedes ADR-0002 for channel architecture, and ADR-0009 owns public distribution |
| `docs/specs/` | roadmap, context map, inventory, product chain, GUI spec, current feature specs, and legacy channel reference |
| `docs/matrix/parity.md` | product and channel support projection; exact channel artifacts remain in machine catalogs |
| `docs/standards/` | naming, plugin, PR, dsh upstream sync, and OpenClaw channel sync rules |
| `docs/journal/` | dated development history, not current-state authority |
| `docs/upstream-proposal/` | dsh Session-event and OpenClaw AgentHarness proposals; no upstream PR is implied |
| `tools/openclaw-channel-host/` | production and canary host locks, channel catalogs, schemas, verifier, and tests |
| other `tools/` entries | ClawDSH installer, migration, verification, and e2e drivers |
| `.github/workflows/clawdsh-*` | ClawDSH-specific CI and the fixed public npm OIDC/provenance release workflow |
| new date-stamped files under `.agents/notes/` | ClawDSH Agent Notes; implemented notes track shipped facts and archived notes remain frozen |

`channel-openclaw` also owns `LICENSE.openclaw` and `THIRD_PARTY_NOTICES.md` beside its bridge distribution. They preserve OpenClaw attribution and change with the locked artifact or copied bridge code.

## 3. Narrow ClawDSH additions in upstream-owned files

| File | Additive content | Backing |
|---|---|---|
| `README*`, `AGENTS.md`, `CONTRIBUTING*` | delimited ClawDSH brand or contribution sections | ADR-0001 / ADR-0006 |
| `LICENSE` | retained upstream notice plus ClawDSH contributor notice | ADR-0006 |
| root `package.json` | project identity and repository metadata | ADR-0001 / ADR-0006 |
| `pnpm-lock.yaml` | generated dependency graph for owned workspace packages | package implementation; regenerate, never hand-edit |
| `tsconfig.base.json` | exact `@clawdsh/*` source aliases needed by owned packages | ADR-0001 additive registration |
| `tsconfig.host.json` | matching owned package project references | ADR-0001 additive registration |
| `tsdown.config.ts` | owned-package build exclusion or registration required by the workspace layout | ADR-0001 additive registration |
| `scripts/check-workspace-constraints.ts` | narrow `@clawdsh/` package rule where still required | ADR-0004 |

During a rebase, take the upstream version first and replay only these exact additions. The exception does not transfer ownership of the rest of the file.

## 4. Local GUI ownership

| Subject | Owner |
|---|---|
| Product posture, routes, and prohibited upstream modifications | ADR-0007 |
| User-visible pages and acceptance behavior | `feature-gui-web` |
| `/clawdsh/` shell, static routes, Settings control plane, semantic Activity, Control Runtime, and nested build | `preset-openclaw/product-shell` plus `activity` |
| Native dsh Web GUI at `/` and raw Trajectory | upstream dsh, consumed without source changes |
| Profile and preset identity | `clawdsh`; the physical `preset-openclaw` source directory is the only retained legacy path name |
| Development installation | `tools/link-clawdsh.sh`; it requires built product artifacts and links the runtime into the managed development profile |
| Managed installation, integrity repair, and `clawdsh doctor` | `preset-openclaw/distribution/cli`; separate from the development installer |

The current ClawDSH GUI uses public dsh Web boot and rendering APIs, Loader observation, static Host routing, index transforms, Settings and Credentials services, Session history, bounded Activity sidecars, and Connection RPC. It does not register a Client Slot or modify `api-proxy`, Client Catalog, Agent Loop, generated files, or upstream GUI source. `/clawdsh-rpc` is loopback-only and exposes product identity, capability evidence, allowlisted Settings mutation, write-only dsh credential operations, and privacy-limited `activity/list` queries.

## 5. Public-distribution ownership

| Subject | Owner |
|---|---|
| Exact 13-package allowlist, `0.1.0-rc.1` version, and dependency-first order | `preset-openclaw/distribution/release-tools/release-contract.mjs`; the [package-domain README](../../packages/openclaw/README.md#public-release-set) is the human-readable projection |
| Profile patch, primary preset, Control Runtime, GUI assets, Channel locks, bridge notices, and exact feature dependencies | `preset-openclaw/distribution/bundle` plus its staging and asset-manifest verifier |
| Managed profile/preset installation, `.clawdsh.json`, backup-before-reset, launch, and doctor | `preset-openclaw/distribution/cli` |
| Explicit production OpenClaw acquisition and runtime assembly | `clawdsh channel install`; the checked locks and bridge remain owned by `tools/openclaw-channel-host` and `channel-openclaw` |
| Real tarballs, publication-content audit, temporary-registry installation, and isolated dsh-home smoke | `preset-openclaw/distribution/release-tools` |
| Public npm `next` publication | `.github/workflows/clawdsh-publish.yml`; fixed public registry, OIDC trusted publishing, provenance, exact `refs/heads/clawdsh`, and GitHub environment `npm` |

The bundle and CLI are prepared release candidates, not published packages. All thirteen package names are absent, so the current state is `bootstrap-required`: a separately authorized interactive 2FA publication must create them because neither npm trust nor staged publishing accepts a brand-new package. After creation, each package trust record must match `clawdsh-publish.yml`, environment `npm`, and `npm publish`; the GitHub environment must admit only branch `clawdsh`, while the workflow requires `refs/heads/clawdsh`. The repository remains private, and release tooling does not authorize bootstrap, trust changes, repository visibility changes, or publication.

## 6. Channel-plane ownership

| Subject | Owner |
|---|---|
| OpenClaw production and canary artifact identities and public channel roster | `tools/openclaw-channel-host/*.json` |
| Channel architecture and role allocation | ADR-0008 |
| Current V1 behavior, assembly, and gaps | `feature-channel-plane-bridge` |
| OpenClaw host gaps and proposed public semantics | `openclaw-agent-harness-channel-seams` |
| Promotion, certification, and rollback | `openclaw-channel-sync` standard |
| User-visible support state | parity matrix |
| Runtime protocol and ledgers | `channel`, `channel-agent`, and `channel-openclaw` |
| Legacy adapter behavior | ADR-0002, `feature-channel-core`, legacy packages, and their active Agent Notes |

OpenClaw source archives and npm tarballs are external inputs, not repository-owned source trees. Do not copy the full host under `packages/openclaw/`. The production bridge may distribute the minimum derived code and notices its license permits; the lock verifier remains authoritative for the external host.

## 7. Transitional state

- `channel-core`, `channel-telegram`, and `channel-feishu` are owned but legacy. They remain until the ADR-0008 replacement conditions pass; do not archive their Agent Notes earlier.
- `channel-wechat` is a historical exclusion record whose availability statement is superseded by the production external WeChat catalog. It is not a runtime package or current status authority.
- The production sidecar is not certified or enabled. Documentation must not convert catalog or package evidence into a live support claim.
- Canary has an approved source archive but no locked built artifact and remains audit input only.
- The upstream snapshot runner does not discover owned channel packages, and the upstream `examples/` tree remains read-only.
- Downstream `channel/*` Session events are disabled in the runnable path until an ignorable append mechanism exists; durable channel ledgers and the known `user/message` source are current authority.
- The `clawdsh` and `clawdsh-messaging-safe` presets remain physically stored as dsh user presets; the ClawDSH CLI owns their managed manifest, integrity repair, and backup-before-reset behavior.
- ClawDSH Settings exposes read-only capability and Loader evidence plus allowlisted mutation and secret-free dsh credential methods. ClawDSH Activity projects standard Session history and bounded sidecars through a privacy-limited loopback query.

## 8. Rebase checklist

1. Take upstream versions of upstream-owned files.
2. Replay only the delimited brand sections and exact additive registrations listed above.
3. Preserve every owned directory and active ClawDSH Agent Note; never edit archived notes to resolve a current change.
4. Verify OpenClaw host locks independently from the dsh upstream baseline.
5. Run bilingual pairing and the relevant package, build, browser, snapshot, and documentation checks before calling this inventory current.
