# Context map — what to build, what to skip

English | [中文](context-map.zh.md)

- **Status**: Phase 4 context discipline (2026-08-14)
- **Purpose**: the single entry point that tells an agent where ClawDSH's own code is (read deeply, change freely) and where upstream dsh is (summarized once here, then skip). One read of this doc replaces re-reading the upstream source tree.
- **Companions**: [doc-inventory.md](doc-inventory.md) (ownership per file) · [roadmap.md](roadmap.md) (why ClawDSH exists)

## 1. Build surface — read deeply, change freely

| Location | What it is |
|---|---|
| `packages/openclaw/` | the only rewriteable code domain — 12 packages below |
| `docs/adr/`, `docs/specs/`, `docs/matrix/`, `docs/standards/`, `docs/journal/`, `docs/upstream-proposal/` | ClawDSH decisions, specs, matrix, standards, journal, upstream proposals |
| `tools/` | ClawDSH scripts + e2e drivers (`ark-e2e.ts`, `link-clawdsh.sh`, `sync-upstream.sh`) |
| `.github/workflows/clawdsh-*` | ClawDSH CI (`clawdsh-publish.yml`, `clawdsh-smoke.yml`) |

### The 12 packages

| Package | Kind | Consumes | Provides / does |
|---|---|---|---|
| `channel-core/` | Service class | `agents`, `sessions`, `agentDefaultModel` | **provides `ctx.channels`** (ADR-0002) — registry + routing + presentation |
| `channel-telegram/` | adapter | `ctx.channels` | Telegram channel adapter (grammY polling) |
| `channel-feishu/` | adapter | `ctx.channels` | Feishu channel adapter (Lark long-connection) |
| `channel-wechat/` | decision record | — | WeChat-family exclusion (no upstream counterpart) |
| `soul/` | function plugin | `systemPrompt` | persona via system-prompt section (replace/append) |
| `memory/` | function plugin | `tools`, `systemPrompt`, `fs` | `memory_search`/`memory_get` + recall section + flush |
| `embeddings/` | Service class | — | **provides `ctx.embeddings`** (ADR-0003) — abstract `Embeddings` |
| `embeddings-ark/` | provider | `ctx.embeddings` | Volcano Ark provider (`doubao-embedding-vision`) |
| `skills-hub/` | provider | `skills` | ClawHub-compatible skill directory |
| `automation/` | function plugin | `agents`, `sessions`, `agentDefaultModel` | croner scheduled agent turns (`automation/run`) |
| `preset-openclaw/` | preset/profile | — | internal source for the `clawdsh` profile and `clawdsh` agent preset (`ClawDSH 模式`) |
| `_template/` | skeleton | — | copy-me template for a new plugin |

## 2. Upstream surface — read only, summarized in §3

| Location | Rule |
|---|---|
| `vendor/` | vendored Cordis; sync via `vendor/README.md` |
| `packages/*` except `packages/openclaw/` | all `@deepseek-ai/dsh-*` — do not edit, do not re-read |
| `apps/`, `website/`, `native/`, `python/`, `examples/`, `assets/`, `patches/`, `scripts/` | upstream apps/runtime/SDK/demos/scripts |
| `docs/` upstream pages | `architecture.md`, `development.md`, `glossary.md`, `cordis-primer.md`, … (dsh-centric) |
| root config | `package.json`, `tsconfig*.json`, `tsdown.config.ts`, `vitest*.ts`, … (a few carry additive `@clawdsh/*` entries, ADR-0001) |

Two allowed change kinds, never a third: ① pin a brand section (README/AGENTS); ② an additive ADR-backed edit (the `@clawdsh/*` registration points). Everything else is read-only; on rebase conflict take upstream's version, then replay the brand section and registration entries.

## 3. dsh in one read — the architecture you need

### Cordis: everything is a plugin

A running `dsh` is a tree of plugins. Each plugin contributes services, typed events, and reversible effects to a shared context; every registration goes through `ctx.effect()` / `ctx.on()` and returns a disposer. There is no privileged core — the model adapter, tool registry, session log, and agent loop are all plugins, all replaceable from config.

### Capability seam = Service Definition / Provider / Consumer

A capability is a **seam** with three roles: a Service Definition (the interface), one or more Providers (implementations), and Consumers (dependents). Declared dependencies go in `inject`; optional services use `ctx.get(name)`. A new seam is a big deal — ClawDSH has admitted only two (`ctx.channels`, `ctx.embeddings`), each with an ADR.

### Composition: profile / patch / bundle

`dsh --profile <name>` stacks layers in order: the profile's bundles → the profile's `cordis.patch.yml` → the home-level patch → `--patch` overlays. A patch targets a row by id and replaces its whole config, or inserts a new row. `tools/link-clawdsh.sh` installs the internal `preset-openclaw/profile/cordis.patch.yml` source as the `clawdsh` profile and installs its `clawdsh` preset under the dsh user root.

The clean-install profile keeps Feishu, Telegram, and Automation disabled, so the Web Host can start without their credentials. Those defaults use Loader `disabled` rows only until the Settings control-plane increment moves optional behavior behind mounted plugins' `enabled` settings. Legacy `openclaw` profile and preset directories are warning-only inputs and remain untouched; the public-distribution CLI owns the managed manifest and `clawdsh doctor` repair flow.

### The invariant: model-visible ⟺ logged

Anything that reaches a model request must be reconstructable from the session log. A new model-visible input requires a session event. This is the one rule every ClawDSH feature is checked against (see the per-feature ledger in [product-chain.md](product-chain.md)).

### The seams

| Seam | Owner | Used by | One-line contract |
|---|---|---|---|
| `ctx.systemPrompt` | upstream (`core`) | soul, memory | ordered prompt sections; a `complete` section becomes the whole prompt |
| `ctx.tools` | upstream (`core`) | memory | tool registry; `memory_search`/`memory_get` |
| `ctx.fs` | upstream (`fs`) | memory | filesystem capability + policy |
| `ctx.sessions` | upstream (`core`) | channel-core, automation | in-memory session store; flush, turn events |
| `ctx.agents` | upstream (`core`) | channel-core, automation | agent registry; resume-or-create a turn |
| `ctx.skills` | upstream (`skill`) | skills-hub | skill provider registry |
| `ctx.llm` | upstream (`llm`) | (none yet) | LLM capability (Service Definition + DeepSeek providers) |
| `ctx.subagents` | upstream (`subagent`) | (future federation) | subagent delegation (ADR-0005 transport) |
| `ctx.get(name)` | Cordis | memory (`embeddings`) | generic optional-service accessor |
| `ctx.channels` | **ClawDSH** (ADR-0002) | channel-*, channel-core | channel registry + routing |
| `ctx.embeddings` | **ClawDSH** (ADR-0003) | memory, embeddings-ark | text-embedding seam (abstract `Embeddings`) |
| `ctx.schedule` | absent (no Service seam) | — | upstream has `dsh-schedule` (a reminder *plugin*) and a `ctx.jobs` seam; automation uses neither — croner + `ctx.agents`/`ctx.sessions` directly |

**Full seam list**: upstream exposes 54 services, generated into `packages/extensions/tool-cordis/src/api-catalog.ts` (`SERVICE_API`), with `docs/capability-seams.md` as the human-facing summary. Consult those instead of re-reading `packages/*/src` — the table above lists only what ClawDSH actually touches.

## 4. Reading strategy — what to open, what to skip

| When | Open | Skip |
|---|---|---|
| Every session | this page + the `AGENTS.md` brand section | — |
| Building a ClawDSH feature | `packages/openclaw/<pkg>/src/`, `docs/adr/`, `docs/specs/feature-*.md`, `docs/matrix/parity.md` | upstream `packages/*` source |
| Adding a new seam | the corresponding upstream Service Definition + an ADR | the rest of that upstream package |
| Looking up a seam contract | `docs/capability-seams.md` or `packages/extensions/tool-cordis/src/api-catalog.ts` | `packages/*/src` |
| Rebase/sync | `docs/standards/upstream-sync.md`, `vendor/README.md` | — |
| Debugging upstream behavior | `docs/architecture.md`, the specific package's README | unrelated upstream packages |
| Never | — | re-reading `vendor/` or `packages/*` from scratch |

**Rule of thumb**: upstream is a platform, not a codebase to read. You need the seam contract, not the implementation. Read the seam's Service Definition when you extend it; otherwise trust §3.
