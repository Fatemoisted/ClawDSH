# Agent Note: Soul `source` resolves against the mount tree's `ctx.baseUrl`

Status: implemented

English | [中文](2026-08-14-soul-preset-relative-source.zh.md)

## Problem

`@clawdsh/dsh-soul`'s `source` config resolved against `process.cwd()`, so a soul file shipped inside an agent preset could not be referenced with a relative path — the daemon's cwd has nothing to do with the preset's directory. The stage-2 TODO was "file path resolves relative to the preset directory". A preset's soul should travel with the preset (the preset ships `souls/assistant.md`; `copyComposition` copies the whole composition directory).

## Decision

Resolve a relative `source` against the context's own mount anchor, `ctx.baseUrl`, in `apply`:

```ts ignore-check
const base = ctx.baseUrl === undefined ? undefined : fileURLToPath(ctx.baseUrl)
const text = config.source ? readFileSync(resolve(base ?? '.', config.source), 'utf8') : (config.text ?? '')
```

`ctx.baseUrl` is the existing Loader seam for the config tree's directory: `Include` rewrites it to the directory of each configuration file it loads, agent presets inherit that via `PresetTree extends Include` (so inside an `agent.cordis.yml` subtree it is the composition directory), and the profile launcher anchors it at the profile directory by writing the root `cordis.yml` into the profile. Two upstream plugins already read `ctx.baseUrl` as their config-tree anchor (`typert-loader`, `client-modules`), so soul is joining an established pattern, not inventing one.

Semantics kept deliberately:
- Absolute `source` paths are unchanged (`resolve(base, absolute)` returns the absolute path).
- A context without a base (raw `new Context()` in tests or non-Loader compositions) falls back to `process.cwd()`, so every existing mount keeps working.
- Fail-loud behavior is unchanged: a missing file still throws from `readFileSync`, an empty soul still rejects.

Bundle patch layers provide rows to the root tree, so a relative `source` from a bundle patch resolves against the profile directory rather than the bundle package directory — identical to how relative module specifiers resolve under the Loader. Documented in the soul README.

## Alternatives considered

**Config-only `!!js` workarounds.** Rejected: `source: !!js dshHomePath('profiles/openclaw/souls/assistant.md')` hardcodes the profile name and only covers profile installs; `new URL('souls/assistant.md', ctx.baseUrl)` needs percent-decoding and breaks on Windows. They work today but are worse for preset consumers than the seam itself.

**A profile-directory helper next to `dshHomePath`.** Rejected: fixes only the profile path (not arbitrary `.agent-presets/<id>/` installs) and hardcodes a home layout; `ctx.baseUrl` already covers both install shapes.

**Per-row origin tracking in the Loader (which file provided each row).** Rejected: the only option with true layer provenance, but it touches two vendored packages (`vendor/loader`, `vendor/include`), needs a logged local modification, and is not required unless bundle-relative souls become a real requirement.

## Consequences

- Presets can ship `source: ./souls/assistant.md` and the soul travels with the preset (the `clawdsh` preset does exactly this).
- Relative-path semantics now match relative module specifiers under the Loader — one anchor rule instead of a plugin-specific cwd rule.
- The bundle-patch-layer caveat is a documented limitation, not a regression: before this change, those rows resolved against cwd, which was no better.
