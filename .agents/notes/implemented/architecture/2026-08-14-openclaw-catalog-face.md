# Agent Note: OpenClaw packages keep their own typecheck face outside the host program

Status: implemented

English | [中文](2026-08-14-openclaw-catalog-face.zh.md)

## Problem

The rebased remote tree had registered the 9 `packages/openclaw/*` packages in `tsconfig.host.json` `references`. The cordis-catalog gate is **fail-closed bidirectional** over the host face (scripts/gen-cordis-catalog.ts + typert projection): every declared Context key and event must be classified in the hardcoded `SERVICE_PAGE`/`EVENT_SCOPE_PAGE` tables or named in the walk-exemption lists — and a key that is rendered but exempt, or exempt but undeclared, is a violation too. The projection scan of the openclaw references surfaced the extension-seam types (`ChannelAdapter`, `EmbeddingVector`) and events (`channel/inbound`, `channel/outbound`) as unclassifiable, producing 4 type-link violations and partition problems. The tables live in a read-only upstream script, and openclaw code must not enter upstream directories, so classifying the types in the tables is not an option.

## Decision

openclaw packages stay **out of `tsconfig.host.json` permanently**; the seam survives the catalog via the 4 walk exemptions added to `scripts/gen-cordis-catalog.ts` (the single sanctioned upstream-file edit, chosen by the sponsor as "摘除 + 4 行豁免"): `SERVICE_WALK_EXEMPTIONS` gains `channels` and `embeddings`; `EVENT_WALK_EXEMPTIONS` gains `channel/inbound` and `channel/outbound`. All three catalog surfaces stay byte-identical to upstream apart from those 4 lines.

Typechecking splits into three pieces:

- **Build**: `packages/openclaw/tsconfig.json` — a composite aggregate (`files: []` + 9 references) emitting `lib/types`.
- **Tests**: `packages/openclaw/tsconfig.check.json` — a plain non-composite program globbing `*/src/**` and `*/tests/**`. With no references, imports resolve through `paths`; the 9 vendored paths are redirected to their built `lib/types` (vendor src fails under the base strict flags — vendor packages compile under their own looser configs, and the host program sees them through references as declaration outputs only), and the 3 test-only deps without base paths entries (`dsh-agent-loop`, `dsh-system-prompt`, `dsh-tools`) get explicit paths to their src.
- **Host**: `tsconfig.host.json` excludes `packages/openclaw/*/tests/**` (otherwise the tests' `paths` imports of openclaw src re-enter the host program as unlisted files → TS6307).

## Alternatives considered

- **Classify the seam types in the upstream catalog tables** — rejected: the tables are in a read-only upstream script and openclaw code must not enter upstream directories; the upstream `ctx.channels` PR (withdrawn by the sponsor, 2026-08-14) would have been the vehicle.
- **Keep the host references and exempt everything** — rejected: the gate is fail-closed bidirectional; the rendered-but-exempt direction still fires, and the projection still scans the unclassifiable openclaw types.
- **Add openclaw tests to the host program's `include`** (files listed → no TS6307) — rejected: test files would pull the entire upstream import graph into the host face, widening the host program and the catalog surface; the dedicated check program isolates that risk inside the openclaw aggregate.
- **Plain check program straight onto vendor src** — tried first, failed empirically: `vendor/cosmokit` and `vendor/schemastery` error under the inherited strict flags (TS2345/TS4114/TS2412/TS2322), hence the `lib/types` redirection.

## Consequences

- openclaw is no longer part of the upstream program: it owns its aggregate (`tsconfig.json`) and its check program (`tsconfig.check.json`); `tools/link-clawdsh.sh` and `.github/workflows/clawdsh-smoke.yml` run both.
- Any future openclaw Context key or event must be registered in the walk-exemption tables (currently 4 entries) or wait for an upstream seam PR; forgetting one fails `verify-cordis-catalog`, not silently.
- The check program requires the openclaw aggregate (or the host build) to have run first — it reads the built `vendor/*/lib/types`.
- `packages/openclaw/README.md` onboarding step 4 documents the aggregate registration instead of the old host-reference flow.
