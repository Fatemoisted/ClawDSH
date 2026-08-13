# @clawdsh/dsh-soul

English | [中文](README.zh.md)

**Purpose**: the persona system (Soul) — OpenClaw's Soul concept realized on the dsh system-prompt seam: each agent scope can mount a "soul" (a Markdown file or inline text) that becomes that agent's system-prompt identity. This is the validation target of the ClawDSH stage 0 Spike.

**OpenClaw correspondence**: the Soul system (persona, tone, code of conduct). Baseline source: the identity mechanism in OpenClaw `v2026.1.5` `src/agents/` (see docs/matrix/parity.md). Finalized in the stage 2 deep read: replace/append is the final form; see "OpenClaw identity mapping" below for the mapping.

**Seam**: `ctx.systemPrompt` (`@deepseek-ai/dsh-system-prompt`) + the `@deepseek-ai/dsh-scope` scope primitives. **No new seam.** Isomorphic with upstream `@deepseek-ai/dsh-persona` (the scope-only row); the difference is that the text comes from a soul file and `append` mode layers it as an independent section (preserving the deployment persona) rather than only shadow-replacing it.

**Specification**: docs/specs/feature-soul.md · **Status**: implemented (Spike ✅)

## Usage

Mounted within an agent scope (i.e. inside the agent preset's `agent.cordis.yml`; see `../preset-openclaw/`):

```yaml
- id: soul
  name: '@clawdsh/dsh-soul'
  config:
    source: ./souls/assistant.md   # relative to the mount tree's ctx.baseUrl; takes precedence over text
    # text: 也可以直接内联
    mode: replace                  # replace=灵魂即完整系统提示；append（默认）=叠加段落
    precedenceNote: true           # append default: precedence note baked ahead of the soul text; never in replace
    includeRuntimeContext: true    # false 时抑制该作用域的运行时上下文快照
```

## OpenClaw identity mapping (finalized in stage 2 deep read)

OpenClaw's identity is composed of four layers (there is no assembly code in `src/gateway/`, all of it lives in `src/agents/`); soul's replace/append already fully covers the "persona-bearing" part of it, and the rest maps to existing dsh seams — see the [Agent Note](../../../.agents/notes/implemented/architecture/2026-08-14-openclaw-identity-mapping.md) for the complete argument:

| OpenClaw identity component | dsh realization |
|---|---|
| Hardcoded first line of `system-prompt.ts` | `deployment:persona` (order 0, explicit deployment config) |
| `SOUL.md` persona | soul `append` (`clawdsh:soul`, order 10) |
| "Soul as the complete system prompt" minimal form | soul `replace` (the complete section alone) |
| `AGENTS.md` operating instructions | carried by preset soul text |
| `TOOLS.md` tool-usage preferences | tool guidance band (order 100–199, carried by each toolkit) |
| `IDENTITY.md` name/emoji | channel presentation, not prompt (Deferred) |
| `USER.md` user profile | preset persona/soul text |
| `BOOTSTRAP.md` first-boot ritual | not a target (preset explicitly hands down the soul; no cold-start scenario) |
| Per-run scenario section | `PromptContext` (not part of soul) |
| `system-prompt-report` | `request/header.header.system` log chain (established) |

Does not add template bootstrapping or the `[MISSING]` placeholder: the former serves first boot without a preset (a scenario ClawDSH does not have); the latter conflicts with dsh's fail-loud culture (soul already throws on empty text or a missing file).

## Design notes

- **scope-only**: mounting without a scope errors out immediately (avoiding publishing a process-level soul), consistent with upstream persona's constraint;
- **fixed at mount**: the soul text is read once at mount and does not change while running — the prompt prefix is stable, so KV-cache reuse is unaffected (following upstream's design); swapping the soul = re-mounting (patch + session restart);
- **relative `source` resolved against the mount tree**: a relative path is anchored to `ctx.baseUrl` — the composition directory inside an agent preset (the preset directory propagates with `copyComposition`, and the soul file follows it), or the profile directory under a profile launcher; a bare context with no baseUrl falls back to `process.cwd()`. Same semantics as relative module specifiers (the typert-loader/client-modules seam);
- **precedence note**: in append mode an OpenClaw-style precedence note (`SOUL_PRECEDENCE_NOTE`) is baked in ahead of the soul text, positioning the soul as persona/tone guidance overridable by higher-priority instructions (such as direct user instructions); `precedenceNote: false` turns it off, and replace mode never adds it;
- **reversible**: every registration goes through `ctx.effect()`, so unmounting rolls it back (hot-swappable);
- **log invariant**: the soul text participates in assembly as a prompt section; "model-visible means logged" is guaranteed by upstream's session mechanism.

## Changelog

- 0.1.0: initial Spike implementation (replace/append dual modes + file loading + contract tests).
- 0.1.0 (2026-08-14 deep-read finalization): documented the OpenClaw identity mapping (README/spec/matrix consistent across all three), zero code changes.
- 0.1.0 (2026-08-14): append mode gains the precedence note (`precedenceNote`, default true; see Model Experience).

## Model Experience

### The soul section

#### What the model sees

The soul text (from `source` file or inline `text`) is added as an ordered system-prompt section through `ctx.systemPrompt.section(...)`. In `replace` mode the model sees only the soul text as the system prompt; in `append` mode it appears as a section alongside the deployment persona.

#### Token effect

Fixed per mounted scope: the soul's own tokens appear on every request an agent in that scope makes, and none for agents outside it. Empty text contributes nothing.

#### KV Cache effect

Prefix-stable for the life of an agent — the text is read once at mount, before the first request, and never changes while the agent runs.

### Append-mode soul system prompt section

#### What the model sees

The `clawdsh:soul` section rendered right after the deployment persona, with the precedence note baked in ahead of the soul text and separated from it by one blank line. The note tells the model that the soul is persona-and-tone guidance, overridable by higher-priority instructions such as direct user instructions. Replace-mode souls render as the complete system prompt instead — no note, no other section.

##### Verbatim precedence note

```markdown
Soul: persona and tone. Follow it unless higher-priority instructions (such as direct user instructions) override it.
```

#### Token effect

Fixed for a given mount: in append mode the note costs about 20 tokens on every request that agent makes, and none for any other agent. With `precedenceNote: false` it costs nothing; replace mode never adds it.

#### KV Cache effect

Prefix-stable for the life of the mount: the note is baked in at mount time, ahead of the soul text, so the rendered section stays immutable until a re-mount (patch + session restart) swaps the soul or the flag. Either change invalidates reuse only from the soul section onward.

## Known Limitations and Deferred Work

- **fixed at mount**: the soul text is read once at mount and does not change while running; swapping the soul requires re-mounting + session restart.
- **scope-only**: mounting without a scope errors out immediately, avoiding publishing a process-level soul (consistent with upstream persona's constraint).
- **relative `source` at the bundle-patch layer**: a line supplied by the bundle-patch layer resolves to the profile directory (the root tree's baseUrl), not the bundle package directory — same semantics as relative module specifiers, not a defect.
- **no remote reference**: OpenClaw's remote URL / ClawHub soul references are not supported; the soul text must come from a local file or inline text.
- **real e2e**: the assembly test for system-prompt composition needs a real key; currently covered by contract tests (12 cases).
