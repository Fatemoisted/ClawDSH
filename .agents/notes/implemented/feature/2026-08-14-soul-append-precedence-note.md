# Agent Note: Soul append mode gains an OpenClaw-style precedence note

Status: implemented

English | [中文](2026-08-14-soul-append-precedence-note.zh.md)

## Problem

OpenClaw injects each soul.md into the system prompt with a precedence declaration: "SOUL.md: persona/tone. Follow it unless higher-priority instructions override." ClawDSH's append mode registered the soul text as a bare `clawdsh:soul` section, so nothing in the assembled prompt told the model where the persona stands in the instruction hierarchy — it could be read as overriding direct user instructions — and the rendered prompt diverged from the tracked OpenClaw baseline. Replace mode already renders the soul as the complete prompt (stronger than any declaration), and its exact-render contract forbids adding text there, so the note belongs to append mode only.

## Decision

The package exports `SOUL_PRECEDENCE_NOTE` — "Soul: persona and tone. Follow it unless higher-priority instructions (such as direct user instructions) override it." — OpenClaw's semantic skeleton, with the file-name prefix dropped (the soul can be inline text) and the parenthetical example reusing dsh's existing "direct user instructions" vocabulary so the two precedence texts do not conflict. `Config` gains `precedenceNote?: boolean` (schema default `true`, the same boolean style as `includeRuntimeContext`). `apply()` prepends `NOTE + '\n\n' + text` in append mode only, after the empty-text guard and before section registration; replace mode never adds it. The model-visible text is pinned verbatim by the soul tests and the README Model Experience section.

## Alternatives considered

- **Verbatim OpenClaw text** — rejected. The `SOUL.md:` prefix names a file that inline-text souls do not have, and `persona/tone` reads like a path.
- **Note without the parenthetical example** — rejected. It saves about 6 tokens but loses the shared vocabulary anchor: dsh's own workspace-context intro already uses "direct user instructions".
- **A separate order-9 section for the note** — rejected. Renders identically but adds a registry name and a disposal path for no benefit.
- **Always-on note with no flag** — rejected. Deployment-varying text presence must be a validated Config field (no hardcoded tunables), and replace mode must stay byte-exact.
- **Bake the note into the soul file format** — rejected. It couples the declaration to a file-format upgrade and breaks replace mode's exact-render contract.

## Consequences

- Append-mode souls carry about 20 extra tokens on every request; `precedenceNote: false` removes them, and replace mode never adds them.
- The note is baked in at mount time, ahead of the soul text, so the rendered section stays prefix-stable; changing the flag or the soul is a mount-time config change (re-mount).
- One exported constant plus one schema field; the module JSDoc, the README, and the feature spec all record the three states.

## Verification

- 13 contract tests in `packages/openclaw/soul/tests/soul.spec.ts`: three new (bare append under `precedenceNote: false`, replace immunity under both flag values, apply-level fallbacks) plus five existing assertions pinned to the note-bearing text; 100% statement/branch/function/line coverage on `src/index.ts`.
- The soul README passes `verify-package-readme-model-experience` and `verify-package-readme-limitations` (new Model Experience entry with a verbatim-pinned note fence, plus a Known Limitations section).
- `pnpm run typecheck` stays green; the `--dump-config` smoke is unaffected.
