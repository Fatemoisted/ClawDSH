# Feature spec: Soul (persona system)

English | [中文](feature-soul.zh.md)

- **Status**: implemented (Phase 0 Spike ✅ + Phase 2 deep-read finalization ✅, 2026-08-14)
- **Implementation package**: `packages/openclaw/soul` (`@clawdsh/dsh-soul`)
- **OpenClaw counterpart**: Soul system (persona, tone, behavioral guidelines). Baseline source: OpenClaw `v2026.1.5` (`197b8f7c3b`) `src/agents/` identity mechanism (`system-prompt.ts` first line + workspace six files). Phase 2 deep-read conclusion: replace/append fully expresses the mechanism, the "concrete form" finalized as the existing spike unchanged — full mapping in Agent Note [2026-08-14-openclaw-identity-mapping](../../.agents/notes/implemented/architecture/2026-08-14-openclaw-identity-mapping.md).

## Goals

- Every agent can bind a "persona": a versionable, shareable persona definition (self-description, tone, behavioral guidelines, default reply habits);
- Persona mounts as a dsh system-prompt assembly provider: replaces/overlays the default system prompt;
- Persona switching hot-pluggable: unload rolls back, no restart;
- Persona content configured via profile/patch, no upstream source change.

## Non-goals

- No persona marketplace/sharing protocol (later can reuse ClawHub-style distribution, separate spec);
- No inter-agent persona socializing (revisit after Phase 3);
- ~~File paths resolve against the preset directory~~ (Phase 2 wrap-up implemented: relative `source` resolves against the mount tree `ctx.baseUrl`, see Agent Note 2026-08-14-soul-preset-relative-source);
- No soul-file hot-reload (mount freezes it, consistent with the upstream KV-prefix stability design; changing soul = remount);
- **No template bootstrapping (`flag:"wx"` first-boot template write)**: OpenClaw needs it because the first-boot wizard has no preset; ClawDSH explicitly delivers the soul via preset/profile, so ensure-if-missing has no applicable scenario;
- **No `[MISSING] Expected at:` placeholder**: a silent placeholder would put missing identity into the prompt; dsh culture is misconfiguration fail-loud, and soul already throws on empty text/missing file — keep consistent.

## Seam (confirmed by Spike)

`ctx.systemPrompt` (`@deepseek-ai/dsh-system-prompt`): `section({name, order, text, complete?})` contributes ordered prompt sections (order 0 = deploy persona, 100–199 = tool guidance; a `complete` section becomes the sole prompt after assembly). Scope via `@deepseek-ai/dsh-scope`'s `createScope`/`scopeOf` (scope-only line, isomorphic with upstream `dsh-persona`).

**Conclusion: the seam hypothesis holds** — no upstream source line needs changing; soul mounts as an independent line to replace/overlay the persona.

### Phase 2 deep-read finalization: OpenClaw identity mapping

OpenClaw identity consists of four layers (gateway has no assembly code, all in `src/agents/`): hardcoded first line → `deployment:persona` (order 0); `SOUL.md` → soul `append` (order 10); "soul as complete prompt" → `replace`=complete section; `AGENTS.md` → carried by preset soul text; `TOOLS.md` → tool guidance band (100–199, each toolkit self-supplied); `IDENTITY.md` (name/emoji) → channel presentation, not prompt (Deferred); `USER.md` → preset persona/soul text; per-run scenario sections → `PromptContext`; `system-prompt-report` → `request/header.header.system` log chain. Full mapping table and the "why not complete" argument in [Agent Note](../../.agents/notes/implemented/architecture/2026-08-14-openclaw-identity-mapping.md).

## Config surface (draft)

```yaml
soul:
  enabled: true
  source: ./souls/<name>.md        # 或远端 URL / ClawHub 引用
  # 叠加模式：replace（替换默认系统提示）| append（追加段落）
  mode: replace
```

## Acceptance criteria (Phase 0 conclusion)

1. ✅ **Replace system prompt**: in replace mode the soul becomes the complete system prompt (test: `replace mode: the soul is the complete system prompt`, renderPrompt exactly equals the soul text);
2. ✅ **Hot-plug**: prompt restores to default after fiber dispose (test: `restores the default prompt when its fiber unloads`); two scoped personas don't interfere (`gives two scopes independent souls`);
3. ✅ **No upstream source change**: only adds `packages/openclaw/soul` + build registration (tsconfig paths/reference, ADR-0001 exemption); full `pnpm typecheck` green;
4. ✅ **Logging invariant**: soul text is a prompt section, participating in assembly enters the session event stream (guaranteed by the upstream session mechanism, "model-visible means logged");
5. ✅ **Profile layering**: `--profile openclaw --dump-config` resolves dsh-base + dsh-headless + our persona override (smoke passed).
6. ⏳ **Real agent mounts preset** under `--profile openclaw`: belongs to Phase 2 (preset wiring for the headless form), see preset-openclaw/README.md.
7. ✅ **Identity mapping documented (Phase 2 deep-read finalization)**: the complete mapping from OpenClaw's four-layer identity to dsh seams lands consistently in three places (Agent Note `.agents/notes/implemented/architecture/2026-08-14-openclaw-identity-mapping`, this spec, and the parity matrix); soul code zero change.
8. ✅ **File path resolves against preset directory (Phase 2 wrap-up)**: relative `source` resolves anchored at the mount tree `ctx.baseUrl` (preset → composition directory, profile → profile directory, bare context → cwd fallback); 12 test cases include baseUrl relative resolution and cwd fallback.

**Phase 0 exit criteria met: the seam hypothesis holds, the project continues. Phase 2 deep-read finalization: the replace/append form is the final form.**
