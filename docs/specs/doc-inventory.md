# Documentation inventory — dsh vs ClawDSH

English | [中文](doc-inventory.zh.md)

- **Status**: Phase 4 entry deliverable (2026-08-14)
- **Purpose**: classify every file in the repo by ownership so the publish plan (ADR-0006) can state exactly which upstream dispositions need an ADR exemption and which files are already free to rewrite.
- **Method**: three disposition categories — (a) upstream read-only (split into brand-editable vs fully untouchable), (b) ClawDSH-owned, (c) ClawDSH content embedded in an upstream file under an ADR exemption. Authority for (c) is ADR-0001 decision 4 and ADR-0004.

## (a) Upstream read-only

Upstream means `deepseek-ai/deepseek-harness` (git remote `upstream`). Read-only, with two narrow change kinds: brand-section pinning and ADR-backed additive metadata/build edits.

### (a1) Brand-editable (only a pinned brand section)

| File | Brand section | Allowed edit |
|---|---|---|
| `README.md` | lines 1–9, delimited by `<!-- ⬇ 以下为上游 README 原文 -->` | replace the brand section only |
| `README.zh.md` | lines 1–9, same delimiter | replace the brand section only |
| `AGENTS.md` (= `CLAUDE.md` symlink) | lines 1–22, delimited by `<!-- ⬇ 以下为上游原文 -->` | replace the brand section only |

Only these three are brand-editable. `packages/AGENTS.md` and `examples/AGENTS.md` (both `CLAUDE.md` symlinks) are **not** branded — they remain upstream-original (see a2).

### (a2) Fully untouchable (no brand section, no direct edit)

| Location | Note |
|---|---|
| `vendor/` | vendored Cordis source; manifest + sync in `vendor/README.md` |
| `packages/*` except `packages/openclaw/` | all `@deepseek-ai/dsh-*` packages |
| `apps/`, `website/` (+ its `docs/`) | upstream applications and site |
| `native/`, `python/`, `examples/`, `assets/`, `patches/` | upstream runtime, SDK, demos, assets, patch dir |
| `docs/` upstream pages | `architecture`, `development`, `glossary`, `capability-seams`, `cordis-primer`, `cordis-tutorial`, `cordis-api`, `config-catalog`, `testing`, `defensive-patterns`, `event-producer-consumer`, `persistence-catalog`, `tool-catalog`, `tool-execution-pipeline`, `agent-lifecycle`, `api-gateway`, `rescope`, `module-graph`, `graph-atlas`, `web-styling`, `postmortem/`, `subsystems/`, `user/`, `cookbook/` except the owned Telegram e2e family below, `i18n/`, `AGENTS.md` |
| `CONTRIBUTING.md`, `CONTRIBUTING.zh.md` | upstream contribution stance (see ADR-0006) |
| `LICENSE` | upstream MIT, `Copyright (c) 2026 DeepSeek` (see ADR-0006) |
| `THIRD_PARTY_NOTICES.md`, `BENCHMARK.md` | upstream notices/benchmark |
| `packages/AGENTS.md`, `examples/AGENTS.md` | upstream package/example rules (unbranded `CLAUDE.md` symlinks) |
| `scripts/` | upstream gates/generators (one additive branch, see c) |
| `.github/workflows/*` except `clawdsh-*` | upstream CI |
| `.agents/skills/`, `.agents/notes/` | upstream skills + notes (ClawDSH appends its own notes, see c) |
| root config files | `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig*.json`, `tsdown.config.ts`, `vitest*.ts`, `knip.json`, `lefthook.yml`, `.editorconfig`, `.gitattributes`, `.gitignore`, `.gitlab-ci.yml`, `.jscpd.json`, `.oxlintrc*.json`, `.rgignore`, `pytest.ini` — each carries a narrow additive edit listed in (c) where applicable |

## (b) ClawDSH-owned files

| Location | Content |
|---|---|
| `packages/openclaw/` | the only rewriteable package domain — ten publishable packages: `channel-core/`, `channel-telegram/`, `channel-discord/`, `channel-feishu/`, `soul/`, `memory/`, `embeddings/`, `embeddings-ark/`, `skills-hub/`, `automation/` |
| `docs/adr/` | 0001–0007 (project foundation through the accepted, pending local GUI product decision) |
| `docs/specs/` | roadmap and feature specs, the context/product-chain/inventory maps, and the WeChat-family exclusion decision |
| `docs/cookbook/telegram-e2e.{md,zh.md,i18n.yaml}` | owned credentialed Telegram e2e procedure and bounded real-run evidence |
| `docs/matrix/parity.md` | single source of truth for feature alignment |
| `docs/standards/` | `naming`, `plugin-contract`, `pr-policy`, `upstream-sync` |
| `docs/journal/2026-08-14.md` | exhaustive development log |
| `docs/upstream-proposal/ctx-channels.md` | the `ctx.channels` seam proposal to upstream |
| `tools/` | application assembly (`openclaw-preset-openclaw/`), plugin skeleton (`openclaw-plugin-template/`), e2e drivers, and lifecycle scripts including `link-clawdsh.sh`; the installer warns about legacy `openclaw` assets and preserves them |
| `.github/workflows/clawdsh-publish.yml`, `clawdsh-smoke.yml` | ClawDSH CI |

## (c) ClawDSH content embedded in an upstream file

| File | Embedded content | ADR backing |
|---|---|---|
| `README.md`, `README.zh.md` | brand section (lines 1–9) | ADR-0001 decision 4 |
| `AGENTS.md` | brand section (lines 1–22) | ADR-0001 decision 4 |
| `package.json` | `"name": "clawdsh"` | ADR-0001 decision 4 |
| `tsdown.config.ts` | workspace scan includes all ten `packages/openclaw/` package directories directly; assembly, template, and decision material live outside the scan | ADR-0001 decision 4 |
| `tsconfig.base.json` | 10 `@clawdsh/dsh-*` `paths` entries (append-only) | ADR-0001 decision 4 |
| `scripts/check-workspace-constraints.ts` | `@clawdsh/` publish-shape branch + non-package-dir skip | ADR-0004 |
| `.agents/notes/` | 11 ClawDSH notes (33 files), dated 2026-08-14, append-only | note mechanism (no ADR — see nuance) |

## Boundary nuances

- `.agents/notes/` is the one place ClawDSH writes its own content into an upstream tree **without** an ADR. It is append-only (date-stamped filenames, upstream never adds `2026-08-14-*`), so it is rebase-clean, but the CLAUDE.md "own code only in …" list does not enumerate it. Decide whether to add it to the list or record a one-line ADR note.
- `docs/upstream-proposal/` is ClawDSH-owned and listed in the CLAUDE.md brand section, but ADR-0001 decision 3 (physical-isolation list) omits it because the directory postdates that decision. Reconcile the two lists.
- `docs/postmortem/` is upstream, but the same append mechanism as notes applies; ClawDSH may add its own postmortems there later.
- `tools/` is own-code (not docs), but it is the designated home for ClawDSH scripts and e2e drivers.

## Publish-facing gaps (handed to ADR-0006)

- `CONTRIBUTING.md` / `CONTRIBUTING.zh.md` still carry upstream's "we cannot accept external pull requests" stance — contradicts a publishable open-source project. Not in the brand-editable list, so needs an ADR exemption (extend brand-pinning to CONTRIBUTING, or carry ClawDSH contribution guidance in the README brand section).
- `LICENSE` is upstream MIT (`Copyright (c) 2026 DeepSeek`); a derivative fork must retain the upstream notice and may add a ClawDSH copyright line.
- `package.json` has no `homepage`/`bugs`/`repository` pointing at `Fatemoisted/ClawDSH`; a publishable package needs those fields. This is a (c)-style edit requiring an ADR note.
